import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const root = dirname(fileURLToPath(import.meta.url));
loadLocalEnvFile();
const dataRoot = process.env.DISPATCH_DATA_DIR ? resolve(process.env.DISPATCH_DATA_DIR) : root;
const usesExternalDataDir = dataRoot !== root;
const defaultMapsDir = join(root, "maps");
const defaultIncidentsFile = join(root, "incidents-data.json");
const mapsDir = join(dataRoot, "maps");
const incidentsFile = join(dataRoot, "incidents-data.json");
const maxBodyBytes = 2_000_000;
const adminPassword = process.env.DISPATCH_ADMIN_PASSWORD || "XXX112XXX";
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "OPENROUTER_API_KEY_HIER_EINTRAGEN";
const openRouterModel = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-pro";
const openRouterReferer = process.env.OPENROUTER_SITE_URL || "http://127.0.0.1:4173";
const openRouterAppName = process.env.OPENROUTER_APP_NAME || "Leitstellen-SIM";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/maps")) {
      await handleMapsApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/api/incidents")) {
      await handleIncidentsApi(request, response);
      return;
    }
    if (url.pathname === "/api/route") {
      await handleRouteApi(request, response, url);
      return;
    }
    if (url.pathname === "/api/reverse-geocode") {
      await handleReverseGeocodeApi(request, response, url);
      return;
    }
    if (url.pathname === "/api/osm-pois") {
      await handleOsmPoiApi(request, response);
      return;
    }
    if (url.pathname === "/api/admin-login") {
      await handleAdminLogin(request, response);
      return;
    }
    if (url.pathname === "/api/generate-incident") {
      await handleGenerateIncidentApi(request, response);
      return;
    }
    await serveStaticFile(request, response, url);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "internal server error" }, 500);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} ist bereits belegt. Wahrscheinlich laeuft DispatchSim schon unter http://127.0.0.1:${port}/`);
    console.error("Nutze das vorhandene Browserfenster oder beende den alten Node-Prozess, bevor du den Server neu startest.");
    if (process.env.DISPATCH_ELECTRON === "1") return;
    process.exit(1);
  }
  throw error;
});

await ensureWritableDataFiles();

server.listen(port, "127.0.0.1", () => {
  console.log(`DispatchSim running at http://127.0.0.1:${port}/`);
  if (usesExternalDataDir) {
    console.log(`Writable app data: ${dataRoot}`);
  }
  if (!process.env.DISPATCH_ADMIN_PASSWORD) {
    console.log("Admin password uses the development default. Set DISPATCH_ADMIN_PASSWORD to override it.");
  }
});

async function ensureWritableDataFiles() {
  await mkdir(mapsDir, { recursive: true });
  if (!usesExternalDataDir) return;

  await seedDefaultMaps();
  if (!existsSync(incidentsFile) && existsSync(defaultIncidentsFile)) {
    await copyDefaultFile(defaultIncidentsFile, incidentsFile);
  }
}

async function seedDefaultMaps() {
  if (!existsSync(defaultMapsDir)) return;
  await mkdir(mapsDir, { recursive: true });

  const existingFiles = new Set((await readdir(mapsDir)).filter((file) => file.endsWith(".json")));
  const defaultFiles = (await readdir(defaultMapsDir)).filter((file) => file.endsWith(".json"));
  for (const file of defaultFiles) {
    if (existingFiles.has(file)) continue;
    await copyDefaultFile(join(defaultMapsDir, file), join(mapsDir, file));
  }
}

async function copyDefaultFile(sourceFile, targetFile) {
  await writeFile(targetFile, await readFile(sourceFile, "utf8"), "utf8");
}

