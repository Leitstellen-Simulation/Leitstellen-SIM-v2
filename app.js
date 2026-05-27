const DEFAULT_MAP_ID = "ils-regensburg-testversion-stadt-regensburg";
const STATIC_MAPS = [
  { id: "ils-regensburg-testversion-stadt-regensburg", name: "ILS Regensburg (Testversion Stadt Regensburg)" },
  { id: "ils-regensburg-tisch-regensburg-alpha-version", name: "ILS Regensburg Tisch Regensburg (Alpha-Version)" }
];

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
    supportGroups: [],
    weightZones: [],
    callRates: normalizedCallRates()
  };
}

const state = {
  center: createEmptyCenter(),
  dispatcher: "Gast",
  minute: 0,
  absoluteMinute: 0,
  speed: 1,
  paused: false,
  pendingCall: null,
  pendingCalls: [],
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
  lastUnplannedCallAbsoluteMinute: 0,
  editorPoints: [],
  editingMapPointId: null,
  selectedDialogVehicleIds: new Set(),
  dialogRoutes: new Map(),
  dialogTravelTimes: new Map(),
  dialogTravelTimeRequests: new Set(),
  showForeignVehiclesInDialog: false,
  showForeignHospitalsInTransport: false,
  startupSyncHandled: false,
  lastForeignAvailabilityRoll: null,
  lastCallTemplateIndex: -1,
  availableMaps: [],
  coveragePoints: [],
  pendingCoverageVehicleId: null,
  supportGroupStates: {},
  testMode: false,
  serverAvailable: false,
  systemStatus: {
    server: "unbekannt",
    routing: "unbekannt",
    weather: "unbekannt",
    geocoding: "unbekannt"
  },
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
  adminStatusBar: document.querySelector("#admin-status-bar"),
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
  adminLoginDialog: document.querySelector("#admin-login-dialog"),
  adminLoginForm: document.querySelector("#admin-login-form"),
  adminLoginPassword: document.querySelector("#admin-login-password"),
  adminLoginError: document.querySelector("#admin-login-error"),
  closeAdminLoginDialog: document.querySelector("#close-admin-login-dialog"),
  cancelAdminLogin: document.querySelector("#cancel-admin-login"),
  coverageButton: document.querySelector("#coverage-button"),
  supportGroupButton: document.querySelector("#support-group-button"),
  supportGroupDialog: document.querySelector("#support-group-dialog"),
  supportGroupList: document.querySelector("#support-group-list"),
  closeSupportGroupDialog: document.querySelector("#close-support-group-dialog"),
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
  incidentCallTextPanel: document.querySelector("#incident-call-text-panel"),
  incidentCallText: document.querySelector("#incident-call-text"),
  incidentTargetInfo: document.querySelector("#incident-target-info"),
  incidentFw: document.querySelector("#incident-fw"),
  incidentPol: document.querySelector("#incident-pol"),
  incidentNote: document.querySelector("#incident-note"),
  incidentPatientConditions: document.querySelector("#incident-patient-conditions"),
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
  editorElrd: document.querySelector("#editor-elrd"),
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
el.adminLoginForm?.addEventListener("submit", handleAdminLoginSubmit);
el.closeAdminLoginDialog?.addEventListener("click", closeAdminLoginDialog);
el.cancelAdminLogin?.addEventListener("click", closeAdminLoginDialog);
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
el.supportGroupButton?.addEventListener("click", openSupportGroupDialog);
el.closeSupportGroupDialog?.addEventListener("click", () => el.supportGroupDialog?.close());
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
loadCenterOptions().then(startFromStartupOptions);

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.incidentFilter = button.dataset.filter;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    renderIncidents();
  });
});

async function startShift() {
  const options = startupOptions();
  state.center = await loadSelectedMap(el.centerSelect.value) || await loadDefaultMap() || createEmptyCenter();
  state.center.callRates = normalizedCallRates(state.center.callRates);
  state.incidentCatalog = await loadIncidentCatalog();
  ensureHospitalDepartments(state.center);
  state.center.supportGroups ||= [];
  state.center.weightZones ||= [];
  ensurePoiCatalog(state.center);
  state.coveragePoints = buildCoveragePoints(state.center);
  state.dispatcher = el.dispatcherName.value.trim() || "Gast";
  state.minute = startingMinute(el.timeSelect.value);
  state.absoluteMinute = state.minute;
  state.incidents = [];
  state.pendingCall = null;
  state.pendingCalls = [];
  state.editingIncidentId = null;
  state.adminMode = false;
  state.testMode = false;
  state.pendingCoverageVehicleId = null;
  state.selectedIncidentId = null;
  state.selectedDialogVehicleIds = new Set();
  state.showForeignVehiclesInDialog = false;
  state.showForeignHospitalsInTransport = false;
  state.lastForeignAvailabilityRoll = null;
  state.supportGroupStates = {};
  state.systemStatus.routing = "unbekannt";
  state.systemStatus.weather = "unbekannt";
  state.systemStatus.geocoding = "unbekannt";
  state.timeouts.forEach((timer) => clearTimeout(timer));
  state.timeouts = [];
  state.speed = Number(el.speedSelect.value) || 1;
  state.lastClockTick = Date.now();
  state.lastCallRateMinute = Math.floor(state.absoluteMinute);
  state.lastUnplannedCallAbsoluteMinute = state.lastCallRateMinute;
  state.vehicles = seedVehicles(state.center);
  rollForeignVehicleAvailability(true);
  initializeShiftStatesForStart();

  el.activeCenter.textContent = state.center.name;
  el.operatorLabel.textContent = state.dispatcher;
  el.weatherLabel.textContent = state.center.weather;
  updateCurrentWeather();
  checkCriticalServices();
  el.startScreen.classList.add("hidden");
  el.dispatchScreen.classList.remove("hidden");
  document.body.classList.add("dispatch-active");
  clearLogs();
  state.adminMode = options.admin;
  state.testMode = options.test;
  updateAdminControls();
  updateCallControls();
  logCall("Schicht gestartet. Telefon ist frei.", "call");
  logRadio("Dienstplan geladen, einsatzbereite Fahrzeuge sind verfuegbar.", "radio");
  initMap();
  renderAll();
  startClock();
}

function startupOptions() {
  const params = new URLSearchParams(window.location.search);
  const preset = String(params.get("preset") || "").toLowerCase();
  if (preset === "admin-test") {
    return {
      admin: true,
      test: true,
      autostart: true
    };
  }
  return {
    admin: startupFlag(params.get("admin")),
    test: startupFlag(params.get("test")),
    autostart: startupFlag(params.get("autostart"))
  };
}

function startupFlag(value) {
  return ["1", "true", "yes", "ja", "on"].includes(String(value || "").toLowerCase());
}

function startFromStartupOptions() {
  if (!startupOptions().autostart || !el.startScreen || el.startScreen.classList.contains("hidden")) return;
  if (!el.dispatcherName.value.trim()) el.dispatcherName.value = "Admin";
  startShift();
}

async function loadCenterOptions() {
  const fallback = STATIC_MAPS;
  try {
    const response = await fetch("/api/maps");
    if (!response.ok) throw new Error("map list unavailable");
    const maps = await response.json();
    state.availableMaps = Array.isArray(maps) && maps.length ? mergeStaticMaps(maps) : fallback;
    state.serverAvailable = true;
    state.systemStatus.server = "online";
  } catch {
    state.availableMaps = fallback;
    state.serverAvailable = false;
    state.systemStatus.server = "fallback";
  }
  updateServerDependentControls();
  renderAdminStatusBar();

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
  if (!state.startupSyncHandled && state.serverAvailable) {
    state.startupSyncHandled = true;
    await handleStartupSyncPrompts();
  }
}

