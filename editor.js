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
    supportGroups: [],
    coverageGeoJson: null,
    weightZones: [],
    callRates: defaultCallRates()
  },
  editingId: null,
  editingUnits: [],
  editingUnitId: null,
  pinMode: false,
  coverageMarkers: [],
  importedPoiResults: [],
  importedOsmData: null,
  failedOsmTiles: [],
  osmImportRunning: false,
  osmImportPauseAfterTile: false,
  osmImportAbort: false,
  showOsmAddressDiagnostics: false,
  showAllRoadDiagnostics: false,
  osmRoadPoolLayers: [],
  boundaryResults: [],
  weightBoundaryResults: [],
  pointListFilter: "station",
  editingSupportGroupId: null,
  editingSupportUnits: [],
  editingSupportUnitId: null,
  showPoiMarkers: false,
  map: null,
  coverageLayer: null,
  layers: []
};

const el = Object.fromEntries([
  "map-name", "type", "name", "address", "foreign-point", "foreign-availability-row", "foreign-availability", "geocode", "rtw", "ktw", "nef", "vef", "ref", "itw", "rth", "ith", "elrd", "hvo", "fr", "lat", "lng",
  "rates",
  "new-station", "new-hospital", "new-poi", "new-support-group", "edit-coverage", "edit-weight-zones", "point-dialog", "point-form", "coverage-form", "weight-form", "form-title",
  "cancel-edit", "cancel-coverage", "vehicle-count-section", "unit-section", "hospital-section", "departments", "hospital-unavailable-probability",
  "pediatric-only", "poi-section", "poi-category-search", "poi-categories", "coverage", "use-bounds", "apply-coverage",
  "boundary-query", "search-boundaries", "replace-boundaries", "add-boundaries", "clear-coverage", "boundary-status", "boundary-results",
  "cancel-weight", "weight-query", "weight-factor", "search-weight-boundaries", "add-weight-zones", "weight-status", "weight-results", "weight-zone-list",
  "osm-poi-categories", "osm-select-all-poi", "osm-clear-poi", "osm-only-roads", "import-roads", "import-outdoor", "import-pois", "retry-osm-failed", "pause-osm-import", "abort-osm-import", "apply-imported-pois", "show-address-diagnostics", "show-all-road-diagnostics", "osm-poi-status", "osm-poi-preview",
  "show-poi-markers", "point-filter-stations", "point-filter-hospitals", "point-filter-poi", "point-filter-support",
  "set-pin", "edit-coverage-pins", "add-coverage-pin",
  "unit-type", "unit-name", "unit-short", "unit-shift", "unit-responder-availability", "add-unit", "cancel-unit-edit", "units-list",
  "support-dialog", "support-title", "cancel-support", "support-name", "support-station", "support-availability", "support-min", "support-max",
  "support-unit-type", "support-unit-name", "support-unit-short", "support-unit-availability", "add-support-unit", "cancel-support-unit-edit", "support-units-list", "save-support",
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
  el.search_boundaries.addEventListener("click", searchBoundaries);
  el.replace_boundaries.addEventListener("click", () => applySelectedBoundaries("replace"));
  el.add_boundaries.addEventListener("click", () => applySelectedBoundaries("add"));
  el.clear_coverage.addEventListener("click", clearCoverageGeoJson);
  el.edit_coverage_pins.addEventListener("click", editCoveragePins);
  el.add_coverage_pin.addEventListener("click", addCoveragePin);
  el.geocode.addEventListener("click", geocodeAddress);
  el.set_pin.addEventListener("click", beginPinMode);
  el.add.addEventListener("click", savePoint);
  el.add_unit.addEventListener("click", addUnit);
  el.cancel_unit_edit.addEventListener("click", cancelUnitEdit);
  el.new_station.addEventListener("click", () => startPointEdit("station"));
  el.new_hospital.addEventListener("click", () => startPointEdit("hospital"));
  el.new_poi.addEventListener("click", () => startPointEdit("poi"));
  el.new_support_group.addEventListener("click", () => startSupportGroupEdit());
  el.edit_coverage.addEventListener("click", showCoverageForm);
  el.edit_weight_zones.addEventListener("click", showWeightForm);
  el.search_weight_boundaries.addEventListener("click", searchWeightBoundaries);
  el.add_weight_zones.addEventListener("click", addSelectedWeightZones);
  el.add_support_unit.addEventListener("click", addSupportUnit);
  el.cancel_support_unit_edit.addEventListener("click", cancelSupportUnitEdit);
  el.save_support.addEventListener("click", saveSupportGroup);
  el.osm_select_all_poi.addEventListener("click", () => setOsmPoiSelection(true));
  el.osm_clear_poi.addEventListener("click", () => setOsmPoiSelection(false));
  el.osm_only_roads.addEventListener("click", selectOnlyOsmRoads);
  el.poi_category_search.addEventListener("input", () => renderPoiCategorySelect());
  el.import_pois.addEventListener("click", importOsmPois);
  el.retry_osm_failed.addEventListener("click", retryFailedOsmTiles);
  el.pause_osm_import.addEventListener("click", () => {
    state.osmImportPauseAfterTile = true;
    el.pause_osm_import.textContent = "Pausiert nach Schritt...";
    el.pause_osm_import.disabled = true;
  });
  el.abort_osm_import.addEventListener("click", () => {
    state.osmImportAbort = true;
    el.abort_osm_import.textContent = "Bricht ab...";
    el.abort_osm_import.disabled = true;
  });
  el.apply_imported_pois.addEventListener("click", applyImportedPois);
  el.show_address_diagnostics.addEventListener("change", () => {
    state.showOsmAddressDiagnostics = el.show_address_diagnostics.checked;
    if (!state.showOsmAddressDiagnostics) {
      state.showAllRoadDiagnostics = false;
      el.show_all_road_diagnostics.checked = false;
    }
    render();
  });
  el.show_all_road_diagnostics.addEventListener("change", () => {
    state.showAllRoadDiagnostics = el.show_all_road_diagnostics.checked;
    if (state.showAllRoadDiagnostics) {
      state.showOsmAddressDiagnostics = true;
      el.show_address_diagnostics.checked = true;
    }
    render();
  });
  el.show_poi_markers.addEventListener("change", () => {
    state.showPoiMarkers = el.show_poi_markers.checked;
    render();
  });
  el.point_filter_stations.addEventListener("click", () => setPointListFilter("station"));
  el.point_filter_hospitals.addEventListener("click", () => setPointListFilter("hospital"));
  el.point_filter_poi.addEventListener("click", () => setPointListFilter("poi"));
  el.point_filter_support.addEventListener("click", () => setPointListFilter("support"));
  el.cancel_edit.addEventListener("click", closeWorkbench);
  el.cancel_coverage.addEventListener("click", closeWorkbench);
  el.cancel_weight.addEventListener("click", closeWorkbench);
  el.new.addEventListener("click", newMap);
  el.save.addEventListener("click", saveMapFile);
  el.type.addEventListener("change", updateVehicleInputs);
  renderDepartmentChecks();
  renderOsmImportCategories();
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

async function searchBoundaries() {
  const query = el.boundary_query.value.trim();
  if (query.length < 3) {
    setBoundaryStatus("Bitte mindestens drei Zeichen eingeben.", true);
    return;
  }
  el.search_boundaries.disabled = true;
  el.search_boundaries.textContent = "Suche...";
  el.replace_boundaries.disabled = true;
  el.add_boundaries.disabled = true;
  setBoundaryStatus("OSM-Grenzen werden gesucht...");
  try {
    const response = await fetch("/api/boundary-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Grenzsuche fehlgeschlagen");
    state.boundaryResults = Array.isArray(data.boundaries) ? data.boundaries : [];
    renderBoundaryResults();
    const hasResults = state.boundaryResults.length > 0;
    el.replace_boundaries.disabled = !hasResults;
    el.add_boundaries.disabled = !hasResults;
    setBoundaryStatus(hasResults ? `${state.boundaryResults.length} Grenze(n) gefunden.` : "Keine passenden Grenzen gefunden.", !hasResults);
  } catch (error) {
    state.boundaryResults = [];
    renderBoundaryResults();
    setBoundaryStatus(error.message || "Grenzsuche fehlgeschlagen.", true);
  } finally {
    el.search_boundaries.disabled = false;
    el.search_boundaries.textContent = "Grenzen suchen";
  }
}

function renderBoundaryResults() {
  el.boundary_results.innerHTML = "";
  if (!state.boundaryResults.length) {
    el.boundary_results.className = "editor-point-list boundary-result-list empty-state";
    el.boundary_results.textContent = "Noch keine Treffer.";
    return;
  }
  el.boundary_results.className = "editor-point-list boundary-result-list";
  state.boundaryResults.forEach((result) => {
    const row = document.createElement("label");
    row.className = "editor-point boundary-result";
    row.innerHTML = `
      <input type="checkbox" value="${escapeHtml(result.id)}" checked>
      <div>
        <h3>${escapeHtml(result.label || "OSM-Grenze")}</h3>
        <p>${escapeHtml(result.displayName || result.type || "Verwaltungsgrenze")}</p>
      </div>
    `;
    el.boundary_results.append(row);
  });
}

function applySelectedBoundaries(mode) {
  const selectedIds = new Set([...el.boundary_results.querySelectorAll("input:checked")].map((input) => input.value));
  const selectedFeatures = state.boundaryResults
    .filter((result) => selectedIds.has(result.id))
    .map((result) => result.geoJson)
    .filter(Boolean);
  if (!selectedFeatures.length) {
    setBoundaryStatus("Bitte mindestens eine Grenze auswählen.", true);
    return;
  }
  const features = mode === "add"
    ? [...coverageFeatures(state.mapData.coverageGeoJson), ...selectedFeatures]
    : selectedFeatures;
  state.mapData.coverageGeoJson = coverageFromFeatures(features);
  el.coverage.value = JSON.stringify(state.mapData.coverageGeoJson, null, 2);
  clearCoverageMarkers();
  render();
  if (state.coverageLayer) {
    state.map.fitBounds(state.coverageLayer.getBounds(), { padding: [20, 20] });
  }
  setBoundaryStatus(`${selectedFeatures.length} Grenze(n) ${mode === "add" ? "hinzugefügt" : "übernommen"}.`);
}

function clearCoverageGeoJson() {
  state.mapData.coverageGeoJson = null;
  el.coverage.value = "";
  clearCoverageMarkers();
  render();
  setBoundaryStatus("Einsatzgebiet gelöscht. Ohne Einsatzgebiet nutzt die Simulation den Kartenausschnitt/Fallback.");
}

function coverageFeatures(geoJson) {
  if (!geoJson) return [];
  if (geoJson.type === "FeatureCollection") return (geoJson.features || []).filter((feature) => feature?.geometry);
  if (geoJson.type === "Feature") return geoJson.geometry ? [geoJson] : [];
  if (["Polygon", "MultiPolygon", "GeometryCollection"].includes(geoJson.type)) {
    return [{ type: "Feature", properties: { name: "Einsatzgebiet" }, geometry: geoJson }];
  }
  return [];
}

function coverageFromFeatures(features) {
  const clean = features.filter((feature) => feature?.geometry);
  if (clean.length === 1) return clean[0];
  return {
    type: "FeatureCollection",
    features: clean
  };
}

function setBoundaryStatus(text, isError = false) {
  el.boundary_status.textContent = text;
  el.boundary_status.classList.toggle("error-text", Boolean(isError));
}

async function searchWeightBoundaries() {
  const query = el.weight_query.value.trim();
  if (query.length < 3) {
    setWeightStatus("Bitte mindestens drei Zeichen eingeben.", true);
    return;
  }
  el.search_weight_boundaries.disabled = true;
  el.add_weight_zones.disabled = true;
  el.search_weight_boundaries.textContent = "Suche...";
  setWeightStatus("Grenzen fuer Gewichtungszone werden gesucht...");
  try {
    const response = await fetch("/api/boundary-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Zonensuche fehlgeschlagen");
    state.weightBoundaryResults = Array.isArray(data.boundaries) ? data.boundaries : [];
    renderWeightBoundaryResults();
    el.add_weight_zones.disabled = !state.weightBoundaryResults.length;
    setWeightStatus(state.weightBoundaryResults.length ? `${state.weightBoundaryResults.length} Zone(n) gefunden.` : "Keine passenden Grenzen gefunden.", !state.weightBoundaryResults.length);
  } catch (error) {
    state.weightBoundaryResults = [];
    renderWeightBoundaryResults();
    setWeightStatus(error.message || "Zonensuche fehlgeschlagen.", true);
  } finally {
    el.search_weight_boundaries.disabled = false;
    el.search_weight_boundaries.textContent = "Zonen suchen";
  }
}

function renderWeightBoundaryResults() {
  el.weight_results.innerHTML = "";
  if (!state.weightBoundaryResults.length) {
    el.weight_results.className = "editor-point-list boundary-result-list empty-state";
    el.weight_results.textContent = "Noch keine Treffer.";
    return;
  }
  el.weight_results.className = "editor-point-list boundary-result-list";
  state.weightBoundaryResults.forEach((result) => {
    const row = document.createElement("label");
    row.className = "editor-point boundary-result";
    row.innerHTML = `
      <input type="checkbox" value="${escapeHtml(result.id)}" checked>
      <div>
        <h3>${escapeHtml(result.label || "Gewichtungszone")}</h3>
        <p>${escapeHtml(result.displayName || result.type || "Verwaltungsgrenze")}</p>
      </div>
    `;
    el.weight_results.append(row);
  });
}

function addSelectedWeightZones() {
  const selectedIds = new Set([...el.weight_results.querySelectorAll("input:checked")].map((input) => input.value));
  const factor = Math.max(0.1, Number(String(el.weight_factor.value).replace(",", ".")) || 1);
  const selected = state.weightBoundaryResults.filter((result) => selectedIds.has(result.id) && result.geoJson);
  if (!selected.length) {
    setWeightStatus("Bitte mindestens eine Zone auswählen.", true);
    return;
  }
  state.mapData.weightZones ||= [];
  selected.forEach((result) => {
    const existing = state.mapData.weightZones.find((zone) => zone.id === result.id);
    const zone = {
      id: result.id,
      label: result.label || "Gewichtungszone",
      weight: factor,
      geoJson: result.geoJson
    };
    if (existing) Object.assign(existing, zone);
    else state.mapData.weightZones.push(zone);
  });
  setWeightStatus(`${selected.length} Gewichtungszone(n) hinzugefügt.`);
  renderWeightZoneList();
  render();
}

function renderWeightZoneList() {
  state.mapData.weightZones ||= [];
  el.weight_zone_list.innerHTML = "";
  if (!state.mapData.weightZones.length) {
    el.weight_zone_list.className = "editor-point-list weight-zone-list empty-state";
    el.weight_zone_list.textContent = "Noch keine Gewichtungszonen.";
    return;
  }
  el.weight_zone_list.className = "editor-point-list weight-zone-list";
  state.mapData.weightZones.forEach((zone) => {
    const row = document.createElement("article");
    row.className = "editor-point weight-zone-row";
    const inputId = `weight-${zone.id}`;
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(zone.label || "Gewichtungszone")}</h3>
        <p>Faktor <input id="${escapeHtml(inputId)}" type="number" min="0.1" step="0.1" value="${escapeHtml(zone.weight || 1)}"></p>
      </div>
    `;
    const input = row.querySelector("input");
    input.addEventListener("input", () => {
      zone.weight = Math.max(0.1, Number(String(input.value).replace(",", ".")) || 1);
      render();
    });
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Löschen";
    remove.addEventListener("click", () => {
      state.mapData.weightZones = state.mapData.weightZones.filter((item) => item.id !== zone.id);
      renderWeightZoneList();
      render();
    });
    actions.append(remove);
    row.append(actions);
    el.weight_zone_list.append(row);
  });
}

function setWeightStatus(text, isError = false) {
  el.weight_status.textContent = text;
  el.weight_status.classList.toggle("error-text", Boolean(isError));
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
      el.elrd.value = 0;
    }
  }
  updateVehicleInputs();
  showDialog(el.point_dialog);
}

function showCoverageForm() {
  state.editingId = null;
  el.coverage_form.hidden = false;
  el.weight_form.hidden = true;
}

function showWeightForm() {
  state.editingId = null;
  el.coverage_form.hidden = true;
  el.weight_form.hidden = false;
  renderWeightZoneList();
}

function closeWorkbench() {
  state.editingId = null;
  el.coverage_form.hidden = true;
  el.weight_form.hidden = true;
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
  const unit = unitFromForm();
  if (state.editingUnitId) {
    state.editingUnits = state.editingUnits.map((item) => item.id === state.editingUnitId ? { ...unit, id: item.id } : item);
  } else {
    state.editingUnits.push(unit);
  }
  resetUnitForm();
  syncCountsFromUnits();
  renderUnits();
}

function unitFromForm() {
  const type = el.unit_type.value;
  const name = el.unit_name.value.trim() || `${type} ${state.editingUnits.length + 1}`;
  const availability = el.unit_responder_availability.value === ""
    ? undefined
    : availabilityPercentToProbability(el.unit_responder_availability.value);
  return {
    id: state.editingUnitId || makeId(`${type}-${name}-${Date.now()}`),
    type,
    name,
    fullName: name,
    shortName: el.unit_short.value.trim() || name,
    shift: el.unit_shift.value.trim(),
    ...(type === "HVO" || type === "FR"
      ? availability === undefined ? {} : { responderAvailabilityProbability: availability }
      : availability === undefined ? {} : { availabilityProbability: availability })
  };
}

function startUnitEdit(unitId) {
  const unit = state.editingUnits.find((item) => item.id === unitId);
  if (!unit) return;
  state.editingUnitId = unit.id;
  el.unit_type.value = unit.type || "RTW";
  el.unit_name.value = unit.name || unit.fullName || "";
  el.unit_short.value = unit.shortName || "";
  el.unit_shift.value = unit.shift || "";
  const availability = unit.responderAvailabilityProbability ?? unit.availabilityProbability;
  el.unit_responder_availability.value = availability === undefined ? "" : probabilityToPercent(availability);
  el.add_unit.textContent = "Fahrzeug speichern";
  el.cancel_unit_edit.hidden = false;
  renderUnits();
}

function cancelUnitEdit() {
  resetUnitForm();
  renderUnits();
}

function resetUnitForm() {
  state.editingUnitId = null;
  el.unit_name.value = "";
  el.unit_short.value = "";
  el.unit_shift.value = "";
  el.unit_responder_availability.value = "";
  el.add_unit.textContent = "Fahrzeug hinzufügen";
  el.cancel_unit_edit.hidden = true;
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
    row.className = `unit-row${state.editingUnitId === unit.id ? " editing" : ""}`;
    const responderAvailability = unit.responderAvailabilityProbability !== undefined
      ? ` | Ausrücken ${probabilityToPercent(unit.responderAvailabilityProbability)}%`
      : "";
    const foreignAvailability = unit.availabilityProbability !== undefined
      ? ` | Verfügbar ${probabilityToPercent(unit.availabilityProbability)}%`
      : "";
    row.innerHTML = `<div><strong>${escapeHtml(unit.shortName)}</strong><span>${escapeHtml(unit.name)} | ${escapeHtml(unit.type)}${unit.shift ? ` | ${escapeHtml(unit.shift)}` : ""}${responderAvailability}${foreignAvailability}</span></div>`;
    const actions = document.createElement("div");
    actions.className = "unit-row-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten";
    editButton.addEventListener("click", () => startUnitEdit(unit.id));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Entfernen";
    removeButton.addEventListener("click", () => {
      if (state.editingUnitId === unit.id) resetUnitForm();
      state.editingUnits = state.editingUnits.filter((item) => item.id !== unit.id);
      syncCountsFromUnits();
      renderUnits();
    });
    actions.append(editButton, removeButton);
    row.append(actions);
    el.units_list.append(row);
  });
}

function startSupportGroupEdit(group = null) {
  state.editingSupportGroupId = group?.id || null;
  state.editingSupportUnits = (group?.units || []).map((unit) => ({ ...unit }));
  resetSupportUnitForm();
  el.support_title.textContent = group ? "UGRD/SEG bearbeiten" : "Neue UGRD/SEG";
  el.support_name.value = group?.label || "";
  el.support_availability.value = probabilityToPercent(group?.availabilityProbability ?? 0.75);
  el.support_min.value = group?.minResponseMinutes || 5;
  el.support_max.value = group?.maxResponseMinutes || 15;
  renderSupportStationOptions(group?.stationId || "");
  renderSupportUnits();
  showDialog(el.support_dialog);
}

function renderSupportStationOptions(selectedId = "") {
  el.support_station.innerHTML = "";
  (state.mapData.stations || []).forEach((station) => {
    const option = document.createElement("option");
    option.value = station.id;
    option.textContent = station.label;
    option.selected = station.id === selectedId;
    el.support_station.append(option);
  });
}

function addSupportUnit() {
  const unit = supportUnitFromForm();
  if (state.editingSupportUnitId) {
    state.editingSupportUnits = state.editingSupportUnits.map((item) => item.id === state.editingSupportUnitId ? { ...unit, id: item.id } : item);
  } else {
    state.editingSupportUnits.push(unit);
  }
  resetSupportUnitForm();
  renderSupportUnits();
}

function supportUnitFromForm() {
  const type = el.support_unit_type.value || "RTW";
  const name = el.support_unit_name.value.trim() || `${type} Hintergrund`;
  return {
    id: state.editingSupportUnitId || makeId(`${type}-${name}-${Date.now()}`),
    type,
    name,
    fullName: name,
    shortName: el.support_unit_short.value.trim() || name,
    availabilityProbability: el.support_unit_availability.value === "" ? undefined : availabilityPercentToProbability(el.support_unit_availability.value)
  };
}

function startSupportUnitEdit(unitId) {
  const unit = state.editingSupportUnits.find((item) => item.id === unitId);
  if (!unit) return;
  state.editingSupportUnitId = unit.id;
  el.support_unit_type.value = unit.type || "RTW";
  el.support_unit_name.value = unit.name || unit.fullName || "";
  el.support_unit_short.value = unit.shortName || "";
  el.support_unit_availability.value = unit.availabilityProbability === undefined ? "" : probabilityToPercent(unit.availabilityProbability);
  el.add_support_unit.textContent = "Fahrzeug speichern";
  el.cancel_support_unit_edit.hidden = false;
  renderSupportUnits();
}

function cancelSupportUnitEdit() {
  resetSupportUnitForm();
  renderSupportUnits();
}

function resetSupportUnitForm() {
  state.editingSupportUnitId = null;
  el.support_unit_name.value = "";
  el.support_unit_short.value = "";
  el.support_unit_availability.value = "";
  el.add_support_unit.textContent = "Fahrzeug hinzufügen";
  el.cancel_support_unit_edit.hidden = true;
}

function renderSupportUnits() {
  el.support_units_list.innerHTML = "";
  if (!state.editingSupportUnits.length) {
    el.support_units_list.textContent = "Noch keine Hintergrundfahrzeuge angelegt.";
    return;
  }
  state.editingSupportUnits.forEach((unit) => {
    const row = document.createElement("article");
    row.className = `unit-row${state.editingSupportUnitId === unit.id ? " editing" : ""}`;
    row.innerHTML = `<span>${escapeHtml(unit.type)} | ${escapeHtml(unit.name)}${unit.availabilityProbability !== undefined ? ` | ${probabilityToPercent(unit.availabilityProbability)}%` : ""}</span>`;
    const actions = document.createElement("div");
    actions.className = "unit-row-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten";
    editButton.addEventListener("click", () => startSupportUnitEdit(unit.id));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Entfernen";
    removeButton.addEventListener("click", () => {
      if (state.editingSupportUnitId === unit.id) resetSupportUnitForm();
      state.editingSupportUnits = state.editingSupportUnits.filter((item) => item.id !== unit.id);
      renderSupportUnits();
    });
    actions.append(editButton, removeButton);
    row.append(actions);
    el.support_units_list.append(row);
  });
}

function saveSupportGroup() {
  const station = (state.mapData.stations || []).find((item) => item.id === el.support_station.value);
  const label = el.support_name.value.trim() || "UGRD/SEG";
  const group = {
    id: state.editingSupportGroupId || makeId(label),
    label,
    stationId: station?.id || "",
    stationLabel: station?.label || "",
    lat: station?.lat,
    lng: station?.lng,
    availabilityProbability: availabilityPercentToProbability(el.support_availability.value),
    minResponseMinutes: Math.max(1, Number(el.support_min.value) || 5),
    maxResponseMinutes: Math.max(1, Number(el.support_max.value) || 15),
    units: state.editingSupportUnits.map((unit) => ({ ...unit }))
  };
  if (group.maxResponseMinutes < group.minResponseMinutes) group.maxResponseMinutes = group.minResponseMinutes;
  state.mapData.supportGroups ||= [];
  upsert(state.mapData.supportGroups, group);
  state.editingSupportGroupId = null;
  state.editingSupportUnits = [];
  el.support_dialog.close();
  setPointListFilter("support");
  render();
}

function syncCountsFromUnits() {
  const counts = state.editingUnits.reduce((sum, unit) => {
    sum[unit.type] = (sum[unit.type] || 0) + 1;
    return sum;
  }, {});
  el.rtw.value = counts.RTW || 0;
  el.ktw.value = counts.KTW || 0;
  el.nef.value = counts.NEF || 0;
  el.vef.value = counts.VEF || 0;
  el.ref.value = counts.REF || 0;
  el.itw.value = counts.ITW || 0;
  el.rth.value = counts.RTH || 0;
  el.ith.value = counts.ITH || 0;
  el.elrd.value = counts.ELRD || 0;
  el.hvo.value = counts.HVO || 0;
  el.fr.value = counts.FR || 0;
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
    lng,
    foreign: Boolean(el.foreign_point.checked)
  };
  if (type === "station") {
    point.vehicles = vehicleCounts();
    point.units = namedUnits(point.vehicles);
    point.foreignAvailabilityProbability = availabilityPercentToProbability(el.foreign_availability.value);
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
    point.unavailableProbability = availabilityPercentToProbability(el.hospital_unavailable_probability.value, 0);
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
    VEF: Number(el.vef.value) || 0,
    REF: Number(el.ref.value) || 0,
    ITW: Number(el.itw.value) || 0,
    RTH: Number(el.rth.value) || 0,
    ITH: Number(el.ith.value) || 0,
    ELRD: Number(el.elrd.value) || 0,
    HVO: Number(el.hvo.value) || 0,
    FR: Number(el.fr.value) || 0
  };
}

function stationHasOnlyStabilizers(point) {
  const vehicles = point?.vehicles || {};
  const entries = Object.entries(vehicles).filter(([, count]) => Number(count) > 0);
  return entries.length > 0 && entries.every(([type]) => type === "HVO" || type === "FR");
}

function stationEditorMarkerLabel(point) {
  if (!stationHasOnlyStabilizers(point)) return "RW";
  return Number(point?.vehicles?.HVO) > 0 ? "HvO" : "FR";
}

function availabilityPercentToProbability(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number)) / 100;
}

function probabilityToPercent(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = number > 1 ? number / 100 : number;
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100);
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
  el.foreign_point.disabled = el.type.value === "poi";
  el.foreign_availability_row.hidden = el.type.value !== "station";
  el.foreign_availability.disabled = el.type.value !== "station";
  [el.rtw, el.ktw, el.nef, el.ref, el.rth, el.elrd, el.unit_type, el.unit_name, el.unit_short, el.unit_shift, el.unit_responder_availability, el.add_unit, el.cancel_unit_edit].forEach((input) => {
    input.disabled = disabled;
  });
  el.hospital_section.open = el.type.value === "hospital";
  el.departments.querySelectorAll("input").forEach((input) => {
    input.disabled = el.type.value !== "hospital";
  });
  el.pediatric_only.disabled = el.type.value !== "hospital";
  el.hospital_unavailable_probability.disabled = el.type.value !== "hospital";
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
  if (!(state.showOsmAddressDiagnostics || el.show_address_diagnostics?.checked || state.osmImportRunning)) [...(state.mapData.weightZones || [])]
    .sort((a, b) => weightZoneWeight(a) - weightZoneWeight(b))
    .forEach((zone) => {
    const baseStyle = weightZoneStyle(zone);
    const layer = L.geoJSON(zone.geoJson, {
      style: baseStyle
    }).bindPopup(`<strong>${escapeHtml(zone.label || "Gewichtungszone")}</strong><br>Faktor ${escapeHtml(weightZoneWeight(zone))}`)
      .bindTooltip(`${zone.label || "Gewichtungszone"}: Faktor ${weightZoneWeight(zone)}`, {
        sticky: true,
        direction: "top",
        className: "weight-zone-tooltip"
      })
      .addTo(state.map);
    layer.on("mouseover", () => layer.setStyle({
      ...baseStyle,
      weight: baseStyle.weight + 2,
      fillOpacity: Math.min(0.78, baseStyle.fillOpacity + 0.18)
    }));
    layer.on("mouseout", () => layer.setStyle(baseStyle));
    state.layers.push(layer);
  });
  const points = [
    ...state.mapData.stations.map((point) => ({ ...point, type: "station" })),
    ...state.mapData.hospitals.map((point) => ({ ...point, type: "hospital" })),
    ...(state.mapData.poi || []).map((point) => ({ ...point, type: "poi" })),
    ...(state.mapData.supportGroups || []).map((point) => ({ ...point, type: "support" }))
  ];
  points.forEach((point) => {
    if (point.type === "poi" && !state.showPoiMarkers) return;
    if (!Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return;
    const foreignClass = point.foreign ? " foreign-map-point" : "";
    const markerClass = point.type === "hospital" ? "hospital" : point.type === "poi" ? "poi" : point.type === "support" ? "support" : `station station-available${stationHasOnlyStabilizers(point) ? " station-stabilizer" : ""}`;
    const markerLabel = point.type === "hospital" ? (point.foreign ? "FKH" : "KH") : point.type === "poi" ? "POI" : point.type === "support" ? "UGRD" : (point.foreign ? "FRW" : stationEditorMarkerLabel(point));
    const icon = L.divIcon({
      className: "",
      html: `<span class="map-marker ${markerClass}${foreignClass}">${markerLabel}</span>`,
      iconSize: point.type === "support" ? [42, 28] : [34, 34],
      iconAnchor: point.type === "support" ? [21, 14] : [17, 17]
    });
    const marker = L.marker([point.lat, point.lng], { icon }).bindPopup(point.label || point.stationLabel || "UGRD/SEG").addTo(state.map);
    marker.on("click", () => point.type === "support" ? startSupportGroupEdit(point) : editPoint(point));
    state.layers.push(marker);
  });
  renderOsmAddressTileOverlay();
  renderList(points);
}

function renderList(points) {
  el.points.innerHTML = "";
  updatePointListTabs();
  const filtered = points.filter((point) => point.type === state.pointListFilter);
  if (!filtered.length) {
    el.points.className = "editor-point-list empty-state";
    el.points.textContent = emptyPointListText(state.pointListFilter);
    return;
  }
  el.points.className = "editor-point-list";
  filtered.forEach((point) => {
    const row = document.createElement("article");
    row.className = `editor-point${point.foreign ? " foreign-point" : ""}`;
    const extra = point.type === "station"
      ? stationListExtra(point)
      : point.type === "hospital"
        ? `${point.foreign ? " | Fremdkrankenhaus" : ""} | ${(point.departments || []).map(departmentLabel).join(", ") || "keine Fachrichtungen"}${point.pediatricOnly ? " | reine Kinderklinik" : ""} | Abmeldung ${probabilityToPercent(point.unavailableProbability, 0)}%`
        : point.type === "support"
          ? ` | ${(point.units || []).length} Fahrzeug(e) | ${point.stationLabel || "keine Wache"} | ${probabilityToPercent(point.availabilityProbability)}%`
          : ` | ${(point.categories || []).join(", ") || "keine Kategorien"}`;
    row.innerHTML = `<div><h3>${escapeHtml(point.label)}</h3><p>${point.type}${escapeHtml(extra)}</p></div>`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    [["Bearbeiten", () => point.type === "support" ? startSupportGroupEdit(point) : editPoint(point)], ["Löschen", () => deletePoint(point)]].forEach(([label, handler]) => {
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

function stationListExtra(point) {
  const unitText = point.units?.length
    ? ` | ${point.units.map((unit) => {
      const availability = unit.availabilityProbability !== undefined
        ? ` (${probabilityToPercent(unit.availabilityProbability)}%)`
        : "";
      return `${unit.name}${availability}`;
    }).join(", ")}`
    : "";
  if (!point.foreign) return unitText;
  const fallback = point.units?.length
    ? " | Fallback Wache"
    : " | Wache";
  return ` | Fremdwache${fallback} ${probabilityToPercent(point.foreignAvailabilityProbability)}%${unitText}`;
}

function setPointListFilter(filter) {
  state.pointListFilter = filter;
  render();
}

function updatePointListTabs() {
  [
    [el.point_filter_stations, "station"],
    [el.point_filter_hospitals, "hospital"],
    [el.point_filter_poi, "poi"],
    [el.point_filter_support, "support"]
  ].forEach(([button, filter]) => button?.classList.toggle("active", state.pointListFilter === filter));
}

function emptyPointListText(filter) {
  if (filter === "station") return "Noch keine Wachen angelegt.";
  if (filter === "hospital") return "Noch keine Krankenhäuser angelegt.";
  if (filter === "support") return "Noch keine UGRD/SEG-Gruppen angelegt.";
  return "Noch keine POI angelegt.";
}

function editPoint(point) {
  if (point.type === "poi") {
    state.showPoiMarkers = true;
    el.show_poi_markers.checked = true;
    render();
  }
  startPointEdit(point.type, point);
}

function fillPointForm(point) {
  el.name.value = point.label;
  el.address.value = point.address || "";
  el.lat.value = point.lat.toFixed(6);
  el.lng.value = point.lng.toFixed(6);
  el.foreign_point.checked = Boolean(point.foreign);
  el.foreign_availability.value = probabilityToPercent(point.foreignAvailabilityProbability);
  el.rtw.value = point.vehicles?.RTW || 0;
  el.ktw.value = point.vehicles?.KTW || 0;
  el.nef.value = point.vehicles?.NEF || 0;
  el.vef.value = point.vehicles?.VEF || 0;
  el.ref.value = point.vehicles?.REF || 0;
  el.itw.value = point.vehicles?.ITW || 0;
  el.rth.value = point.vehicles?.RTH || 0;
  el.ith.value = point.vehicles?.ITH || 0;
  el.elrd.value = point.vehicles?.ELRD || 0;
  el.hvo.value = point.vehicles?.HVO || 0;
  el.fr.value = point.vehicles?.FR || 0;
  state.editingUnits = (point.units || []).map((unit) => ({
    id: unit.id || makeId(`${unit.type}-${unit.name}-${Date.now()}`),
    type: unit.type || "RTW",
    name: unit.fullName || unit.name || "",
    fullName: unit.fullName || unit.name || "",
    shortName: unit.shortName || unit.short || unit.name || "",
    shift: unit.shift || "",
    ...(unit.availabilityProbability !== undefined ? { availabilityProbability: unit.availabilityProbability } : {}),
    ...(unit.responderAvailabilityProbability !== undefined ? { responderAvailabilityProbability: unit.responderAvailabilityProbability } : {})
  }));
  resetUnitForm();
  renderDepartmentChecks(point.departments || []);
  el.pediatric_only.checked = Boolean(point.pediatricOnly);
  el.hospital_unavailable_probability.value = probabilityToPercent(point.unavailableProbability, 0);
  renderPoiCategorySelect(point.categories || []);
  el.add.textContent = "Änderungen speichern";
  renderUnits();
}

function deletePoint(point) {
  state.mapData.stations = state.mapData.stations.filter((item) => item.id !== point.id);
  state.mapData.hospitals = state.mapData.hospitals.filter((item) => item.id !== point.id);
  state.mapData.poi = (state.mapData.poi || []).filter((item) => item.id !== point.id);
  state.mapData.supportGroups = (state.mapData.supportGroups || []).filter((item) => item.id !== point.id);
  render();
}

async function saveMapFile() {
  state.mapData.name = el.map_name.value.trim() || "Neue Karte";
  state.mapData.callRates = normalizeCallRates(state.mapData.callRates);
  state.mapData.id = makeId(state.mapData.name);
  state.mapData.mapCenter = [state.map.getCenter().lat, state.map.getCenter().lng];
  state.mapData.zoom = state.map.getZoom();
  try {
    const response = await fetch("/api/maps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state.mapData)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Speichern fehlgeschlagen (${response.status})`);
    }
    el.saved.textContent = "Karte gespeichert.";
  } catch (error) {
    el.saved.textContent = `Karte konnte nicht gespeichert werden: ${error.message || error}`;
    return;
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
      row.innerHTML = `<div><h3>${escapeHtml(map.name)}</h3><p>${map.stations} Wachen | ${map.hospitals} Kliniken | ${map.supportGroups || 0} UGRD/SEG</p></div>`;
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
  state.mapData.osmData ||= emptyImportedOsmData();
  state.mapData.supportGroups ||= [];
  state.mapData.weightZones ||= [];
  state.mapData.callRates = normalizeCallRates(state.mapData.callRates);
  el.map_name.value = state.mapData.name;
  el.coverage.value = state.mapData.coverageGeoJson ? JSON.stringify(state.mapData.coverageGeoJson, null, 2) : "";
  state.editingId = null;
  state.editingUnits = [];
  state.showOsmAddressDiagnostics = false;
  state.showAllRoadDiagnostics = false;
  el.show_address_diagnostics.checked = false;
  el.show_all_road_diagnostics.checked = false;
  updateAddressDiagnosticsToggle();
  closeWorkbench();
  state.map.setView(state.mapData.mapCenter, state.mapData.zoom);
  renderRateEditor();
  render();
}

function newMap() {
  state.mapData = { id: "new-map", name: "Neue Karte", weather: "", mapCenter: [49.00761514468197, 12.09749221801758], zoom: 14, stations: [], hospitals: [], poi: [], supportGroups: [], osmData: emptyImportedOsmData(), coverageGeoJson: null, weightZones: [], callRates: defaultCallRates() };
  el.map_name.value = state.mapData.name;
  el.coverage.value = "";
  state.showOsmAddressDiagnostics = false;
  state.showAllRoadDiagnostics = false;
  el.show_address_diagnostics.checked = false;
  el.show_all_road_diagnostics.checked = false;
  updateAddressDiagnosticsToggle();
  renderRateEditor();
  closeWorkbench();
  render();
}

function editCoveragePins() {
  clearCoverageMarkers();
  const ring = primaryCoverageRing(state.mapData.coverageGeoJson);
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
  el.foreign_point.checked = false;
  el.foreign_availability.value = 50;
  el.hospital_unavailable_probability.value = 0;
  state.editingUnits = [];
  resetUnitForm();
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

function renderOsmImportCategories() {
  if (!el.osm_poi_categories) return;
  el.osm_poi_categories.innerHTML = "";
  (window.poiCategoryCatalog || [])
    .filter((category) => category.importable)
    .forEach((category) => {
      const label = document.createElement("label");
      label.className = "check-row";
      label.innerHTML = `<input type="checkbox" value="${escapeHtml(category.key)}" checked> ${escapeHtml(category.label)}`;
      el.osm_poi_categories.append(label);
    });
}

function setOsmPoiSelection(checked) {
  el.osm_poi_categories.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = checked;
  });
}

