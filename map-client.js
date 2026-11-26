function normalizeStatus3Radio(settings) {
  const modes = ["0", "5", "none"];
  const signal = String(settings?.signal);
  const normal = String(settings?.normal);
  return {
    signal: modes.includes(signal) ? signal : "0",
    normal: modes.includes(normal) ? normal : "5"
  };
}

const MAP_RESPONDER_SYMBOL = "♥";
const SUPPORT_COMPONENT_LABELS = { ugrd: "UGRD", treatment: "SEG-Behandlung", transport: "SEG-Transport", sanel: "UG SanEL" };

function supportGroupKind(group) {
  if (Object.hasOwn(SUPPORT_COMPONENT_LABELS, group.kind)) return group.kind;
  if (/\bSEG[\s-]+Behandlung\b/i.test(group.label || "")) return "treatment";
  if (/\bSEG[\s-]+Transport\b/i.test(group.label || "")) return "transport";
  if (/^UG[\s-]+SanEL\b/i.test(group.label || "")) return "sanel";
  return "ugrd";
}

function supportGroupUnits(group) {
  const configured = Array.isArray(group.units) ? group.units : [];
  const kind = supportGroupKind(group);
  if (kind === "ugrd") return configured;
  const type = { treatment: "GW-SAN", transport: "KTW", sanel: "UG-SANEL" }[kind];
  const count = kind === "transport" ? 2 : 1;
  const matching = configured.filter((unit) => unit.type === type);
  return Array.from({ length: count }, (_, index) => matching[index]
    || { id: `${kind}-${index + 1}`, type, name: `${group.label || SUPPORT_COMPONENT_LABELS[kind]} · ${type}${count > 1 ? ` ${index + 1}` : ""}` });
}

function supportGroupDisplayName(group) {
  const label = String(group.label || "").trim();
  const kind = supportGroupKind(group);
  const prefixes = { ugrd: /^UGRD\b/i, treatment: /^SEG[\s-]+Behandlung\b/i, transport: /^SEG[\s-]+Transport\b/i, sanel: /^UG[\s-]+SanEL\b/i };
  const prefix = prefixes[kind];
  const title = SUPPORT_COMPONENT_LABELS[kind];
  return prefix.test(label) ? label.replace(prefix, title) : [title, label].filter(Boolean).join(" ");
}

function supportGroupResponseWindow(group) {
  const min = Math.min(60, Math.max(1, Number(group.minResponseMinutes) || 5));
  const max = Math.min(90, Math.max(min, Number(group.maxResponseMinutes) || 15));
  return { min, max };
}

function supportGroupLocation(map, group, unit = {}) {
  const supportStation = (map.supportStations || []).find((item) => item.id === group.supportStationId);
  const stationId = unit.stationId || group.stationId;
  const legacyStation = stationId && (map.stations || []).find((item) => item.id === stationId);
  const station = supportStation || legacyStation;
  const point = station || group;
  return {
    id: station?.id || `support-${group.id}`,
    label: station?.label || group.label || "UGRD-/SEG-Standort",
    lat: Number.isFinite(point.lat) ? point.lat : map.mapCenter[0],
    lng: Number.isFinite(point.lng) ? point.lng : map.mapCenter[1]
  };
}

function attachLegacySupportGroups(map) {
  const stations = map.supportStations ||= [];
  const ids = new Set(stations.map((station) => station.id));
  for (const group of map.supportGroups || []) {
    if (ids.has(group.supportStationId)) continue;
    const location = supportGroupLocation(map, group);
    const baseId = `seg-wache-${group.id}`;
    let id = baseId;
    for (let n = 2; ids.has(id); n++) id = `${baseId}-${n}`;
    ids.add(id);
    stations.push({ ...location, id, label: group.label || location.label, units: [] });
    group.supportStationId = id;
  }
}

function isForeignMapPoint(point) {
  return Boolean(point?.foreign || point?.foreignStation || point?.outsideCoverage || point?.external);
}

function stationMapSymbol(station) {
  const units = Array.isArray(station.units) && station.units.length ? station.units : null;
  const types = new Set((units
    ? units.map((unit) => unit.type || unit.name?.split(" ")[0] || "RTW")
    : Object.entries(station.vehicles || {}).filter(([, count]) => Number(count) > 0).map(([type]) => type)
  ).map((type) => String(type).trim().toUpperCase()));
  if (types.size && [...types].every((type) => type === "HVO" || type === "FR")) {
    return types.has("HVO") ? "HvO" : "FR";
  }
  const roadTransport = ["RTW", "KTW", "ITW"].some((type) => types.has(type));
  if (!roadTransport && (types.has("RTH") || types.has("ITH"))) return "RTH";
  if (isForeignMapPoint(station)) return "FRW";
  if (!roadTransport && (types.has("NEF") || types.has("VEF"))) return "NEF";
  return "RW";
}

function createMapPointIcon(label, type, count) {
  const station = label === "RW" || label === "FRW";
  const responder = label === "HvO" || label === "FR";
  const support = type.split(" ").includes("support");
  const symbol = station ? '<span class="map-station-symbol"></span>'
    : label === "RTH" ? '<span class="map-helicopter-symbol"></span>'
    : escapeHtml(label);
  const content = responder ? `<span>${MAP_RESPONDER_SYMBOL}</span><small>${symbol}</small>` : symbol;
  const badge = Number.isInteger(count) ? `<small class="map-station-count">${count}</small>` : "";
  return L.divIcon({
    className: "",
    html: `<span class="map-marker ${type}${responder ? " map-marker-responder" : ""}" aria-hidden="true">${content}${badge}</span>`,
    iconSize: support ? [42, 28] : [34, 34],
    iconAnchor: support ? [21, 14] : [17, 17]
  });
}

function groupHospitalsByLocation(hospitals) {
  const sites = new Map();
  for (const hospital of hospitals) {
    const lat = Number(hospital.lat);
    const lng = Number(hospital.lng);
    if (hospital.lat == null || hospital.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (!sites.has(key)) sites.set(key, []);
    sites.get(key).push(hospital);
  }
  return [...sites.values()];
}

function hospitalMapMarkerTitle(entries) {
  const label = entries[0].label || "Klinik";
  return entries.length > 1 ? `${label.replace(/\s*\([^()]*\)$/, "")} · ${entries.length} Klinikeinträge` : label;
}

async function fetchMapOverview(mapId, { signal } = {}) {
  const url = `/api/maps/${encodeURIComponent(mapId)}`;
  const response = await fetch(`${url}?view=overview`, { signal });
  if (!response.ok) throw new Error(`Karte konnte nicht geladen werden (${response.status}).`);
  const data = await response.json();
  return data.map ? { ...data, url } : { map: data, osmRevision: null, url };
}

async function fetchMapOsmData({ url, osmRevision }, { signal } = {}) {
  const response = await fetch(`${url}?view=osm&revision=${encodeURIComponent(osmRevision)}`, { signal });
  if (response.status === 409) throw new Error("Die Karte wurde geändert. Bitte die Karte neu laden.");
  if (!response.ok) throw new Error(`OSM-Daten konnten nicht geladen werden (${response.status}).`);
  return response.json();
}
