import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const root = dirname(fileURLToPath(import.meta.url));
loadLocalEnvFile();
const dataRoot = process.env.DISPATCH_DATA_DIR ? resolve(process.env.DISPATCH_DATA_DIR) : root;
const usesExternalDataDir = dataRoot !== root;
const defaultMapsDir = join(root, "maps");
const incidentCatalogFileName = process.env.DISPATCH_INCIDENTS_FILE || "incidents-dynamic.json";
const defaultIncidentsFile = join(root, incidentCatalogFileName);
const mapsDir = join(dataRoot, "maps");
const incidentsFile = join(dataRoot, incidentCatalogFileName);
const syncMetaFile = join(dataRoot, "startup-sync.json");
const startupSyncMetaVersion = 2;
const maxBodyBytes = 180_000_000;
const adminPassword = process.env.DISPATCH_ADMIN_PASSWORD || "XXX112XXX";
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "OPENROUTER_API_KEY_HIER_EINTRAGEN";
const openRouterModel = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-pro";
const openRouterReferer = process.env.OPENROUTER_SITE_URL || "http://127.0.0.1:4173";
const openRouterAppName = process.env.OPENROUTER_APP_NAME || "Leitstellen-SIM";
const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter"
];
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
const startupSyncState = {
  mapConflicts: [],
  incidentMerge: null,
  incidentConflicts: []
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
    if (url.pathname.startsWith("/api/startup-sync")) {
      await handleStartupSyncApi(request, response);
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
    if (url.pathname === "/api/osm-data") {
      await handleOsmDataApi(request, response);
      return;
    }
    if (url.pathname === "/api/boundary-search") {
      await handleBoundarySearchApi(request, response);
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
  await mergeDefaultIncidents();
}

async function seedDefaultMaps() {
  if (!existsSync(defaultMapsDir)) return;
  await mkdir(mapsDir, { recursive: true });

  const syncMeta = await readSyncMeta();
  let metaChanged = false;
  const existingFiles = new Set((await readdir(mapsDir)).filter((file) => file.endsWith(".json")));
  const defaultFiles = (await readdir(defaultMapsDir)).filter((file) => file.endsWith(".json"));
  for (const file of defaultFiles) {
    const sourceFile = join(defaultMapsDir, file);
    const targetFile = join(mapsDir, file);
    const bundledHash = await jsonFileHash(sourceFile);
    if (!existingFiles.has(file)) {
      await copyDefaultFile(sourceFile, targetFile);
      syncMeta.mapHashes[file] = bundledHash;
      metaChanged = true;
      continue;
    }
    const targetHash = await jsonFileHash(targetFile).catch(() => null);
    if (targetHash === bundledHash) {
      syncMeta.mapHashes[file] = bundledHash;
      metaChanged = true;
      continue;
    }
    if (syncMeta.mapHashes?.[file] && targetHash === syncMeta.mapHashes[file]) {
      await copyDefaultFile(sourceFile, targetFile);
      syncMeta.mapHashes[file] = bundledHash;
      metaChanged = true;
      continue;
    }
    if (syncMeta.mapIgnores?.[file] === bundledHash) continue;
    const bundled = await readJsonFile(sourceFile).catch(() => null);
    const local = await readJsonFile(targetFile).catch(() => null);
    startupSyncState.mapConflicts.push({
      id: safeId(bundled?.id || local?.id || file.replace(/\.json$/i, "")),
      file,
      localName: local?.name || local?.id || file,
      bundledName: bundled?.name || bundled?.id || file,
      bundledHash
    });
  }
  if (metaChanged) await writeSyncMeta(syncMeta);
}

async function copyDefaultFile(sourceFile, targetFile) {
  await writeFile(targetFile, await readFile(sourceFile, "utf8"), "utf8");
}

function stableJsonString(value) {
  return JSON.stringify(sortJsonValue(value));
}

async function jsonFileHash(file) {
  const json = await readJsonFile(file);
  return createHash("sha256").update(stableJsonString(json)).digest("hex");
}

async function readSyncMeta() {
  const empty = { syncMetaVersion: startupSyncMetaVersion, mapIgnores: {}, mapHashes: {}, incidentHashes: {}, incidentIgnores: {} };
  if (!existsSync(syncMetaFile)) return empty;
  const meta = await readJsonFile(syncMetaFile).catch(() => ({}));
  if (meta.syncMetaVersion !== startupSyncMetaVersion) {
    return {
      ...empty,
      mapHashes: meta.mapHashes || {},
      incidentHashes: meta.incidentHashes || {}
    };
  }
  return { ...empty, ...meta };
}

async function writeSyncMeta(meta) {
  await writeJsonFile(syncMetaFile, { syncMetaVersion: startupSyncMetaVersion, mapIgnores: {}, mapHashes: {}, incidentHashes: {}, incidentIgnores: {}, ...meta });
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortJsonValue(value[key]);
    return result;
  }, {});
}

async function mergeDefaultIncidents() {
  const bundledFile = existsSync(defaultIncidentsFile) ? defaultIncidentsFile : null;
  if (!bundledFile) return;
  const syncMeta = await readSyncMeta();
  if (!existsSync(incidentsFile)) {
    await copyDefaultFile(bundledFile, incidentsFile);
    const bundled = await readJsonFile(bundledFile).catch(() => []);
    if (Array.isArray(bundled)) {
      syncMeta.incidentHashes = incidentHashMap(bundled);
      await writeSyncMeta(syncMeta);
    }
    startupSyncState.incidentMerge = { added: "initial", total: null };
    return;
  }
  const bundled = await readJsonFile(bundledFile).catch(() => []);
  const local = await readJsonFile(incidentsFile).catch(() => []);
  if (!Array.isArray(bundled) || !Array.isArray(local)) return;
  const bundledById = new Map(bundled.filter((incident) => incident?.id).map((incident) => [incident.id, incident]));
  const localById = new Map(local.filter((incident) => incident?.id).map((incident) => [incident.id, incident]));
  const bundledHashes = incidentHashMap(bundled);
  let added = 0;
  let updated = 0;
  let changed = false;
  const merged = local.map((incident) => {
    if (!incident?.id) return incident;
    const bundledIncident = bundledById.get(incident.id);
    if (!bundledIncident) return incident;
    const bundledHash = bundledHashes[incident.id];
    const localHash = jsonValueHash(incident);
    if (localHash === bundledHash) {
      syncMeta.incidentHashes[incident.id] = bundledHash;
      return incident;
    }
    if (syncMeta.incidentHashes?.[incident.id] && localHash === syncMeta.incidentHashes[incident.id]) {
      syncMeta.incidentHashes[incident.id] = bundledHash;
      updated += 1;
      changed = true;
      return bundledIncident;
    }
    if (syncMeta.incidentIgnores?.[incident.id] !== bundledHash) {
      startupSyncState.incidentConflicts.push({
        id: incident.id,
        localTitle: incident.title || incident.keyword || incident.id,
        bundledTitle: bundledIncident.title || bundledIncident.keyword || incident.id,
        bundledHash
      });
    }
    return incident;
  });
  bundled.forEach((incident) => {
    if (!incident?.id || localById.has(incident.id)) return;
    merged.push(incident);
    syncMeta.incidentHashes[incident.id] = bundledHashes[incident.id];
    added += 1;
    changed = true;
  });
  if (changed) await writeJsonFile(incidentsFile, merged);
  await writeSyncMeta(syncMeta);
  startupSyncState.incidentMerge = { added, updated, conflicts: startupSyncState.incidentConflicts.length, total: merged.length };
}