async function serveStaticFile(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeContentPath(requestedPath);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function handleReverseGeocodeApi(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (![lat, lng].every(Number.isFinite)) {
    sendJson(response, { error: "invalid coordinates" }, 400);
    return;
  }
  try {
    const data = await reverseGeocodeNearest(lat, lng);
    if (!data) return sendJson(response, { error: "geocoding unavailable" }, 502);
    sendJson(response, data);
  } catch {
    sendJson(response, { error: "geocoding unavailable" }, 502);
  }
}

async function reverseGeocodeNearest(lat, lng) {
  for (const zoom of [18, 17, 16]) {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}&addressdetails=1`;
    const geocodeResponse = await fetch(nominatimUrl, {
      headers: {
        accept: "application/json",
        "user-agent": "Leitstellen-SIM-v2 local development"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!geocodeResponse.ok) continue;
    const data = await geocodeResponse.json();
    if (geocodeHasStreet(data) || zoom === 16) return data;
  }
  return null;
}

function geocodeHasStreet(data) {
  const address = data?.address || {};
  return Boolean(address.road || address.pedestrian || address.footway || address.cycleway || address.path || address.residential || data?.display_name);
}

async function handleRouteApi(request, response, url) {
  if (request.method !== "GET") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const fromLng = Number(url.searchParams.get("fromLng"));
  const fromLat = Number(url.searchParams.get("fromLat"));
  const toLng = Number(url.searchParams.get("toLng"));
  const toLat = Number(url.searchParams.get("toLat"));
  if (![fromLng, fromLat, toLng, toLat].every(Number.isFinite)) {
    sendJson(response, { error: "invalid coordinates" }, 400);
    return;
  }
  const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  try {
    const routeResponse = await fetch(osrmUrl, { signal: AbortSignal.timeout(6000) });
    if (!routeResponse.ok) {
      sendJson(response, { error: "route unavailable" }, 502);
      return;
    }
    const data = await routeResponse.json();
    sendJson(response, data);
  } catch {
    sendJson(response, { error: "route unavailable" }, 502);
  }
}

const osmPoiCategories = {
  practice: {
    label: "Arztpraxis",
    queries: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
    matchAny: [[{ key: "amenity", value: "doctors" }], [{ key: "healthcare", value: "doctor" }]]
  },
  dentist: {
    label: "Zahnarztpraxis",
    queries: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    matchAny: [[{ key: "amenity", value: "dentist" }], [{ key: "healthcare", value: "dentist" }]]
  },
  dialysis: {
    label: "Dialyse",
    queries: ['["healthcare"="dialysis"]', '["healthcare:speciality"~"dialysis",i]'],
    matchAny: [[{ key: "healthcare", value: "dialysis" }], [{ key: "healthcare:speciality", regex: /dialysis/i }]]
  },
  "nursing-home": {
    label: "Alten-/Pflegeheim",
    queries: [
      '["amenity"="nursing_home"]',
      '["amenity"="retirement_home"]',
      '["amenity"="social_facility"]["social_facility"~"nursing_home|assisted_living|group_home",i]'
    ],
    matchAny: [
      [{ key: "amenity", value: "nursing_home" }],
      [{ key: "amenity", value: "retirement_home" }],
      [{ key: "amenity", value: "social_facility" }, { key: "social_facility", regex: /nursing_home|assisted_living|group_home/i }]
    ]
  },
  school: {
    label: "Schule",
    queries: ['["amenity"="school"]'],
    matchAny: [[{ key: "amenity", value: "school" }]]
  },
  kindergarten: {
    label: "Kindergarten",
    queries: ['["amenity"="kindergarten"]'],
    matchAny: [[{ key: "amenity", value: "kindergarten" }]]
  },
  university: {
    label: "Universität",
    queries: ['["amenity"="university"]', '["amenity"="college"]'],
    matchAny: [[{ key: "amenity", value: "university" }], [{ key: "amenity", value: "college" }]]
  },
  "railway-station": {
    label: "Bahnhöfe",
    queries: ['["railway"="station"]', '["railway"="halt"]'],
    matchAny: [[{ key: "railway", value: "station" }], [{ key: "railway", value: "halt" }]]
  },
  "fire-station": {
    label: "Feuerwehr",
    queries: ['["amenity"="fire_station"]'],
    matchAny: [[{ key: "amenity", value: "fire_station" }]]
  },
  police: {
    label: "Polizei",
    queries: ['["amenity"="police"]'],
    matchAny: [[{ key: "amenity", value: "police" }]]
  },
  townhall: {
    label: "Rathaus",
    queries: ['["amenity"="townhall"]'],
    matchAny: [[{ key: "amenity", value: "townhall" }]]
  },
  church: {
    label: "Kirche",
    queries: ['["amenity"="place_of_worship"]["religion"="christian"]', '["building"="church"]'],
    matchAny: [
      [{ key: "amenity", value: "place_of_worship" }, { key: "religion", value: "christian" }],
      [{ key: "building", value: "church" }]
    ]
  },
  cinema: {
    label: "Kino",
    queries: ['["amenity"="cinema"]'],
    matchAny: [[{ key: "amenity", value: "cinema" }]]
  },
  "sports-centre": {
    label: "Sportzentrum",
    queries: ['["leisure"="sports_centre"]', '["leisure"="stadium"]'],
    matchAny: [[{ key: "leisure", value: "sports_centre" }], [{ key: "leisure", value: "stadium" }]]
  },
  mall: {
    label: "Einkaufszentrum",
    queries: ['["shop"="mall"]'],
    matchAny: [[{ key: "shop", value: "mall" }]]
  },
  hotel: {
    label: "Hotel",
    queries: ['["tourism"="hotel"]', '["tourism"="motel"]', '["tourism"="guest_house"]'],
    matchAny: [[{ key: "tourism", value: "hotel" }], [{ key: "tourism", value: "motel" }], [{ key: "tourism", value: "guest_house" }]]
  }
};

async function handleOsmPoiApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(request, response, {});
  if (!payload) return;
  const categories = [...new Set((payload.categories || []).filter((key) => osmPoiCategories[key]))];
  if (!categories.length) {
    sendJson(response, { error: "no supported categories selected" }, 400);
    return;
  }
  const selector = overpassSpatialSelector(payload);
  if (!selector) {
    sendJson(response, { error: "invalid coverage area" }, 400);
    return;
  }
  const query = buildOverpassPoiQuery(categories, selector);
  try {
    const overpassResponse = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        "user-agent": "Leitstellen-SIM-v2 local POI import"
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(30000)
    });
    if (!overpassResponse.ok) {
      sendJson(response, { error: "overpass unavailable" }, 502);
      return;
    }
    const data = await overpassResponse.json();
    const poi = normalizeOsmPoiElements(data.elements || [], categories);
    sendJson(response, { poi, count: poi.length, categories });
  } catch {
    sendJson(response, { error: "overpass unavailable" }, 502);
  }
}

function buildOverpassPoiQuery(categories, selector) {
  const queries = categories.flatMap((key) => osmPoiCategories[key].queries);
  const parts = queries.flatMap((filter) => [
    `node${filter}${selector};`,
    `way${filter}${selector};`,
    `relation${filter}${selector};`
  ]);
  return `[out:json][timeout:25];(${parts.join("")});out body center 1200;`;
}

function overpassSpatialSelector(payload) {
  const polygon = Array.isArray(payload.polygon) ? payload.polygon : [];
  const points = polygon
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length >= 3) {
    const closed = sameCoordinate(points[0], points.at(-1)) ? points : [...points, points[0]];
    return `(poly:"${closed.map((point) => `${point.lat} ${point.lng}`).join(" ")}")`;
  }
  const bounds = payload.bounds || {};
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if ([south, west, north, east].every(Number.isFinite) && south < north && west < east) {
    return `(${south},${west},${north},${east})`;
  }
  return null;
}

function sameCoordinate(a, b) {
  return a && b && Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
}

function normalizeOsmPoiElements(elements, wantedCategories) {
  const byId = new Map();
  elements.forEach((element) => {
    const tags = element.tags || {};
    const lat = Number(element.lat ?? element.center?.lat);
    const lng = Number(element.lon ?? element.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const categories = osmCategoriesForTags(tags, wantedCategories);
    if (!categories.length) return;
    const id = `osm-${element.type}-${element.id}`;
    const existing = byId.get(id);
    if (existing) {
      existing.categories = [...new Set([...existing.categories, ...categories])];
      return;
    }
    const primaryCategory = osmPoiCategories[categories[0]];
    byId.set(id, {
      id,
      label: tags.name || tags.operator || `${primaryCategory?.label || "OSM-POI"} ${element.id}`,
      address: osmAddressLabel(tags),
      lat,
      lng,
      categories,
      source: "osm",
      osmType: element.type,
      osmId: element.id
    });
  });
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
}

function osmCategoriesForTags(tags, wantedCategories) {
  return wantedCategories.filter((key) =>
    (osmPoiCategories[key]?.matchAny || []).some((rule) => rule.every((condition) => osmConditionMatches(tags, condition)))
  );
}

function osmConditionMatches(tags, condition) {
  const value = tags[condition.key];
  if (condition.value !== undefined) return value === condition.value;
  if (condition.regex) return condition.regex.test(String(value || ""));
  return false;
}

function osmAddressLabel(tags) {
  if (tags["addr:full"]) return tags["addr:full"];
  const street = tags["addr:street"] || tags["addr:place"];
  const number = tags["addr:housenumber"];
  const city = tags["addr:city"] || tags["addr:suburb"] || tags["addr:municipality"];
  const first = [street, number].filter(Boolean).join(" ");
  return [first, city].filter(Boolean).join(", ") || "OSM-POI";
}

async function handleMapsApi(request, response, url) {
  await mkdir(mapsDir, { recursive: true });
  const id = url.pathname.split("/").filter(Boolean)[2];
  if (request.method === "GET" && !id) {
    const maps = await readSavedMaps();
    sendJson(response, maps.map((map) => ({
      id: map.id,
      name: map.name,
      stations: Array.isArray(map.stations) ? map.stations.length : 0,
      hospitals: Array.isArray(map.hospitals) ? map.hospitals.length : 0
    })));
    return;
  }
  if (request.method === "GET" && id) {
    const file = mapFilePath(id);
    if (!file || !existsSync(file)) return notFound(response);
    const map = await readJsonFile(file);
    if (!isValidMap(map)) return sendJson(response, { error: "invalid map file" }, 500);
    sendJson(response, map);
    return;
  }
  if (request.method === "POST") {
    const map = await readJsonBody(request, response, {});
    if (!map) return;
    map.id = safeId(map.id || map.name || `map-${Date.now()}`);
    if (!isValidMap(map)) return sendJson(response, { error: "invalid map payload" }, 400);
    await writeJsonFile(mapFilePath(map.id), map);
    sendJson(response, map);
    return;
  }
  if (request.method === "DELETE" && id) {
    const file = mapFilePath(id);
    if (file && existsSync(file)) await unlink(file);
    sendJson(response, { ok: true });
    return;
  }
  notFound(response);
}

async function handleIncidentsApi(request, response) {
  if (request.method === "GET") {
    if (!existsSync(incidentsFile)) return sendJson(response, []);
    const incidents = await readJsonFile(incidentsFile);
    sendJson(response, Array.isArray(incidents) ? incidents : []);
    return;
  }
  if (request.method === "POST") {
    const incidents = await readJsonBody(request, response, []);
    if (!incidents) return;
    if (!Array.isArray(incidents)) return sendJson(response, { error: "invalid incidents payload" }, 400);
    await writeJsonFile(incidentsFile, incidents);
    sendJson(response, incidents);
    return;
  }
  notFound(response);
}

async function handleAdminLogin(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const body = await readJsonBody(request, response, {});
  if (!body) return;
  sendJson(response, { ok: body.password === adminPassword });
}

async function handleGenerateIncidentApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  if (!isOpenRouterConfigured()) {
    sendJson(response, {
      error: "OpenRouter API-Key fehlt. Setze OPENROUTER_API_KEY als System-Umgebungsvariable oder optional in einer nicht versionierten .env-Datei."
    }, 503);
    return;
  }

  const body = await readJsonBody(request, response, {});
  if (!body) return;
  const userPrompt = String(body.prompt || "").trim();
  if (userPrompt.length < 8) {
    sendJson(response, { error: "Bitte eine kurze Beschreibung fuer den KI-Einsatz eingeben." }, 400);
    return;
  }

  try {
    const generated = await generateIncidentWithOpenRouter(userPrompt);
    const incident = normalizeGeneratedIncident(generated, userPrompt);
    sendJson(response, { incident, model: openRouterModel });
  } catch (error) {
    sendJson(response, { error: error.message || "KI-Generierung fehlgeschlagen" }, 502);
  }
}

function isOpenRouterConfigured() {
  return Boolean(openRouterApiKey && openRouterApiKey !== "OPENROUTER_API_KEY_HIER_EINTRAGEN");
}

async function generateIncidentWithOpenRouter(userPrompt) {
  const first = await requestOpenRouterIncident(userPrompt, false);
  if (first.content) {
    try {
      return parseGeneratedIncidentJson(first.content);
    } catch (error) {
      logOpenRouterJsonFailure("parse-first", first, error);
    }
  } else {
    logOpenRouterJsonFailure("empty-first", first);
  }
  const retry = await requestOpenRouterIncident(userPrompt, true);
  if (retry.content) {
    try {
      return parseGeneratedIncidentJson(retry.content);
    } catch (error) {
      logOpenRouterJsonFailure("parse-retry", retry, error);
    }
  } else {
    logOpenRouterJsonFailure("empty-retry", retry);
  }
  throw new Error("OpenRouter hat keine JSON-Antwort geliefert.");
}

async function requestOpenRouterIncident(userPrompt, retry = false) {
  const messages = retry
    ? [
        { role: "system", content: `${incidentGenerationSystemPrompt()}\n\nWICHTIG: Gib jetzt nur ein einziges JSON-Objekt aus. Kein Denken, keine Erklaerung, kein leerer Inhalt.` },
        { role: "user", content: `${userPrompt}\n\nAntworte ausschliesslich als JSON object.` }
      ]
    : [
        { role: "system", content: incidentGenerationSystemPrompt() },
        { role: "user", content: userPrompt }
      ];
  const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openRouterApiKey}`,
      "content-type": "application/json",
      "HTTP-Referer": openRouterReferer,
      "X-Title": openRouterAppName
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: retry ? 0.2 : 0.55,
      max_tokens: retry ? 1400 : 1800,
      response_format: { type: "json_object" },
      reasoning: {
        effort: "none",
        exclude: true
      },
      include_reasoning: false,
      messages
    }),
    signal: AbortSignal.timeout(60000)
  });

  const data = await openRouterResponse.json().catch(() => null);
  if (!openRouterResponse.ok) {
    const message = data?.error?.message || data?.message || `OpenRouter Fehler ${openRouterResponse.status}`;
    throw new Error(message);
  }
  const message = data?.choices?.[0]?.message || {};
  const rawContent = message.content ?? message.reasoning_content ?? data?.choices?.[0]?.text;
  const content = Array.isArray(rawContent)
    ? rawContent.map((part) => part?.text || part?.content || "").join("")
    : rawContent;
  const fallbackContent = content || jsonFromReasoningDetails(message.reasoning_details);
  return { content: String(fallbackContent || "").trim(), raw: data, status: openRouterResponse.status };
}