async function handleStartupSyncPrompts() {
  let changedMaps = false;
  try {
    const response = await fetch("/api/startup-sync");
    if (!response.ok) return;
    const sync = await response.json();
    if (sync?.incidentMerge?.added && sync.incidentMerge.added !== "initial") {
      console.log(`Einsatzkatalog aktualisiert: ${sync.incidentMerge.added} neue Einsaetze ergaenzt.`);
    }
    for (const conflict of sync?.mapConflicts || []) {
      const choice = window.prompt(
        `Neue gebuendelte Version fuer Karte "${conflict.localName}" gefunden.\n\n` +
        "Was soll passieren?\n" +
        "lokal = lokale Karte behalten\n" +
        "neu = gebuendelte Version uebernehmen\n" +
        "beide = beide behalten (neue als v2 anlegen)",
        "beide"
      );
      const action = String(choice || "lokal").trim().toLowerCase();
      if (!["lokal", "neu", "beide", "bundled", "both"].includes(action)) continue;
      await fetch("/api/startup-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "map", id: conflict.id, file: conflict.file, action })
      });
      if (action !== "lokal") changedMaps = true;
    }
    if (changedMaps) await reloadMapOptionsAfterSync();
  } catch (error) {
    console.warn("Startup-Synchronisierung nicht verfuegbar", error);
  }
}

async function reloadMapOptionsAfterSync() {
  const previousHandled = state.startupSyncHandled;
  state.startupSyncHandled = true;
  await loadCenterOptions();
  state.startupSyncHandled = previousHandled;
}

function mergeStaticMaps(maps) {
  const merged = new Map(STATIC_MAPS.map((map) => [map.id, map]));
  maps.forEach((map) => {
    const id = map?.id || map?.name;
    if (!id) return;
    merged.set(id, map);
  });
  return Array.from(merged.values());
}

function initializeShiftStatesForStart() {
  state.vehicles.forEach((vehicle) => {
    const inShift = vehicleInShift(vehicle);
    const canShiftChange = vehicleCanShiftChangeAtStation(vehicle);
    vehicle.shiftWarning = !inShift && vehicle.status !== 6 && !canShiftChange;
    if (!inShift && canShiftChange) {
      vehicle.status = 6;
      vehicle.statusText = "ausser Dienst";
      vehicle.radioStatus = null;
      vehicle.radioMessage = "";
      vehicle.awaitingSpeechPrompt = false;
    }
    if (inShift && vehicle.status === 6 && !vehicle.status6Reason && !vehicle.foreign) {
      vehicle.status = 2;
      vehicle.statusText = "auf Wache";
      vehicle.radioStatus = null;
      vehicle.radioMessage = "";
      vehicle.awaitingSpeechPrompt = false;
    }
  });
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
  openAdminLoginDialog();
}

function openAdminLoginDialog() {
  if (!el.adminLoginDialog) return;
  if (el.adminLoginPassword) el.adminLoginPassword.value = "";
  if (el.adminLoginError) {
    el.adminLoginError.hidden = true;
    el.adminLoginError.textContent = "";
  }
  showDialog(el.adminLoginDialog);
  setTimeout(() => el.adminLoginPassword?.focus(), 0);
}

function closeAdminLoginDialog() {
  if (el.adminLoginDialog?.open) el.adminLoginDialog.close();
}

async function handleAdminLoginSubmit(event) {
  event.preventDefault();
  const password = el.adminLoginPassword?.value || "";
  if (!password || !(await verifyAdminPassword(password))) {
    if (el.adminLoginError) {
      el.adminLoginError.textContent = "Falsches Passwort oder Hintergrundserver nicht erreichbar.";
      el.adminLoginError.hidden = false;
    }
    logRadio("Admin-Modus: falsches Passwort.", "admin");
    return;
  }
  closeAdminLoginDialog();
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
  renderAdminStatusBar();
}

function renderAdminStatusBar() {
  if (!el.adminStatusBar) return;
  el.adminStatusBar.hidden = !state.adminMode;
  if (!state.adminMode) return;
  const mapStatus = state.mapReady ? "online" : "fallback";
  const vehiclesStatus = state.vehicles?.length ? `${state.vehicles.length} Fzg` : "keine Fzg";
  const callChanceStatus = adminCallChanceStatus();
  const items = [
    ["Server", state.systemStatus.server],
    ["Routing", state.systemStatus.routing],
    ["Wetter", state.systemStatus.weather],
    ["Geocoding", state.systemStatus.geocoding],
    ["Karte", mapStatus],
    ["Fahrzeuge", vehiclesStatus],
    ["Anruf", callChanceStatus]
  ];
  const selectedIncident = state.incidents.find((incident) => incident.id === state.selectedIncidentId);
  const patientDetails = adminPatientStateDetails(selectedIncident);
  el.adminStatusBar.innerHTML = items.map(([label, value]) => {
    const tone = value === "online" || /Fzg$/.test(value) ? "ok" : value === "unbekannt" ? "neutral" : "warn";
    return `<span class="admin-status-chip ${tone}"><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</span>`;
  }).join("") + (patientDetails ? `<span class="admin-patient-status">${escapeHtml(patientDetails)}</span>` : "");
}

function adminCallChanceStatus() {
  if (typeof currentCallChanceInfo !== "function") return "unbekannt";
  const info = currentCallChanceInfo();
  const total = Math.round(info.callChance * 1000) / 10;
  const bonus = Math.round(info.idleBonus * 1000) / 10;
  const emergency = Math.round(info.emergencyShare * 100);
  const transport = Math.round(info.transportShare * 100);
  return `${formatGermanPercent(total)}%/min inkl. +${formatGermanPercent(bonus)}% Bonus (${emergency}% N / ${transport}% T)`;
}

function formatGermanPercent(value) {
  return String(value).replace(".", ",");
}

function adminPatientStateDetails(incident) {
  const patients = incident?.patient?.patients || [];
  if (!patients.length || typeof patientConditionPercent !== "function") return "";
  return patients.map((patient) => adminPatientStateText(patient, incident)).join("   |   ");
}

function adminPatientStateText(patient, incident) {
  if (patient.deceased) return `${patient.label || "Pat"} verstorben`;
  const labels = {
    "planned-transport": "planbar",
    stable: "stabil",
    "potential-critical": "pot. kritisch",
    critical: "kritisch",
    reanimation: "Reanimation"
  };
  const condition = Math.round(patientConditionPercent(patient, incident) * 100);
  const parts = [`${patient.label || "Pat"} ${condition}%`, labels[patient.acuity] || patient.acuity || "unbekannt"];
  if (Number.isFinite(patient.conditionStartPercent)) parts.push(`Start ${Math.round(patient.conditionStartPercent * 100)}%`);
  if (Number.isFinite(patient.deteriorationPerMinute) && patient.deteriorationPerMinute > 0) {
    const rate = typeof dynamicDeteriorationRate === "function" ? dynamicDeteriorationRate(patient, incident) : patient.deteriorationPerMinute;
    parts.push(`Abfall ${(rate * 100).toFixed(2).replace(".", ",")}%/min`);
  }
  if (patient.acuity === "reanimation" && Number.isFinite(patient.reanimationSurvivalChance)) {
    const reaRate = typeof reanimationDeteriorationRate === "function" ? reanimationDeteriorationRate(patient) : null;
    parts.push(`Rea ${Math.round(patient.reanimationSurvivalChance * 100)}%`);
    if (Number.isFinite(reaRate)) parts.push(`Rea-Abfall ${(reaRate * 100).toFixed(1).replace(".", ",")}%/min`);
  }
  const startedAt = patient.conditionStartedAt ?? incident?.createdAtAbsoluteMinute ?? incident?.createdAtMinute;
  if (Number.isFinite(startedAt) && typeof simMinuteNow === "function") parts.push(`${Math.max(0, Math.floor(simMinuteNow() - startedAt))} min`);
  return parts.join(" | ");
}

function toggleTestMode() {
  state.testMode = !state.testMode;
  updateTestModeButton();
  updateCallControls();
  logRadio(`Testbetrieb ${state.testMode ? "aktiviert: automatische Anrufe pausiert" : "deaktiviert: automatische Anrufe aktiv"}.`, "admin");
}