function selectOnlyOsmRoads() {
  el.import_roads.checked = true;
  el.import_outdoor.checked = false;
  setOsmPoiSelection(false);
}

function selectedOsmImportCategories() {
  return [...el.osm_poi_categories.querySelectorAll("input:checked")].map((input) => input.value);
}

async function importOsmPois() {
  const categories = selectedOsmImportCategories();
  const layers = selectedOsmImportLayers();
  if (!categories.length && !layers.length) {
    setOsmImportStatus("Bitte mindestens eine POI-Kategorie oder einen Standort-Pool auswählen.", true);
    return;
  }
  const payload = {
    categories,
    layers,
    polygons: coveragePolygonsForImport(),
    bounds: boundsForImport()
  };
  el.import_pois.disabled = true;
  el.pause_osm_import.disabled = false;
  el.abort_osm_import.disabled = false;
  el.pause_osm_import.textContent = "Nach Schritt pausieren";
  el.abort_osm_import.textContent = "Abbrechen";
  el.apply_imported_pois.disabled = true;
  el.import_pois.textContent = "Suche...";
  state.osmImportRunning = true;
  state.osmImportPauseAfterTile = false;
  state.osmImportAbort = false;
  state.failedOsmTiles = [];
  state.importedPoiResults = [];
  state.importedOsmData = emptyImportedOsmData();
  updateRetryFailedOsmButton();
  setOsmImportStatus("OSM wird abgefragt...");
  try {
    const poiData = { poi: [] };
    const osmData = emptyImportedOsmData();
    const warnings = [];
    for (const layer of layers) {
      if (state.osmImportAbort) break;
      await importOsmDataLayerWithProgress(layer, payload, osmData, warnings);
      if (state.osmImportAbort || state.osmImportPauseAfterTile) break;
    }
    const categoryChunks = chunkArray(categories, 4);
    for (let index = 0; index < categoryChunks.length; index += 1) {
      if (state.osmImportAbort || state.osmImportPauseAfterTile) break;
      const chunk = categoryChunks[index];
      setOsmImportStatus(`OSM wird abgefragt: POI ${index + 1}/${categoryChunks.length} (${state.importedPoiResults.length + poiData.poi.length} POI bisher)...`);
      const response = await fetch("/api/osm-pois", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, categories: chunk, layers: [] })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) warnings.push(`POI ${chunk.join(", ")}: ${data.error || "fehlgeschlagen"}`);
      else {
        poiData.poi.push(...(Array.isArray(data.poi) ? data.poi : []));
        warnings.push(...(data.warnings || []));
      }
      state.importedPoiResults = uniqueByImportId(Array.isArray(poiData.poi) ? poiData.poi : []);
      renderOsmImportPreview();
      el.apply_imported_pois.disabled = !osmImportHasResults();
      await pauseOsmImportStep();
    }
    state.importedPoiResults = uniqueByImportId(Array.isArray(poiData.poi) ? poiData.poi : []);
    state.importedOsmData = {
      roads: uniqueByImportId(osmData.roads),
      outdoorAreas: uniqueByImportId(osmData.outdoorAreas)
    };
    updateAddressDiagnosticsToggle();
    renderOsmImportPreview();
    el.apply_imported_pois.disabled = !osmImportHasResults();
    if (!osmImportHasResults() && warnings.length) throw new Error(warnings[0] || "OSM-Import fehlgeschlagen");
    const endLabel = state.osmImportAbort
      ? "abgebrochen"
      : state.osmImportPauseAfterTile
        ? "pausiert"
        : "gefunden";
    setOsmImportStatus(warnings.length
      ? `${osmImportStatusText(endLabel)} Teilweise fehlgeschlagen: ${warnings.slice(0, 2).join(" | ")}`
      : osmImportStatusText(endLabel), Boolean(warnings.length));
  } catch (error) {
    renderOsmImportPreview();
    setOsmImportStatus(error.message || "OSM-Import fehlgeschlagen.", true);
  } finally {
    state.osmImportRunning = false;
    el.import_pois.disabled = false;
    updateRetryFailedOsmButton();
    el.pause_osm_import.disabled = true;
    el.abort_osm_import.disabled = true;
    el.pause_osm_import.textContent = "Nach Schritt pausieren";
    el.abort_osm_import.textContent = "Abbrechen";
    el.import_pois.textContent = "OSM suchen";
  }
}