function jsonFromReasoningDetails(details) {
  if (!Array.isArray(details)) return "";
  return details
    .map((detail) => detail?.text || detail?.content || detail?.reasoning || "")
    .join("\n");
}

function logOpenRouterJsonFailure(stage, result, error = null) {
  const choice = result?.raw?.choices?.[0] || {};
  const message = choice.message || {};
  const rawContent = message.content ?? message.reasoning_content ?? choice.text ?? "";
  const reasoningDetails = Array.isArray(message.reasoning_details)
    ? message.reasoning_details.map((detail) => detail?.text || detail?.content || detail?.reasoning || "").join("\n")
    : "";
  const printable = {
    stage,
    status: result?.status || null,
    model: result?.raw?.model || null,
    provider: result?.raw?.provider || null,
    finish_reason: choice.finish_reason || null,
    native_finish_reason: choice.native_finish_reason || null,
    error: error?.message || null,
    content_preview: truncateForLog(rawContent),
    reasoning_preview: truncateForLog(reasoningDetails),
    raw_preview: truncateForLog(JSON.stringify(result?.raw || {}))
  };
  console.warn("[OpenRouter JSON Fehler]", JSON.stringify(printable, null, 2));
}

function truncateForLog(value, maxLength = 1800) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}... [gekuerzt, ${text.length} Zeichen]`;
}

function incidentGenerationSystemPrompt() {
  return `Du generierst Einsatzvorlagen fuer eine deutsche Rettungsdienst-Leitstellen-Simulation.