function openSupportGroupDialog() {
  renderSupportGroupDialog();
  showDialog(el.supportGroupDialog);
}

function renderSupportGroupDialog() {
  if (!el.supportGroupList) return;
  const groups = state.center?.supportGroups || [];
  el.supportGroupList.innerHTML = "";
  if (!groups.length) {
    el.supportGroupList.textContent = "Keine UGRD-/SEG-Gruppen in dieser Karte angelegt.";
    return;
  }
  groups.forEach((group) => {
    const groupState = supportGroupState(group.id);
    const activeVehicles = state.vehicles.filter((vehicle) => vehicle.supportGroupId === group.id);
    const pending = groupState.pending || 0;
    const available = activeVehicles.filter((vehicle) => [1, 2].includes(vehicle.status) && !vehicle.incidentId && !vehicle.nextIncidentId).length;
    const busy = activeVehicles.length - available;
    const row = document.createElement("article");
    row.className = "support-group-card";
    const units = (group.units || []).map((unit) => unit.shortName || unit.name || unit.type).join(", ") || "keine Fahrzeuge";
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(group.label || group.id || "UGRD/SEG")}</h3>
        <p>${escapeHtml(units)}</p>
        <small>Status: ${escapeHtml(groupState.status || "bereit")} | ausstehend ${pending} | frei ${available} | gebunden ${busy}</small>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const alarm = document.createElement("button");
    alarm.type = "button";
    alarm.textContent = groupState.status === "alarmed" ? "erneut alarmieren" : "alarmieren";
    alarm.addEventListener("click", () => {
      alarmSupportGroup(group.id);
      renderSupportGroupDialog();
    });
    const standDown = document.createElement("button");
    standDown.type = "button";
    standDown.textContent = "Alarm beenden";
    standDown.disabled = groupState.status !== "alarmed" && !activeVehicles.length && !pending;
    standDown.addEventListener("click", () => {
      standDownSupportGroup(group.id);
      renderSupportGroupDialog();
    });
    actions.append(alarm, standDown);
    row.append(actions);
    el.supportGroupList.append(row);
  });
}

function supportGroupState(groupId) {
  state.supportGroupStates ||= {};
  state.supportGroupStates[groupId] ||= {
    status: "bereit",
    pending: 0,
    activeVehicleIds: []
  };
  return state.supportGroupStates[groupId];
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
    foreign: Boolean(hospital.foreign),
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
      state.systemStatus.weather = "online";
      renderAdminStatusBar();
    }
  } catch {
    el.weatherLabel.textContent = state.center.weather || "Wetter nicht verfügbar";
    state.systemStatus.weather = "fallback";
    renderAdminStatusBar();
  }
}

async function checkCriticalServices() {
  checkRoutingStatus();
  checkGeocodingStatus();
}

async function checkRoutingStatus() {
  const [lat, lng] = state.center.mapCenter || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !window.fetch) return;
  state.systemStatus.routing = "prueft";
  renderAdminStatusBar();
  try {
    const params = new URLSearchParams({
      fromLat: String(lat),
      fromLng: String(lng),
      toLat: String(lat + 0.01),
      toLng: String(lng + 0.01)
    });
    const response = await fetch(`/api/route?${params}`);
    state.systemStatus.routing = response.ok ? "online" : "fallback";
  } catch {
    state.systemStatus.routing = "fallback";
  }
  renderAdminStatusBar();
}

async function checkGeocodingStatus() {
  const [lat, lng] = state.center.mapCenter || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !window.fetch) return;
  state.systemStatus.geocoding = "prueft";
  renderAdminStatusBar();
  try {
    const response = await fetch(reverseGeocodeUrl(lat, lng), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("geocoding unavailable");
    const data = await response.json();
    state.systemStatus.geocoding = formatGeocodeAddress(data) ? "online" : "fallback";
  } catch {
    state.systemStatus.geocoding = "fallback";
  }
  renderAdminStatusBar();
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
    .filter((keyword) => !query || normalizeSearch(keyword.label).includes(query));
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
  if (el.incidentDialog?.open) {
    const source = currentIncidentDialogSource();
    const incident = state.editingIncidentId ? state.incidents.find((item) => item.id === state.editingIncidentId) : null;
    if (source) renderDialogVehicles(source, incident);
  }
}

function vehicleTypeLabel(type) {
  const labels = {
    RTW: "Rettungswagen",
    KTW: "Krankentransportwagen",
    NEF: "Notarzteinsatzfahrzeug",
    VEF: "Verlegungseinsatzfahrzeug",
    REF: "Rettungseinsatzfahrzeug",
    RTH: "Rettungshubschrauber",
    ITW: "Intensivtransportwagen",
    ITH: "Intensivtransporthubschrauber",
    ELRD: "Einsatzleiter Rettungsdienst",
    HVO: "Helfer vor Ort",
    FR: "First Responder"
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
        vehicles.push(createVehicleFromStationUnit(station, stationIndex, unit, unitIndex));
      });
      return vehicles;
    }
    Object.entries(station.vehicles || { RTW: 1 }).forEach(([type, count]) => {
      for (let unitIndex = 0; unitIndex < count; unitIndex += 1) {
        vehicles.push(createVehicleFromStationUnit(station, stationIndex, { type }, unitIndex));
      }
    });
    return vehicles;
  });
}

function createVehicleFromStationUnit(station, stationIndex, unit, unitIndex) {
  const type = unit.type || unit.name?.split(" ")[0]?.toUpperCase() || "RTW";
  const fallbackName = `${type} ${stationIndex + 1}/${unitIndex + 1}`;
  const name = unit.fullName || unit.name || fallbackName;
  const foreign = stationIsForeign(station) || Boolean(unit.foreign);
  return {
    id: unit.id || `${type}-${stationIndex + 1}-${unitIndex + 1}`,
    name,
    shortName: unit.shortName || unit.short || name,
    shift: unit.shift || "",
    type,
    label: vehicleTypeLabel(type),
    station: station.label,
    stationId: station.id,
    foreign,
    availabilityProbability: foreignAvailabilityProbability(unit, station),
    responderAvailabilityProbability: unit.responderAvailabilityProbability ?? station.responderAvailabilityProbability,
    status: 2,
    statusText: foreign ? "auf Fremdwache verfügbar" : "auf Wache",
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
  };
}

function stationIsForeign(station) {
  return Boolean(station?.foreign || station?.foreignStation || station?.outsideCoverage || station?.external);
}

function foreignAvailabilityProbability(unit = {}, station = {}) {
  const value = unit.availabilityProbability
    ?? unit.foreignAvailabilityProbability
    ?? station.availabilityProbability
    ?? station.foreignAvailabilityProbability
    ?? 0.5;
  return normalizeProbability(value, 0.5);
}

function normalizeProbability(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

function rollForeignVehicleAvailability(force = false) {
  const rollSlot = Math.floor(Math.floor(state.minute) / 15);
  if (!force && state.lastForeignAvailabilityRoll === rollSlot) return;
  state.lastForeignAvailabilityRoll = rollSlot;
  let changed = false;
  state.vehicles.forEach((vehicle) => {
    if (!vehicle.foreign || ![2, 6].includes(vehicle.status) || vehicle.status6Reason || vehicle.nextIncidentId || vehicle.incidentId) return;
    const station = state.center.stations.find((item) => item.id === vehicle.stationId);
    if (!vehicleInShift(vehicle)) {
      vehicle.status = 6;
      vehicle.statusText = "außer Dienst";
      changed = true;
      return;
    }
    const available = Math.random() < (vehicle.availabilityProbability ?? 0.5);
    vehicle.status = available ? 2 : 6;
    vehicle.statusText = available ? "auf Fremdwache verfügbar" : "Fremdwache nicht verfügbar";
    if (station) {
      vehicle.lat = station.lat;
      vehicle.lng = station.lng;
    }
    changed = true;
  });
  if (changed && !force) renderAll();
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
    const elapsedMinutes = (elapsedMs / 60000) * state.speed;
    state.absoluteMinute += elapsedMinutes;
    state.minute = (state.minute + elapsedMinutes) % 1440;
    processCallRates();
    rollForeignVehicleAvailability();
    renderClock();
    if (typeof updateDynamicPatientStates === "function") updateDynamicPatientStates();
    if (state.incidents.some((incident) => incident.status !== "geschlossen")) {
      renderIncidents();
    }
    updateShiftStates();
  }, 1000));

  state.timers.push(setInterval(() => {
    if (!state.paused) updateVehicleTracking();
  }, 1000));
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