function incidentHashMap(incidents) {
  return Object.fromEntries((incidents || [])
    .filter((incident) => incident?.id)
    .map((incident) => [incident.id, jsonValueHash(incident)]));
}

function jsonValueHash(value) {
  return createHash("sha256").update(stableJsonString(value)).digest("hex");
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

async function handleBoundarySearchApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(request, response, { query: "" });
  if (!payload) return;
  const query = String(payload.query || "").trim();
  if (query.length < 3) {
    sendJson(response, { error: "search query too short" }, 400);
    return;
  }
  try {
    const boundaries = [];
    const seen = new Set();
    for (const searchQuery of boundarySearchQueries(query)) {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: searchQuery,
        polygon_geojson: "1",
        addressdetails: "1",
        extratags: "1",
        limit: "10",
        countrycodes: "de"
      });
      const searchUrl = `https://nominatim.openstreetmap.org/search?${params}`;
      const boundaryResponse = await fetch(searchUrl, {
        headers: {
          "user-agent": "Leitstellen-SIM-v2/0.3 boundary import",
          accept: "application/json"
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!boundaryResponse.ok) continue;
      const data = await boundaryResponse.json();
      (Array.isArray(data) ? data : [])
        .map(normalizeBoundaryResult)
        .filter(Boolean)
        .forEach((boundary) => {
          if (seen.has(boundary.id)) return;
          seen.add(boundary.id);
          boundaries.push(boundary);
        });
      if (boundaries.length) break;
    }
    sendJson(response, { boundaries });
  } catch (error) {
    console.warn(`Boundary search failed: ${error.message}`);
    sendJson(response, { error: "boundary search unavailable" }, 502);
  }
}

function boundarySearchQueries(query) {
  const cleaned = String(query || "").trim().replace(/\s+/g, " ");
  const withoutPrefix = cleaned
    .replace(/^stadt\s+/i, "")
    .replace(/^landkreis\s+/i, "")
    .trim();
  return [...new Set([
    cleaned,
    `${cleaned}, Bayern, Deutschland`,
    withoutPrefix && `${withoutPrefix}, Bayern, Deutschland`,
    withoutPrefix && `${withoutPrefix} Landkreis, Bayern, Deutschland`
  ].filter(Boolean))];
}

function normalizeBoundaryResult(item) {
  const geometry = item?.geojson;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) return null;
  const osmClass = item.class || item.category || "";
  const adminLevel = String(item.extratags?.admin_level || item.extratags?.["admin_level"] || "");
  const administrativeBoundary = (osmClass === "boundary" || item.type === "administrative")
    && (!adminLevel || ["6", "8"].includes(adminLevel));
  if (!administrativeBoundary) return null;
  const id = `${item.osm_type || "osm"}-${item.osm_id || item.place_id || Math.random().toString(36).slice(2)}`;
  const label = boundaryDisplayLabel(item);
  return {
    id,
    label,
    type: item.type || item.class || "boundary",
    displayName: item.display_name || label,
    osmType: item.osm_type || "",
    osmId: item.osm_id || null,
    geoJson: {
      type: "Feature",
      properties: {
        id,
        name: label,
        displayName: item.display_name || label,
        osmType: item.osm_type || "",
        osmId: item.osm_id || null,
        boundaryType: item.type || item.class || "boundary"
      },
      geometry
    }
  };
}

function boundaryDisplayLabel(item) {
  const address = item?.address || {};
  const firstDisplayPart = String(item?.display_name || "").split(",")[0]?.trim();
  return item?.name
    || address.city
    || address.town
    || address.village
    || address.municipality
    || address.hamlet
    || firstDisplayPart
    || address.county
    || address.state_district
    || "OSM-Grenze";
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
  },
  pharmacy: {
    label: "Apotheke",
    queries: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'],
    matchAny: [[{ key: "amenity", value: "pharmacy" }], [{ key: "healthcare", value: "pharmacy" }]]
  },
  supermarket: {
    label: "Supermarkt",
    queries: ['["shop"="supermarket"]', '["shop"="convenience"]'],
    matchAny: [[{ key: "shop", value: "supermarket" }], [{ key: "shop", value: "convenience" }]]
  },
  restaurant: {
    label: "Gastronomie",
    queries: ['["amenity"="restaurant"]', '["amenity"="fast_food"]', '["amenity"="cafe"]', '["amenity"="bar"]'],
    matchAny: [[{ key: "amenity", value: "restaurant" }], [{ key: "amenity", value: "fast_food" }], [{ key: "amenity", value: "cafe" }], [{ key: "amenity", value: "bar" }]]
  },
  fuel: {
    label: "Tankstelle",
    queries: ['["amenity"="fuel"]'],
    matchAny: [[{ key: "amenity", value: "fuel" }]]
  },
  "swimming-pool": {
    label: "Schwimmbad",
    queries: ['["leisure"="swimming_pool"]', '["sport"="swimming"]'],
    matchAny: [[{ key: "leisure", value: "swimming_pool" }], [{ key: "sport", value: "swimming" }]]
  },
  playground: {
    label: "Spielplatz",
    queries: ['["leisure"="playground"]'],
    matchAny: [[{ key: "leisure", value: "playground" }]]
  },
  industrial: {
    label: "Industrie/Gewerbe",
    queries: ['["landuse"="industrial"]', '["landuse"="commercial"]', '["industrial"]'],
    matchAny: [[{ key: "landuse", value: "industrial" }], [{ key: "landuse", value: "commercial" }], [{ key: "industrial", regex: /.+/ }]]
  },
  "bus-stop": {
    label: "ÖPNV-Haltestelle",
    queries: ['["highway"="bus_stop"]', '["public_transport"="platform"]'],
    matchAny: [[{ key: "highway", value: "bus_stop" }], [{ key: "public_transport", value: "platform" }]]
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
  const selectors = overpassSpatialSelectors(payload);
  if (!selectors.length) {
    sendJson(response, { error: "invalid coverage area" }, 400);
    return;
  }
  const byId = new Map();
  const warnings = [];
  for (const chunk of chunkArray(categories, 5)) {
    const query = buildOverpassPoiQuery(chunk, selectors);
    try {
      const data = await fetchOverpassJson(query, "Leitstellen-SIM-v2 local POI import", 35000);
      normalizeOsmPoiElements(data.elements || [], chunk).forEach((poi) => {
        const existing = byId.get(poi.id);
        if (existing) existing.categories = [...new Set([...(existing.categories || []), ...(poi.categories || [])])];
        else byId.set(poi.id, poi);
      });
    } catch (error) {
      warnings.push(`${chunk.join(", ")}: ${error.message || "Overpass nicht erreichbar"}`);
    }
  }
  const poi = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, "de"));
  if (!poi.length && warnings.length) {
    sendJson(response, { error: "overpass unavailable", warnings }, 502);
    return;
  }
  sendJson(response, { poi, count: poi.length, categories, warnings });
}

