const DEFAULT_MAP_ID = "ils-regensburg-testversion-stadt-regensburg";

const rdKeywords = window.rdKeywords || [];
const keywordDefaults = Object.fromEntries(rdKeywords.map((item) => [item.label, item]));

function createEmptyCenter() {
  return {
    id: DEFAULT_MAP_ID,
    name: "Leitstelle",
    weather: "Wetter nicht verfuegbar",
    mapCenter: [49.00761514468197, 12.09749221801758],
    zoom: 14,
    stations: [],
    hospitals: [],
    poi: [],
    callRates: normalizedCallRates()
  };
}

const state = {
  center: createEmptyCenter(),
  dispatcher: "Gast",
  minute: 0,
  speed: 1,
  paused: false,
  pendingCall: null,
  audioContext: null,
  editingIncidentId: null,
  selectedIncidentId: null,
  selectedVehicleId: null,
  incidentFilter: "emergency",
  incidents: [],
  vehicles: [],
  timers: [],
  timeouts: [],
  lastClockTick: Date.now(),
  lastCallRateMinute: 0,
  editorPoints: [],
  editingMapPointId: null,
  selectedDialogVehicleIds: new Set(),
  lastCallTemplateIndex: -1,
  availableMaps: [],
  coveragePoints: [],
  pendingCoverageVehicleId: null,
  testMode: false,
  serverAvailable: false,
  map: null,
  mapReady: false,
  layers: {
    stations: [],
    hospitals: [],
    incidents: [],
    vehicles: [],
    routes: [],
    coverage: []
  }
};

const el = {
  startScreen: document.querySelector("#start-screen"),
  dispatchScreen: document.querySelector("#dispatch-screen"),
  shiftForm: document.querySelector("#shift-form"),
  centerSelect: document.querySelector("#center-select"),
  dispatcherName: document.querySelector("#dispatcher-name"),
  timeSelect: document.querySelector("#time-select"),
  startMapEditorButton: document.querySelector("#start-map-editor-button"),
  startIncidentEditorButton: document.querySelector("#start-incident-editor-button"),
  activeCenter: document.querySelector("#active-center"),
  operatorLabel: document.querySelector("#operator-label"),
  weatherLabel: document.querySelector("#weather-label"),
  map: document.querySelector("#map"),
  incidentList: document.querySelector("#incident-list"),
  incidentCount: document.querySelector("#incident-count"),
  callLog: document.querySelector("#call-log"),
  radioLog: document.querySelector("#radio-log"),
  callActions: document.querySelector("#call-actions"),
  vehicleList: document.querySelector("#vehicle-list"),
  answerButton: document.querySelector("#answer-button"),
  forwardButton: document.querySelector("#forward-button"),
  newCallButton: document.querySelector("#new-call-button"),
  testModeButton: document.querySelector("#test-mode-button"),
  adminModeButton: document.querySelector("#admin-mode-button"),
  speedSelect: document.querySelector("#speed-select"),
  pauseButton: document.querySelector("#pause-button"),
  endShiftButton: document.querySelector("#end-shift-button"),
  editorButton: document.querySelector("#editor-button"),
  incidentEditorButton: document.querySelector("#incident-editor-button"),
  coverageButton: document.querySelector("#coverage-button"),
  vehicleSort: document.querySelector("#vehicle-sort"),
  clockLabel: document.querySelector("#clock-label"),
  incidentDialog: document.querySelector("#incident-dialog"),
  incidentForm: document.querySelector("#incident-form"),
  incidentLocation: document.querySelector("#incident-location"),
  incidentKeyword: document.querySelector("#incident-keyword"),
  incidentKeywordOptions: document.querySelector("#incident-keyword-options"),
  incidentKeywordToggle: document.querySelector("#incident-keyword-toggle"),
  incidentSignal: document.querySelector("#incident-signal"),
  dispositionSuggestion: document.querySelector("#disposition-suggestion"),
  incidentFw: document.querySelector("#incident-fw"),
  incidentPol: document.querySelector("#incident-pol"),
  incidentCaller: document.querySelector("#incident-caller"),
  incidentNote: document.querySelector("#incident-note"),
  incidentMapButton: document.querySelector("#incident-map-button"),
  dialogVehicleList: document.querySelector("#dialog-vehicle-list"),
  editorDialog: document.querySelector("#editor-dialog"),
  editorType: document.querySelector("#editor-type"),
  editorMapName: document.querySelector("#editor-map-name"),
  editorName: document.querySelector("#editor-name"),
  editorRtw: document.querySelector("#editor-rtw"),
  editorKtw: document.querySelector("#editor-ktw"),
  editorNef: document.querySelector("#editor-nef"),
  editorRef: document.querySelector("#editor-ref"),
  editorRth: document.querySelector("#editor-rth"),
  editorLat: document.querySelector("#editor-lat"),
  editorLng: document.querySelector("#editor-lng"),
  useMapCenterButton: document.querySelector("#use-map-center-button"),
  addMapPointButton: document.querySelector("#add-map-point-button"),
  editorPointList: document.querySelector("#editor-point-list"),
  newMapButton: document.querySelector("#new-map-button"),
  saveMapButton: document.querySelector("#save-map-button"),
  savedMapList: document.querySelector("#saved-map-list"),
  coverageDialog: document.querySelector("#coverage-dialog"),
  coverageList: document.querySelector("#coverage-list"),
  radioAlerts: document.querySelector("#radio-alerts"),
  callDispositionDialog: document.querySelector("#call-disposition-dialog"),
  callDispositionText: document.querySelector("#call-disposition-text"),
  callFwButton: document.querySelector("#call-fw-button"),
  callPolButton: document.querySelector("#call-pol-button"),
  callAendButton: document.querySelector("#call-aend-button"),
  callRejectButton: document.querySelector("#call-reject-button"),
  callMapButton: document.querySelector("#call-map-button"),
  callCreateButton: document.querySelector("#call-create-button")
};

el.shiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await startShift();
});