function legacyReceiveCall(forcedType = null) {
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
  keepCallInsideCoverage(state.pendingCall);
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
    const hospitals = locationsInsideCoverage(state.center.hospitals);
    const hospital = hospitals[randomInt(0, hospitals.length - 1)] || state.center.hospitals[randomInt(0, state.center.hospitals.length - 1)];
    return { ...template, location: hospital.label, lat: hospital.lat, lng: hospital.lng, fixedDestinationId: template.fixedDestinationId };
  }
  if (template.locationMode === "poi" && state.center.poi?.length) {
    const candidates = matchingPoiCandidates(template);
    const fallbackPoi = locationsInsideCoverage(state.center.poi);
    const poi = candidates[randomInt(0, candidates.length - 1)] || fallbackPoi[randomInt(0, fallbackPoi.length - 1)];
    if (!poi) return resolveTemplateLocation({ ...template, locationMode: "random" });
    return {
      ...template,
      location: poi.label,
      lat: poi.lat,
      lng: poi.lng,
      locationPoiId: poi.id || "",
      locationPoiLabel: poi.label || "",
      callerText: replacePoiPlaceholder(template.callerText, poi)
    };
  }
  if (template.locationMode === "random") {
    const point = randomPointInCoverage();
    return { ...template, location: point.label || nearestAddressLabel(point.lat, point.lng, template.location), lat: point.lat, lng: point.lng };
  }
  return template;
}

function replacePoiPlaceholder(value, poi) {
  if (value === null || value === undefined) return value;
  const label = poi?.label || poi?.address || "POI";
  return String(value).replace(/\*POI\*/gi, label);
}

function resolveTemplateDestination(template) {
  if (!template || template.fixedDestination || template.fixedDestinationId) return template;
  if (!isDirectTransportTemplate(template)) return template;
  if (transportTemplateNeedsClinicSelection(template)) return template;
  if (template.destinationMode === "poi") {
    const destination = randomWeightedPoiTransportDestination(template);
    return destination ? withDirectTransportDestination(template, destination) : template;
  }
  if (template.destinationMode === "home"
    || (template.destinationMode === "none" && template.type === "transport")
    || normalizeSearch(template.keyword || template.title || "").includes("heimfahrt")) {
    return withDirectTransportDestination(template, randomHomeDestinationNear(template));
  }
  return template;
}

function isDirectTransportTemplate(template) {
  const keyword = String(template?.keyword || template?.title || "");
  return template?.type === "transport" || template?.type === "scheduled" || keyword.includes("KTP") || keyword.includes("Heimfahrt");
}

function transportTemplateNeedsClinicSelection(template) {
  const patients = Array.isArray(template?.patients) ? template.patients : [];
  const keys = patients.flatMap((patient) => patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || "none"]);
  return keys.some((key) => normalizeDepartmentKey(key) !== "none");
}

function withDirectTransportDestination(template, destination) {
  if (!destination) return template;
  const target = {
    id: destination.id || makeId(`destination-${Date.now()}-${Math.random()}`),
    label: destination.label || destination.address || "Zieladresse",
    address: destination.address || destination.label || "Zieladresse",
    lat: destination.lat,
    lng: destination.lng,
    type: (destination.categories || []).includes("hospital") ? "hospital" : "destination",
    categories: destination.categories || []
  };
  return {
    ...template,
    fixedDestination: target,
    callerText: appendDestinationToCallerText(template.callerText, target)
  };
}

function appendDestinationToCallerText(text, destination) {
  const base = String(text || "").trim();
  const label = destination?.label || destination?.address || "";
  if (!label || normalizeSearch(base).includes(normalizeSearch(label))) return base;
  return `${base}${base ? " " : ""}Ziel: ${label}.`;
}

function randomWeightedPoiTransportDestination(template) {
  const candidates = matchingDestinationPoiCandidatesForTemplate(template);
  if (!candidates.length) return null;
  return weightedLocationChoice(candidates, template);
}

function matchingDestinationPoiCandidatesForTemplate(template) {
  const poiIds = listValue(template.destinationPoiIds).map((item) => item.toLowerCase());
  const categories = listValue(template.destinationPoiCategories).map((item) => item.toLowerCase());
  return (state.center.poi || [])
    .filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .filter((poi) => {
      const id = String(poi.id || poi.label || "").toLowerCase();
      const poiCategories = (poi.categories || []).map((category) => String(category).toLowerCase());
      const idMatches = !poiIds.length || poiIds.includes(id);
      const categoryMatches = !categories.length || categories.some((category) => poiCategories.includes(category));
      return idMatches && categoryMatches;
    });
}

function weightedLocationChoice(candidates, origin) {
  const weighted = candidates.map((candidate) => {
    const distance = mapDistance(origin.lat, origin.lng, candidate.lat, candidate.lng);
    return { candidate, weight: 1 / Math.pow(Math.max(1, distance), 1.6) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let draw = Math.random() * total;
  for (const item of weighted) {
    draw -= item.weight;
    if (draw <= 0) return item.candidate;
  }
  return weighted[weighted.length - 1]?.candidate || candidates[0];
}

function randomHomeDestinationNear(origin) {
  const originLat = Number.isFinite(origin?.lat) ? origin.lat : state.center.mapCenter[0];
  const originLng = Number.isFinite(origin?.lng) ? origin.lng : state.center.mapCenter[1];
  const roll = Math.random();
  const distanceKm = roll < 0.82
    ? randomFloat(0.5, 15)
    : roll < 0.96
      ? randomFloat(15, 50)
      : randomFloat(50, 200);
  const bearing = randomFloat(0, Math.PI * 2);
  const point = destinationPointFrom(originLat, originLng, distanceKm, bearing);
  return {
    id: makeId(`home-${state.absoluteMinute}-${Math.random()}`),
    label: `Wohnadresse ca. ${Math.round(distanceKm)} km entfernt`,
    address: "Wohnadresse",
    lat: point.lat,
    lng: point.lng,
    categories: ["home"]
  };
}

function destinationPointFrom(lat, lng, distanceKm, bearing) {
  const radiusKm = 6371;
  const latRad = lat * Math.PI / 180;
  const lngRad = lng * Math.PI / 180;
  const angular = distanceKm / radiusKm;
  const targetLat = Math.asin(Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing));
  const targetLng = lngRad + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
    Math.cos(angular) - Math.sin(latRad) * Math.sin(targetLat)
  );
  return { lat: targetLat * 180 / Math.PI, lng: ((targetLng * 180 / Math.PI + 540) % 360) - 180 };
}

function matchingPoiCandidates(template) {
  const poiIds = listValue(template.poiIds).map((item) => item.toLowerCase());
  const categories = listValue(template.poiCategories).map((item) => item.toLowerCase());
  return locationsInsideCoverage(state.center.poi || []).filter((poi) => {
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
  const weightedPoint = randomPointInWeightZones();
  if (weightedPoint) return weightedPoint;
  const rings = coverageOuterRings(state.center?.coverageGeoJson);
  if (!rings.length) {
    return { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1], label: nearestAddressLabel(state.center.mapCenter[0], state.center.mapCenter[1], defaultLocationLabel()) };
  }
  const allPoints = rings.flat();
  const lngs = allPoints.map((point) => point[0]);
  const lats = allPoints.map((point) => point[1]);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const point = {
      lat: randomFloat(Math.min(...lats), Math.max(...lats)),
      lng: randomFloat(Math.min(...lngs), Math.max(...lngs))
    };
    if (callPointInsideCoverage(point.lat, point.lng)) return { ...point, label: null };
  }
  return { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1], label: nearestAddressLabel(state.center.mapCenter[0], state.center.mapCenter[1], defaultLocationLabel()) };
}