async function handleOsmDataApi(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const payload = await readJsonBody(request, response, {});
  if (!payload) return;
  const layers = new Set((payload.layers || []).map((item) => String(item)));
  if (!layers.size) {
    sendJson(response, { error: "no layers selected" }, 400);
    return;
  }
  const selectors = overpassSpatialSelectors(payload);
  if (!selectors.length) {
    sendJson(response, { error: "invalid coverage area" }, 400);
    return;
  }
  const coveragePolygons = importPolygons(payload);
  const result = { roads: [], outdoorAreas: [] };
  const warnings = [];
  for (const layer of layers) {
    try {
      const normalized = await fetchOsmDataLayer(layer, payload, selectors, coveragePolygons);
      result.roads.push(...normalized.roads);
      result.outdoorAreas.push(...normalized.outdoorAreas);
    } catch (error) {
      console.error("[OSM Datenimport]", layer, error?.message || error);
      warnings.push(`${layer}: ${error.message || "Overpass nicht erreichbar"}`);
    }
  }
  result.roads = uniqueById(result.roads).sort((a, b) => a.label.localeCompare(b.label, "de"));
  result.outdoorAreas = uniqueById(result.outdoorAreas).sort((a, b) => a.label.localeCompare(b.label, "de"));
  if (!result.roads.length && !result.outdoorAreas.length && warnings.length) {
    sendJson(response, { error: "overpass unavailable", warnings }, 502);
    return;
  }
  sendJson(response, { ...result, layers: [...layers], warnings });
}

async function fetchOsmDataLayer(layer, payload, selectors, coveragePolygons) {
  const layerSet = new Set([layer]);
  const bounds = boundsFromImportPayload(payload);
  const useTiledImport = !payload.forceBoundsSelector && bounds && shouldUseTiledOsmDataImport(selectors, coveragePolygons);
  if (!useTiledImport) {
    const query = buildOverpassDataQuery(layerSet, selectors);
    if (!query) return { roads: [], outdoorAreas: [] };
    const data = await fetchOverpassJson(query, "Leitstellen-SIM-v2 local OSM data import", 50000);
    const normalized = normalizeOsmDataElements(data.elements || [], layerSet);
    return payload.forceBoundsSelector ? filterOsmDataToPolygons(normalized, coveragePolygons) : normalized;
  }

  const result = { roads: [], outdoorAreas: [] };
  const tiles = tileBounds(bounds, 0.18, 0.18)
    .filter((tile) => tileTouchesImportPolygons(tile, coveragePolygons));
  const maxTiles = 120;
  const selectedTiles = tiles.slice(0, maxTiles);
  const tileWarnings = [];
  for (let index = 0; index < selectedTiles.length; index += 1) {
    const tile = selectedTiles[index];
    const selector = `(${tile.south},${tile.west},${tile.north},${tile.east})`;
    const query = buildOverpassDataQuery(layerSet, [selector]);
    try {
      const data = await fetchOverpassJsonWithRetry(query, "Leitstellen-SIM-v2 local OSM tiled data import", 35000, 1);
      const normalized = filterOsmDataToPolygons(normalizeOsmDataElements(data.elements || [], layerSet), coveragePolygons);
      result.roads.push(...normalized.roads);
      result.outdoorAreas.push(...normalized.outdoorAreas);
      await sleep(1000);
    } catch (error) {
      tileWarnings.push(`${index + 1}/${selectedTiles.length}: ${error.message || "Overpass nicht erreichbar"}`);
      if (tileWarnings.length >= 8 && !result.roads.length && !result.outdoorAreas.length) throw new Error(tileWarnings.join(" | "));
    }
  }
  if (tiles.length > maxTiles) tileWarnings.push(`nur ${maxTiles}/${tiles.length} Kacheln abgefragt`);
  const normalizedResult = {
    roads: uniqueById(result.roads).sort((a, b) => a.label.localeCompare(b.label, "de")),
    outdoorAreas: uniqueById(result.outdoorAreas).sort((a, b) => a.label.localeCompare(b.label, "de"))
  };
  if (!normalizedResult.roads.length && !normalizedResult.outdoorAreas.length && tileWarnings.length) throw new Error(tileWarnings.join(" | "));
  return normalizedResult;
}

function shouldUseTiledOsmDataImport(selectors, polygons) {
  const selectorLength = selectors.join("").length;
  const pointCount = polygons.reduce((sum, polygon) => sum + polygon.length, 0);
  return selectorLength > 60000 || pointCount > 2500;
}

async function fetchOverpassJson(query, userAgent, timeoutMs) {
  const errors = [];
  for (const endpoint of overpassEndpoints) {
    try {
      const overpassResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          "user-agent": userAgent
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!overpassResponse.ok) {
        errors.push(`${endpoint}: HTTP ${overpassResponse.status}`);
        continue;
      }
      return await overpassResponse.json();
    } catch (error) {
      errors.push(`${endpoint}: ${error.message || error}`);
    }
  }
  throw new Error(errors.join(" | ") || "Overpass nicht erreichbar");
}