el.answerButton.addEventListener("click", answerCall);
el.forwardButton.addEventListener("click", forwardCall);
el.newCallButton.addEventListener("click", receiveCall);
el.testModeButton?.addEventListener("click", toggleTestMode);
el.adminModeButton.addEventListener("click", enableAdminMode);
el.startMapEditorButton?.addEventListener("click", openEditor);
el.startIncidentEditorButton?.addEventListener("click", openIncidentEditor);
el.callFwButton.addEventListener("click", () => referPendingCall("FW"));
el.callPolButton.addEventListener("click", () => referPendingCall("POL"));
el.callAendButton.addEventListener("click", () => referPendingCall("AEND"));
el.callRejectButton.addEventListener("click", rejectPendingCall);
el.callMapButton.addEventListener("click", showPendingCallOnMap);
el.callCreateButton.addEventListener("click", () => {
  openIncidentDialog();
  el.callDispositionDialog.close();
});
el.callDispositionDialog.addEventListener("close", handleCallDispositionClosed);
el.speedSelect.addEventListener("change", setSpeed);
el.pauseButton.addEventListener("click", togglePause);
el.endShiftButton.addEventListener("click", endShift);
el.editorButton.addEventListener("click", openEditor);
el.incidentEditorButton.addEventListener("click", openIncidentEditor);
el.coverageButton?.addEventListener("click", openCoverageDialog);
el.vehicleSort.addEventListener("change", renderVehicles);
el.incidentMapButton.addEventListener("click", showPendingCallOnMap);
el.incidentForm.addEventListener("submit", submitIncidentDialog);
el.incidentKeyword.addEventListener("change", renderDispositionSuggestion);
el.incidentKeyword.addEventListener("focus", () => showKeywordOptions(el.incidentKeyword.value));
el.incidentKeyword.addEventListener("input", () => {
  populateKeywordSelectGrouped(el.incidentKeyword.value);
  showKeywordOptions(el.incidentKeyword.value);
  renderDispositionSuggestion();
});
el.incidentKeywordToggle?.addEventListener("click", () => {
  if (el.incidentKeywordOptions.hidden) showKeywordOptions(el.incidentKeyword.value);
  else hideKeywordOptions();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".keyword-field")) hideKeywordOptions();
});
document.querySelectorAll(".signal-option").forEach((button) => {
  button.addEventListener("click", () => setIncidentSignal(button.dataset.signal));
});
el.editorType.addEventListener("change", updateEditorVehicleControls);
el.useMapCenterButton.addEventListener("click", fillEditorFromMapCenter);
el.addMapPointButton.addEventListener("click", addEditorPoint);
el.newMapButton.addEventListener("click", createBlankMap);
el.saveMapButton.addEventListener("click", saveCurrentMap);
makeDialogDraggable(el.incidentDialog);

populateKeywordSelectGrouped();
loadCenterOptions();

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.incidentFilter = button.dataset.filter;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    renderIncidents();
  });
});

async function startShift() {
  state.center = await loadSelectedMap(el.centerSelect.value) || await loadDefaultMap() || createEmptyCenter();
  state.center.callRates = normalizedCallRates(state.center.callRates);
  state.incidentCatalog = await loadIncidentCatalog();
  ensureHospitalDepartments(state.center);
  ensurePoiCatalog(state.center);
  state.coveragePoints = buildCoveragePoints(state.center);
  state.dispatcher = el.dispatcherName.value.trim() || "Gast";
  state.minute = startingMinute(el.timeSelect.value);
  state.incidents = [];
  state.pendingCall = null;
  state.editingIncidentId = null;
  state.adminMode = false;
  state.testMode = false;
  state.pendingCoverageVehicleId = null;
  state.selectedIncidentId = null;
  state.selectedDialogVehicleIds = new Set();
  state.timeouts.forEach((timer) => clearTimeout(timer));
  state.timeouts = [];
  state.speed = Number(el.speedSelect.value) || 1;
  state.lastClockTick = Date.now();
  state.lastCallRateMinute = Math.floor(state.minute);
  state.vehicles = seedVehicles(state.center);

  el.activeCenter.textContent = state.center.name;
  el.operatorLabel.textContent = state.dispatcher;
  el.weatherLabel.textContent = state.center.weather;
  updateCurrentWeather();
  el.startScreen.classList.add("hidden");
  el.dispatchScreen.classList.remove("hidden");
  document.body.classList.add("dispatch-active");
  clearLogs();
  updateAdminControls();
  logCall("Schicht gestartet. Telefon ist frei.", "call");
  logRadio("Alle Fahrzeuge melden einsatzbereit.", "radio");
  initMap();
  renderAll();
  receiveCall();
  startClock();
}

async function loadCenterOptions() {
  const fallback = [{ id: DEFAULT_MAP_ID, name: "ILS Regensburg (Testversion Stadt Regensburg)" }];
  try {
    const response = await fetch("/api/maps");
    if (!response.ok) throw new Error("map list unavailable");
    const maps = await response.json();
    state.availableMaps = Array.isArray(maps) && maps.length ? maps : fallback;
    state.serverAvailable = true;
  } catch {
    state.availableMaps = fallback;
    state.serverAvailable = false;
  }
  updateServerDependentControls();

  const previousValue = el.centerSelect.value;
  el.centerSelect.innerHTML = "";
  state.availableMaps.forEach((map) => {
    const option = document.createElement("option");
    option.value = map.id || DEFAULT_MAP_ID;
    option.textContent = map.name || map.id || "Leitstelle";
    el.centerSelect.append(option);
  });
  const defaultId = state.availableMaps.find((map) => map.id === DEFAULT_MAP_ID)?.id
    || state.availableMaps[0]?.id
    || DEFAULT_MAP_ID;
  el.centerSelect.value = state.availableMaps.some((map) => map.id === previousValue) ? previousValue : defaultId;
}

function updateServerDependentControls() {
  [el.editorButton, el.incidentEditorButton, el.startMapEditorButton, el.startIncidentEditorButton].forEach((button) => {
    if (!button) return;
    button.disabled = !state.serverAvailable;
    button.title = state.serverAvailable ? "" : "Nur mit laufendem Hintergrundserver verfügbar.";
  });
}

async function enableAdminMode() {
  if (state.adminMode) {
    state.adminMode = false;
    updateAdminControls();
    return;
  }
  const password = window.prompt("Admin-Passwort");
  if (!password || !(await verifyAdminPassword(password))) {
    logRadio("Admin-Modus: falsches Passwort.", "admin");
    return;
  }
  state.adminMode = true;
  updateAdminControls();
  logRadio("Admin-Modus aktiviert.", "admin");
}

async function verifyAdminPassword(password) {
  try {
    const response = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!response.ok) return false;
    return Boolean((await response.json()).ok);
  } catch {
    state.serverAvailable = false;
    updateServerDependentControls();
    return false;
  }
}

function updateAdminControls() {
  document.querySelectorAll(".admin-only").forEach((node) => {
    node.hidden = !state.adminMode;
  });
  el.adminModeButton.textContent = state.adminMode ? "Admin aktiv" : "Admin";
  updateTestModeButton();
}

function toggleTestMode() {
  state.testMode = !state.testMode;
  updateTestModeButton();
  logRadio(`Testbetrieb ${state.testMode ? "aktiviert: automatische Anrufe pausiert" : "deaktiviert: automatische Anrufe aktiv"}.`, "admin");
}

function updateTestModeButton() {
  if (!el.testModeButton) return;
  el.testModeButton.textContent = state.testMode ? "Testbetrieb an" : "Testbetrieb aus";
  el.testModeButton.classList.toggle("active", Boolean(state.testMode));
}

function ensureHospitalDepartments(center) {
  const defaults = {
    "kh-ukr": ["cardiology", "neurology", "trauma", "pediatrics", "obstetrics", "internal", "stroke", "icu"],
    "kh-barmherzige": ["cardiology", "neurology", "trauma", "internal", "stroke", "icu"],
    "kh-st-josef": ["cardiology", "internal", "obstetrics"],
    "kh-st-hedwig": ["pediatrics", "obstetrics"],
    "kh-medbo": ["psychiatry"]
  };
  center.hospitals.forEach((hospital) => {
    hospital.departments = (hospital.departments || defaults[hospital.id] || ["internal"]).map(normalizeDepartmentKey);
  });
}