async function importOsmDataLayerWithProgress(layer, payload, osmData, warnings) {
  const tiles = osmDataProgressTiles(payload);
  const layerLabel = osmLayerLabel(layer);
  if (!tiles.length) {
    setOsmImportStatus(`OSM wird abgefragt: ${layerLabel}...`);
    const response = await fetch("/api/osm-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, layers: [layer], categories: [] })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) warnings.push(`${layerLabel}: ${data.error || "fehlgeschlagen"}`);
    else mergeOsmDataLayerResponse(data, osmData, warnings);
    updateOsmDataProgressPreview(osmData);
    return;
  }

  let failedTiles = 0;
  for (let index = 0; index < tiles.length; index += 1) {
    if (state.osmImportAbort || state.osmImportPauseAfterTile) break;
    const tile = tiles[index];
    setOsmImportStatus(`${layerLabel}: Kachel ${index + 1}/${tiles.length}, ${osmDataProgressText(osmData)}...`);
    const response = await fetch("/api/osm-data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        layers: [layer],
        categories: [],
        bounds: tile,
        forceBoundsSelector: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      failedTiles += 1;
      state.failedOsmTiles.push({ layer, layerLabel, tile, index, total: tiles.length, payload });
      warnings.push(`${layerLabel} Kachel ${index + 1}/${tiles.length}: ${data.error || "fehlgeschlagen"}`);
    } else {
      mergeOsmDataLayerResponse(data, osmData, warnings);
    }
    updateOsmDataProgressPreview(osmData);
    updateRetryFailedOsmButton();
    setOsmImportStatus(`${layerLabel}: Kachel ${index + 1}/${tiles.length} fertig, ${osmDataProgressText(osmData)}${failedTiles ? `, ${failedTiles} fehlgeschlagen` : ""}.`);
    await pauseOsmImportStep(1000);
  }
}

async function retryFailedOsmTiles() {
  if (!state.failedOsmTiles.length || state.osmImportRunning) return;
  state.osmImportRunning = true;
  state.osmImportPauseAfterTile = false;
  state.osmImportAbort = false;
  el.import_pois.disabled = true;
  el.retry_osm_failed.disabled = true;
  el.pause_osm_import.disabled = false;
  el.abort_osm_import.disabled = false;
  el.pause_osm_import.textContent = "Nach Schritt pausieren";
  el.abort_osm_import.textContent = "Abbrechen";
  const osmData = normalizeImportedOsmData(state.importedOsmData);
  const warnings = [];
  const retryTiles = [...state.failedOsmTiles];
  state.failedOsmTiles = [];
  try {
    for (let index = 0; index < retryTiles.length; index += 1) {
      if (state.osmImportAbort || state.osmImportPauseAfterTile) {
        state.failedOsmTiles.push(...retryTiles.slice(index));
        break;
      }
      const item = retryTiles[index];
      setOsmImportStatus(`${item.layerLabel}: Retry ${index + 1}/${retryTiles.length} (urspr. Kachel ${item.index + 1}/${item.total}), ${osmDataProgressText(osmData)}...`);
      const response = await fetch("/api/osm-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...item.payload,
          layers: [item.layer],
          categories: [],
          bounds: item.tile,
          forceBoundsSelector: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        state.failedOsmTiles.push(item);
        warnings.push(`${item.layerLabel} Retry ${index + 1}/${retryTiles.length}: ${data.error || "fehlgeschlagen"}`);
      } else {
        mergeOsmDataLayerResponse(data, osmData, warnings);
      }
      updateOsmDataProgressPreview(osmData);
      updateRetryFailedOsmButton();
      setOsmImportStatus(`${item.layerLabel}: Retry ${index + 1}/${retryTiles.length} fertig, ${osmDataProgressText(osmData)}${state.failedOsmTiles.length ? `, ${state.failedOsmTiles.length} weiter fehlgeschlagen` : ""}.`);
      await pauseOsmImportStep(1000);
    }
    const label = state.osmImportAbort
      ? "Retry abgebrochen"
      : state.osmImportPauseAfterTile
        ? "Retry pausiert"
        : "Retry abgeschlossen";
    setOsmImportStatus(warnings.length
      ? `${label}: ${osmImportStatusText("gefunden")} Noch fehlgeschlagen: ${state.failedOsmTiles.length}.`
      : `${label}: ${osmImportStatusText("gefunden")}`);
  } catch (error) {
    setOsmImportStatus(error.message || "Retry fehlgeschlagen.", true);
  } finally {
    state.osmImportRunning = false;
    el.import_pois.disabled = false;
    el.pause_osm_import.disabled = true;
    el.abort_osm_import.disabled = true;
    el.pause_osm_import.textContent = "Nach Schritt pausieren";
    el.abort_osm_import.textContent = "Abbrechen";
    updateRetryFailedOsmButton();
  }
}

function updateRetryFailedOsmButton() {
  if (!el.retry_osm_failed) return;
  const count = state.failedOsmTiles.length;
  el.retry_osm_failed.disabled = state.osmImportRunning || count === 0;
  el.retry_osm_failed.textContent = count ? `Fehlgeschlagene erneut (${count})` : "Fehlgeschlagene erneut";
}

function mergeOsmDataLayerResponse(data, osmData, warnings) {
  const normalized = normalizeImportedOsmData(data);
  osmData.roads.push(...normalized.roads);
  osmData.outdoorAreas.push(...normalized.outdoorAreas);
  warnings.push(...(data.warnings || []));
}

function updateOsmDataProgressPreview(osmData) {
  state.importedOsmData = {
    roads: uniqueByImportId(osmData.roads),
    outdoorAreas: uniqueByImportId(osmData.outdoorAreas)
  };
  updateAddressDiagnosticsToggle();
  renderOsmImportPreview();
  renderOsmAddressTileOverlay();
  el.apply_imported_pois.disabled = !osmImportHasResults();
}

function osmDataProgressText(osmData) {
  const roads = uniqueByImportId(osmData.roads).length;
  const outdoor = uniqueByImportId(osmData.outdoorAreas).length;
  return `${roads} Straßen, ${outdoor} Outdoor-Flächen`;
}

function osmDataProgressTiles(payload) {
  const bounds = importBoundsForTiles(payload);
  if (!bounds) return [];
  const polygons = Array.isArray(payload.polygons) ? payload.polygons : [];
  const tiles = tileBoundsForOsmProgress(bounds, 0.18, 0.18);
  const filtered = polygons.length ? tiles.filter((tile) => tileIntersectsAnyPolygon(tile, polygons)) : tiles;
  return filtered.length > 1 ? filtered : [];
}

function tileBoundsForOsmProgress(bounds, latStep, lngStep) {
  const south = Number(bounds?.south);
  const west = Number(bounds?.west);
  const north = Number(bounds?.north);
  const east = Number(bounds?.east);
  if (![south, west, north, east].every(Number.isFinite) || south >= north || west >= east) return [];
  const tiles = [];
  for (let tileSouth = south; tileSouth < north; tileSouth += latStep) {
    for (let tileWest = west; tileWest < east; tileWest += lngStep) {
      tiles.push({
        south: roundImportCoord(tileSouth),
        west: roundImportCoord(tileWest),
        north: roundImportCoord(Math.min(north, tileSouth + latStep)),
        east: roundImportCoord(Math.min(east, tileWest + lngStep))
      });
    }
  }
  return tiles;
}

function osmLayerLabel(layer) {
  return { roads: "Straßen", outdoor: "Outdoor-Flächen" }[layer] || layer;
}

function pauseOsmImportStep(ms = 350) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueByImportId(items) {
  return [...new Map((items || []).map((item) => [item.id || `${item.lat},${item.lng},${item.label}`, item])).values()];
}

function selectedOsmImportLayers() {
  return [
    el.import_roads?.checked ? "roads" : "",
    el.import_outdoor?.checked ? "outdoor" : ""
  ].filter(Boolean);
}

function importBoundsForTiles(payload) {
  const polygonPoints = (payload.polygons || []).flat();
  const valid = polygonPoints
    .map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (valid.length) {
    return {
      south: Math.min(...valid.map((point) => point.lat)),
      west: Math.min(...valid.map((point) => point.lng)),
      north: Math.max(...valid.map((point) => point.lat)),
      east: Math.max(...valid.map((point) => point.lng))
    };
  }
  return payload.bounds;
}

function tileIntersectsAnyPolygon(tile, polygons) {
  return polygons.some((polygon) => tileIntersectsPolygon(tile, polygon));
}

function tileIntersectsPolygon(tile, polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return true;
  const probes = [
    { lat: (tile.south + tile.north) / 2, lng: (tile.west + tile.east) / 2 },
    { lat: tile.south, lng: tile.west },
    { lat: tile.south, lng: tile.east },
    { lat: tile.north, lng: tile.west },
    { lat: tile.north, lng: tile.east }
  ];
  if (probes.some((point) => pointInsidePolygon(point.lat, point.lng, polygon))) return true;
  return polygon.some((point) => pointInsideTile(point, tile));
}

function pointInsideTile(point, tile) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= tile.south
    && lat <= tile.north
    && lng >= tile.west
    && lng <= tile.east;
}

