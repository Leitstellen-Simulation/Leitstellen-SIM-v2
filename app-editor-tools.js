function sendVehicleHome(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 1) return;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  cancelVehicleRoute(vehicle);
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  logRadio(`${vehicle.name}: Leitstellenstatus H, Rückfahrt zur Wache.`, "radio");
  driveVehicleTo(vehicle, station, { signal: false, phase: "station" }, () => returnToStation(vehicle.id));
}

function abortVehicleMission(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 3) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  cancelVehicleRoute(vehicle);
  vehicle.status = 1;
  vehicle.statusText = "frei nach Einsatzabbruch";
  if (incident) {
    incident.assigned = incident.assigned.filter((id) => id !== vehicle.id);
    incident.status = incident.assigned.length ? "in Bearbeitung" : "offen";
  }
  logRadio(`${vehicle.name}: Leitstellenstatus E, Einsatzabbruch bestätigt.`, "warn");
  renderAll();
}

function openCoverageDialog() {
  renderCoverageDialog();
  showDialog(el.coverageDialog);
}

function renderCoverageDialog() {
  const available = state.vehicles.filter((vehicle) => [1, 2].includes(vehicle.status) && !vehicle.nextIncidentId);
  el.coverageList.innerHTML = "";
  if (!available.length) {
    el.coverageList.className = "coverage-list empty-state";
    el.coverageList.textContent = "Keine freien Fahrzeuge für Gebietsabsicherung verfügbar.";
    return;
  }
  el.coverageList.className = "coverage-list";
  state.coveragePoints.forEach((point) => {
    const row = document.createElement("article");
    row.className = "coverage-row";
    const nearest = available
      .map((vehicle) => ({ vehicle, distance: mapDistance(vehicle.lat, vehicle.lng, point.lat, point.lng) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(point.label)}</h3>
        <p>${nearest.length ? `Vorschlag: ${escapeHtml(nearest[0].vehicle.name)} (${nearest[0].distance.toFixed(1).replace(".", ",")} km)` : "kein freies Fahrzeug"}</p>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    nearest.forEach(({ vehicle }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = vehicle.name;
      button.addEventListener("click", () => sendVehicleToCoverage(vehicle.id, point.id));
      actions.append(button);
    });
    row.append(actions);
    el.coverageList.append(row);
  });
}

function sendVehicleToCoverage(vehicleId, pointId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const point = state.coveragePoints.find((item) => item.id === pointId);
  if (!vehicle || !point || ![1, 2].includes(vehicle.status)) return;
  if (vehicle.status === 2) vehicle.status = 1;
  vehicle.statusText = `Gebietsabsicherung ${point.label}`;
  vehicle.coveragePointId = point.id;
  logRadio(`${vehicle.name}: Gebietsabsicherung ${point.label}.`, "radio");
  renderAll();
  driveVehicleTo(vehicle, point, { signal: false, phase: "coverage" }, () => arriveAtCoverage(vehicle.id, point.id));
  renderCoverageDialog();
}

function startCoveragePinSelection(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || ![1, 2].includes(vehicle.status) || vehicle.nextIncidentId) return;
  state.pendingCoverageVehicleId = vehicle.id;
  state.selectedVehicleId = vehicle.id;
  logRadio(`${vehicle.name}: Gebietsabsicherung gewaehlt, Ziel-Pin auf der Karte setzen.`, "radio");
  renderVehicles();
}

function sendVehicleToCoveragePin(vehicleId, latlng) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || ![1, 2].includes(vehicle.status) || !latlng) return;
  const point = {
    id: `cov-pin-${makeId()}`,
    label: "gesetzter Pin",
    lat: latlng.lat,
    lng: latlng.lng
  };
  state.pendingCoverageVehicleId = null;
  vehicle.coveragePointId = point.id;
  vehicle.coveragePoint = point;

  const startCoverageRun = () => {
    if (vehicle.coveragePointId !== point.id) return;
    vehicle.status = 3;
    vehicle.statusText = `Gebietsabsicherung ${point.label}`;
    triggerRadioStatus(vehicle, 5, "Status 3, Gebietsabsicherung.");
    renderAll();
    driveVehicleTo(vehicle, point, { signal: false, phase: "coverage" }, () => arriveAtCoverage(vehicle.id, point.id));
  };

  if (vehicle.status === 2) {
    const delay = turnoutDelayMinutes(vehicle);
    vehicle.statusText = `Gebietsabsicherung alarmiert, rueckt in ca. ${delay} min aus`;
    logRadio(`${vehicle.name}: Gebietsabsicherung, Ausruecken in ca. ${delay} Minute(n).`, "radio");
    renderAll();
    vehicle.dispatchTimer = scheduleTimeout(() => {
      vehicle.dispatchTimer = null;
      startCoverageRun();
    }, simulationDelay(delay));
    return;
  }

  startCoverageRun();
}