Antworte ausschliesslich als valides JSON-Objekt ohne Markdown.
Das Wort JSON ist absichtlich genannt: Die Antwort muss ein JSON object sein.

Ziel: Erzeuge genau einen Einsatz im bestehenden Katalogformat. Verwende realistische, kurze Texte.
Namen duerfen Platzhalter nutzen: *Vorname*, *Nachname*, *Name*. Bei Nachname setzt die Simulation automatisch Frau/Herr davor.

JSON-Schema:
{
  "category": "Herz/Kreislauf|Atmung|Trauma|Neuro/Psych|Sonstiges|Krankentransport",
  "title": "kurzer Einsatzname inklusive RD-Stufe, z.B. RD 1 Herz/Kreislauf - Brustschmerz",
  "type": "emergency|transport|scheduled",
  "timeWindows": [{"start":"8","end":"18"}],
  "variants": [{
    "callerName": "Anrufer",
    "callerText": "Notruftext, mehrere Varianten mit | trennen",
    "locationMode": "random|hospital|poi",
    "poiCategories": ["practice|dentist|dialysis|nursing-home|school|kindergarten|university|railway-station|fire-station|police|townhall|church|cinema|sports-centre|mall|hotel|public|home"],
    "destinationMode": "none|poi",
    "destinationPoiProbability": 0,
    "destinationPoiCategories": ["practice|dentist|dialysis|nursing-home|home"],
    "requiredServices": ["FW","POL"],
    "report": "kurze Rueckmeldung an die Leitstelle, z.B. Zustand und benoetigtes Transportmittel, kein Abschlussbericht",
    "situationReport": "Lagemeldung bei mehreren Patienten",
    "patients": [{
      "options": [{"probability":1,"vehicles":["RTW"]}],
      "requiredDepartmentKeys": ["internal|cardiology|neurology|trauma|pediatrics|obstetrics|psychiatry|stroke|icu|none"],
      "transportSignalProbability": 0,
      "conditionReport": "individuelle Patientenrueckmeldung",
      "noTransportProbability": 0,
      "noTransportText": "Ambulante Versorgung ausreichend, kein Transport.",
      "requiresDoctorAccompaniment": false,
      "needsFW": false,
      "needsPOL": false
    }]
  }]
}