function ensurePoiCatalog(center) {
  const existing = Array.isArray(center.poi) ? center.poi : [];
  const stations = (center.stations || []).map((station) => ({
    id: `station-${station.id}`,
    label: station.label,
    address: station.address,
    lat: station.lat,
    lng: station.lng,
    categories: ["station"]
  }));
  const hospitals = (center.hospitals || []).map((hospital) => ({
    id: `hospital-${hospital.id}`,
    label: hospital.label,
    address: hospital.address,
    lat: hospital.lat,
    lng: hospital.lng,
    categories: ["hospital", ...(hospital.departments || [])]
  }));
  const byId = new Map([...existing, ...stations, ...hospitals].map((poi) => [poi.id || poi.label, poi]));
  center.poi = [...byId.values()];
}

function buildCoveragePoints(center) {
  if (Array.isArray(center.coveragePoints) && center.coveragePoints.length) return center.coveragePoints;
  const ring = center.coverageGeoJson?.geometry?.coordinates?.[0];
  if (Array.isArray(ring) && ring.length) {
    const lngs = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    const north = Math.max(...lats);
    const south = Math.min(...lats);
    const east = Math.max(...lngs);
    const west = Math.min(...lngs);
    const lat = (north + south) / 2;
    const lng = (east + west) / 2;
    return [
      { id: "cov-center", label: "Einsatzgebiet Zentrum", lat, lng },
      { id: "cov-west", label: "Einsatzgebiet West", lat, lng: west + (east - west) * .25 },
      { id: "cov-east", label: "Einsatzgebiet Ost", lat, lng: west + (east - west) * .75 },
      { id: "cov-north", label: "Einsatzgebiet Nord", lat: south + (north - south) * .75, lng },
      { id: "cov-south", label: "Einsatzgebiet Süd", lat: south + (north - south) * .25, lng }
    ];
  }
  return (center.stations || []).map((station) => ({
    id: `cov-${station.id}`,
    label: station.label,
    lat: station.lat,
    lng: station.lng
  }));
}

async function updateCurrentWeather() {
  const [lat, lng] = state.center.mapCenter || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("weather unavailable");
    const data = await response.json();
    const weather = weatherLabel(data.current?.weather_code);
    const temperature = Math.round(Number(data.current?.temperature_2m));
    if (Number.isFinite(temperature)) {
      state.center.weather = `${weather}, ${temperature}°C`;
      el.weatherLabel.textContent = state.center.weather;
    }
  } catch {
    el.weatherLabel.textContent = state.center.weather || "Wetter nicht verfügbar";
  }
}

function weatherLabel(code) {
  if ([0].includes(code)) return "Klar";
  if ([1, 2].includes(code)) return "Heiter";
  if ([3].includes(code)) return "Bewölkt";
  if ([45, 48].includes(code)) return "Nebel";
  if ([51, 53, 55, 56, 57].includes(code)) return "Nieselregen";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Regen";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Schnee";
  if ([95, 96, 99].includes(code)) return "Gewitter";
  return "Wetter";
}

function keywordGroupName(label) {
  if (label.includes("KTP")) return "Krankentransport";
  if (label.includes("Herz") || label.includes("Kreislauf")) return "Herz/Kreislauf";
  if (label.includes("Atmung")) return "Atmung";
  if (label.includes("Trauma")) return "Trauma";
  if (label.includes("Neuro") || label.includes("Psych")) return "Neuro/Psych";
  if (label.includes("Kind") || label.includes("KIND") || label.includes("Säugling")) return "Kind";
  if (label.includes("Verlegung")) return "Verlegung";
  if (label.includes("ABSICHERUNG") || label.includes("SONSTIGE") || label.includes("HILFE")) return "Planbar / Sonstige";
  return "Rettungsdienst";
}

function populateKeywordSelectGrouped(filter = "") {
  const currentValue = el.incidentKeyword.value;
  const query = normalizeSearch(filter);
  el.incidentKeywordOptions.innerHTML = "";
  const matches = rdKeywords
    .filter((keyword) => !query || normalizeSearch(keyword.label).includes(query))
    .slice(0, 24);
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "keyword-option-empty";
    empty.textContent = "Keine passenden Stichwörter";
    el.incidentKeywordOptions.append(empty);
  }
  matches.forEach((keyword) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "keyword-option";
    button.innerHTML = `<strong>${escapeHtml(keyword.label)}</strong><span>${escapeHtml(keywordGroupName(keyword.label))}</span>`;
    button.addEventListener("click", () => {
      el.incidentKeyword.value = keyword.label;
      hideKeywordOptions();
      renderDispositionSuggestion();
      const source = currentIncidentDialogSource();
      if (source) renderDialogVehicles(source, state.editingIncidentId ? source : null);
    });
    el.incidentKeywordOptions.append(button);
  });
  el.incidentKeyword.value = currentValue;
}

function showKeywordOptions(filter = "") {
  populateKeywordSelectGrouped(filter);
  el.incidentKeywordOptions.hidden = false;
}

function hideKeywordOptions() {
  if (el.incidentKeywordOptions) el.incidentKeywordOptions.hidden = true;
}

function setIncidentSignal(value) {
  el.incidentSignal.value = value === "yes" ? "yes" : "no";
  document.querySelectorAll(".signal-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.signal === el.incidentSignal.value);
  });
}

function vehicleTypeLabel(type) {
  const labels = {
    RTW: "Rettungswagen",
    KTW: "Krankentransportwagen",
    NEF: "Notarzteinsatzfahrzeug",
    REF: "Rettungseinsatzfahrzeug",
    RTH: "Rettungshubschrauber"
  };
  return labels[type] || type;
}

function endShift() {
  state.timers.forEach((timer) => clearInterval(timer));
  state.timeouts.forEach((timer) => clearTimeout(timer));
  state.timers = [];
  state.timeouts = [];
  el.dispatchScreen.classList.add("hidden");
  el.startScreen.classList.remove("hidden");
  document.body.classList.remove("dispatch-active");
}

