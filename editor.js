const state = {
  mapData: {
    id: "ils-regensburg-testversion-stadt-regensburg",
    name: "ILS Regensburg (Testversion Stadt Regensburg)",
    weather: "Leichter Regen, 12 C",
    mapCenter: [49.0134, 12.1016],
    zoom: 13,
    stations: [],
    hospitals: [],
    poi: [],
    coverageGeoJson: null,
    callRates: defaultCallRates()
  },
  editingId: null,
  editingUnits: [],
  pinMode: false,
  coverageMarkers: [],
  map: null,
  coverageLayer: null,
  layers: []
};

const el = Object.fromEntries([
  "map-name", "type", "name", "address", "geocode", "rtw", "ktw", "nef", "ref", "rth", "lat", "lng",
  "rates",
  "new-station", "new-hospital", "new-poi", "edit-coverage", "point-dialog", "point-form", "coverage-form", "form-title",
  "cancel-edit", "cancel-coverage", "vehicle-count-section", "unit-section", "hospital-section", "departments",
  "pediatric-only", "poi-section", "poi-category-search", "poi-categories", "coverage", "use-bounds", "apply-coverage",
  "set-pin", "edit-coverage-pins", "add-coverage-pin",
  "unit-type", "unit-name", "unit-short", "unit-shift", "add-unit", "units-list",
  "use-center", "add", "new", "save", "points", "saved", "map"
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#se-${id}`)]));

init();

function init() {
  state.map = L.map(el.map).setView(state.mapData.mapCenter, state.mapData.zoom);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  }).addTo(state.map);
  state.map.on("click", (event) => {
    if (state.pinMode) {
      setPointCoordinates(event.latlng);
      state.pinMode = false;
      state.map.getContainer().classList.remove("pin-mode");
      if (!el.point_dialog.open) showDialog(el.point_dialog);
      return;
    }
    el.lat.value = event.latlng.lat.toFixed(6);
    el.lng.value = event.latlng.lng.toFixed(6);
  });
  el.use_center.addEventListener("click", useCenter);
  el.use_bounds.addEventListener("click", useBoundsAsCoverage);
  el.apply_coverage.addEventListener("click", applyCoverageGeoJson);
  el.edit_coverage_pins.addEventListener("click", editCoveragePins);
  el.add_coverage_pin.addEventListener("click", addCoveragePin);
  el.geocode.addEventListener("click", geocodeAddress);
  el.set_pin.addEventListener("click", beginPinMode);
  el.add.addEventListener("click", savePoint);
  el.add_unit.addEventListener("click", addUnit);
  el.new_station.addEventListener("click", () => startPointEdit("station"));
  el.new_hospital.addEventListener("click", () => startPointEdit("hospital"));
  el.new_poi.addEventListener("click", () => startPointEdit("poi"));
  el.edit_coverage.addEventListener("click", showCoverageForm);
  el.poi_category_search.addEventListener("input", () => renderPoiCategorySelect());
  el.cancel_edit.addEventListener("click", closeWorkbench);
  el.cancel_coverage.addEventListener("click", closeWorkbench);
  el.new.addEventListener("click", newMap);
  el.save.addEventListener("click", saveMapFile);
  el.type.addEventListener("change", updateVehicleInputs);
  renderDepartmentChecks();
  renderRateEditor();
  useCenter();
  updateVehicleInputs();
  closeWorkbench();
  render();
  loadSavedMaps();
}

function defaultCallRates() {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    emergency: hour >= 7 && hour <= 22 ? 0.9 : 0.35,
    transport: hour >= 7 && hour <= 18 ? 0.55 : 0.1,
    scheduled: hour >= 7 && hour <= 16 ? 0.25 : 0.02
  }));
}