function pointInsidePolygon(lat, lng, polygon) {
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

function roundImportCoord(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function applyImportedPois() {
  if (!osmImportHasResults()) return;
  state.mapData.osmData ||= emptyImportedOsmData();
  const imported = normalizeImportedOsmData(state.importedOsmData);
  mergeOsmDataList("roads", imported.roads);
  mergeOsmDataList("outdoorAreas", imported.outdoorAreas);
  state.showOsmAddressDiagnostics = Boolean((state.mapData.osmData.roads || []).length);
  el.show_address_diagnostics.checked = state.showOsmAddressDiagnostics;
  updateAddressDiagnosticsToggle();
  state.mapData.poi ||= [];
  const byId = new Map(state.mapData.poi.map((poi) => [poi.id, poi]));
  state.importedPoiResults.forEach((poi) => {
    const existing = byId.get(poi.id);
    if (existing) {
      existing.label = existing.label || poi.label;
      existing.address = existing.address || poi.address;
      existing.lat = Number.isFinite(existing.lat) ? existing.lat : poi.lat;
      existing.lng = Number.isFinite(existing.lng) ? existing.lng : poi.lng;
      existing.categories = [...new Set([...(existing.categories || []), ...(poi.categories || [])])];
      existing.source = existing.source || poi.source;
      existing.osmType = existing.osmType || poi.osmType;
      existing.osmId = existing.osmId || poi.osmId;
    } else {
      byId.set(poi.id, { ...poi });
      state.mapData.poi.push({ ...poi });
    }
  });
  setOsmImportStatus(osmImportStatusText("übernommen"));
  state.importedPoiResults = [];
  state.importedOsmData = null;
  state.pointListFilter = "poi";
  el.apply_imported_pois.disabled = true;
  renderOsmImportPreview();
  render();
}

function updateAddressDiagnosticsToggle() {
  if (!el.show_address_diagnostics) return;
  const count = availableAddressDiagnosticCount();
  const label = el.show_address_diagnostics.closest("label");
  if (label) {
    const suffix = count ? ` (${count} Straßen)` : " (keine Straßen übernommen)";
    [...label.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .forEach((node) => node.textContent = ` Straßenpool anzeigen${suffix}`);
  }
  if (!count) {
    el.show_address_diagnostics.checked = false;
    el.show_all_road_diagnostics.checked = false;
    state.showOsmAddressDiagnostics = false;
    state.showAllRoadDiagnostics = false;
  }
}

function availableAddressDiagnosticCount() {
  const imported = normalizeImportedOsmData(state.importedOsmData);
  const current = normalizeImportedOsmData(state.mapData?.osmData);
  return imported.roads.length || current.roads.length || 0;
}

function mergeOsmDataList(key, items) {
  if (!items?.length) return;
  state.mapData.osmData ||= emptyImportedOsmData();
  state.mapData.osmData[key] ||= [];
  const byId = new Map(state.mapData.osmData[key].map((item) => [item.id, item]));
  items.forEach((item) => byId.set(item.id, { ...(byId.get(item.id) || {}), ...item }));
  state.mapData.osmData[key] = [...byId.values()];
}

function renderOsmImportPreview() {
  el.osm_poi_preview.innerHTML = "";
  if (!osmImportHasResults()) {
    el.osm_poi_preview.className = "editor-point-list osm-poi-preview empty-state";
    el.osm_poi_preview.textContent = "Keine Treffer in der Vorschau.";
    return;
  }
  el.osm_poi_preview.className = "editor-point-list osm-poi-preview";
  const osmData = normalizeImportedOsmData(state.importedOsmData);
  const summary = document.createElement("article");
  summary.className = "editor-point osm-poi-result";
  summary.innerHTML = `<div><h3>Standort-Pools</h3><p>${escapeHtml(osmImportStatusText("gefunden"))}</p></div>`;
  el.osm_poi_preview.append(summary);
  const visible = state.importedPoiResults.slice(0, 80);
  visible.forEach((poi) => {
    const row = document.createElement("article");
    row.className = "editor-point osm-poi-result";
    const categories = (poi.categories || []).map(poiCategoryLabel).join(", ") || "POI";
    row.innerHTML = `<div><h3>${escapeHtml(poi.label)}</h3><p>${escapeHtml(categories)} | ${escapeHtml(poi.address || "OSM")}</p></div>`;
    el.osm_poi_preview.append(row);
  });
  if (state.importedPoiResults.length > visible.length) {
    const note = document.createElement("p");
    note.className = "inline-hint";
    note.textContent = `${state.importedPoiResults.length - visible.length} weitere Treffer werden beim Übernehmen ebenfalls importiert.`;
    el.osm_poi_preview.append(note);
  }
  const samples = [
    ...osmData.roads.slice(0, 8).map((item) => ({ label: item.label, type: "Straße" })),
    ...osmData.outdoorAreas.slice(0, 8).map((item) => ({ label: item.label, type: "Outdoor" }))
  ];
  samples.forEach((item) => {
    const row = document.createElement("article");
    row.className = "editor-point osm-poi-result";
    row.innerHTML = `<div><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.type)}</p></div>`;
    el.osm_poi_preview.append(row);
  });
}

function renderOsmAddressTileOverlay() {
  if (!state.map || typeof L === "undefined") return;
  state.osmRoadPoolLayers.forEach((layer) => layer.remove());
  state.osmRoadPoolLayers = [];
  const diagnosticsEnabled = state.showOsmAddressDiagnostics || el.show_address_diagnostics?.checked || state.osmImportRunning;
  if (!diagnosticsEnabled) return;
  const roads = roadPoolForOverlay();
  if (!roads.length) {
    setOsmImportStatus("Keine Straßendaten für die Poolanzeige vorhanden.", true);
    return;
  }
  const visibleRoads = state.showAllRoadDiagnostics ? roads : roads.slice(0, 7000);
  visibleRoads.forEach((road) => {
    const geometry = (road.geometry || []).map((point) => [point[1], point[0]]);
    if (geometry.length < 2) return;
    const group = roadPoolGroup(road);
    const layer = L.polyline(geometry, {
      color: roadPoolColor(group),
      opacity: group === "other" ? 0.35 : 0.82,
      weight: group === "motorway" ? 3.4 : group === "rural" ? 2.5 : 2,
      interactive: true
    }).bindTooltip(roadPoolTooltip(road, group), {
      sticky: true,
      direction: "top"
    }).addTo(state.map);
    state.layers.push(layer);
    state.osmRoadPoolLayers.push(layer);
  });
}

function roadPoolForOverlay() {
  const imported = normalizeImportedOsmData(state.importedOsmData);
  const current = normalizeImportedOsmData(state.mapData?.osmData);
  return imported.roads.length ? imported.roads : current.roads;
}

function roadPoolGroup(road) {
  const officialGroup = officialRoadPoolGroup(road);
  if (officialGroup) return officialGroup;
  const cls = String(road?.roadClass || "");
  if (/motorway|trunk/.test(cls)) return "motorway";
  if (/primary|secondary|unclassified/.test(cls)) return "rural";
  if (cls === "tertiary") return "urban";
  if (/residential|living_street/.test(cls)) return "urban";
  return "other";
}

function officialRoadPoolGroup(road) {
  const officialClass = String(road?.officialRoadClass || "");
  if (officialClass === "motorway") return "motorway";
  if (["federal", "state", "county"].includes(officialClass)) return "rural";
  const refs = Array.isArray(road?.routeRefs) ? road.routeRefs.join(" ") : "";
  const networks = Array.isArray(road?.routeNetworks) ? road.routeNetworks.join(" ") : "";
  const value = `${networks} ${refs}`;
  if (/\b(BAB|A\s*\d{1,3})\b/i.test(value)) return "motorway";
  if (/\b(B|St|L|K|Kr|[A-ZÄÖÜ]{1,3})\s*\d{1,5}\b/.test(value)) return "rural";
  return "";
}

function roadPoolTooltip(road, group) {
  const routeRefs = Array.isArray(road?.routeRefs) && road.routeRefs.length ? ` | Route: ${road.routeRefs.join(", ")}` : "";
  const routeNetworks = Array.isArray(road?.routeNetworks) && road.routeNetworks.length ? ` | Netz: ${road.routeNetworks.join(", ")}` : "";
  const official = road?.officialRoadClass ? ` | ${road.officialRoadClass}` : "";
  return `${roadPoolLabel(group)}: ${road.label || road.name || road.roadClass}${official}${routeRefs}${routeNetworks}`;
}

function roadPoolColor(group) {
  return { urban: "#16a34a", rural: "#f97316", motorway: "#dc2626", other: "#64748b" }[group] || "#64748b";
}

function roadPoolLabel(group) {
  return { urban: "Innerorts/Wohnstraße", rural: "Außerorts/Landstraße", motorway: "Autobahn/Schnellstraße", other: "Sonstige Straße" }[group] || "Straße";
}

function emptyImportedOsmData() {
  return { roads: [], outdoorAreas: [] };
}

function normalizeImportedOsmData(data) {
  return {
    roads: Array.isArray(data?.roads) ? data.roads : [],
    outdoorAreas: Array.isArray(data?.outdoorAreas) ? data.outdoorAreas : []
  };
}

function osmImportHasResults() {
  const data = normalizeImportedOsmData(state.importedOsmData);
  return Boolean(state.importedPoiResults.length || data.roads.length || data.outdoorAreas.length);
}

function osmImportStatusText(action) {
  const data = normalizeImportedOsmData(state.importedOsmData);
  return `${state.importedPoiResults.length} POI, ${data.roads.length} Straßen, ${data.outdoorAreas.length} Outdoor-Flächen ${action}.`;
}

function coveragePolygonsForImport() {
  return coverageOuterRings(state.mapData.coverageGeoJson)
    .map((ring) => ringToLatLngPoints(ring))
    .filter((polygon) => polygon.length >= 3);
}

function weightZoneStyle(zone) {
  const weight = weightZoneWeight(zone);
  const colors = weightZoneColors(weight);
  const opacity = Math.max(0.16, Math.min(0.68, 0.13 + Math.sqrt(weight) * 0.2));
  return {
    color: colors.stroke,
    weight: weight >= 1.5 ? 2.5 : 1.6,
    fillColor: colors.fill,
    fillOpacity: opacity
  };
}

function weightZoneWeight(zone) {
  return Math.max(0.1, Number(String(zone?.weight ?? 1).replace(",", ".")) || 1);
}

function weightZoneColors(weight) {
  if (weight < 0.5) return { fill: "#2563eb", stroke: "#1e3a8a" };
  if (weight < 0.9) return { fill: "#0891b2", stroke: "#155e75" };
  if (weight < 1.2) return { fill: "#f59e0b", stroke: "#92400e" };
  if (weight < 1.6) return { fill: "#f97316", stroke: "#9a3412" };
  if (weight < 2.4) return { fill: "#dc2626", stroke: "#7f1d1d" };
  return { fill: "#7c3aed", stroke: "#4c1d95" };
}

function ringToLatLngPoints(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  return ring.slice(0, -1).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function coverageOuterRings(geoJson) {
  const rings = [];
  coverageFeatures(geoJson).forEach((feature) => {
    const geometry = feature.geometry;
    if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates?.[0])) {
      rings.push(geometry.coordinates[0]);
    }
    if (geometry?.type === "MultiPolygon") {
      (geometry.coordinates || []).forEach((polygon) => {
        if (Array.isArray(polygon?.[0])) rings.push(polygon[0]);
      });
    }
  });
  return rings;
}

function primaryCoverageRing(geoJson) {
  return coverageOuterRings(geoJson)[0] || null;
}

function boundsForImport() {
  const bounds = state.map.getBounds();
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast()
  };
}

function setOsmImportStatus(text, isError = false) {
  el.osm_poi_status.textContent = text;
  el.osm_poi_status.classList.toggle("error-text", Boolean(isError));
}

function poiCategoryLabel(key) {
  return (window.poiCategoryCatalog || []).find((category) => category.key === key)?.label || key;
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