function startingMinute(value) {
  if (value === "now") {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function seedVehicles(center) {
  return center.stations.flatMap((station, stationIndex) => {
    const vehicles = [];
    if (Array.isArray(station.units) && station.units.length) {
      station.units.forEach((unit, unitIndex) => {
        const type = unit.type || unit.name?.split(" ")[0]?.toUpperCase() || "RTW";
        const name = unit.fullName || unit.name || `${type} ${stationIndex + 1}/${unitIndex + 1}`;
        vehicles.push({
          id: `${type}-${stationIndex + 1}-${unitIndex + 1}`,
          name,
          shortName: unit.shortName || unit.short || name,
          shift: unit.shift || "",
          type,
          label: vehicleTypeLabel(type),
          station: station.label,
          stationId: station.id,
          status: 2,
          statusText: "auf Wache",
          lat: station.lat + unitIndex * 0.00045,
          lng: station.lng + unitIndex * 0.00045,
          target: null,
          incidentId: null,
          radioStatus: null,
          radioMessage: "",
          awaitingSpeechPrompt: false,
          waitingForSpeechPrompt: false,
          pendingTransportRequest: null,
          shiftWarning: false,
          coveragePointId: null
        });
      });
      return vehicles;
    }
    Object.entries(station.vehicles || { RTW: 1 }).forEach(([type, count]) => {
      for (let unitIndex = 0; unitIndex < count; unitIndex += 1) {
        vehicles.push({
          id: `${type}-${stationIndex + 1}-${unitIndex + 1}`,
          name: `${type} ${stationIndex + 1}/${unitIndex + 1}`,
          shortName: `${type} ${stationIndex + 1}/${unitIndex + 1}`,
          shift: "",
          type,
          label: vehicleTypeLabel(type),
          station: station.label,
          stationId: station.id,
          status: 2,
          statusText: "auf Wache",
          lat: station.lat + unitIndex * 0.00045,
          lng: station.lng + unitIndex * 0.00045,
          target: null,
          incidentId: null,
          radioStatus: null,
          radioMessage: "",
          awaitingSpeechPrompt: false,
          waitingForSpeechPrompt: false,
          pendingTransportRequest: null,
          shiftWarning: false,
          coveragePointId: null
        });
      }
    });
    return vehicles;
  });
}

function initMap() {
  if (typeof L === "undefined") {
  el.map.innerHTML = '<div class="map-fallback">OpenStreetMap konnte nicht geladen werden. Mit Internetverbindung erscheint hier die Einsatzkarte.</div>';
    state.mapReady = false;
    return;
  }

  if (!state.map) {
    state.map = L.map(el.map, { zoomControl: true, closePopupOnClick: true }).setView(state.center.mapCenter, state.center.zoom);
    state.map.on("click", handleMapClick);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      keepBuffer: 4,
      attribution: "Tiles &copy; Esri, HERE, Garmin, FAO, NOAA, USGS"
    }).addTo(state.map);
  } else {
    state.map.setView(state.center.mapCenter, state.center.zoom);
  }

  state.mapReady = true;
  repairMapSize();
  [150, 500, 1200, 2500].forEach((delay) => window.setTimeout(repairMapSize, delay));
  if (!state.mapResizeObserver) {
    state.mapResizeObserver = new ResizeObserver(() => repairMapSize());
    state.mapResizeObserver.observe(el.map);
    window.addEventListener("resize", repairMapSize);
  }
  if (!state.vehicleSelectionListener) {
    state.vehicleSelectionListener = true;
    document.addEventListener("pointerdown", (event) => {
      if (!state.selectedVehicleId) return;
      if (event.target.closest(".leaflet-popup, .vehicle-marker, .vehicle-row")) return;
      clearSelectedVehiclePopup();
    });
  }
}

function handleMapClick(event) {
  if (state.pendingCoverageVehicleId && event?.latlng) {
    sendVehicleToCoveragePin(state.pendingCoverageVehicleId, event.latlng);
    return;
  }
  clearSelectedVehiclePopup();
}

function clearSelectedVehiclePopup() {
  if (!state.selectedVehicleId) return;
  state.selectedVehicleId = null;
  if (state.mapReady) state.map.closePopup();
  renderVehicles();
}

function repairMapSize() {
  if (!state.mapReady) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      state.map.invalidateSize({ animate: false, pan: false });
      state.map.setView(state.center.mapCenter, state.center.zoom, { animate: false });
    });
  });
}

function startClock() {
  state.timers.forEach((timer) => clearInterval(timer));
  state.timers = [];
  state.timers.push(setInterval(() => {
    if (state.paused) return;
    const now = Date.now();
    const elapsedMs = now - state.lastClockTick;
    state.lastClockTick = now;
    state.minute = (state.minute + (elapsedMs / 60000) * state.speed) % 1440;
    processCallRates();
    renderClock();
    if (state.incidents.some((incident) => incident.status !== "geschlossen")) {
      renderIncidents();
    }
    updateShiftStates();
  }, 1000));

  state.timers.push(setInterval(() => {
    if (!state.paused) updateVehicleTracking();
  }, 1000));
}

function processCallRates() {
  if (state.testMode) {
    state.lastCallRateMinute = Math.floor(state.minute);
    return;
  }
  if (state.pendingCall || el.incidentDialog.open) return;
  const currentMinute = Math.floor(state.minute);
  let previous = state.lastCallRateMinute ?? currentMinute;
  if (currentMinute < previous) previous -= 1440;
  const steps = Math.min(60, currentMinute - previous);
  for (let index = 0; index < steps; index += 1) {
    const minute = (previous + index + 1 + 1440) % 1440;
    const type = callTypeForMinute(minute);
    if (type) {
      receiveCall(type);
      break;
    }
  }
  state.lastCallRateMinute = currentMinute;
}

function callTypeForMinute(minute) {
  const hour = Math.floor(minute / 60);
  const rate = normalizedCallRates(state.center.callRates)[hour];
  const rolls = [
    ["emergency", rate.emergency],
    ["transport", rate.transport],
    ["scheduled", rate.scheduled]
  ].filter(([, value]) => Math.random() < Math.max(0, Number(value) || 0) / 60);
  if (!rolls.length) return null;
  return rolls.sort((a, b) => b[1] - a[1])[0][0];
}

function normalizedCallRates(rates) {
  const fallback = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    emergency: hour >= 7 && hour <= 22 ? 0.9 : 0.35,
    transport: hour >= 7 && hour <= 18 ? 0.55 : 0.1,
    scheduled: hour >= 7 && hour <= 16 ? 0.25 : 0.02
  }));
  if (!Array.isArray(rates)) return fallback;
  return fallback.map((base) => ({ ...base, ...(rates.find((item) => Number(item.hour) === base.hour) || {}) }));
}

function receiveCall(forcedType = null) {
  if (state.pendingCall) return;
  const templates = availableCallTemplates();
  if (!templates.length) {
    logCall("Kein Einsatzkatalog geladen. Bitte Einsatzeditor oder incidents-data.json prüfen.", "warn");
    return;
  }
  let templateIndex = weightedCallTemplateIndex(forcedType);
  if (templates.length > 1 && templateIndex === state.lastCallTemplateIndex) {
    templateIndex = (templateIndex + randomInt(1, templates.length - 1)) % templates.length;
  }
  state.lastCallTemplateIndex = templateIndex;
  const template = resolveTemplateLocation(normalizeIncidentTemplate(templates[templateIndex]));
  state.pendingCall = {
    ...template,
    id: makeId(),
    location: template.location || defaultLocationLabel(),
    lat: Number.isFinite(template.lat) ? template.lat : state.center.mapCenter[0],
    lng: Number.isFinite(template.lng) ? template.lng : state.center.mapCenter[1]
  };
  updateCallAddressFromNearestSource(state.pendingCall);
  reverseGeocodeCall(state.pendingCall);
  playPhoneRing();
  logCall("Neuer Telefonanruf.", "warn");
  el.answerButton.disabled = false;
  el.forwardButton.disabled = false;
  el.answerButton.classList.add("pending-call-alert");
}