function renderRateEditor() {
  const rates = normalizeCallRates(state.mapData.callRates);
  state.mapData.callRates = rates;
  el.rates.innerHTML = `
    <span>Std</span><span>112</span><span>19222</span><span>Planbar</span>
  `;
  rates.forEach((rate) => {
    [["hour", rate.hour], ["emergency", rate.emergency], ["transport", rate.transport], ["scheduled", rate.scheduled]].forEach(([key, value]) => {
      if (key === "hour") {
        const label = document.createElement("strong");
        label.textContent = `${String(value).padStart(2, "0")}:00`;
        el.rates.append(label);
        return;
      }
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.step = "0.1";
      input.value = value;
      input.dataset.hour = rate.hour;
      input.dataset.type = key;
      input.addEventListener("input", updateRateFromInput);
      el.rates.append(input);
    });
  });
}

function normalizeCallRates(rates) {
  const fallback = defaultCallRates();
  if (!Array.isArray(rates)) return fallback;
  return fallback.map((base) => ({ ...base, ...(rates.find((item) => Number(item.hour) === base.hour) || {}) }));
}

function updateRateFromInput(event) {
  const hour = Number(event.target.dataset.hour);
  const type = event.target.dataset.type;
  const rate = state.mapData.callRates.find((item) => item.hour === hour);
  if (rate) rate[type] = Math.max(0, Number(event.target.value) || 0);
}

function useBoundsAsCoverage() {
  const bounds = state.map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  state.mapData.coverageGeoJson = {
    type: "Feature",
    properties: { name: `${state.mapData.name} Einsatzgebiet` },
    geometry: {
      type: "Polygon",
      coordinates: [[[west, north], [east, north], [east, south], [west, south], [west, north]]]
    }
  };
  el.coverage.value = JSON.stringify(state.mapData.coverageGeoJson, null, 2);
  clearCoverageMarkers();
  render();
}

function applyCoverageGeoJson() {
  try {
    const parsed = JSON.parse(el.coverage.value);
    state.mapData.coverageGeoJson = parsed;
    render();
  } catch {
    alert("GeoJSON konnte nicht gelesen werden.");
  }
}

function useCenter() {
  const center = state.map.getCenter();
  setPointCoordinates(center);
}

function setPointCoordinates(latlng) {
  el.lat.value = latlng.lat.toFixed(6);
  el.lng.value = latlng.lng.toFixed(6);
}

function beginPinMode() {
  state.pinMode = true;
  state.map.getContainer().classList.add("pin-mode");
  alert("Klicke jetzt auf die Karte, um den Pin zu setzen.");
}

function startPointEdit(type, point = null) {
  state.editingId = point?.id || null;
  el.coverage_form.hidden = true;
  el.type.value = type;
  const typeLabel = type === "hospital" ? "Klinik" : type === "poi" ? "POI" : "Rettungswache";
  el.form_title.textContent = point ? `${typeLabel} bearbeiten` : `Neuer ${typeLabel}`;
  if (point) fillPointForm(point);
  else {
    clearPointFields();
    useCenter();
    if (type === "station") {
      el.rtw.value = 1;
      el.ktw.value = 0;
      el.nef.value = 0;
      el.ref.value = 0;
      el.rth.value = 0;
    }
  }
  updateVehicleInputs();
  showDialog(el.point_dialog);
}

function showCoverageForm() {
  state.editingId = null;
  el.coverage_form.hidden = false;
}

function closeWorkbench() {
  state.editingId = null;
  el.coverage_form.hidden = true;
  if (el.point_dialog.open) el.point_dialog.close();
  clearPointFields();
}

async function geocodeAddress() {
  const query = [el.address.value.trim(), "Regensburg"].filter(Boolean).join(", ");
  if (!query.trim()) return;
  el.geocode.disabled = true;
  el.geocode.textContent = "Suche...";
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("geocoding failed");
    const result = (await response.json())[0];
    if (!result) throw new Error("no result");
    el.lat.value = Number(result.lat).toFixed(6);
    el.lng.value = Number(result.lon).toFixed(6);
    state.map.setView([Number(result.lat), Number(result.lon)], 16);
  } catch {
    alert("Adresse konnte nicht gefunden werden. Bitte Koordinaten setzen oder später erneut versuchen.");
  } finally {
    el.geocode.disabled = false;
    el.geocode.textContent = "Adresse suchen";
  }
}