Regeln:
- Erlaubte Fahrzeugtypen: KTW, RTW, NEF, REF, RTH.
- options-Wahrscheinlichkeiten pro Patient muessen zusammen etwa 1 ergeben.
- KTP ueber 19222 oder mit Anrufer ist type transport, auch wenn die Fahrt zeitlich geplant ist. type scheduled nur fuer automatisch im Hintergrund entstehende Planfahrten ohne Telefonanruf und ohne initial zugewiesenes Fahrzeug.
- RTW-Notfaelle ca. 1 Patient, requiredDepartmentKeys passend zur Lage.
- requiredDepartmentKeys ist eine Mehrfachauswahl. Setze bei Bedarf mehrere Fachrichtungen, z.B. ["trauma","icu"] bei Polytrauma, ["neurology","stroke"] bei Schlaganfall, ["internal","cardiology"] bei ACS. Nutze ["none"] nur, wenn kein Klinikziel gebraucht wird.
- NEF/RTH nur bei kritisch, Bewusstlosigkeit, Reanimation, schwerem Trauma, Geburt/Kind kritisch oder Notarztbegleitung.
- destinationMode poi nur fuer Fahrten zu Arztpraxis, Zahnarztpraxis, Dialyse oder andere echte POI-Ziele. Heimfahrt nach Hause nicht als POI-Ziel modellieren.
- locationMode poi nur wenn der Einsatz sinnvoll an einer echten POI-Kategorie startet. Wohnadresse/Privatadresse ist locationMode random.
- report und situationReport beschreiben die Lage nach Erkundung, nicht dass der Transport bereits abgeschlossen ist.
- Setze requiredServices nur wenn FW/POL wirklich vor Transport erforderlich sind.
- Keine Koordinaten, keine IDs, keine Kommentare.`;
}

function parseGeneratedIncidentJson(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("KI-Antwort war kein valides JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeGeneratedIncident(input, fallbackTitle) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("KI-JSON muss ein Objekt sein.");
  if (input.incident && typeof input.incident === "object" && !Array.isArray(input.incident)) {
    input = input.incident;
  }
  const sourceVariant = Array.isArray(input.variants) && input.variants[0] && typeof input.variants[0] === "object"
    ? input.variants[0]
    : input;
  const title = stringValue(input.title || input.keyword || sourceVariant.keyword || fallbackTitle, 80) || "KI Einsatz";
  const rawType = enumValue(input.type || sourceVariant.type, ["emergency", "transport", "scheduled"], "emergency");
  const type = normalizeGeneratedIncidentType(rawType, sourceVariant);
  const category = enumValue(input.category, ["Herz/Kreislauf", "Atmung", "Trauma", "Neuro/Psych", "Sonstiges", "Krankentransport"], type === "transport" || type === "scheduled" ? "Krankentransport" : "Sonstiges");
  const patients = normalizeGeneratedPatients(sourceVariant.patients);
  const poiCategories = allowedList(sourceVariant.poiCategories, allowedOriginPoiCategories());
  const destinationPoiCategories = allowedList(sourceVariant.destinationPoiCategories, allowedDestinationPoiCategories());
  const locationMode = enumValue(sourceVariant.locationMode, ["random", "hospital", "poi"], "random");
  const destinationMode = enumValue(sourceVariant.destinationMode, ["none", "poi"], "none");
  const effectiveLocationMode = locationMode === "poi" && !poiCategories.length ? "random" : locationMode;
  const effectiveDestinationMode = destinationMode === "poi" && !destinationPoiCategories.length ? "none" : destinationMode;
  const variant = {
    callerName: stringValue(sourceVariant.callerName, 60) || "Anrufer",
    callerText: stringValue(sourceVariant.callerText, 900) || "Hallo, ich brauche bitte Hilfe.",
    locationMode: effectiveLocationMode,
    poiCategories,
    poiIds: [],
    destinationMode: effectiveDestinationMode,
    destinationPoiProbability: effectiveDestinationMode === "poi" ? 1 : probabilityValue(sourceVariant.destinationPoiProbability),
    destinationPoiCategories,
    destinationPoiIds: [],
    requiredServices: allowedList(sourceVariant.requiredServices, ["FW", "POL"]),
    report: patients.length > 1 ? "" : stringValue(sourceVariant.report, 500),
    situationReport: patients.length > 1 ? stringValue(sourceVariant.situationReport || sourceVariant.report, 600) : "",
    patients
  };
  return {
    id: safeId(`ki-${title}-${Date.now()}`),
    category,
    title,
    type,
    keyword: title,
    timeWindows: normalizeGeneratedTimeWindows(input.timeWindows || sourceVariant.timeWindows),
    variants: [variant]
  };
}

function normalizeGeneratedIncidentType(rawType, variant) {
  if (rawType !== "scheduled") return rawType;
  const hasPhoneContext = Boolean(String(variant?.callerText || "").trim() || String(variant?.callerName || "").trim());
  return hasPhoneContext ? "transport" : "scheduled";
}

function normalizeGeneratedPatients(value) {
  const rawPatients = Array.isArray(value) && value.length ? value.slice(0, 8) : [{}];
  return rawPatients.map((patient, index) => ({
    id: `pat-${index + 1}`,
    label: `Pat ${index + 1}`,
    options: normalizeGeneratedOptions(patient?.options),
    requiredDepartmentKeys: allowedList(patient?.requiredDepartmentKeys || patient?.requiredDepartmentKey, allowedDepartmentKeys(), ["internal"]),
    transportSignalProbability: probabilityValue(patient?.transportSignalProbability),
    conditionReport: stringValue(patient?.conditionReport, 400),
    noTransportProbability: probabilityValue(patient?.noTransportProbability),
    noTransportText: stringValue(patient?.noTransportText, 220) || "Ambulante Versorgung ausreichend, kein Transport.",
    requiresDoctorAccompaniment: Boolean(patient?.requiresDoctorAccompaniment),
    needsFW: Boolean(patient?.needsFW),
    needsPOL: Boolean(patient?.needsPOL)
  }));
}

function normalizeGeneratedOptions(value) {
  const allowedVehicles = ["KTW", "RTW", "NEF", "REF", "RTH"];
  const options = Array.isArray(value) ? value : [];
  const normalized = options.map((option) => {
    const vehicles = allowedList(option?.vehicles, allowedVehicles);
    if (!vehicles.length) return null;
    return { probability: probabilityValue(option?.probability, 1), vehicles };
  }).filter(Boolean);
  return normalized.length ? normalized : [{ probability: 1, vehicles: ["RTW"] }];
}

function normalizeGeneratedTimeWindows(value) {
  const windows = Array.isArray(value) ? value : [];
  return windows.map((window) => {
    if (typeof window === "string") {
      const [start, end] = window.split("-").map((part) => part.trim());
      return normalizeGeneratedTimeWindow(start, end);
    }
    return normalizeGeneratedTimeWindow(window?.start, window?.end);
  }).filter(Boolean).slice(0, 4);
}

function normalizeGeneratedTimeWindow(start, end) {
  const startMinute = generatedTimeToMinute(start);
  const endMinute = generatedTimeToMinute(end);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute === endMinute) return null;
  return { start: generatedMinuteToLabel(startMinute), end: generatedMinuteToLabel(endMinute) };
}

function generatedTimeToMinute(value) {
  const [hourText, minuteText = "0"] = String(value || "").trim().split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return NaN;
  return ((hour % 24) * 60) + minute;
}

function generatedMinuteToLabel(minute) {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const part = normalized % 60;
  return part ? `${hour}:${String(part).padStart(2, "0")}` : String(hour);
}

function stringValue(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function probabilityValue(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

function allowedList(value, allowed, fallback = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
  const result = raw
    .map((item) => String(item || "").trim())
    .filter((item) => allowed.includes(item));
  return result.length ? [...new Set(result)] : fallback;
}

function allowedDepartmentKeys() {
  return ["internal", "cardiology", "neurology", "trauma", "pediatrics", "obstetrics", "psychiatry", "stroke", "icu", "none"];
}

function allowedPoiCategories() {
  return ["practice", "dentist", "dialysis", "nursing-home", "school", "kindergarten", "university", "railway-station", "fire-station", "police", "townhall", "church", "cinema", "sports-centre", "mall", "hotel", "public", "home"];
}

function allowedOriginPoiCategories() {
  return allowedPoiCategories().filter((category) => category !== "home");
}

function allowedDestinationPoiCategories() {
  return ["practice", "dentist", "dialysis", "nursing-home", "school", "university", "railway-station", "hotel"];
}

async function readSavedMaps() {
  const files = (await readdir(mapsDir)).filter((file) => file.endsWith(".json")).sort();
  const maps = [];
  for (const file of files) {
    try {
      const map = await readJsonFile(join(mapsDir, file));
      if (isValidMap(map)) maps.push(map);
    } catch (error) {
      console.warn(`Skipping invalid map file ${file}: ${error.message}`);
    }
  }
  return maps;
}

async function readJsonBody(request, response, fallback) {
  try {
    const body = await readBody(request);
    return parseJson(body || JSON.stringify(fallback));
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    sendJson(response, { error: error.message || "invalid request body" }, status);
    return null;
  }
}

async function readJsonFile(filePath) {
  return parseJson(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

function parseJson(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
        const error = new Error("request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, data, status = 200) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  sendJson(response, { error: "not found" }, 404);
}

function safeContentPath(requestedPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    return null;
  }
  const filePath = resolve(join(root, decoded.replace(/^[/\\]+/, "")));
  return isInsideRoot(filePath, root) ? filePath : null;
}

function mapFilePath(id) {
  const filePath = resolve(join(mapsDir, `${safeId(id)}.json`));
  return isInsideRoot(filePath, mapsDir) ? filePath : null;
}

function isInsideRoot(filePath, baseDir) {
  const rel = relative(baseDir, filePath);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`${sep}`) && !resolve(rel).startsWith(".."));
}

function isValidMap(map) {
  return Boolean(map && typeof map === "object" && map.id && map.name && Array.isArray(map.stations) && Array.isArray(map.hospitals));
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `map-${Date.now()}`;
}

function loadLocalEnvFile() {
  const envFile = join(root, ".env");
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