function resolveTemplateLocation(template) {
  if (template.locationMode === "hospital" && state.center.hospitals?.length) {
    const hospital = state.center.hospitals[randomInt(0, state.center.hospitals.length - 1)];
    return { ...template, location: hospital.label, lat: hospital.lat, lng: hospital.lng, fixedDestinationId: template.fixedDestinationId };
  }
  if (template.locationMode === "poi" && state.center.poi?.length) {
    const candidates = matchingPoiCandidates(template);
    const poi = candidates[randomInt(0, candidates.length - 1)] || state.center.poi[randomInt(0, state.center.poi.length - 1)];
    return { ...template, location: poi.label, lat: poi.lat, lng: poi.lng };
  }
  if (template.locationMode === "random") {
    const point = randomPointInCoverage();
    return { ...template, location: point.label || nearestAddressLabel(point.lat, point.lng, template.location), lat: point.lat, lng: point.lng };
  }
  return template;
}

function matchingPoiCandidates(template) {
  const poiIds = listValue(template.poiIds).map((item) => item.toLowerCase());
  const categories = listValue(template.poiCategories).map((item) => item.toLowerCase());
  return (state.center.poi || []).filter((poi) => {
    const id = String(poi.id || poi.label || "").toLowerCase();
    const poiCategories = (poi.categories || []).map((category) => String(category).toLowerCase());
    const idMatches = !poiIds.length || poiIds.includes(id);
    const categoryMatches = !categories.length || categories.some((category) => poiCategories.includes(category));
    return idMatches && categoryMatches;
  });
}

function listValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function randomPointInCoverage() {
  if (state.center.poi?.length && Math.random() < .45) {
    const poi = state.center.poi[randomInt(0, state.center.poi.length - 1)];
    return { lat: poi.lat, lng: poi.lng, label: poi.label };
  }
  const ring = state.center.coverageGeoJson?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || !ring.length) {
    return { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1], label: nearestAddressLabel(state.center.mapCenter[0], state.center.mapCenter[1], defaultLocationLabel()) };
  }
  const lngs = ring.map((point) => point[0]);
  const lats = ring.map((point) => point[1]);
  return {
    lat: randomFloat(Math.min(...lats), Math.max(...lats)),
    lng: randomFloat(Math.min(...lngs), Math.max(...lngs))
  };
}

function updateCallAddressFromNearestSource(call) {
  if (!call || !Number.isFinite(call.lat) || !Number.isFinite(call.lng)) return;
  if (call.locationMode !== "random" && call.location) return;
  call.location = nearestAddressLabel(call.lat, call.lng, call.location);
}

function nearestAddressLabel(lat, lng, fallback = defaultLocationLabel()) {
  const candidates = [
    ...(state.center.poi || []),
    ...(state.center.hospitals || []),
    ...(state.center.stations || [])
  ]
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .map((item) => ({
      label: item.address || item.label,
      distance: mapDistance(lat, lng, item.lat, item.lng)
    }))
    .sort((a, b) => a.distance - b.distance);
  if (candidates[0]?.distance <= 0.45) return candidates[0].label;
  return fallback || defaultLocationLabel();
}

async function reverseGeocodeCall(call) {
  if (!call || !Number.isFinite(call.lat) || !Number.isFinite(call.lng) || !window.fetch) return;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${call.lat}&lon=${call.lng}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    const address = data.address || {};
    const road = address.road || address.pedestrian || address.footway || address.cycleway || address.path;
    if (!road) return;
    const city = address.city || address.town || address.village || defaultLocationLabel();
    call.location = `${road}${address.house_number ? ` ${address.house_number}` : ""}, ${city}`;
    if (state.pendingCall?.id === call.id) {
      renderCallDisposition();
      renderPendingCallActions();
    }
  } catch {
    // Offline/fallback bleibt bei der nächsten bekannten Adresse.
  }
}

function audioContext() {
  if (!state.audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    state.audioContext = new AudioCtx();
  }
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function beep(frequency, start, duration, gain = .045) {
  const ctx = audioContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  envelope.gain.setValueAtTime(0, ctx.currentTime + start);
  envelope.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + .015);
  envelope.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + start + duration);
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + .03);
}

function playPagerTone() {
  [1060, 1160, 1270, 1400, 1530].forEach((tone, index) => beep(tone, index * .18, .13, .035));
}

function playPhoneRing() {
  beep(440, 0, .28, .035);
  beep(440, .38, .28, .035);
}

function playStatusTone(code) {
  if (code === 0) {
    beep(920, 0, .12, .06);
    beep(680, .16, .12, .06);
    beep(920, .32, .12, .06);
  } else if (code === 5) {
    beep(760, 0, .1, .045);
    beep(760, .16, .1, .045);
  } else if (code >= 1 && code <= 8) {
    beep(520, 0, .07, .018);
  }
}

function weightedCallTemplateIndex(forcedType = null) {
  const roll = Math.random();
  const wantedType = forcedType || (roll < .72 ? "emergency" : roll < .9 ? "transport" : "scheduled");
  const templates = availableCallTemplates();
  if (!templates.length) return -1;
  const candidates = templates
    .map((template, index) => ({ template, index }))
    .filter((item) => item.template.type === wantedType);
  const pool = candidates.length ? candidates : templates.map((template, index) => ({ template, index }));
  return pool[Math.floor(Math.random() * pool.length)].index;
}

function availableCallTemplates() {
  if (Array.isArray(state.incidentCatalog) && state.incidentCatalog.length) return state.incidentCatalog;
  return [];
}

async function loadIncidentCatalog() {
  try {
    const response = await fetch("/api/incidents");
    if (!response.ok) throw new Error("incident api unavailable");
    const catalog = await response.json();
    if (Array.isArray(catalog) && catalog.length) return catalog;
  } catch {
    // Fallback below keeps the standalone JSON file usable when the API is unavailable.
  }
  try {
    const response = await fetch("incidents-data.json");
    if (!response.ok) throw new Error("incident file unavailable");
    const catalog = await response.json();
    return Array.isArray(catalog) ? catalog : [];
  } catch {
    return [];
  }
}

async function loadDefaultMap() {
  return loadSelectedMap(DEFAULT_MAP_ID);
}

async function loadSelectedMap(mapId) {
  if (!mapId) return null;
  try {
    const response = await fetch(`/api/maps/${encodeURIComponent(mapId)}`);
    if (!response.ok) throw new Error("map api unavailable");
    const map = await response.json();
    return map?.stations?.length ? map : null;
  } catch {
    try {
      const response = await fetch(`maps/${encodeURIComponent(mapId)}.json`);
      if (!response.ok) throw new Error("map file unavailable");
      const map = await response.json();
      return map?.stations?.length ? map : null;
    } catch {
      return null;
    }
  }
}