function addUnit() {
  if (el.type.value !== "station") return;
  const type = el.unit_type.value;
  const name = el.unit_name.value.trim() || `${type} ${state.editingUnits.length + 1}`;
  state.editingUnits.push({
    id: makeId(`${type}-${name}-${Date.now()}`),
    type,
    name,
    fullName: name,
    shortName: el.unit_short.value.trim() || name,
    shift: el.unit_shift.value.trim()
  });
  el.unit_name.value = "";
  el.unit_short.value = "";
  el.unit_shift.value = "";
  syncCountsFromUnits();
  renderUnits();
}

function renderUnits() {
  el.units_list.innerHTML = "";
  if (el.type.value !== "station") {
    el.units_list.textContent = "Fahrzeuge nur bei Rettungswachen.";
    return;
  }
  if (!state.editingUnits.length) {
    el.units_list.textContent = "Noch keine einzelnen Fahrzeuge angelegt. Alternativ zählen die Felder oben.";
    return;
  }
  state.editingUnits.forEach((unit) => {
    const row = document.createElement("article");
    row.className = "unit-row";
    row.innerHTML = `<div><strong>${escapeHtml(unit.shortName)}</strong><span>${escapeHtml(unit.name)} | ${escapeHtml(unit.type)}${unit.shift ? ` | ${escapeHtml(unit.shift)}` : ""}</span></div>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Entfernen";
    button.addEventListener("click", () => {
      state.editingUnits = state.editingUnits.filter((item) => item.id !== unit.id);
      syncCountsFromUnits();
      renderUnits();
    });
    row.append(button);
    el.units_list.append(row);
  });
}

function syncCountsFromUnits() {
  const counts = state.editingUnits.reduce((sum, unit) => {
    sum[unit.type] = (sum[unit.type] || 0) + 1;
    return sum;
  }, {});
  el.rtw.value = counts.RTW || 0;
  el.ktw.value = counts.KTW || 0;
  el.nef.value = counts.NEF || 0;
  el.ref.value = counts.REF || 0;
  el.rth.value = counts.RTH || 0;
}

function savePoint() {
  const type = el.type.value;
  state.mapData.poi ||= [];
  const lat = Number(el.lat.value.replace(",", "."));
  const lng = Number(el.lng.value.replace(",", "."));
  if (!el.name.value.trim() || Number.isNaN(lat) || Number.isNaN(lng)) return;
  const point = {
    id: state.editingId || makeId(el.name.value),
    label: el.name.value.trim(),
    address: el.address.value.trim() || "eigener Kartenpunkt",
    lat,
    lng
  };
  if (type === "station") {
    point.vehicles = vehicleCounts();
    point.units = namedUnits(point.vehicles);
    upsert(state.mapData.stations, point);
    state.mapData.hospitals = state.mapData.hospitals.filter((item) => item.id !== point.id);
    state.mapData.poi = (state.mapData.poi || []).filter((item) => item.id !== point.id);
  } else if (type === "poi") {
    point.categories = selectedPoiCategories();
    upsert(state.mapData.poi, point);
    state.mapData.stations = state.mapData.stations.filter((item) => item.id !== point.id);
    state.mapData.hospitals = state.mapData.hospitals.filter((item) => item.id !== point.id);
  } else {
    point.departments = selectedDepartments();
    point.pediatricOnly = el.pediatric_only.checked;
    upsert(state.mapData.hospitals, point);
    state.mapData.stations = state.mapData.stations.filter((item) => item.id !== point.id);
    state.mapData.poi = (state.mapData.poi || []).filter((item) => item.id !== point.id);
  }
  state.editingId = null;
  el.add.textContent = "Punkt speichern";
  closeWorkbench();
  render();
}

function vehicleCounts() {
  if (state.editingUnits.length) {
    return state.editingUnits.reduce((counts, unit) => {
      counts[unit.type] = (counts[unit.type] || 0) + 1;
      return counts;
    }, {});
  }
  return {
    RTW: Number(el.rtw.value) || 0,
    KTW: Number(el.ktw.value) || 0,
    NEF: Number(el.nef.value) || 0,
    REF: Number(el.ref.value) || 0,
    RTH: Number(el.rth.value) || 0
  };
}

function namedUnits(vehicles) {
  if (state.editingUnits.length) return state.editingUnits.map((unit) => ({ ...unit }));
  return Object.entries(vehicles).flatMap(([type, count]) =>
    Array.from({ length: count }, (_, index) => ({ type, name: `${type} ${index + 1}`, shortName: `${type} ${index + 1}`, shift: "" }))
  );
}

function updateVehicleInputs() {
  const disabled = el.type.value !== "station";
  el.vehicle_count_section.hidden = disabled;
  el.unit_section.hidden = disabled;
  el.hospital_section.hidden = el.type.value !== "hospital";
  el.poi_section.hidden = el.type.value !== "poi";
  [el.rtw, el.ktw, el.nef, el.ref, el.rth, el.unit_type, el.unit_name, el.unit_short, el.unit_shift, el.add_unit].forEach((input) => {
    input.disabled = disabled;
  });
  el.hospital_section.open = el.type.value === "hospital";
  el.departments.querySelectorAll("input").forEach((input) => {
    input.disabled = el.type.value !== "hospital";
  });
  el.pediatric_only.disabled = el.type.value !== "hospital";
  el.poi_categories.disabled = el.type.value !== "poi";
  el.poi_category_search.disabled = el.type.value !== "poi";
  renderUnits();
}

function render() {
  state.layers.forEach((layer) => layer.remove());
  state.layers = [];
  state.coverageLayer = null;
  if (state.mapData.coverageGeoJson) {
    const layer = L.geoJSON(state.mapData.coverageGeoJson, {
      style: { color: "#2d75b8", weight: 2, fillColor: "#2d75b8", fillOpacity: .08 }
    }).addTo(state.map);
    state.coverageLayer = layer;
    state.layers.push(layer);
  }
  const points = [
    ...state.mapData.stations.map((point) => ({ ...point, type: "station" })),
    ...state.mapData.hospitals.map((point) => ({ ...point, type: "hospital" })),
    ...(state.mapData.poi || []).map((point) => ({ ...point, type: "poi" }))
  ];
  points.forEach((point) => {
    const icon = L.divIcon({
      className: "",
      html: `<span class="map-marker ${point.type === "hospital" ? "hospital" : point.type === "poi" ? "poi" : "station station-available"}">${point.type === "hospital" ? "KH" : point.type === "poi" ? "POI" : "RW"}</span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    const marker = L.marker([point.lat, point.lng], { icon }).bindPopup(point.label).addTo(state.map);
    marker.on("click", () => editPoint(point));
    state.layers.push(marker);
  });
  renderList(points);
}