async function fetchOverpassJsonWithRetry(query, userAgent, timeoutMs, retries = 1) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchOverpassJson(query, userAgent, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(2000 + attempt * 2500);
    }
  }
  throw lastError || new Error("Overpass nicht erreichbar");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function buildOverpassDataQuery(layers, selectors) {
  const parts = [];
  if (layers.has("roads")) {
    const roadFilter = '["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]';
    selectors.forEach((selector) => {
      parts.push(`way${roadFilter}${selector};`);
      parts.push(`relation["route"="road"]${selector};`);
    });
  }
  if (layers.has("outdoor")) {
    const outdoorFilters = [
      '["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery)$"]',
      '["natural"~"^(wood|grassland|heath|scrub|water|beach)$"]',
      '["leisure"~"^(park|nature_reserve|pitch|playground|garden|sports_centre)$"]'
    ];
    selectors.forEach((selector) => {
      outdoorFilters.forEach((filter) => {
        parts.push(`way${filter}${selector};`);
        parts.push(`relation${filter}${selector};`);
      });
    });
  }
  if (!parts.length) return "";
  const output = "out body center geom";
  return `[out:json][timeout:40];(${parts.join("")});${output};`;
}

function boundsFromImportPayload(payload) {
  const polygonBounds = boundsFromPolygons(payload);
  if (polygonBounds) return polygonBounds;
  const bounds = payload.bounds || {};
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if ([south, west, north, east].every(Number.isFinite) && south < north && west < east) return { south, west, north, east };
  return null;
}

function boundsFromPolygons(payload) {
  const polygons = Array.isArray(payload.polygons) && payload.polygons.length
    ? payload.polygons
    : (Array.isArray(payload.polygon) ? [payload.polygon] : []);
  const points = polygons.flatMap((polygon) => Array.isArray(polygon) ? polygon : [])
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!points.length) return null;
  return {
    south: Math.min(...points.map((point) => point.lat)),
    west: Math.min(...points.map((point) => point.lng)),
    north: Math.max(...points.map((point) => point.lat)),
    east: Math.max(...points.map((point) => point.lng))
  };
}

function tileBounds(bounds, latStep, lngStep) {
  const tiles = [];
  for (let south = bounds.south; south < bounds.north; south += latStep) {
    for (let west = bounds.west; west < bounds.east; west += lngStep) {
      tiles.push({
        south: roundCoord(south),
        west: roundCoord(west),
        north: roundCoord(Math.min(bounds.north, south + latStep)),
        east: roundCoord(Math.min(bounds.east, west + lngStep))
      });
    }
  }
  return tiles.slice(0, 260);
}

function tileTouchesImportPolygons(tile, polygons) {
  if (!polygons.length) return true;
  const corners = [
    { lat: tile.south, lng: tile.west },
    { lat: tile.south, lng: tile.east },
    { lat: tile.north, lng: tile.west },
    { lat: tile.north, lng: tile.east },
    { lat: (tile.south + tile.north) / 2, lng: (tile.west + tile.east) / 2 }
  ];
  if (corners.some((point) => pointInsideAnyImportPolygon(point.lat, point.lng, polygons))) return true;
  return polygons.some((polygon) => polygon.some((point) => (
    point.lat >= tile.south && point.lat <= tile.north && point.lng >= tile.west && point.lng <= tile.east
  )));
}

function filterOsmDataToPolygons(data, polygons) {
  if (!polygons.length) return data;
  return {
    roads: (data.roads || []).filter((road) => geometryTouchesImportPolygons(road.geometry, polygons)),
    outdoorAreas: (data.outdoorAreas || []).filter((area) => geometryTouchesImportPolygons(area.geometry, polygons))
  };
}

function geometryTouchesImportPolygons(geometry, polygons) {
  return (geometry || []).some(([lng, lat]) => pointInsideAnyImportPolygon(lat, lng, polygons));
}

function normalizeOsmDataElements(elements, layers) {
  const roads = [];
  const outdoorAreas = [];
  const roadRoutesByWayId = layers.has("roads") ? osmRoadRoutesByWayId(elements) : new Map();
  elements.forEach((element) => {
    const tags = element.tags || {};
    if (layers.has("roads") && tags.highway && Array.isArray(element.geometry) && element.geometry.length >= 2) {
      const routeInfo = roadRoutesByWayId.get(String(element.id)) || normalizeRoadRoute(tags);
      roads.push({
        id: `road-${element.type}-${element.id}`,
        label: osmRoadLabel(tags),
        roadClass: tags.highway,
        ref: tags.ref || "",
        name: tags.name || "",
        routeNetworks: routeInfo.networks || (routeInfo.network ? [routeInfo.network] : []),
        routeRefs: routeInfo.refs || (routeInfo.ref ? [routeInfo.ref] : []),
        officialRoadClass: routeInfo.officialRoadClass || "",
        geometry: compressOsmGeometry(element.geometry),
        source: "osm",
        osmType: element.type,
        osmId: element.id
      });
    }
    if (layers.has("outdoor") && osmOutdoorCategory(tags) && Array.isArray(element.geometry) && element.geometry.length >= 3) {
      outdoorAreas.push({
        id: `outdoor-${element.type}-${element.id}`,
        label: tags.name || osmOutdoorCategoryLabel(tags),
        category: osmOutdoorCategory(tags),
        geometry: compressOsmGeometry(element.geometry),
        source: "osm",
        osmType: element.type,
        osmId: element.id
      });
    }
  });
  return {
    roads: uniqueById(roads).sort((a, b) => a.label.localeCompare(b.label, "de")),
    outdoorAreas: uniqueById(outdoorAreas).sort((a, b) => a.label.localeCompare(b.label, "de"))
  };
}

function osmRoadRoutesByWayId(elements) {
  const byWayId = new Map();
  elements.forEach((element) => {
    const tags = element.tags || {};
    if (element.type !== "relation" || tags.route !== "road" || !Array.isArray(element.members)) return;
    const route = normalizeRoadRoute(tags);
    element.members
      .filter((member) => member?.type === "way" && Number.isFinite(Number(member.ref)))
      .forEach((member) => {
        const key = String(member.ref);
        const current = byWayId.get(key) || { networks: [], refs: [], officialClasses: [] };
        if (route.network) current.networks.push(route.network);
        if (route.ref) current.refs.push(route.ref);
        if (route.officialRoadClass) current.officialClasses.push(route.officialRoadClass);
        byWayId.set(key, current);
      });
  });
  return new Map([...byWayId.entries()].map(([wayId, info]) => {
    const officialClasses = [...new Set(info.officialClasses)].filter(Boolean);
    return [wayId, {
      networks: [...new Set(info.networks)].filter(Boolean),
      refs: [...new Set(info.refs)].filter(Boolean),
      officialRoadClass: strongestOfficialRoadClass(officialClasses)
    }];
  }));
}