function normalizeIncidentTemplate(template) {
  if (!template.variants) {
    return {
      ...template,
      callerText: randomDelimitedText(template.callerText),
      callerName: randomDelimitedText(template.callerName) || "Anrufer"
    };
  }
  const variant = template.variants[Math.floor(Math.random() * template.variants.length)];
  const normalized = {
    ...template,
    ...variant,
    id: undefined,
    catalogId: template.id,
    variantId: variant.id || makeId(),
    keyword: variant.keyword || template.keyword || template.title || template.category || "Eigener Einsatz",
    type: variant.type || template.type,
    priority: variant.priority || template.priority || "normal",
    required: variant.required || template.required || ["RTW"],
    signal: false
  };
  normalized.callerText = randomDelimitedText(normalized.callerText);
  normalized.callerName = randomDelimitedText(normalized.callerName) || "Anrufer";
  return normalized;
}

function randomDelimitedText(value) {
  const parts = String(value || "").split("|").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return value || "";
  return parts[randomInt(0, parts.length - 1)];
}

function answerCall() {
  if (!state.pendingCall) return;
  const call = state.pendingCall;
  logCall(`${call.callerName}: ${call.callerText}`, "call");
  logCall(`Einsatzort genannt: ${call.location}.`, "call");
  el.callActions.innerHTML = "";
  el.answerButton.disabled = true;
  el.answerButton.classList.remove("pending-call-alert");
  renderCallDisposition();
  showDialog(el.callDispositionDialog);
}