function arriveAtCoverage(vehicleId, pointId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const point = state.coveragePoints.find((item) => item.id === pointId) || vehicle?.coveragePoint;
  if (!vehicle || !point) return;
  logRadio(`${vehicle.name}: Status 5, Gebietsabsicherung erreicht.`, "radio");
  vehicle.status = 1;
  vehicle.statusText = `steht zur Gebietsabsicherung: ${point.label}`;
  vehicle.lat = point.lat;
  vehicle.lng = point.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  logRadio(`${vehicle.name}: Gebietsabsicherung ${point.label} erreicht.`, "radio");
  renderAll();
}

function openEditor() {
  if (!state.serverAvailable) {
    logRadio("Karteneditor ist ohne Hintergrundserver nicht verfügbar.", "admin");
    return;
  }
  window.location.href = "editor.html";
  return;
  el.editorMapName.value = state.center.name;
  state.editingMapPointId = null;
  el.addMapPointButton.textContent = "Punkt hinzufügen";
  updateEditorVehicleControls();
  fillEditorFromMapCenter();
  renderEditorPoints();
  renderSavedMaps();
  showDialog(el.editorDialog);
}

function openIncidentEditor() {
  if (!state.serverAvailable) {
    logRadio("Einsatzeditor ist ohne Hintergrundserver nicht verfügbar.", "admin");
    return;
  }
  window.location.href = "incident-editor.html";
}

function fillEditorFromMapCenter() {
  const center = state.mapReady ? state.map.getCenter() : { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1] };
  el.editorLat.value = center.lat.toFixed(6);
  el.editorLng.value = center.lng.toFixed(6);
}

function addEditorPoint() {
  const type = el.editorType.value;
  const label = el.editorName.value.trim();
  const lat = Number(el.editorLat.value.replace(",", "."));
  const lng = Number(el.editorLng.value.replace(",", "."));
  if (!label || Number.isNaN(lat) || Number.isNaN(lng)) return;

  const vehicles = editorVehicleCounts();
  if (state.editingMapPointId) {
    updateEditorPoint(state.editingMapPointId, { label, lat, lng, type, vehicles });
    return;
  }

  const point = { id: makeId(), label, lat, lng, type, vehicles };
  state.editorPoints.push(point);
  if (type === "station") {
    const station = { id: point.id, label, address: "eigener Kartenpunkt", lat, lng, vehicles };
    state.center.stations.push(station);
    addStationVehicles(station);
  } else {
    state.center.hospitals.push({ id: point.id, label, lat, lng });
  }

  el.editorName.value = "";
  renderEditorPoints();
  renderAll();
}

function editorVehicleCounts() {
  if (el.editorType.value !== "station") return {};
  return {
    RTW: Math.max(0, Number(el.editorRtw.value) || 0),
    KTW: Math.max(0, Number(el.editorKtw.value) || 0),
    NEF: Math.max(0, Number(el.editorNef.value) || 0),
    REF: Math.max(0, Number(el.editorRef.value) || 0),
    RTH: Math.max(0, Number(el.editorRth.value) || 0)
  };
}

function updateEditorVehicleControls() {
  const disabled = el.editorType.value !== "station";
  [el.editorRtw, el.editorKtw, el.editorNef, el.editorRef, el.editorRth].forEach((input) => {
    input.disabled = disabled;
  });
}

function updateEditorPoint(pointId, data) {
  const oldStationIndex = state.center.stations.findIndex((station) => station.id === pointId);
  const oldHospitalIndex = state.center.hospitals.findIndex((hospital) => hospital.id === pointId);
  if (oldStationIndex >= 0) state.center.stations.splice(oldStationIndex, 1);
  if (oldHospitalIndex >= 0) state.center.hospitals.splice(oldHospitalIndex, 1);

  if (data.type === "station") {
    const station = {
      id: pointId,
      label: data.label,
      address: "eigener Kartenpunkt",
      lat: data.lat,
      lng: data.lng,
      vehicles: data.vehicles
    };
    state.center.stations.push(station);
    syncStationVehicles(station);
  } else {
    state.center.hospitals.push({ id: pointId, label: data.label, address: "eigener Kartenpunkt", lat: data.lat, lng: data.lng });
    state.vehicles = state.vehicles.filter((vehicle) => vehicle.stationId !== pointId || vehicle.incidentId || vehicle.nextIncidentId);
  }

  state.editingMapPointId = null;
  el.addMapPointButton.textContent = "Punkt hinzufügen";
  el.editorName.value = "";
  renderEditorPoints();
  renderAll();
}