function normalizeRoadRoute(tags) {
  const network = String(tags.network || "").trim();
  const ref = String(tags.ref || "").trim();
  const text = `${network} ${ref} ${tags.name || ""}`.trim();
  return {
    network,
    ref,
    officialRoadClass: officialRoadClassFromRouteText(text)
  };
}

function officialRoadClassFromRouteText(text) {
  const value = String(text || "").trim();
  if (/\b(BAB|A\s*\d{1,3})\b/i.test(value)) return "motorway";
  if (/\b(B\s*\d{1,4})\b/i.test(value)) return "federal";
  if (/\b(St|Staatsstra(?:sse|ße)|L|Landesstra(?:sse|ße))\s*\d{1,5}\b/i.test(value)) return "state";
  if (/\b(K|Kr|Kreisstra(?:sse|ße)|[A-ZÄÖÜ]{1,3})\s*\d{1,5}\b/.test(value)) return "county";
  return "";
}

function strongestOfficialRoadClass(classes) {
  const order = ["motorway", "federal", "state", "county"];
  return order.find((item) => classes.includes(item)) || "";
}

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function osmElementPoint(element) {
  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  if (Array.isArray(element.geometry) && element.geometry.length) {
    const valid = element.geometry
      .map((point) => ({ lat: Number(point.lat), lng: Number(point.lon) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (valid.length) {
      return {
        lat: valid.reduce((sum, point) => sum + point.lat, 0) / valid.length,
        lng: valid.reduce((sum, point) => sum + point.lng, 0) / valid.length
      };
    }
  }
  return null;
}

function compressOsmGeometry(geometry) {
  return geometry
    .map((point) => [roundCoord(point.lon), roundCoord(point.lat)])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

function roundCoord(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1_000_000) / 1_000_000 : null;
}

function osmRoadLabel(tags) {
  const ref = tags.ref || "";
  const name = tags.name || "";
  if (ref && name) return `${ref} - ${name}`;
  return ref || name || roadClassLabel(tags.highway);
}

function roadClassLabel(value) {
  const labels = {
    motorway: "Autobahn",
    trunk: "Schnellstraße",
    primary: "Bundesstraße",
    secondary: "Staats-/Landstraße",
    tertiary: "Kreisstraße",
    residential: "Wohnstraße",
    service: "Zufahrt"
  };
  return labels[value] || "Straße";
}

function osmOutdoorCategory(tags) {
  if (["forest"].includes(tags.landuse) || ["wood"].includes(tags.natural)) return "forest";
  if (["park", "nature_reserve", "garden"].includes(tags.leisure)) return "park";
  if (["pitch", "sports_centre"].includes(tags.leisure)) return "sports";
  if (["water"].includes(tags.natural)) return "water";
  if (["grass", "meadow", "recreation_ground"].includes(tags.landuse) || ["grassland", "heath", "scrub", "beach"].includes(tags.natural)) return "open";
  if (tags.landuse === "cemetery") return "cemetery";
  return "";
}

function osmOutdoorCategoryLabel(tags) {
  const labels = {
    forest: "Waldgebiet",
    park: "Park / Grünanlage",
    sports: "Sportfläche",
    water: "Gewässer",
    open: "Freifläche",
    cemetery: "Friedhof"
  };
  return labels[osmOutdoorCategory(tags)] || "Outdoor-Fläche";
}

function buildOverpassPoiQuery(categories, selectors) {
  const queries = categories.flatMap((key) => osmPoiCategories[key].queries);
  const parts = queries.flatMap((filter) => selectors.flatMap((selector) => [
    `node${filter}${selector};`,
    `way${filter}${selector};`,
    `relation${filter}${selector};`
  ]));
  return `[out:json][timeout:25];(${parts.join("")});out body center 1200;`;
}

function overpassSpatialSelectors(payload) {
  if (payload.forceBoundsSelector) {
    const bounds = payload.bounds || {};
    const south = Number(bounds.south);
    const west = Number(bounds.west);
    const north = Number(bounds.north);
    const east = Number(bounds.east);
    if ([south, west, north, east].every(Number.isFinite) && south < north && west < east) {
      return [`(${south},${west},${north},${east})`];
    }
  }
  const polygons = Array.isArray(payload.polygons) && payload.polygons.length
    ? payload.polygons
    : (Array.isArray(payload.polygon) ? [payload.polygon] : []);
  const selectors = polygons
    .map(overpassPolygonSelector)
    .filter(Boolean);
  if (selectors.length) return selectors;
  const bounds = payload.bounds || {};
  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);
  if ([south, west, north, east].every(Number.isFinite) && south < north && west < east) {
    return [`(${south},${west},${north},${east})`];
  }
  return [];
}

function importPolygons(payload) {
  const polygons = Array.isArray(payload.polygons) && payload.polygons.length
    ? payload.polygons
    : (Array.isArray(payload.polygon) ? [payload.polygon] : []);
  return polygons
    .map((polygon) => (Array.isArray(polygon) ? polygon : [])
      .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)))
    .filter((polygon) => polygon.length >= 3);
}

function pointInsideAnyImportPolygon(lat, lng, polygons) {
  if (!polygons.length) return true;
  return polygons.some((polygon) => pointInsidePolygonLatLng(lat, lng, polygon));
}