function renderCallDisposition() {
  const call = state.pendingCall;
  if (!call) return;
  const tag = callTypeTag(call.type);
  el.callDispositionText.innerHTML = `
    <section class="call-disposition-summary">
      <span class="call-type">${escapeHtml(tag)}</span>
      <h3>${escapeHtml(call.callerName || "Anrufer")}</h3>
      <p class="call-location">${escapeHtml(call.location || defaultLocationLabel())}</p>
      <p>${escapeHtml(call.callerText || "")}</p>
    </section>
  `;
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function callTypeTag(type) {
  if (type === "transport" || type === "scheduled") return "19222";
  return "112";
}

function defaultLocationLabel() {
  return state.center?.name || "Einsatzgebiet";
}

function handleCallDispositionClosed() {
  if (!state.pendingCall || el.incidentDialog.open) return;
  renderPendingCallActions();
}

function renderPendingCallActions() {
  el.callActions.innerHTML = "";
  const reopenButton = document.createElement("button");
  reopenButton.type = "button";
  reopenButton.textContent = "Dispositionsfenster öffnen";
  reopenButton.addEventListener("click", () => {
    renderCallDisposition();
    showDialog(el.callDispositionDialog);
  });
  const rejectButton = document.createElement("button");
  rejectButton.type = "button";
  rejectButton.textContent = "Anruf ablehnen";
  rejectButton.addEventListener("click", rejectPendingCall);
  const mapButton = document.createElement("button");
  mapButton.type = "button";
  mapButton.textContent = "auf Karte zeigen";
  mapButton.addEventListener("click", showPendingCallOnMap);
  el.callActions.append(reopenButton, rejectButton, mapButton);
}

function rejectPendingCall() {
  if (!state.pendingCall) return;
  logCall("Anruf abgelehnt.", "warn");
  state.pendingCall = null;
  el.answerButton.disabled = true;
  el.answerButton.classList.remove("pending-call-alert");
  el.forwardButton.disabled = true;
  el.callActions.innerHTML = "";
  if (el.callDispositionDialog.open) el.callDispositionDialog.close();
}

function referPendingCall(service) {
  if (!state.pendingCall) return;
  const labels = { FW: "Feuerwehr", POL: "Polizei", AEND: "Ärztlichen Notdienst" };
  logCall(`Anruf an ${labels[service] || service} verwiesen.`, "warn");
  state.pendingCall = null;
  el.answerButton.disabled = true;
  el.answerButton.classList.remove("pending-call-alert");
  el.forwardButton.disabled = true;
  el.callActions.innerHTML = "";
  el.callDispositionDialog.close();
}

function forwardCall() {
  if (!state.pendingCall) return;
  logCall("Anruf beendet oder weitergeleitet.", "warn");
  state.pendingCall = null;
  el.answerButton.disabled = true;
  el.answerButton.classList.remove("pending-call-alert");
  el.forwardButton.disabled = true;
  el.callActions.innerHTML = "";
  if (el.callDispositionDialog.open) el.callDispositionDialog.close();
}

function openIncidentDialog(source = null) {
  const incident = typeof source === "string"
    ? state.incidents.find((item) => item.id === source)
    : source?.assigned ? source : null;
  const call = incident || source || state.pendingCall;
  if (!call) return;

  state.editingIncidentId = incident?.id || null;
  state.selectedDialogVehicleIds = new Set();
  el.incidentDialog.querySelector(".modal-header h2").textContent = incident ? "Einsatz bearbeiten" : "Neuen Einsatz erstellen";
  el.incidentLocation.value = call.location || defaultLocationLabel();
  populateKeywordSelectGrouped();
  el.incidentKeyword.value = call.keyword && keywordDefaults[call.keyword] ? call.keyword : "";
  setIncidentSignal(call.signal ? "yes" : "no");
  el.incidentFw.checked = Boolean(incident?.requiredServices?.includes("FW") || call.requiredServices?.includes?.("FW"));
  el.incidentPol.checked = Boolean(incident?.requiredServices?.includes("POL") || call.requiredServices?.includes?.("POL"));
  el.incidentCaller.value = call.callerName || "";
  el.incidentNote.value = call.note || "";
  document.querySelector("#create-incident-button").textContent = incident ? "Änderungen speichern" : "Einsatz erstellen";
  document.querySelector("#create-alarm-button").textContent = incident ? "Speichern & weitere alarmieren" : "Erstellen & alarmieren";
  renderDispositionSuggestion();
  renderDialogVehicles(call, incident);
  showDialog(el.incidentDialog);
}

function renderDispositionSuggestion() {
  if (!el.dispositionSuggestion) return;
  const keyword = el.incidentKeyword.value;
  const defaults = keywordDefaults[keyword];
  if (!defaults) {
    el.dispositionSuggestion.hidden = true;
    el.dispositionSuggestion.innerHTML = "";
    return;
  }
  el.dispositionSuggestion.hidden = false;
  el.dispositionSuggestion.innerHTML = "";
  const copy = document.createElement("div");
  copy.className = "disposition-copy";
  const label = document.createElement("strong");
  label.textContent = "Dispositionsvorschlag";
  const text = document.createElement("span");
  text.textContent = defaults.disposition || formatDisposition(defaults.required, defaults.requiredServices);
  copy.append(label, text);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Übernehmen";
  button.addEventListener("click", applyDispositionSuggestion);
  el.dispositionSuggestion.append(copy, button);
}

function applyDispositionSuggestion() {
  const keyword = el.incidentKeyword.value;
  const defaults = keywordDefaults[keyword];
  const source = currentIncidentDialogSource();
  if (!defaults || !source) return;
  const incident = state.editingIncidentId ? state.incidents.find((item) => item.id === state.editingIncidentId) : null;
  const unavailableIds = new Set(incident?.assigned || []);
  state.selectedDialogVehicleIds = new Set();
  normalizeRequiredVehicles(defaults.required || []).forEach((type) => {
    const vehicle = nearestDispositionVehicle(source, type, unavailableIds);
    if (!vehicle) return;
    state.selectedDialogVehicleIds.add(vehicle.id);
    unavailableIds.add(vehicle.id);
  });
  renderDialogVehicles(source, incident);
}

function currentIncidentDialogSource() {
  return state.editingIncidentId
    ? state.incidents.find((item) => item.id === state.editingIncidentId)
    : state.pendingCall;
}

function nearestDispositionVehicle(call, type, unavailableIds) {
  const exact = nearestFreeVehicleOfType(call, type, unavailableIds);
  if (exact) return exact;
  if (type === "NEF") return nearestFreeVehicleOfType(call, "RTH", unavailableIds);
  if (type === "KTW") return nearestFreeVehicleOfType(call, "RTW", unavailableIds);
  return null;
}

function formatDisposition(required = [], services = []) {
  const counts = new Map();
  normalizeRequiredVehicles(required).forEach((type) => counts.set(type, (counts.get(type) || 0) + 1));
  return [
    ...[...counts.entries()].map(([type, count]) => `${count} ${type}`),
    ...(services || [])
  ].join(", ") || "Lage erkunden";
}

function submitIncidentDialog(event) {
  event.preventDefault();
  const submitter = event.submitter;
  if (submitter?.value === "cancel") {
    state.editingIncidentId = null;
    el.incidentDialog.close();
    return;
  }

  const editingIncident = state.editingIncidentId
    ? state.incidents.find((item) => item.id === state.editingIncidentId)
    : null;
  const source = editingIncident || state.pendingCall;
  if (!source) return;

  const keyword = el.incidentKeyword.value;
  const defaults = keywordDefaults[keyword] || keywordDefaults[source.keyword] || {
    type: source.type || "emergency",
    required: source.required || ["RTW"],
    signal: Boolean(source.signal)
  };
  const defaultRequired = normalizeRequiredVehicles(defaults.required);
  const fallbackLat = Number.isFinite(source.lat) ? source.lat : state.center.mapCenter[0];
  const fallbackLng = Number.isFinite(source.lng) ? source.lng : state.center.mapCenter[1];
  const incidentData = {
    ...source,
    keyword,
    type: defaults.type,
    required: defaultRequired,
    signal: el.incidentSignal.value === "yes",
    requiredServices: [el.incidentFw.checked ? "FW" : null, el.incidentPol.checked ? "POL" : null].filter(Boolean),
    services: {
      FW: createServiceState(),
      POL: createServiceState()
    },
    callerName: el.incidentCaller.value.trim() || source.callerName,
    location: el.incidentLocation.value.trim() || source.location || defaultLocationLabel(),
    lat: fallbackLat,
    lng: fallbackLng,
    note: el.incidentNote.value.trim()
  };
  const incident = editingIncident || createIncident(incidentData);
  if (editingIncident) {
    const updatedPatient = updatePatientProfile(editingIncident.patient, incidentData);
    Object.assign(editingIncident, incidentData, {
      patient: updatedPatient,
      required: updatedPatient.requiredVehicles
    });
    editingIncident.status = hasRequiredVehicles(editingIncident) ? editingIncident.status : "in Bearbeitung";
    logRadio(`Einsatz bearbeitet: ${editingIncident.keyword} in ${editingIncident.location}.`, "radio");
  }

  const selectedIds = [...state.selectedDialogVehicleIds];
  if (!editingIncident) {
    state.pendingCall = null;
    el.answerButton.disabled = true;
    el.answerButton.classList.remove("pending-call-alert");
    el.forwardButton.disabled = true;
    el.callActions.innerHTML = "";
  }
  state.editingIncidentId = null;
  el.incidentDialog.close();
  renderAll();
  (incident.requiredServices || []).forEach((service) => {
    if (incident.services?.[service]?.status === "nicht alarmiert") alarmService(incident.id, service);
  });

  if (submitter?.value === "alarm") {
    selectedIds.forEach((vehicleId) => assignVehicle(vehicleId, incident.id));
  }
}

function showPendingCallOnMap() {
  const source = state.editingIncidentId
    ? state.incidents.find((item) => item.id === state.editingIncidentId)
    : state.pendingCall;
  if (!source || !state.mapReady) return;
  const lat = Number.isFinite(source.lat) ? source.lat : state.center.mapCenter[0];
  const lng = Number.isFinite(source.lng) ? source.lng : state.center.mapCenter[1];
  state.map.setView([lat, lng], 15);
  L.popup()
    .setLatLng([lat, lng])
    .setContent(`<strong>${escapeHtml(source.location || defaultLocationLabel())}</strong>`)
    .openOn(state.map);
}

function createIncident(call) {
  const patientProfile = createPatientProfile(call);
  const incident = {
    id: call.id,
    type: call.type,
    keyword: call.keyword,
    location: call.location || defaultLocationLabel(),
    callerName: call.callerName,
    note: call.note || "",
    required: patientProfile.requiredVehicles,
    signal: call.signal,
    priority: call.priority,
    lat: Number.isFinite(call.lat) ? call.lat : state.center.mapCenter[0],
    lng: Number.isFinite(call.lng) ? call.lng : state.center.mapCenter[1],
    createdAtMinute: state.minute,
    status: "offen",
    assigned: [],
    patient: patientProfile,
    transportRequest: null,
    transportRequests: [],
    requiredServices: requiredExternalServices(call, patientProfile),
    services: {
      FW: call.services?.FW || createServiceState(),
      POL: call.services?.POL || createServiceState()
    }
  };
  state.incidents.unshift(incident);
  state.selectedIncidentId = incident.id;
  logRadio(`Neuer Einsatz: ${incident.keyword} in ${incident.location}.`, "warn");
  return incident;
}

function createServiceState() {
  return {
    status: "nicht alarmiert",
    eta: null,
    arriveAtMinute: null,
    alarmedAt: null
  };
}

function requiredExternalServices(call, patientProfile) {
  const services = new Set(call.requiredServices || []);
  ["FW", "POL"].forEach((service) => {
    if (call.services?.[service] && call.services[service].status !== "nicht alarmiert") services.add(service);
  });
  if (call.needsFW) services.add("FW");
  if (call.needsPOL) services.add("POL");
  (patientProfile.patients || []).forEach((patient) => {
    if (patient.needsFW) services.add("FW");
    if (patient.needsPOL) services.add("POL");
  });
  return [...services].filter((service) => service === "FW" || service === "POL");
}

function createPatientProfile(call) {
  const keyword = call.keyword || "";
  const critical = keyword.includes("RD 2") || keyword.includes("MANV") || (call.required || []).some(isDoctorRequirement);
  const trauma = keyword.includes("Trauma") || keyword.includes("Verkehrsunfall");
  const child = keyword.includes("Kind") || keyword.includes("Säugling");
  const transport = call.type === "transport" || keyword.includes("KTP") || keyword.includes("Verlegung");
  const departmentKey = call.requiredDepartmentKey || call.requiredDepartmentKeys?.[0] || departmentKeyForKeyword(keyword, trauma, child);
  const patients = normalizePatients(call, departmentKey);
  const requiredVehicles = aggregateRequiredVehicles(patients, call.required || ["RTW"]);
  return {
    condition: transport ? "transportstabil" : critical ? "kritisch" : "stabil",
    status: "unversorgt",
    treatmentStartedAt: null,
    readyForTransport: false,
    transportNeeded: call.type !== "scheduled",
    requiredDepartmentKey: departmentKey,
    requiredDepartmentKeys: call.requiredDepartmentKeys || [departmentKey],
    requiredDepartment: departmentLabels(call.requiredDepartmentKeys || [departmentKey]),
    report: "",
    pendingReport: call.report || "",
    situationReport: call.situationReport || "",
    patientCount: patients.length,
    patients,
    requiredVehicles,
    noTransportLikely: Boolean(call.noTransportLikely),
    outcome: null,
    fixedDestinationId: call.fixedDestinationId || null,
    fixedDestination: call.fixedDestination || null
  };
}

function updatePatientProfile(existing, call) {
  const next = createPatientProfile(call);
  return {
    ...next,
    status: existing?.status || next.status,
    treatmentStartedAt: existing?.treatmentStartedAt || null,
    readyForTransport: existing?.readyForTransport || false,
    outcome: existing?.outcome || null,
    report: existing?.report || "",
    pendingReport: existing?.pendingReport || next.pendingReport,
    situationReport: existing?.situationReport || next.situationReport,
    patients: existing?.patients?.length ? existing.patients : next.patients
  };
}

function normalizePatients(call, fallbackDepartmentKey) {
  if (Array.isArray(call.patients) && call.patients.length) {
    return call.patients.map((patient, index) => {
      const required = resolvePatientRequirement(patient.required || patient.options || [{ vehicles: patient.vehicles || ["RTW"], probability: 1 }]);
      const refOnly = required.length > 0 && required.every((type) => type === "REF");
      return {
        id: patient.id || `pat-${index + 1}`,
        label: patient.label || `Pat ${index + 1}`,
        required,
        requiredDepartmentKey: (patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey])[0],
        requiredDepartmentKeys: patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey],
        requiredDepartment: departmentLabels(patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey]),
        transportSignalProbability: Number(patient.transportSignalProbability) || 0,
        requiresDoctorAccompaniment: Boolean(patient.requiresDoctorAccompaniment),
        needsFW: Boolean(patient.needsFW),
        needsPOL: Boolean(patient.needsPOL),
        noTransportProbability: refOnly ? 1 : clampProbability(patient.noTransportProbability),
        noTransportText: patient.noTransportText || (refOnly ? "Ambulante Versorgung durch REF ausreichend, kein Transport." : "Ambulante Versorgung ausreichend, kein Transport."),
        transportNeeded: refOnly ? false : patient.transportNeeded !== false,
        assignedVehicles: []
      };
    });
  }
  const count = Math.max(1, Number(call.patientCount) || 1);
  const baseRequired = normalizeRequiredVehicles(call.required?.length ? call.required : ["RTW"]);
  const baseRefOnly = baseRequired.length > 0 && baseRequired.every((type) => type === "REF");
  return Array.from({ length: count }, (_, index) => ({
    id: `pat-${index + 1}`,
    label: `Pat ${index + 1}`,
    required: index === 0 ? [...baseRequired] : ["RTW"],
    requiredDepartmentKey: fallbackDepartmentKey,
    requiredDepartmentKeys: [fallbackDepartmentKey],
    requiredDepartment: departmentLabels([fallbackDepartmentKey]),
    needsFW: false,
    needsPOL: false,
    requiresDoctorAccompaniment: false,
    noTransportProbability: baseRefOnly ? 1 : 0,
    noTransportText: baseRefOnly ? "Ambulante Versorgung durch REF ausreichend, kein Transport." : "Ambulante Versorgung ausreichend, kein Transport.",
    transportNeeded: baseRefOnly ? false : call.type !== "scheduled",
    assignedVehicles: []
  }));
}