function renderList(points) {
  el.points.innerHTML = "";
  points.forEach((point) => {
    const row = document.createElement("article");
    row.className = "editor-point";
    const extra = point.type === "station"
      ? (point.units?.length ? ` | ${point.units.map((unit) => unit.name).join(", ")}` : "")
      : point.type === "hospital"
        ? ` | ${(point.departments || []).map(departmentLabel).join(", ") || "keine Fachrichtungen"}${point.pediatricOnly ? " | reine Kinderklinik" : ""}`
        : ` | ${(point.categories || []).join(", ") || "keine Kategorien"}`;
    row.innerHTML = `<div><h3>${escapeHtml(point.label)}</h3><p>${point.type}${escapeHtml(extra)}</p></div>`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    [["Bearbeiten", () => editPoint(point)], ["Löschen", () => deletePoint(point)]].forEach(([label, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", handler);
      actions.append(button);
    });
    row.append(actions);
    el.points.append(row);
  });
}

function editPoint(point) {
  startPointEdit(point.type, point);
}

function fillPointForm(point) {
  el.name.value = point.label;
  el.address.value = point.address || "";
  el.lat.value = point.lat.toFixed(6);
  el.lng.value = point.lng.toFixed(6);
  el.rtw.value = point.vehicles?.RTW || 0;
  el.ktw.value = point.vehicles?.KTW || 0;
  el.nef.value = point.vehicles?.NEF || 0;
  el.ref.value = point.vehicles?.REF || 0;
  el.rth.value = point.vehicles?.RTH || 0;
  state.editingUnits = (point.units || []).map((unit) => ({
    id: unit.id || makeId(`${unit.type}-${unit.name}-${Date.now()}`),
    type: unit.type || "RTW",
    name: unit.fullName || unit.name || "",
    fullName: unit.fullName || unit.name || "",
    shortName: unit.shortName || unit.short || unit.name || "",
    shift: unit.shift || ""
  }));
  renderDepartmentChecks(point.departments || []);
  el.pediatric_only.checked = Boolean(point.pediatricOnly);
  renderPoiCategorySelect(point.categories || []);
  el.add.textContent = "Änderungen speichern";
  renderUnits();
}

function deletePoint(point) {
  state.mapData.stations = state.mapData.stations.filter((item) => item.id !== point.id);
  state.mapData.hospitals = state.mapData.hospitals.filter((item) => item.id !== point.id);
  state.mapData.poi = (state.mapData.poi || []).filter((item) => item.id !== point.id);
  render();
}

async function saveMapFile() {
  state.mapData.name = el.map_name.value.trim() || "Neue Karte";
  state.mapData.callRates = normalizeCallRates(state.mapData.callRates);
  state.mapData.id = makeId(state.mapData.name);
  state.mapData.mapCenter = [state.map.getCenter().lat, state.map.getCenter().lng];
  state.mapData.zoom = state.map.getZoom();
  const response = await fetch("/api/maps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.mapData)
  });
  if (!response.ok) {
    localStorage.setItem(`dispatchsim.map.${state.mapData.id}`, JSON.stringify(state.mapData));
  }
  loadSavedMaps();
}