function randomPointInWeightZones() {
  const zones = (state.center?.weightZones || [])
    .map((zone) => ({ zone, geometry: callCoverageGeometry(zone.geoJson), weight: Math.max(0.1, Number(zone.weight) || 1) }))
    .filter((entry) => entry.geometry);
  if (!zones.length) return null;
  const weightedZones = zones
    .map((entry) => ({ ...entry, score: entry.weight * Math.max(0.000001, geometryApproxArea(entry.geometry)) }))
    .filter((entry) => entry.score > 0);
  if (!weightedZones.length) return null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const entry = weightedZoneChoice(weightedZones);
    const point = randomPointInGeometry(entry.geometry);
    if (point && callPointInsideCoverage(point.lat, point.lng)) return { ...point, label: null };
  }
  return null;
}

function weightedZoneChoice(items) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.score), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= Math.max(0, item.score);
    if (roll <= 0) return item;
  }
  return items.at(-1);
}

function randomPointInGeometry(geometry) {
  const rings = geometryOuterRings(geometry);
  if (!rings.length) return null;
  const allPoints = rings.flat();
  const lngs = allPoints.map((point) => point[0]);
  const lats = allPoints.map((point) => point[1]);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const point = {
      lat: randomFloat(Math.min(...lats), Math.max(...lats)),
      lng: randomFloat(Math.min(...lngs), Math.max(...lngs))
    };
    if (callGeometryContainsPoint(geometry, point.lat, point.lng)) return point;
  }
  return null;
}

function keepCallInsideCoverage(call) {
  if (!call || !Number.isFinite(call.lat) || !Number.isFinite(call.lng)) return;
  if (callPointInsideCoverage(call.lat, call.lng)) return;
  const replacement = randomPointInCoverage();
  call.lat = replacement.lat;
  call.lng = replacement.lng;
  call.location = replacement.label || nearestAddressLabel(replacement.lat, replacement.lng, call.location);
  call.locationMode = "random";
}

function locationsInsideCoverage(locations = []) {
  return (locations || []).filter((location) => Number.isFinite(location.lat)
    && Number.isFinite(location.lng)
    && callPointInsideCoverage(location.lat, location.lng));
}

function callPointInsideCoverage(lat, lng) {
  const geometry = callCoverageGeometry(state.center?.coverageGeoJson);
  if (!geometry) return true;
  return callGeometryContainsPoint(geometry, lat, lng);
}

function callCoverageGeometry(geoJson) {
  if (!geoJson) return null;
  if (geoJson.type === "Feature") return geoJson.geometry || null;
  if (geoJson.type === "FeatureCollection") {
    return {
      type: "GeometryCollection",
      geometries: (geoJson.features || []).map((feature) => feature.geometry).filter(Boolean)
    };
  }
  return geoJson;
}

function primaryCoverageRing() {
  return coverageOuterRings(state.center?.coverageGeoJson)[0] || null;
}

function coverageOuterRings(geoJson) {
  return geometryOuterRings(callCoverageGeometry(geoJson));
}

function geometryOuterRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return Array.isArray(geometry.coordinates?.[0]) ? [geometry.coordinates[0]] : [];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).map((polygon) => polygon?.[0]).filter(Array.isArray);
  if (geometry.type === "GeometryCollection") return (geometry.geometries || []).flatMap(geometryOuterRings);
  return [];
}

function geometryApproxArea(geometry) {
  return geometryOuterRings(geometry).reduce((sum, ring) => sum + Math.abs(ringShoelaceArea(ring)), 0);
}

function ringShoelaceArea(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [lngA, latA] = ring[index];
    const [lngB, latB] = ring[(index + 1) % ring.length];
    area += lngA * latB - lngB * latA;
  }
  return area / 2;
}

function callGeometryContainsPoint(geometry, lat, lng) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return callPolygonContainsPoint(geometry.coordinates, lat, lng);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).some((polygon) => callPolygonContainsPoint(polygon, lat, lng));
  if (geometry.type === "GeometryCollection") return (geometry.geometries || []).some((item) => callGeometryContainsPoint(item, lat, lng));
  return false;
}

function callPolygonContainsPoint(rings, lat, lng) {
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!callRingContainsPoint(rings[0], lat, lng)) return false;
  return !rings.slice(1).some((ring) => callRingContainsPoint(ring, lat, lng));
}

function callRingContainsPoint(ring, lat, lng) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [lngA, latA] = ring[index];
    const [lngB, latB] = ring[previous];
    const intersects = (latA > lat) !== (latB > lat)
      && lng < ((lngB - lngA) * (lat - latA)) / ((latB - latA) || 1e-9) + lngA;
    if (intersects) inside = !inside;
  }
  return inside;
}

function updateCallAddressFromNearestSource(call) {
  if (!call || !Number.isFinite(call.lat) || !Number.isFinite(call.lng)) return;
  call.location = nearestAddressLabel(call.lat, call.lng, call.location);
}

function nearestAddressLabel(lat, lng, fallback = defaultLocationLabel()) {
  if (fallback && fallback !== defaultLocationLabel()) return fallback;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return "Adresse wird ermittelt...";
  return fallback || defaultLocationLabel();
}

async function reverseGeocodeCall(call) {
  if (!call || !Number.isFinite(call.lat) || !Number.isFinite(call.lng) || !window.fetch) return;
  state.systemStatus.geocoding = "fallback";
  renderAdminStatusBar();
  try {
    const url = reverseGeocodeUrl(call.lat, call.lng);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("geocoding unavailable");
    const data = await response.json();
    const label = formatGeocodeAddress(data);
    if (!label) return;
    call.location = label;
    state.systemStatus.geocoding = "online";
    renderAdminStatusBar();
    if (state.pendingCall?.id === call.id) {
      renderCallDisposition();
    }
    if (state.pendingCalls?.some((item) => item.id === call.id)) renderPendingCallActions();
  } catch {
    // Offline/fallback bleibt bei der nächsten bekannten Adresse.
  }
}