function createBlankMap() {
  const center = state.mapReady ? state.map.getCenter() : { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1] };
  const name = el.editorMapName.value.trim() || "Neue Karte";
  state.center = {
    name,
    weather: state.center.weather,
    mapCenter: [center.lat, center.lng],
    zoom: state.mapReady ? state.map.getZoom() : 13,
    stations: [],
    hospitals: []
  };
  ensureHospitalDepartments(state.center);
  state.vehicles = [];
  state.incidents = [];
  state.pendingCall = null;
  state.selectedIncidentId = null;
  state.editorPoints = [];
  state.editingMapPointId = null;
  el.activeCenter.textContent = state.center.name;
  clearLogs();
  logCall("Neue leere Karte angelegt.", "call");
  logRadio("Keine Fahrzeuge vorhanden. Bitte Wachen im Editor hinzufügen.", "warn");
  renderEditorPoints();
  renderAll();
  repairMapSize();
}

function saveCurrentMap() {
  const name = el.editorMapName.value.trim() || state.center.name;
  const saved = readSavedMaps().filter((map) => map.id !== state.center.id && map.name !== name);
  const mapData = {
    id: state.center.id || makeId(),
    name,
    weather: state.center.weather,
    mapCenter: state.mapReady ? [state.map.getCenter().lat, state.map.getCenter().lng] : state.center.mapCenter,
    zoom: state.mapReady ? state.map.getZoom() : state.center.zoom,
    stations: state.center.stations,
    hospitals: state.center.hospitals
  };
  state.center = structuredClone(mapData);
  ensureHospitalDepartments(state.center);
  saved.push(mapData);
  localStorage.setItem("dispatchsim.maps", JSON.stringify(saved));
  el.activeCenter.textContent = state.center.name;
  renderSavedMaps();
  logCall(`Karte gespeichert: ${name}.`, "call");
}

function readSavedMaps() {
  try {
    return JSON.parse(localStorage.getItem("dispatchsim.maps") || "[]");
  } catch {
    return [];
  }
}

function renderSavedMaps() {
  const maps = readSavedMaps();
  el.savedMapList.innerHTML = "";
  if (!maps.length) {
    el.savedMapList.className = "editor-point-list empty-state";
    el.savedMapList.textContent = "Noch keine gespeicherten Karten.";
    return;
  }

  el.savedMapList.className = "editor-point-list";
  maps.forEach((mapData) => {
    const row = document.createElement("article");
    row.className = "editor-point";
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(mapData.name)}</h3>
        <p>${mapData.stations.length} Wachen | ${mapData.hospitals.length} Kliniken</p>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Laden";
    loadButton.addEventListener("click", () => loadSavedMap(mapData.id));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Löschen";
    deleteButton.addEventListener("click", () => deleteSavedMap(mapData.id));
    actions.append(loadButton, deleteButton);
    row.append(actions);
    el.savedMapList.append(row);
  });
}

function loadSavedMap(mapId) {
  const mapData = readSavedMaps().find((item) => item.id === mapId);
  if (!mapData) return;
  state.center = structuredClone(mapData);
  state.vehicles = seedVehicles(state.center);
  state.incidents = [];
  state.pendingCall = null;
  state.selectedIncidentId = null;
  state.editingMapPointId = null;
  state.editorPoints = mapData.stations.concat(mapData.hospitals).map((point) => ({
    ...point,
    type: state.center.stations.some((station) => station.id === point.id) ? "station" : "hospital"
  }));
  el.editorMapName.value = state.center.name;
  el.activeCenter.textContent = state.center.name;
  if (state.mapReady) state.map.setView(state.center.mapCenter, state.center.zoom);
  renderEditorPoints();
  renderAll();
  logCall(`Karte geladen: ${state.center.name}.`, "call");
}

function deleteSavedMap(mapId) {
  localStorage.setItem("dispatchsim.maps", JSON.stringify(readSavedMaps().filter((item) => item.id !== mapId)));
  renderSavedMaps();
}