async function loadSavedMaps() {
  try {
    const response = await fetch("/api/maps");
    if (!response.ok) throw new Error("api unavailable");
    const maps = await response.json();
    el.saved.innerHTML = "";
    maps.forEach((map) => {
      const row = document.createElement("article");
      row.className = "editor-point";
      row.innerHTML = `<div><h3>${escapeHtml(map.name)}</h3><p>${map.stations} Wachen | ${map.hospitals} Kliniken</p></div>`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Laden";
      button.addEventListener("click", () => loadMap(map.id));
      row.append(button);
      el.saved.append(row);
    });
  } catch {
    el.saved.textContent = "Server-Speicherung nicht verfügbar.";
  }
}

async function loadMap(id) {
  const response = await fetch(`/api/maps/${id}`);
  if (!response.ok) return;
  state.mapData = await response.json();
  state.mapData.poi ||= [];
  state.mapData.callRates = normalizeCallRates(state.mapData.callRates);
  el.map_name.value = state.mapData.name;
  el.coverage.value = state.mapData.coverageGeoJson ? JSON.stringify(state.mapData.coverageGeoJson, null, 2) : "";
  state.editingId = null;
  state.editingUnits = [];
  closeWorkbench();
  state.map.setView(state.mapData.mapCenter, state.mapData.zoom);
  renderRateEditor();
  render();
}

function newMap() {
  state.mapData = { id: "new-map", name: "Neue Karte", weather: "", mapCenter: [49.00761514468197, 12.09749221801758], zoom: 14, stations: [], hospitals: [], poi: [], coverageGeoJson: null, callRates: defaultCallRates() };
  el.map_name.value = state.mapData.name;
  el.coverage.value = "";
  renderRateEditor();
  closeWorkbench();
  render();
}

function editCoveragePins() {
  clearCoverageMarkers();
  const ring = state.mapData.coverageGeoJson?.geometry?.coordinates?.[0];
  const points = Array.isArray(ring) && ring.length > 3
    ? ring.slice(0, -1).slice(0, 25).map(([lng, lat]) => ({ lat, lng }))
    : boundsToCoveragePoints();
  points.forEach(addCoverageMarker);
  syncCoverageFromMarkers();
}