async function reverseGeocodeCallDestination(call) {
  const destination = call?.fixedDestination;
  if (!destination || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || !window.fetch) return;
  if (!String(destination.label || "").startsWith("Wohnadresse")) return;
  try {
    const response = await fetch(reverseGeocodeUrl(destination.lat, destination.lng), { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const label = formatGeocodeAddress(await response.json());
    if (!label) return;
    const oldLabel = destination.label;
    destination.label = label;
    destination.address = label;
    call.callerText = String(call.callerText || "").replace(oldLabel, label);
    if (state.pendingCall?.id === call.id) renderCallDisposition();
    if (state.pendingCalls?.some((item) => item.id === call.id)) renderPendingCallActions();
    if (el.incidentDialog?.open && currentIncidentDialogSource()?.id === call.id) renderIncidentTransportTarget(call);
  } catch {
    // Zieladresse bleibt als generische Wohnadresse erhalten.
  }
}

function formatGeocodeAddress(data) {
  const address = data?.address || {};
  const road = address.road || address.pedestrian || address.footway || address.cycleway || address.path || address.residential;
  const place = address.city || address.town || address.village || address.municipality || address.county || defaultLocationLabel();
  if (road) return `${road}${address.house_number ? ` ${address.house_number}` : ""}, ${place}`;
  if (data?.display_name) {
    const parts = String(data.display_name).split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 3).join(", ");
  }
  return null;
}

function reverseGeocodeUrl(lat, lng) {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (location.protocol === "http:" || location.protocol === "https:") return `/api/reverse-geocode?${params}`;
  return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
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

function legacyWeightedCallTemplateIndex(forcedType = null) {
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

function legacyAvailableCallTemplates() {
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
    const response = await fetch("incidents-dynamic.json");
    if (!response.ok) throw new Error("dynamic incident file unavailable");
    const catalog = await response.json();
    if (Array.isArray(catalog) && catalog.length) return catalog;
  } catch {
    // Legacy fallback below.
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
  if (isDynamicIncidentTemplate(template)) {
    return normalizeDynamicIncidentTemplate(template);
  }
  if (!template.variants) {
    return applyDynamicIncidentPlaceholders({
      ...template,
      callerText: randomDelimitedText(template.callerText),
      callerName: randomDelimitedText(template.callerName) || "Anrufer"
    });
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
  return applyDynamicIncidentPlaceholders(normalized);
}

function isDynamicIncidentTemplate(template) {
  return Number(template?.schemaVersion) >= 2 || Boolean(template?.call);
}

function normalizeDynamicIncidentTemplate(template) {
  const call = template.call || {};
  const variant = weightedChoice(template.variants, "weight") || {};
  const patients = Array.isArray(variant.patients) && variant.patients.length
    ? variant.patients.map(materializeDynamicPatient)
    : [];
  const normalized = {
    ...template,
    ...call,
    id: undefined,
    catalogId: template.id,
    variantId: variant.id || makeId(),
    variantLabel: variant.label || variant.title || "",
    keyword: template.keyword || template.title || variant.keyword || variant.title || template.category || "Eigener Einsatz",
    type: template.type || variant.type || "emergency",
    priority: variant.priority || template.priority || "normal",
    required: variant.required || template.required || ["RTW"],
    noElrd: Boolean(variant.noElrd ?? template.noElrd ?? false),
    requiredServices: variant.requiredServices || template.requiredServices || [],
    report: variant.report || "",
    situationReport: variant.situationReport || "",
    patients,
    patientCount: patients.length || Number(variant.patientCount) || Number(template.patientCount) || 1,
    signal: Boolean(variant.signal ?? template.signal ?? false)
  };
  normalized.callerText = randomDelimitedText(call.callerText ?? template.callerText);
  normalized.callerName = randomDelimitedText(call.callerName ?? template.callerName) || "Anrufer";
  return applyDynamicIncidentPlaceholders(normalized);
}

function materializeDynamicPatient(patient, index) {
  const materialized = { ...patient };
  delete materialized.outcomes;
  materialized.id ||= `pat-${index + 1}`;
  materialized.label ||= `Pat ${index + 1}`;
  materialized.acuity ||= "stable";
  return materialized;
}

function weightedChoice(items, weightKey = "weight") {
  const pool = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!pool.length) return null;
  const weighted = pool.map((item) => {
    const weight = Number(item?.[weightKey] ?? 1);
    return { item, weight: Number.isFinite(weight) && weight > 0 ? weight : 0 };
  }).filter((entry) => entry.weight > 0);
  if (!weighted.length) return pool[randomInt(0, pool.length - 1)];
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let draw = Math.random() * total;
  for (const entry of weighted) {
    draw -= entry.weight;
    if (draw <= 0) return entry.item;
  }
  return weighted[weighted.length - 1].item;
}

function applyDynamicIncidentPlaceholders(template) {
  if (typeof window.applyDynamicNamePlaceholdersToIncidentTemplate === "function") {
    return window.applyDynamicNamePlaceholdersToIncidentTemplate(template);
  }
  return template;
}

function randomDelimitedText(value) {
  const parts = String(value || "").split("|").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return value || "";
  return parts[randomInt(0, parts.length - 1)];
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

function legacyRenderPendingCallActions() {
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

function legacyRejectPendingCall() {
  if (!state.pendingCall) return;
  logCall("Anruf abgelehnt.", "warn");
  state.pendingCall = null;
  el.answerButton.disabled = true;
  el.answerButton.classList.remove("pending-call-alert");
  el.forwardButton.disabled = true;
  el.callActions.innerHTML = "";
  if (el.callDispositionDialog.open) el.callDispositionDialog.close();
}

function legacyReferPendingCall(service) {
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

function legacyForwardCall() {
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
  state.showForeignVehiclesInDialog = false;
  el.incidentDialog.querySelector(".modal-header h2").textContent = incident ? "Einsatz bearbeiten" : "Neuen Einsatz erstellen";
  el.incidentLocation.value = call.location || defaultLocationLabel();
  populateKeywordSelectGrouped();
  el.incidentKeyword.value = incident ? call.keyword || "" : "";
  setIncidentSignal(call.signal ? "yes" : "no");
  el.incidentFw.checked = incident
    ? Boolean(incident.requiredServices?.includes("FW") || (incident.services?.FW && incident.services.FW.status !== "nicht alarmiert"))
    : false;
  el.incidentPol.checked = incident
    ? Boolean(incident.requiredServices?.includes("POL") || (incident.services?.POL && incident.services.POL.status !== "nicht alarmiert"))
    : false;
  el.incidentNote.value = call.note || "";
  renderIncidentCallText(call);
  renderIncidentTransportTarget(call);
  if (el.incidentPatientConditions) {
    el.incidentPatientConditions.hidden = true;
    el.incidentPatientConditions.innerHTML = "";
  }
  document.querySelector("#create-incident-button").textContent = incident ? "Änderungen speichern" : "Einsatz erstellen";
  document.querySelector("#create-alarm-button").textContent = incident ? "Speichern & weitere alarmieren" : "Erstellen & alarmieren";
  renderDispositionSuggestion();
  renderDialogVehicles(call, incident);
  showDialog(el.incidentDialog);
}

function renderIncidentCallText(source) {
  if (!el.incidentCallTextPanel || !el.incidentCallText) return;
  const text = String(source?.callerText || source?.callText || "").trim();
  el.incidentCallTextPanel.hidden = !text;
  el.incidentCallTextPanel.open = false;
  el.incidentCallText.textContent = text;
}

function renderIncidentTransportTarget(source) {
  if (!el.incidentTargetInfo) return;
  const destination = source?.fixedDestination || source?.patient?.fixedDestination || null;
  if (!destination || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    el.incidentTargetInfo.hidden = true;
    el.incidentTargetInfo.innerHTML = "";
    return;
  }
  const status = incidentTargetTravelStatus(source, destination);
  el.incidentTargetInfo.hidden = false;
  el.incidentTargetInfo.innerHTML = `
    <strong>Ziel:</strong> ${escapeHtml(destination.label || destination.address || "Zieladresse")}
    <span>${targetTravelMarkup(status)}</span>
  `;
  requestIncidentTargetTravelTime(source, destination);
}

function incidentTargetTravelStatus(source, destination) {
  state.dialogDestinationTravelTimes ||= new Map();
  state.dialogDestinationTravelTimeRequests ||= new Set();
  const key = incidentTargetTravelKey(source, destination);
  if (state.dialogDestinationTravelTimes.has(key)) return state.dialogDestinationTravelTimes.get(key);
  if (state.dialogDestinationTravelTimeRequests.has(key)) return { state: "loading" };
  return { state: "idle" };
}

function targetTravelMarkup(status) {
  if (status?.state === "ready") {
    const minutes = Math.max(1, Math.round(status.durationMs / 60000));
    const source = status.source === "fallback" ? "Fallback" : "OSRM";
    return ` | Einsatzort -> Ziel ca. ${minutes} min (${source})`;
  }
  if (status?.state === "loading") return " | Fahrtzeit wird berechnet...";
  return "";
}

function incidentTargetTravelKey(source, destination) {
  return [
    Number(source?.lat).toFixed(5),
    Number(source?.lng).toFixed(5),
    Number(destination.lat).toFixed(5),
    Number(destination.lng).toFixed(5)
  ].join("|");
}

async function requestIncidentTargetTravelTime(source, destination) {
  if (!source || !destination || state.dialogDestinationTravelTimeRequests?.has(incidentTargetTravelKey(source, destination))) return;
  state.dialogDestinationTravelTimes ||= new Map();
  state.dialogDestinationTravelTimeRequests ||= new Set();
  const key = incidentTargetTravelKey(source, destination);
  if (state.dialogDestinationTravelTimes.has(key)) return;
  state.dialogDestinationTravelTimeRequests.add(key);
  try {
    const route = await buildRoute({ type: "KTW", lat: source.lat, lng: source.lng }, destination);
    state.dialogDestinationTravelTimes.set(key, {
      state: "ready",
      durationMs: Math.max(1, route.baseDurationMs || 0),
      source: route.source
    });
  } catch {
    state.dialogDestinationTravelTimes.set(key, { state: "error" });
  } finally {
    state.dialogDestinationTravelTimeRequests.delete(key);
  }
  if (el.incidentDialog?.open && currentIncidentDialogSource()?.id === source.id) renderIncidentTransportTarget(source);
}

function renderDispositionSuggestion() {
  if (!el.dispositionSuggestion) return;
  const keyword = el.incidentKeyword.value.trim();
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
  label.textContent = "Vorschlag";
  const text = document.createElement("span");
  const source = currentIncidentDialogSource();
  const required = addElrdToRequiredForDialog(defaults.required, source);
  const disposition = formatDisposition(required, defaults.requiredServices);
  text.textContent = `${disposition} · ${defaults.signal ? "SoSi" : "ohne SoSi"}`;
  copy.append(label, text);
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Übernehmen";
  button.addEventListener("click", applyDispositionSuggestion);
  el.dispositionSuggestion.append(copy, button);
}

function applyDispositionSuggestion() {
  const keyword = el.incidentKeyword.value.trim();
  const defaults = keywordDefaults[keyword];
  const source = currentIncidentDialogSource();
  if (!defaults || !source) return;
  const incident = state.editingIncidentId ? state.incidents.find((item) => item.id === state.editingIncidentId) : null;
  const unavailableIds = new Set(incident?.assigned || []);
  state.selectedDialogVehicleIds = new Set();
  setIncidentSignal(defaults.signal ? "yes" : "no");
  setIncidentSupportServices(defaults.requiredServices || []);
  addElrdToRequiredForDialog(defaults.required || [], source).forEach((type) => {
    const vehicle = nearestDispositionVehicle(source, type, unavailableIds);
    if (!vehicle) return;
    state.selectedDialogVehicleIds.add(vehicle.id);
    unavailableIds.add(vehicle.id);
  });
  renderDialogVehicles(source, incident);
}

function addElrdToRequiredForDialog(required = [], source = null) {
  const normalized = normalizeRequiredVehicles(required || []);
  const patientCount = source?.patient?.patients?.length || source?.patients?.length || Number(source?.patientCount) || 1;
  if (!source?.noElrd && patientCount >= 2 && !normalized.includes("ELRD")) normalized.push("ELRD");
  return normalized;
}

function setIncidentSupportServices(services = []) {
  const requiredServices = new Set(services || []);
  el.incidentFw.checked = requiredServices.has("FW");
  el.incidentPol.checked = requiredServices.has("POL");
}

function currentIncidentDialogSource() {
  return state.editingIncidentId
    ? state.incidents.find((item) => item.id === state.editingIncidentId)
    : state.pendingCall;
}

function renderPatientConditionEditor(source) {
  if (!el.incidentPatientConditions) return;
  const currentValues = collectPatientConditionInputs();
  const patients = dialogPatientsForConditionEditor(source);
  el.incidentPatientConditions.innerHTML = "";
  if (patients.length <= 1) {
    el.incidentPatientConditions.hidden = true;
    return;
  }
  el.incidentPatientConditions.hidden = false;
  const title = document.createElement("strong");
  title.textContent = "Patientenzustand";
  el.incidentPatientConditions.append(title);
  patients.forEach((patient) => {
    const label = document.createElement("label");
    label.dataset.patientId = patient.id;
    label.textContent = patient.label;
    const input = document.createElement("textarea");
    input.rows = 2;
    input.dataset.patientId = patient.id;
    input.placeholder = "z.B. kritisch, Rauchgasexposition, Ziel: Innere";
    input.value = currentValues[patient.id] ?? patient.conditionReport ?? patient.report ?? "";
    label.append(input);
    el.incidentPatientConditions.append(label);
  });
}

function collectPatientConditionInputs() {
  if (!el.incidentPatientConditions) return {};
  return [...el.incidentPatientConditions.querySelectorAll("textarea[data-patient-id]")]
    .reduce((values, input) => {
      values[input.dataset.patientId] = input.value.trim();
      return values;
    }, {});
}

function dialogPatientsForConditionEditor(source) {
  if (!source) return [];
  if (source.patient?.patients?.length) {
    return source.patient.patients.map((patient, index) => ({
      id: patient.id || `pat-${index + 1}`,
      label: patient.label || `Pat ${index + 1}`,
      conditionReport: patient.conditionReport || patient.report || ""
    }));
  }
  if (Array.isArray(source.patients) && source.patients.length) {
    return source.patients.map((patient, index) => ({
      id: patient.id || `pat-${index + 1}`,
      label: patient.label || `Pat ${index + 1}`,
      conditionReport: patient.conditionReport || patient.patientCondition || patient.report || ""
    }));
  }
  const count = Math.max(1, Number(source.patientCount) || 1);
  return Array.from({ length: count }, (_, index) => ({
    id: `pat-${index + 1}`,
    label: `Pat ${index + 1}`,
    conditionReport: ""
  }));
}

function nearestDispositionVehicle(call, type, unavailableIds) {
  const exact = nearestFreeVehicleOfType(call, type, unavailableIds);
  if (exact) return exact;
  if (type === "NEF") {
    return nearestFreeVehicleOfType(call, "VEF", unavailableIds)
      || nearestFreeVehicleOfType(call, "RTH", unavailableIds)
      || nearestFreeVehicleOfType(call, "ITH", unavailableIds)
      || nearestFreeVehicleOfType(call, "ITW", unavailableIds);
  }
  if (type === "KTW") return nearestFreeVehicleOfType(call, "RTW", unavailableIds) || nearestFreeVehicleOfType(call, "ITW", unavailableIds);
  if (type === "RTW") return nearestFreeVehicleOfType(call, "ITW", unavailableIds);
  if (type === "RTH") return nearestFreeVehicleOfType(call, "ITH", unavailableIds);
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
    updateCallControls();
    return;
  }

  const editingIncident = state.editingIncidentId
    ? state.incidents.find((item) => item.id === state.editingIncidentId)
    : null;
  const source = editingIncident || state.pendingCall;
  if (!source) return;

  const keyword = el.incidentKeyword.value.trim() || source.keyword || "Eigener Einsatz";
  const defaults = keywordDefaults[keyword] || keywordDefaults[source.keyword] || {
    type: source.type || "emergency",
    required: source.required || ["RTW"],
    signal: Boolean(source.signal)
  };
  const defaultRequired = normalizeRequiredVehicles(defaults.required);
  const fallbackLat = Number.isFinite(source.lat) ? source.lat : state.center.mapCenter[0];
  const fallbackLng = Number.isFinite(source.lng) ? source.lng : state.center.mapCenter[1];
  const existingServices = editingIncident?.services || source.services || {};
  const selectedRequiredServices = [el.incidentFw.checked ? "FW" : null, el.incidentPol.checked ? "POL" : null].filter(Boolean);
  const incidentData = {
    ...source,
    keyword,
    type: editingIncident?.type === "scheduled" ? "scheduled" : defaults.type,
    required: defaultRequired,
    signal: el.incidentSignal.value === "yes",
    requiredServices: selectedRequiredServices,
    services: {
      FW: existingServices.FW || createServiceState(),
      POL: existingServices.POL || createServiceState()
    },
    callerName: source.callerName,
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
      required: updatedPatient.requiredVehicles,
      requiredServices: requiredExternalServices(incidentData, updatedPatient)
    });
    editingIncident.status = hasRequiredVehicles(editingIncident) ? editingIncident.status : "in Bearbeitung";
    logRadio(`Einsatz bearbeitet: ${editingIncident.keyword} in ${editingIncident.location}.`, "radio");
  }

  const selectedIds = [...state.selectedDialogVehicleIds];
  if (!editingIncident) {
    completePendingCall(source.id);
  }
  state.editingIncidentId = null;
  el.incidentDialog.close();
  updateCallControls();
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
    createdAtAbsoluteMinute: state.absoluteMinute,
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
  const patients = applyPatientConditionReports(normalizePatients(call, departmentKey), call.patientConditions);
  const requiredVehicles = applyElrdRequirement(aggregateRequiredVehicles(patients, call.required || ["RTW"]), call, patients);
  return {
    condition: transport ? "transportstabil" : critical ? "kritisch" : "stabil",
    status: "unversorgt",
    treatmentStartedAt: null,
    readyForTransport: false,
    transportNeeded: callTransportNeeded(call),
    requiredDepartmentKey: departmentKey,
    requiredDepartmentKeys: call.requiredDepartmentKeys || [departmentKey],
    requiredDepartment: departmentLabels(call.requiredDepartmentKeys || [departmentKey]),
    report: "",
    pendingReport: call.report || "",
    situationReport: call.situationReport || "",
    patientCount: patients.length,
    patients,
    requiredVehicles,
    outcome: null,
    fixedDestinationId: call.fixedDestinationId || null,
    fixedDestination: call.fixedDestination || null,
    destinationMode: call.destinationMode || "none",
    destinationPoiProbability: clampProbability(call.destinationPoiProbability),
    destinationPoiCategories: listValue(call.destinationPoiCategories),
    destinationPoiIds: listValue(call.destinationPoiIds)
  };
}

function updatePatientProfile(existing, call) {
  const next = createPatientProfile(call);
  const patients = applyPatientConditionReports(existing?.patients?.length ? existing.patients : next.patients, call.patientConditions);
  return {
    ...next,
    status: existing?.status || next.status,
    treatmentStartedAt: existing?.treatmentStartedAt || null,
    readyForTransport: existing?.readyForTransport || false,
    outcome: existing?.outcome || null,
    report: existing?.report || "",
    pendingReport: existing?.pendingReport || next.pendingReport,
    situationReport: existing?.situationReport || next.situationReport,
    patients
  };
}

function applyPatientConditionReports(patients, patientConditions = {}) {
  return (patients || []).map((patient) => {
    if (!Object.prototype.hasOwnProperty.call(patientConditions, patient.id)) return patient;
    return { ...patient, conditionReport: patientConditions[patient.id]?.trim() || "" };
  });
}

function normalizePatients(call, fallbackDepartmentKey) {
  if (Array.isArray(call.patients) && call.patients.length) {
    return call.patients.map((patient, index) => {
      const required = resolvePatientRequirement(patient.required || patient.options || [{ vehicles: patient.vehicles || ["RTW"], probability: 1 }]);
      const acuity = normalizePatientAcuity(patient.acuity || patient.patientAcuity || (call.type === "scheduled" ? "planned-transport" : "stable"));
      const effectiveRequired = acuity === "reanimation" ? ["RTW", "NEF"] : required;
      const refOnly = acuity !== "reanimation" && required.length > 0 && required.every((type) => type === "REF");
      return {
        id: patient.id || `pat-${index + 1}`,
        label: patient.label || `Pat ${index + 1}`,
        required: effectiveRequired,
        acuity,
        reanimationCase: Boolean(patient.reanimationCase),
        requiredDepartmentKey: (patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey])[0],
        requiredDepartmentKeys: patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey],
        requiredDepartment: departmentLabels(patient.requiredDepartmentKeys || [patient.requiredDepartmentKey || fallbackDepartmentKey]),
        transportSignalProbability: Number(patient.transportSignalProbability) || 0,
        requiresDoctorAccompaniment: acuity === "reanimation" || Boolean(patient.requiresDoctorAccompaniment),
        needsFW: Boolean(patient.needsFW),
        needsPOL: Boolean(patient.needsPOL),
        recommendedVehicles: normalizeRequiredVehicles(patient.recommendedVehicles || []),
        conditionReport: patient.conditionReport || patient.patientCondition || patient.report || "",
        noTransportProbability: refOnly ? 1 : clampProbability(patient.noTransportProbability),
        noTransportText: patient.noTransportText || (refOnly ? "Ambulante Versorgung durch REF ausreichend, kein Transport." : "Ambulante Versorgung ausreichend, kein Transport."),
        transportNeeded: refOnly ? false : patient.transportNeeded !== false,
        assignedVehicles: []
      };
    });
  }
  const count = Math.max(1, Number(call.patientCount) || 1);
  const baseRequired = normalizeRequiredVehicles(call.required?.length ? call.required : ["RTW"]);
  const baseAcuity = normalizePatientAcuity(call.acuity || (call.type === "scheduled" ? "planned-transport" : "stable"));
  const effectiveBaseRequired = baseAcuity === "reanimation" ? ["RTW", "NEF"] : baseRequired;
  const baseRefOnly = baseAcuity !== "reanimation" && baseRequired.length > 0 && baseRequired.every((type) => type === "REF");
  return Array.from({ length: count }, (_, index) => ({
    id: `pat-${index + 1}`,
    label: `Pat ${index + 1}`,
    required: index === 0 ? [...effectiveBaseRequired] : ["RTW"],
    acuity: baseAcuity,
    reanimationCase: false,
    requiredDepartmentKey: fallbackDepartmentKey,
    requiredDepartmentKeys: [fallbackDepartmentKey],
    requiredDepartment: departmentLabels([fallbackDepartmentKey]),
    needsFW: false,
    needsPOL: false,
    requiresDoctorAccompaniment: baseAcuity === "reanimation",
    conditionReport: "",
    recommendedVehicles: normalizeRequiredVehicles(call.recommendedVehicles || []),
    noTransportProbability: baseRefOnly ? 1 : 0,
    noTransportText: baseRefOnly ? "Ambulante Versorgung durch REF ausreichend, kein Transport." : "Ambulante Versorgung ausreichend, kein Transport.",
    transportNeeded: baseRefOnly ? false : callTransportNeeded(call),
    assignedVehicles: []
  }));
}

function normalizePatientAcuity(value) {
  const text = String(value || "").toLowerCase();
  if (["planned", "planned-transport", "planbar", "ktp"].includes(text)) return "planned-transport";
  if (["potential-critical", "potentially-critical", "potentiell kritisch", "potenziell kritisch"].includes(text)) return "potential-critical";
  if (["critical", "kritisch"].includes(text)) return "critical";
  if (["reanimation", "cpr", "rea"].includes(text)) return "reanimation";
  return "stable";
}

function callTransportNeeded(call) {
  if (Object.prototype.hasOwnProperty.call(call || {}, "transportNeeded")) return call.transportNeeded !== false;
  return call?.type !== "scheduled";
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

function applyElrdRequirement(required, call, patients = []) {
  const normalized = normalizeRequiredVehicles(required);
  const needsElrd = !call?.noElrd && (patients || []).filter(Boolean).length >= 2;
  if (needsElrd && !normalized.includes("ELRD")) normalized.push("ELRD");
  return normalized;
}

function normalizeRequiredVehicles(required = []) {
  return (required || []).filter(Boolean).map((type) => {
    const normalized = String(type).trim().toUpperCase();
    if (normalized === "HVO" || normalized === "HVO/FR") return "HVO";
    return normalized === "VEF" || normalized === "RTH" ? "NEF" : normalized;
  });
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