function addStationVehicles(station) {
  const stationNumber = state.center.stations.length;
  if (Array.isArray(station.units) && station.units.length) {
    station.units.forEach((unit, index) => {
      const type = unit.type || unit.name?.split(" ")[0]?.toUpperCase() || "RTW";
      const name = unit.fullName || unit.name || `${type} ${stationNumber}/${index + 1}`;
      state.vehicles.push({
        id: `${type}-${stationNumber}-${index + 1}-${makeId()}`,
        name,
        shortName: unit.shortName || unit.short || name,
        shift: unit.shift || "",
        type,
        label: vehicleTypeLabel(type),
        station: station.label,
        stationId: station.id,
        status: 2,
        statusText: "auf Wache",
        lat: station.lat + index * 0.00045,
        lng: station.lng + index * 0.00045,
        target: null,
        incidentId: null,
        radioStatus: null,
        radioMessage: "",
        awaitingSpeechPrompt: false,
        waitingForSpeechPrompt: false,
        pendingTransportRequest: null,
        coveragePointId: null
      });
    });
    return;
  }
  Object.entries(station.vehicles || { RTW: 1 }).forEach(([type, count]) => {
    for (let index = 0; index < count; index += 1) {
      state.vehicles.push({
        id: `${type}-${stationNumber}-${index + 1}-${makeId()}`,
        name: `${type} ${stationNumber}/${index + 1}`,
        shortName: `${type} ${stationNumber}/${index + 1}`,
        shift: "",
        type,
        label: vehicleTypeLabel(type),
        station: station.label,
        stationId: station.id,
        status: 2,
        statusText: "auf Wache",
        lat: station.lat + index * 0.00045,
        lng: station.lng + index * 0.00045,
        target: null,
        incidentId: null,
        radioStatus: null,
        radioMessage: "",
        awaitingSpeechPrompt: false,
        waitingForSpeechPrompt: false,
        pendingTransportRequest: null,
        coveragePointId: null
      });
    }
  });
}

function syncStationVehicles(station) {
  const active = state.vehicles.filter((vehicle) => vehicle.stationId === station.id && (vehicle.incidentId || vehicle.nextIncidentId || vehicle.routeMeta));
  state.vehicles = state.vehicles.filter((vehicle) => vehicle.stationId !== station.id || active.includes(vehicle));
  const stationNumber = state.center.stations.findIndex((item) => item.id === station.id) + 1;
  const activeCounts = active.reduce((counts, vehicle) => {
    counts[vehicle.type] = (counts[vehicle.type] || 0) + 1;
    vehicle.station = station.label;
    return counts;
  }, {});
  Object.entries(station.vehicles || {}).forEach(([type, desired]) => {
    const missing = Math.max(0, desired - (activeCounts[type] || 0));
    for (let index = 0; index < missing; index += 1) {
      state.vehicles.push({
        id: `${type}-${stationNumber}-${index + 1}-${makeId()}`,
        name: `${type} ${stationNumber}/${index + 1}`,
        shortName: `${type} ${stationNumber}/${index + 1}`,
        shift: "",
        type,
        label: vehicleTypeLabel(type),
        station: station.label,
        stationId: station.id,
        status: 2,
        statusText: "auf Wache",
        lat: station.lat + index * 0.00045,
        lng: station.lng + index * 0.00045,
        target: null,
        incidentId: null,
        radioStatus: null,
        radioMessage: "",
        awaitingSpeechPrompt: false,
        waitingForSpeechPrompt: false,
        pendingTransportRequest: null,
        coveragePointId: null
      });
    }
  });
}

function renderEditorPoints() {
  el.editorPointList.innerHTML = "";
  const points = [
    ...state.center.stations.map((point) => ({ ...point, type: "station" })),
    ...state.center.hospitals.map((point) => ({ ...point, type: "hospital" }))
  ];
  if (!points.length) {
    el.editorPointList.className = "editor-point-list empty-state";
    el.editorPointList.textContent = "Noch keine eigenen Punkte.";
    return;
  }

  el.editorPointList.className = "editor-point-list";
  points.forEach((point) => {
    const row = document.createElement("article");
    row.className = "editor-point";
    const vehicleText = point.type === "station"
      ? ` | ${Object.entries(point.vehicles || {}).filter(([, count]) => count > 0).map(([type, count]) => `${count} ${type}`).join(", ") || "keine Fzg"}`
      : "";
    row.innerHTML = `
      <div>
        <h3>${escapeHtml(point.label)}</h3>
        <p>${point.type === "station" ? "Rettungswache" : "Klinik"} | ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${escapeHtml(vehicleText)}</p>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const showButton = document.createElement("button");
    showButton.type = "button";
    showButton.textContent = "Anzeigen";
    showButton.addEventListener("click", () => {
      if (state.mapReady) state.map.setView([point.lat, point.lng], 15);
    });
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten";
    editButton.addEventListener("click", () => editMapPoint(point));
    actions.append(showButton, editButton);
    row.append(actions);
    el.editorPointList.append(row);
  });
}

function editMapPoint(point) {
  state.editingMapPointId = point.id;
  el.editorType.value = point.type;
  el.editorName.value = point.label;
  el.editorLat.value = point.lat.toFixed(6);
  el.editorLng.value = point.lng.toFixed(6);
  el.editorRtw.value = point.vehicles?.RTW || 0;
  el.editorKtw.value = point.vehicles?.KTW || 0;
  el.editorNef.value = point.vehicles?.NEF || 0;
  el.editorRef.value = point.vehicles?.REF || 0;
  el.editorRth.value = point.vehicles?.RTH || 0;
  el.addMapPointButton.textContent = "Punkt speichern";
  updateEditorVehicleControls();
}
