import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const root = dirname(fileURLToPath(import.meta.url));
const mapsDir = join(root, "maps");
const incidentsFile = join(root, "incidents-data.json");
const maxBodyBytes = 2_000_000;
const adminPassword = process.env.DISPATCH_ADMIN_PASSWORD || "XXX112XXX";
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
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DispatchSim running at http://127.0.0.1:${port}/`);
  if (!process.env.DISPATCH_ADMIN_PASSWORD) {
    console.log("Admin password uses the development default. Set DISPATCH_ADMIN_PASSWORD to override it.");
  }
});

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