function boundsToCoveragePoints() {
  const bounds = state.map.getBounds();
  const center = bounds.getCenter();
  const latRadius = Math.max(.005, (bounds.getNorth() - bounds.getSouth()) * .42);
  const lngRadius = Math.max(.005, (bounds.getEast() - bounds.getWest()) * .42);
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + index * (Math.PI * 2 / 10);
    return {
      lat: center.lat + Math.sin(angle) * latRadius,
      lng: center.lng + Math.cos(angle) * lngRadius
    };
  });
}

function addCoveragePin() {
  if (state.coverageMarkers.length >= 25) {
    alert("Maximal 25 Grenzpunkte sind vorgesehen.");
    return;
  }
  addCoverageMarker(state.map.getCenter());
  syncCoverageFromMarkers();
}

function addCoverageMarker(point) {
  const marker = L.marker([point.lat, point.lng], { draggable: true }).addTo(state.map);
  marker.on("drag", syncCoverageFromMarkers);
  marker.on("dragend", syncCoverageFromMarkers);
  state.coverageMarkers.push(marker);
}

function syncCoverageFromMarkers() {
  if (state.coverageMarkers.length < 3) return;
  const coordinates = state.coverageMarkers.map((marker) => {
    const position = marker.getLatLng();
    return [position.lng, position.lat];
  });
  coordinates.push([...coordinates[0]]);
  state.mapData.coverageGeoJson = {
    type: "Feature",
    properties: { name: `${state.mapData.name} Einsatzgebiet` },
    geometry: { type: "Polygon", coordinates: [coordinates] }
  };
  el.coverage.value = JSON.stringify(state.mapData.coverageGeoJson, null, 2);
  renderCoverageLayerOnly();
}

function renderCoverageLayerOnly() {
  if (state.coverageLayer) state.coverageLayer.remove();
  state.layers = state.layers.filter((layer) => layer !== state.coverageLayer);
  state.coverageLayer = null;
  if (state.mapData.coverageGeoJson) {
    const layer = L.geoJSON(state.mapData.coverageGeoJson, {
      style: { color: "#2d75b8", weight: 2, fillColor: "#2d75b8", fillOpacity: .08 }
    }).addTo(state.map);
    state.coverageLayer = layer;
    state.layers.push(layer);
  }
}

function clearCoverageMarkers() {
  state.coverageMarkers.forEach((marker) => marker.remove());
  state.coverageMarkers = [];
}

function clearPointFields() {
  el.name.value = "";
  el.address.value = "";
  state.editingUnits = [];
  syncCountsFromUnits();
  renderDepartmentChecks();
  el.pediatric_only.checked = false;
  renderPoiCategorySelect([]);
  renderUnits();
}

function renderDepartmentChecks(selected = []) {
  const selectedSet = new Set(selected);
  el.departments.innerHTML = "";
  (window.departmentCatalog || []).forEach((department) => {
    if (department.key === "none") return;
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(department.key)}"> ${escapeHtml(department.label)}`;
    const input = label.querySelector("input");
    input.checked = selectedSet.has(department.key) || (!selected.length && department.key === "internal");
    el.departments.append(label);
  });
}

function selectedDepartments() {
  return [...el.departments.querySelectorAll("input:checked")].map((input) => input.value);
}

function renderPoiCategorySelect(selected = selectedPoiCategories()) {
  const selectedSet = new Set(selected);
  const query = normalizeSearch(el.poi_category_search?.value || "");
  el.poi_categories.innerHTML = "";
  (window.poiCategoryCatalog || [])
    .filter((category) => !query || normalizeSearch(`${category.id || category.key} ${category.label}`).includes(query))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id || category.key;
      option.textContent = category.label;
      option.selected = selectedSet.has(option.value);
      el.poi_categories.append(option);
    });
}

function selectedPoiCategories() {
  return [...el.poi_categories.selectedOptions].map((option) => option.value);
}

function departmentLabel(key) {
  return (window.departmentCatalog || []).find((item) => item.key === key)?.label || key;
}

function upsert(list, point) {
  const index = list.findIndex((item) => item.id === point.id);
  if (index >= 0) list[index] = point;
  else list.push(point);
}

function makeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `map-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