function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function resolvePatientRequirement(options) {
  if (Array.isArray(options) && options.every((option) => typeof option === "string")) {
    return normalizeRequiredVehicles(options);
  }
  const choices = Array.isArray(options) ? options : [{ vehicles: ["RTW"], probability: 1 }];
  const total = choices.reduce((sum, option) => sum + (Number(option.probability) || 0), 0) || 1;
  let draw = Math.random() * total;
  for (const option of choices) {
    draw -= Number(option.probability) || 0;
    if (draw <= 0) return normalizeRequiredVehicles(option.vehicles || option.required || []);
  }
  return normalizeRequiredVehicles(choices.at(-1)?.vehicles || choices.at(-1)?.required || ["RTW"]);
}

function aggregateRequiredVehicles(patients, fallback = ["RTW"]) {
  const required = normalizeRequiredVehicles(patients.flatMap((patient) => patient.required || []));
  return required.length ? required : normalizeRequiredVehicles(fallback);
}

function normalizeRequiredVehicles(required = []) {
  return (required || []).filter(Boolean).map((type) => type === "RTH" ? "NEF" : type);
}

function departmentForKeyword(keyword, trauma = false, child = false) {
  if (child) return "Pädiatrie / Kinderklinik";
  if (trauma) return "Unfallchirurgie / Schockraum";
  if (keyword.includes("Herz") || keyword.includes("Kreislauf")) return "Kardiologie / Chest Pain Unit";
  if (keyword.includes("Atmung")) return "Innere Medizin / Überwachung";
  if (keyword.includes("Neuro")) return "Neurologie / Stroke Unit";
  if (keyword.includes("Psych")) return "Psychiatrie";
  if (keyword.includes("Geburt")) return "Geburtshilfe";
  if (keyword.includes("Verlegung")) return "aufnehmende Fachabteilung";
  if (keyword.includes("KTP")) return "Ziel nach Auftrag";
  return "Notaufnahme";
}

function departmentKeyForKeyword(keyword, trauma = false, child = false) {
  if (child) return "pediatrics";
  if (trauma) return "trauma";
  if (keyword.includes("Herz") || keyword.includes("Kreislauf")) return "cardiology";
  if (keyword.includes("Atmung")) return "internal";
  if (keyword.includes("Neuro")) return "neurology";
  if (keyword.includes("Psych")) return "psychiatry";
  if (keyword.includes("Geburt")) return "obstetrics";
  if (keyword.includes("KTP") || keyword.includes("Verlegung")) return "internal";
  return "internal";
}

function departmentLabel(key) {
  if (key === "emergency") return "Innere Medizin";
  return (window.departmentCatalog || []).find((department) => department.key === key)?.label || key || "Innere Medizin";
}

function departmentLabels(keys) {
  const normalized = (keys || []).filter(Boolean).map(normalizeDepartmentKey);
  return normalized.length ? normalized.map(departmentLabel).join(" / ") : "kein Klinikziel";
}

function normalizeDepartmentKey(key) {
  return key === "emergency" ? "internal" : key;
}