function pointInsidePolygonLatLng(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function overpassPolygonSelector(polygon) {
  const points = (Array.isArray(polygon) ? polygon : [])
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length < 3) return null;
  const closed = sameCoordinate(points[0], points.at(-1)) ? points : [...points, points[0]];
  return `(poly:"${closed.map((point) => `${point.lat} ${point.lng}`).join(" ")}")`;
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
      hospitals: Array.isArray(map.hospitals) ? map.hospitals.length : 0,
      supportGroups: Array.isArray(map.supportGroups) ? map.supportGroups.length : 0
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
    const sourceFile = existsSync(incidentsFile)
      ? incidentsFile
      : existsSync(defaultIncidentsFile)
        ? defaultIncidentsFile
        : null;
    if (!sourceFile) return sendJson(response, []);
    const incidents = await readJsonFile(sourceFile);
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

async function handleStartupSyncApi(request, response) {
  if (!usesExternalDataDir) return sendJson(response, { mapConflicts: [], incidentMerge: null, incidentConflicts: [] });
  if (request.method === "GET") {
    sendJson(response, startupSyncState);
    return;
  }
  if (request.method === "POST") {
    const body = await readJsonBody(request, response, {});
    if (!body) return;
    if (body.type === "incident") {
      await handleIncidentSyncChoice(body);
      sendJson(response, startupSyncState);
      return;
    }
    if (body.type !== "map") return sendJson(response, { error: "unsupported sync type" }, 400);
    const conflict = startupSyncState.mapConflicts.find((item) => item.id === body.id || item.file === body.file);
    if (!conflict) return sendJson(response, startupSyncState);
    const action = String(body.action || "local").toLowerCase();
    const sourceFile = join(defaultMapsDir, conflict.file);
    const targetFile = join(mapsDir, conflict.file);
    const meta = await readSyncMeta();
    if (action === "bundled" || action === "neu") {
      await copyDefaultFile(sourceFile, targetFile);
      meta.mapHashes[conflict.file] = conflict.bundledHash || await jsonFileHash(sourceFile);
    } else if (action === "both" || action === "beide") {
      const bundled = await readJsonFile(sourceFile);
      const copy = await uniqueMapCopy(bundled);
      await writeJsonFile(mapFilePath(copy.id), copy);
      meta.mapIgnores[conflict.file] = conflict.bundledHash || await jsonFileHash(sourceFile);
    } else {
      meta.mapIgnores[conflict.file] = conflict.bundledHash || await jsonFileHash(sourceFile);
    }
    await writeSyncMeta(meta);
    startupSyncState.mapConflicts = startupSyncState.mapConflicts.filter((item) => item !== conflict);
    sendJson(response, startupSyncState);
    return;
  }
  notFound(response);
}

async function handleIncidentSyncChoice(body) {
  const conflict = startupSyncState.incidentConflicts.find((item) => item.id === body.id);
  if (!conflict || !existsSync(defaultIncidentsFile) || !existsSync(incidentsFile)) return;
  const action = String(body.action || "local").toLowerCase();
  const [bundled, local] = await Promise.all([
    readJsonFile(defaultIncidentsFile).catch(() => []),
    readJsonFile(incidentsFile).catch(() => [])
  ]);
  if (!Array.isArray(bundled) || !Array.isArray(local)) return;
  const bundledIncident = bundled.find((incident) => incident?.id === conflict.id);
  if (!bundledIncident) return;
  const meta = await readSyncMeta();
  let next = local;
  if (action === "bundled" || action === "neu") {
    next = local.map((incident) => incident?.id === conflict.id ? bundledIncident : incident);
    meta.incidentHashes[conflict.id] = conflict.bundledHash || jsonValueHash(bundledIncident);
    delete meta.incidentIgnores[conflict.id];
  } else if (action === "both" || action === "beide") {
    next = [...local, uniqueIncidentCopy(bundledIncident, local)];
    meta.incidentIgnores[conflict.id] = conflict.bundledHash || jsonValueHash(bundledIncident);
  } else {
    meta.incidentIgnores[conflict.id] = conflict.bundledHash || jsonValueHash(bundledIncident);
  }
  await writeJsonFile(incidentsFile, next);
  await writeSyncMeta(meta);
  startupSyncState.incidentConflicts = startupSyncState.incidentConflicts.filter((item) => item !== conflict);
}

function uniqueIncidentCopy(incident, existingIncidents = []) {
  const existingIds = new Set(existingIncidents.map((item) => item?.id).filter(Boolean));
  const baseId = safeId(incident.id || incident.title || "einsatz");
  for (let version = 2; version < 100; version += 1) {
    const id = safeId(`${baseId}-v${version}`);
    if (existingIds.has(id)) continue;
    return {
      ...incident,
      id,
      title: `${incident.title || incident.keyword || "Einsatz"} v${version}`,
      keyword: incident.keyword ? `${incident.keyword} v${version}` : incident.keyword
    };
  }
  const id = safeId(`${baseId}-${Date.now()}`);
  return { ...incident, id, title: `${incident.title || incident.keyword || "Einsatz"} Kopie` };
}

async function uniqueMapCopy(map) {
  const baseId = safeId(map.id || map.name || "karte");
  const baseName = map.name || map.id || "Karte";
  for (let version = 2; version < 100; version += 1) {
    const id = safeId(`${baseId}-v${version}`);
    if (existsSync(mapFilePath(id))) continue;
    return { ...map, id, name: `${baseName} v${version}` };
  }
  return { ...map, id: safeId(`${baseId}-${Date.now()}`), name: `${baseName} Kopie` };
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
  const mode = body.mode === "transport" ? "transport" : "emergency";
  const variationCount = clampInteger(body.variationCount, 1, 6, 1);
  if (userPrompt.length < 8) {
    sendJson(response, { error: "Bitte eine kurze Beschreibung fuer den KI-Einsatz eingeben." }, 400);
    return;
  }

  try {
    const generated = await generateIncidentWithOpenRouter(userPrompt, mode, variationCount);
    const incidents = normalizeGeneratedIncidents(generated, userPrompt, mode, variationCount);
    sendJson(response, { incident: incidents[0], incidents, model: openRouterModel });
  } catch (error) {
    sendJson(response, { error: error.message || "KI-Generierung fehlgeschlagen" }, 502);
  }
}

function isOpenRouterConfigured() {
  return Boolean(openRouterApiKey && openRouterApiKey !== "OPENROUTER_API_KEY_HIER_EINTRAGEN");
}

async function generateIncidentWithOpenRouter(userPrompt, mode = "emergency", variationCount = 1) {
  const first = await requestOpenRouterIncident(userPrompt, false, mode, variationCount);
  if (first.content) {
    try {
      return parseGeneratedIncidentJson(first.content);
    } catch (error) {
      logOpenRouterJsonFailure("parse-first", first, error);
    }
  } else {
    logOpenRouterJsonFailure("empty-first", first);
  }
  const retry = await requestOpenRouterIncident(userPrompt, true, mode, variationCount);
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

async function requestOpenRouterIncident(userPrompt, retry = false, mode = "emergency", variationCount = 1) {
  const messages = retry
    ? [
        { role: "system", content: `${incidentGenerationSystemPrompt(mode, variationCount)}\n\nWICHTIG: Gib jetzt nur ein einziges JSON-Objekt aus. Kein Denken, keine Erklaerung, kein leerer Inhalt.` },
        { role: "user", content: `${userPrompt}\n\nAntworte ausschliesslich als JSON object mit genau ${variationCount} Variante(n).` }
      ]
    : [
        { role: "system", content: incidentGenerationSystemPrompt(mode, variationCount) },
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
      max_tokens: retry ? 1600 + (variationCount * 450) : 1800 + (variationCount * 550),
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

function incidentGenerationSystemPrompt(mode = "emergency", variationCount = 1) {
  const modeRules = mode === "transport"
    ? `Modus: Krankentransport.
- type muss transport sein, nicht scheduled. scheduled ist nur fuer interne Hintergrundgeneratoren.
- Standardfahrzeug ist KTW, ausser der Nutzer nennt RTW/NEF/RTH ausdruecklich.
- Heimfahrt nach Hause: destinationMode "home", requiredDepartmentKeys ["none"], locationMode meist "hospital".
- Fahrt zu Arztpraxis/Zahnarzt/Dialyse/Altenheim: destinationMode "poi" und passende destinationPoiCategories.
- Transport in ein Krankenhaus ohne Fachrichtung: destinationMode "poi", destinationPoiCategories ["hospital"], requiredDepartmentKeys ["none"].
- KTP mit benoetigter Fachrichtung oder geeigneter Klinik: destinationMode "none"; die Leitstelle waehlt das Krankenhaus spaeter aus.`
    : `Modus: Notfalleinsatz.
- type muss emergency sein.
- destinationMode bleibt "none"; bei Notfaellen wird das Krankenhaus erst nach Rueckmeldung zugewiesen.
- Verwende RTW/NEF/RTH nur passend zur Lage, REF nur bei eindeutig ambulanten/niedrigprioren Lagen.`;
  const variationRules = variationCount > 1
    ? `Erzeuge genau ${variationCount} Varianten im variants-Array.
- Alle Varianten muessen denselben callerName, callerText, locationMode, locationRoadTypes, poiCategories, destinationMode, destinationPoiProbability und destinationPoiCategories nutzen.
- Variieren sollen nur report, situationReport und patients. Die medizinische Bandbreite soll realistisch sein, z.B. bei Brustschmerz von muskuloskelettal/Intercostalneuralgie bis ACS/Myokardinfarkt.
- Keine getrennten Anruftexte pro Variante, keine unterschiedlichen POI-/Zielmodi pro Variante.`
    : `Erzeuge genau 1 Variante im variants-Array.`;
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
    "weight": 1,
    "callerName": "Anrufer",
    "callerText": "Notruftext, mehrere Varianten mit | trennen",
    "locationMode": "random|address|road|outdoor|hospital|poi",
    "locationRoadTypes": ["urban|rural|motorway"],
    "poiCategories": ["practice|dentist|dialysis|nursing-home|school|kindergarten|university|railway-station|fire-station|police|townhall|church|cinema|sports-centre|mall|hotel|pharmacy|supermarket|restaurant|fuel|swimming-pool|playground|industrial|bus-stop|public|home"],
    "destinationMode": "none|poi|home",
    "destinationPoiProbability": 0,
    "destinationPoiCategories": ["practice|dentist|dialysis|nursing-home|hospital"],
    "requiredServices": ["FW","POL"],
    "report": "kurze Rueckmeldung an die Leitstelle, z.B. Zustand und benoetigtes Transportmittel, kein Abschlussbericht",
    "situationReport": "Lagemeldung bei mehreren Patienten",
    "patients": [{
      "options": [{"probability":1,"vehicles":["RTW"]}],
      "requiredDepartmentKeys": ["internal|cardiology|neurology|trauma|pediatrics|obstetrics|psychiatry|stroke|icu|none"],
      "transportSignalProbability": 0,
      "conditionReport": "individuelle Patientenrueckmeldung",
      "acuity": "planned-transport|stable|potential-critical|critical|reanimation",
      "noTransportProbability": 0,
      "noTransportText": "Ambulante Versorgung ausreichend, kein Transport.",
      "requiresDoctorAccompaniment": false,
      "needsFW": false,
      "needsPOL": false,
      "recommendedVehicles": ["HVO","FR"]
    }]
  }]
}

Regeln:
${modeRules}
${variationRules}
- Erlaubte Fahrzeugtypen: KTW, RTW, NEF, VEF, REF, RTH, ITW, ITH, HVO, FR. HVO/FR nur als recommendedVehicles nutzen, nicht in options.
- Gib keinen globalen Einsatz-weight aus; dieser wird lokal immer automatisch auf 1 gesetzt.
- Gib pro Variante ein sinnvolles "weight" aus. Beispiele: haeufige Variante 0.6, seltene Variante 0.15, mehrere gleich haeufige Varianten je 1.
- options-Wahrscheinlichkeiten pro Patient muessen zusammen etwa 1 ergeben. Nutze mehrere Optionen, wenn unterschiedliche Rettungsmittel realistisch sind, z.B. [{"probability":0.7,"vehicles":["RTW"]},{"probability":0.3,"vehicles":["KTW"]}] oder [{"probability":0.8,"vehicles":["RTW","NEF"]},{"probability":0.2,"vehicles":["RTW"]}].
- KTP ueber 19222 oder mit Anrufer ist type transport, auch wenn die Fahrt zeitlich geplant ist. type scheduled nur fuer automatisch im Hintergrund entstehende Planfahrten ohne Telefonanruf und ohne initial zugewiesenes Fahrzeug.
- RTW-Notfaelle ca. 1 Patient, requiredDepartmentKeys passend zur Lage.
- requiredDepartmentKeys ist eine Mehrfachauswahl. Setze bei Bedarf mehrere Fachrichtungen, z.B. ["trauma","icu"] bei Polytrauma, ["neurology","stroke"] bei Schlaganfall, ["internal","cardiology"] bei ACS. Nutze ["none"] nur, wenn kein Klinikziel gebraucht wird.
- acuity beschreibt den dynamischen Zustand: planned-transport fuer planbare KTP, stable fuer stabile Patienten, potential-critical fuer moegliche Verschlechterung, critical fuer kritisch, reanimation fuer laufende Reanimation. Reanimation erfordert immer NEF.
- recommendedVehicles ist optional fuer HVO/FR bei Reanimation, Bewusstlosigkeit oder RD-2-Bewusstsein; diese Fahrzeuge stabilisieren nur und sind keine Pflichtfahrzeuge.
- NEF/RTH nur bei kritisch, Bewusstlosigkeit, Reanimation, schwerem Trauma, Geburt/Kind kritisch oder Notarztbegleitung.
- destinationMode poi nur fuer Fahrten zu Arztpraxis, Zahnarztpraxis, Dialyse, Altenheim oder Krankenhaus als festes Ziel. Heimfahrt nach Hause ist destinationMode home.
- locationMode address fuer Wohnadressen/Privatadressen. Das erzeugt eine plausible Hausnummer an einer importierten Wohnstrasse.
- locationMode road fuer Verkehrsunfaelle oder Ereignisse auf Verkehrswegen. locationRoadTypes dann passend setzen: urban fuer innerorts, rural fuer Land-/Bundesstrassen ausserorts, motorway fuer Autobahn/Schnellstrasse. Bei generischen VU mehrere Werte kombinieren.
- locationMode outdoor fuer Wald/Feld/Park/Sportflaeche, poi nur wenn der Einsatz sinnvoll an einer echten POI-Kategorie startet. Wenn unsicher: random.
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

function normalizeGeneratedIncidents(input, fallbackTitle, mode = "emergency", variationCount = 1) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("KI-JSON muss ein Objekt sein.");
  if (input.incident && typeof input.incident === "object" && !Array.isArray(input.incident)) {
    input = input.incident;
  }
  const sourceVariant = Array.isArray(input.variants) && input.variants[0] && typeof input.variants[0] === "object"
    ? input.variants[0]
    : input;
  const sourceVariants = Array.isArray(input.variants) && input.variants.length
    ? input.variants.filter((variant) => variant && typeof variant === "object")
    : [sourceVariant];
  const title = stringValue(input.title || input.keyword || sourceVariant.keyword || fallbackTitle, 80) || "KI Einsatz";
  const rawType = mode === "transport"
    ? "transport"
    : "emergency";
  const type = normalizeGeneratedIncidentType(rawType, sourceVariant);
  const category = enumValue(input.category, ["Herz/Kreislauf", "Atmung", "Trauma", "Neuro/Psych", "Sonstiges", "Krankentransport"], type === "transport" || type === "scheduled" ? "Krankentransport" : "Sonstiges");
  const poiCategories = allowedList(sourceVariant.poiCategories, allowedOriginPoiCategories());
  const destinationPoiCategories = allowedList(sourceVariant.destinationPoiCategories, allowedDestinationPoiCategories());
  const locationMode = enumValue(sourceVariant.locationMode, ["random", "address", "road", "outdoor", "hospital", "poi"], "random");
  const destinationMode = enumValue(sourceVariant.destinationMode, ["none", "poi", "home"], "none");
  const effectiveLocationMode = locationMode === "poi" && !poiCategories.length ? "random" : locationMode;
  const locationRoadTypes = normalizeRoadTypeList(sourceVariant.locationRoadTypes);
  const common = {
    callerName: stringValue(sourceVariant.callerName, 60) || "Anrufer",
    callerText: stringValue(sourceVariant.callerText, 900) || "Hallo, ich brauche bitte Hilfe.",
    locationMode: effectiveLocationMode,
    locationRoadTypes: effectiveLocationMode === "road" ? locationRoadTypes : [],
    poiCategories,
    poiIds: [],
    destinationPoiCategories,
    destinationPoiIds: [],
    timeWindows: normalizeGeneratedTimeWindows(input.timeWindows || sourceVariant.timeWindows)
  };
  const requestedCount = Math.max(1, Math.min(6, Number(variationCount) || 1));
  const variantsToUse = sourceVariants.slice(0, requestedCount);
  while (variantsToUse.length < requestedCount) variantsToUse.push(sourceVariant);
  const normalizedVariantPatients = variantsToUse.map((rawVariant) => normalizeGeneratedPatients(rawVariant.patients));
  const anyNeedsClinicSelection = normalizedVariantPatients
    .some((patients) => patients.some((patient) => (patient.requiredDepartmentKeys || []).some((key) => key !== "none")));
  const timestamp = Date.now();
  return variantsToUse.map((rawVariant, index) => {
    const patients = normalizedVariantPatients[index];
    const effectiveDestinationMode = anyNeedsClinicSelection
      ? "none"
      : destinationMode === "poi" && !destinationPoiCategories.length
        ? "none"
        : destinationMode;
    const variationTitle = requestedCount > 1 ? `${title} (Variation ${index + 1})` : title;
    const variant = {
      callerName: common.callerName,
      callerText: common.callerText,
      locationMode: common.locationMode,
      locationRoadTypes: common.locationRoadTypes,
      poiCategories: common.poiCategories,
      poiIds: common.poiIds,
      destinationMode: effectiveDestinationMode,
      destinationPoiProbability: effectiveDestinationMode === "poi" ? 1 : probabilityValue(sourceVariant.destinationPoiProbability),
      destinationPoiCategories: common.destinationPoiCategories,
      destinationPoiIds: common.destinationPoiIds,
      requiredServices: allowedList(rawVariant.requiredServices || sourceVariant.requiredServices, ["FW", "POL"]),
      weight: positiveWeight(rawVariant.weight, 1),
      report: patients.length > 1 ? "" : stringValue(rawVariant.report, 500),
      situationReport: patients.length > 1 ? stringValue(rawVariant.situationReport || rawVariant.report, 600) : "",
      patients
    };
    return {
      id: safeId(`ki-${variationTitle}-${timestamp}-${index + 1}`),
      category,
      title: variationTitle,
      type,
      weight: 1,
      keyword: variationTitle,
      timeWindows: common.timeWindows,
      variants: [variant]
    };
  });
}

function normalizeGeneratedIncident(input, fallbackTitle, mode = "emergency") {
  return normalizeGeneratedIncidents(input, fallbackTitle, mode, 1)[0];
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
    acuity: enumValue(patient?.acuity, ["planned-transport", "stable", "potential-critical", "critical", "reanimation"], "stable"),
    noTransportProbability: probabilityValue(patient?.noTransportProbability),
    noTransportText: stringValue(patient?.noTransportText, 220) || "Ambulante Versorgung ausreichend, kein Transport.",
    requiresDoctorAccompaniment: Boolean(patient?.requiresDoctorAccompaniment),
    needsFW: Boolean(patient?.needsFW),
    needsPOL: Boolean(patient?.needsPOL),
    recommendedVehicles: allowedList(patient?.recommendedVehicles, ["HVO", "FR"])
  }));
}

function normalizeGeneratedOptions(value) {
  const allowedVehicles = ["KTW", "RTW", "NEF", "VEF", "REF", "RTH", "ITW", "ITH"];
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

function positiveWeight(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function allowedList(value, allowed, fallback = []) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,;|]/);
  const result = raw
    .map((item) => String(item || "").trim())
    .filter((item) => allowed.includes(item));
  return result.length ? [...new Set(result)] : fallback;
}

function normalizeRoadTypeList(value) {
  const result = allowedList(value, ["urban", "rural", "motorway"]);
  return result.length ? result : ["urban", "rural", "motorway"];
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
  return ["practice", "dentist", "dialysis", "nursing-home", "hospital", "school", "university", "railway-station", "hotel"];
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
