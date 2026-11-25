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
  if (isForeignMapPoint(station)) return "FRW";
  if (!["RTW", "KTW", "ITW"].some((type) => types.has(type))) {
    if (types.has("RTH") || types.has("ITH")) return "RTH";
    if (types.has("NEF") || types.has("VEF")) return "NEF";
  }
  return "RW";
}

function createMapPointIcon(label, type, count) {
  const station = label === "RW" || label === "FRW";
  const responder = label === "HvO" || label === "FR";
  const support = type.split(" ").includes("support");
  const symbol = station ? '<span class="map-station-symbol"></span>' : escapeHtml(label);
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
