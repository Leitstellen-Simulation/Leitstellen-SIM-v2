function renderAll() {
  renderClock();
  renderMap();
  renderIncidents();
  renderVehicles();
  renderRadioAlerts();
  renderAdminStatusBar();
}

function renderRadioAlerts() {
  if (!el.radioAlerts) return;
  const alerts = state.vehicles.filter((vehicle) => vehicle.radioStatus === 5 || vehicle.radioStatus === 0 || vehicle.radioStatus === 6);
  el.radioAlerts.innerHTML = "";
  alerts.forEach((vehicle) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `radio-alert radio-alert-${vehicle.radioStatus}`;
    button.textContent = `${vehicle.radioStatus} - ${vehicle.shortName || vehicle.name}`;
    button.title = vehicle.radioStatus === 6
      ? `Status 6 ${vehicle.name} quittieren`
      : `Status ${vehicle.radioStatus} ${vehicle.radioStatus === 0 ? "dringenden Sprechwunsch" : "Sprechwunsch"} ${vehicle.name} annehmen`;
    button.addEventListener("click", () => sendSpeechPrompt(vehicle.id));
    el.radioAlerts.append(button);
  });
}

function renderClock() {
  const displayMinute = Math.floor(state.minute);
  const hours = String(Math.floor(displayMinute / 60)).padStart(2, "0");
  const minutes = String(displayMinute % 60).padStart(2, "0");
  el.clockLabel.textContent = `${hours}:${minutes}`;
}

function updateShiftStates() {
  let changed = false;
  state.vehicles.forEach((vehicle) => {
    const inShift = vehicleInShift(vehicle);
    const canShiftChange = vehicleCanShiftChangeAtStation(vehicle);
    const shouldWarn = !inShift && vehicle.status !== 6 && !canShiftChange;
    if (vehicle.shiftWarning !== shouldWarn) {
      vehicle.shiftWarning = shouldWarn;
      changed = true;
    }
    if (!inShift && canShiftChange) {
      vehicle.status = 6;
      vehicle.radioContext = "shift-end";
      vehicle.radioStatus = 6;
      vehicle.radioMessage = `Schichtende: ${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} ausser Dienst`;
      logRadio(`${vehicle.name}: Status 6 - Schichtende, Vorhaltende an ${vehicle.station}.`, "radio");
      vehicle.statusText = "außer Dienst";
      changed = true;
    }
    if (inShift && vehicle.status === 6 && !vehicle.status6Reason && !vehicle.foreign) {
      vehicle.status = 2;
      vehicle.radioStatus = 5;
      vehicle.radioContext = "shift-start";
      vehicle.radioMessage = `${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} einsatzklar`;
      logRadio(`${vehicle.name}: Status 5 - Sprechwunsch zur Indienstmeldung.`, "radio");
      vehicle.statusText = "auf Wache";
      changed = true;
    }
  });
  if (changed) {
    renderVehicles();
    renderRadioAlerts();
  }
}

function vehicleInShift(vehicle) {
  return vehicleShiftIntervals(vehicle).some((interval) => interval.active);
}

function vehicleCanShiftChangeAtStation(vehicle) {
  if (!vehicle || vehicle.status !== 2 || vehicle.nextIncidentId || vehicle.coverageDispatch) return false;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (!station) return true;
  if (String(vehicle.statusText || "").toLowerCase().includes("wache")) return true;
  return mapDistance(vehicle.lat, vehicle.lng, station.lat, station.lng) < .75;
}

function vehicleShiftIntervals(vehicle) {
  if (!vehicle.shift || vehicle.shift.toLowerCase() === "24h") {
    return [{ label: "24h", active: true, endingSoon: false, expired: false, valid: true }];
  }
  return vehicle.shift.split(/[,;]/)
    .map((interval) => shiftIntervalState(interval.trim()))
    .filter(Boolean);
}

function shiftIntervalState(interval) {
  const match = interval.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?$/);
  if (!match) return { label: interval, active: true, valid: false };
  const start = shiftTimeToMinute(match[1], match[2]);
  const end = shiftTimeToMinute(match[3], match[4]);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { label: interval, active: true, valid: false };
  const now = Math.floor(state.minute) % 1440;
  const active = start === end
    ? true
    : start < end
      ? now >= start && now < end
      : now >= start || now < end;
  const minutesUntilEnd = active ? shiftMinutesUntilEnd(now, end) : null;
  return {
    label: normalizedShiftLabel(match[1], match[2], match[3], match[4]),
    active,
    endingSoon: active && minutesUntilEnd !== null && minutesUntilEnd <= 30,
    expired: !active && shiftAlreadyEndedToday(now, start, end),
    minutesSinceEnd: !active && shiftAlreadyEndedToday(now, start, end) ? shiftMinutesSinceEnd(now, end) : null,
    valid: true
  };
}

function shiftMinutesUntilEnd(now, end) {
  return (end - now + 1440) % 1440;
}

function shiftAlreadyEndedToday(now, start, end) {
  if (start === end) return false;
  if (start < end) return now >= end;
  return now >= end && now < start;
}

function shiftMinutesSinceEnd(now, end) {
  return (now - end + 1440) % 1440;
}

function shiftTimeToMinute(hourText, minuteText = "0") {
  const hour = Number(hourText);
  const minute = Number(minuteText || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return NaN;
  if (hour === 24 && minute !== 0) return NaN;
  return hour === 24 ? 1440 : hour * 60 + minute;
}

function normalizedShiftLabel(startHour, startMinute, endHour, endMinute) {
  return `${shiftTimeLabel(startHour, startMinute)}-${shiftTimeLabel(endHour, endMinute)}`;
}

function shiftTimeLabel(hourText, minuteText = "0") {
  const hour = Number(hourText);
  const minute = Number(minuteText || 0);
  return minute ? `${hour}:${String(minute).padStart(2, "0")}` : String(hour);
}

function renderMap() {
  if (!state.mapReady) return;
  clearMapLayers();
  const markerSlots = new Map();

  state.center.stations.forEach((station) => {
    const vehicleSummary = Object.entries(station.vehicles || {})
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");
    const availableCount = stationAvailableVehicles(station).length;
    const foreignStation = isForeignMapPoint(station);
    const stationType = `${availableCount ? "station station-available" : "station station-empty"}${foreignStation ? " foreign-map-point" : ""}`;
    const stationLabel = foreignStation ? "FRW" : station.vehicles?.RTH && !station.vehicles?.RTW && !station.vehicles?.KTW ? "RTH"
      : station.vehicles?.NEF && !station.vehicles?.RTW && !station.vehicles?.KTW ? "NEF"
        : "RW";
    const availabilityText = availableCount ? `${availableCount} Fahrzeug(e) an der Wache` : "keine Fahrzeuge an der Wache";
    const stationKind = foreignStation ? "Fremdwache" : "Rettungswache";
    const position = stackedMapPosition(offsetStationPosition(station), markerSlots);
    const marker = addMapMarker("stations", position.lat, position.lng, stationLabel, stationType, `<strong>${escapeHtml(station.label)}</strong><br>${escapeHtml(stationKind)}<br>${escapeHtml(station.address)}<br>${escapeHtml(vehicleSummary)}<br>${escapeHtml(availabilityText)}`);
    marker.bindPopup(stationPopupContent(station), { autoClose: true, closeOnClick: true, closeButton: true });
  });
  state.center.hospitals.forEach((hospital) => {
    const foreignHospital = isForeignMapPoint(hospital);
    const position = stackedMapPosition(hospital, markerSlots);
    addMapMarker("hospitals", position.lat, position.lng, foreignHospital ? "FKH" : "KH", `hospital${foreignHospital ? " foreign-map-point" : ""}`, `<strong>${escapeHtml(hospital.label)}</strong><br>${foreignHospital ? "Fremdkrankenhaus<br>" : ""}${escapeHtml(hospital.address)}`);
  });
  state.incidents.filter((incident) => incident.status !== "geschlossen").forEach((incident) => {
    const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
    const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
    const position = stackedMapPosition({ lat, lng }, markerSlots);
    const attention = incidentHasRadioAttention(incident) ? " attention" : "";
    const marker = addMapMarker("incidents", position.lat, position.lng, "!", `incident${attention}`, `${incident.keyword}<br>${incident.location || "Regensburg"}`);
    marker.on("click", () => {
      selectIncidentFromMapOrList(incident);
      renderAll();
    });
  });
  renderCoveragePins();
  state.vehicles.filter((vehicle) => vehicleVisibleOnMap(vehicle)).forEach((vehicle) => {
    const routeIncidentId = vehicle.incidentId || vehicle.nextIncidentId;
    if (vehicle.route?.length && routeIncidentId === state.selectedIncidentId) {
      const line = L.polyline(vehicle.route, {
        color: "#1d5f9f",
        weight: 3,
        opacity: .65
      }).addTo(state.map);
      state.layers.routes.push(line);
    }

    const icon = L.divIcon({
      className: "",
      html: `<span class="vehicle-marker vehicle-${vehicle.type} ${vehicle.status > 2 ? "busy" : ""} ${vehicle.routeMeta?.signal ? "signal" : ""} ${vehicle.radioStatus ? "radio-attention" : ""}"><span class="vehicle-marker-text"><strong>${escapeHtml(vehicle.type)}</strong><small>${escapeHtml(vehicle.shortName || vehicle.name)}</small></span><em class="vehicle-marker-status status-${vehicle.status}">${vehicle.status}</em></span>`,
      iconSize: [72, 34],
      iconAnchor: [36, 17]
    });
    const position = stackedMapPosition(vehicle, markerSlots);
    const marker = L.marker([position.lat, position.lng], { icon })
      .bindPopup(vehiclePopupContent(vehicle))
      .addTo(state.map);
    marker.on("click", (event) => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      state.selectedVehicleId = vehicle.id;
      renderVehicles();
    });
    if (vehicle.id === state.selectedVehicleId) {
      window.setTimeout(() => marker.openPopup(), 0);
    }
    state.layers.vehicles.push(marker);
  });
}

function stackedMapPosition(point, markerSlots) {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !state.map?.project) return { lat, lng };
  const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
  const index = markerSlots.get(key) || 0;
  markerSlots.set(key, index + 1);
  if (!index) return { lat, lng };
  const direction = index % 2 ? -1 : 1;
  const step = Math.ceil(index / 2);
  const horizontalStep = Math.floor((step - 1) / 4);
  const pixelOffset = L.point(horizontalStep * 38, direction * (38 + (step - 1) % 4 * 38));
  const projected = state.map.project(L.latLng(lat, lng), state.map.getZoom()).add(pixelOffset);
  const shifted = state.map.unproject(projected, state.map.getZoom());
  return { lat: shifted.lat, lng: shifted.lng };
}

function offsetStationPosition(station) {
  const overlapsHospital = state.center.hospitals.some((hospital) => mapDistance(station.lat, station.lng, hospital.lat, hospital.lng) < .08);
  if (!overlapsHospital) return { lat: station.lat, lng: station.lng };
  return { lat: station.lat + .0012, lng: station.lng - .0012 };
}

function isForeignMapPoint(point) {
  return Boolean(point?.foreign || point?.foreignStation || point?.outsideCoverage || point?.external);
}

function stationAvailableVehicles(station) {
  return state.vehicles.filter((vehicle) => vehicle.stationId === station.id && vehicle.status === 2 && !vehicle.nextIncidentId);
}

function vehicleVisibleOnMap(vehicle) {
  return Boolean(vehicle.coveragePoint || vehicle.routeMeta || vehicle.route?.length || [3, 7].includes(vehicle.status));
}

function incidentHasRadioAttention(incident) {
  if (incident.assigned?.length && incident.assigned.every((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    return vehicle && [7, 8, 1, 2, 6].includes(vehicle.status);
  })) return false;
  return incident.assigned.some((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    return vehicle?.radioStatus === 5 || vehicle?.radioStatus === 0;
  }) || activeTransportRequests(incident).length > 0 || missingVehicleTypesAtScene(incident).length > 0 || missingExternalServices(incident, "dispatch").length > 0;
}

function missingVehicleTypesAtScene(incident) {
  const assigned = incident.assigned
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((vehicle) => vehicle && vehicle.status === 4);
  const used = new Set();
  return (incident.required || []).filter((requiredType) => {
    const match = assigned.find((vehicle) => !used.has(vehicle.id) && vehicleSatisfiesRequirement(vehicle.type, requiredType));
    if (!match) return true;
    used.add(match.id);
    return false;
  });
}

function incidentHasVehicleStatus(incident, status) {
  return incident.assigned.some((id) => state.vehicles.find((vehicle) => vehicle.id === id)?.status === status);
}

function stationPopupContent(station) {
  const wrapper = document.createElement("div");
  wrapper.className = "map-popup-actions";
  const title = document.createElement("strong");
  title.textContent = station.label;
  wrapper.append(title);
  const vehicles = state.vehicles.filter((vehicle) => vehicle.stationId === station.id && vehicle.status !== 6);
  if (!vehicles.length) {
    appendTextBlock(wrapper, "p", "Keine aktiven Fahrzeuge.");
    return wrapper;
  }
  vehicles.forEach((vehicle) => {
    appendTextBlock(wrapper, "p", `${vehicle.name}: Status ${vehicle.status} - ${vehicle.statusText}`);
  });
  return wrapper;
}

function vehiclePopupContent(vehicle) {
  const wrapper = document.createElement("div");
  wrapper.className = "map-popup-actions";
  const title = document.createElement("strong");
  title.textContent = vehicle.name;
  wrapper.append(title);
  appendTextBlock(wrapper, "p", `Status ${vehicle.status}: ${vehicle.statusText}`);
  if (vehicle.radioStatus) addPopupButton(wrapper, `Status ${vehicle.radioStatus} annehmen`, () => sendSpeechPrompt(vehicle.id));
  if ([1, 2].includes(vehicle.status) && !vehicle.nextIncidentId) addPopupButton(wrapper, "Gebietsabsicherung", () => startCoveragePinSelection(vehicle.id));
  if (vehicle.status === 1) addPopupButton(wrapper, "Status H", () => sendVehicleHome(vehicle.id));
  if (vehicle.status === 3) {
    addPopupButton(wrapper, "Status E", () => abortVehicleMission(vehicle.id));
    addPopupButton(wrapper, vehicle.routeMeta?.signal ? "ohne Sondersignal weiter" : "mit Sondersignal weiter", () => toggleVehicleSignal(vehicle.id));
  }
  if (vehicle.status === 4 && vehicle.type === "RTW") {
    const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
    const patient = incident ? patientForVehicle(vehicle, incident) : null;
    if (patient?.awaitingKtwHandover && !patient.rtwMustTransport) {
      addPopupButton(wrapper, "selbst transportieren", () => forceRtwTransport(vehicle.id));
    }
  }
  if ((vehicle.status === 2 || vehicle.status === 8) && vehicle.nextIncidentId) {
    addPopupButton(wrapper, "mit Sondersignal zum Auftrag", () => toggleVehicleSignal(vehicle.id));
  }
  if (vehicle.status === 7) addPopupButton(wrapper, "Zielortwechsel", () => changeTransportDestination(vehicle.id));
  if (vehicle.supportGroupId) addPopupButton(wrapper, "UGRD einruecken", () => recallSupportGroupVehicle(vehicle.id));
  if (canAskAccompanyingDoctorRelease(vehicle)) addPopupButton(wrapper, "Abkömmlich?", () => askAccompanyingDoctorRelease(vehicle.id));
  if (canReleaseAccompanyingDoctor(vehicle)) addPopupButton(wrapper, "abkömmlich freimelden", () => releaseAccompanyingDoctor(vehicle.id));
  if (vehicle.status === 8) addPopupButton(wrapper, "einsatzklar?", () => askVehicleReadiness(vehicle.id));
  return wrapper;
}

function forceRtwTransport(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === vehicle?.incidentId);
  const patient = incident ? patientForVehicle(vehicle, incident) : null;
  if (!vehicle || !incident || !patient) return;
  patient.rtwMustTransport = true;
  patient.awaitingKtwHandover = false;
  incident.ktwHandoverDecision = null;
  logRadio(`${vehicle.name}: RTW übernimmt den Transport.`, "radio");
  scheduleTreatmentCompletion(vehicle, incident);
  renderAll();
}

function canReleaseAccompanyingDoctor(vehicle) {
  return ["NEF", "RTH"].includes(vehicle.type) && vehicle.status === 7 && vehicle.accompanyingActive === false && /abkömmlich|abkoemmlich/i.test(vehicle.statusText || "");
}

function canAskAccompanyingDoctorRelease(vehicle) {
  return ["NEF", "RTH"].includes(vehicle.type) && vehicle.status === 7 && vehicle.boundTransportVehicleId && vehicle.accompanyingActive !== false;
}

function askAccompanyingDoctorRelease(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || !canAskAccompanyingDoctorRelease(vehicle)) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const patient = incident ? patientForVehicle(vehicle, incident) : null;
  const canRelease = !patient?.requiresDoctorAccompaniment && Math.random() < 0.25;
  if (canRelease) {
    vehicle.accompanyingActive = false;
    vehicle.statusText = vehicle.statusText.replace(/begleitet aktiv/i, "begleitet abkoemmlich");
    logRadio(`${vehicle.name}: Status 5 - Notarzt abkoemmlich, Freimeldung moeglich.`, "radio");
    releaseAccompanyingDoctor(vehicle.id);
    return;
  }
  logRadio(`${vehicle.name}: Status 5 - Notarzt derzeit nicht abkoemmlich.`, "radio");
  vehicle.statusText = "Notarztbegleitung weiter gebunden";
  renderAll();
}

function releaseAccompanyingDoctor(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || !canReleaseAccompanyingDoctor(vehicle)) return;
  const transport = state.vehicles.find((unit) => unit.id === vehicle.boundTransportVehicleId);
  if (transport?.boundDoctorVehicleId === vehicle.id) transport.boundDoctorVehicleId = null;
  cancelVehicleRoute(vehicle);
  vehicle.status = 1;
  vehicle.statusText = "abkömmlich freigemeldet";
  vehicle.incidentId = null;
  vehicle.patientId = null;
  vehicle.accompanyingActive = false;
  vehicle.boundTransportVehicleId = null;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  logRadio(`${vehicle.name}: Status 1, Notarzt abkömmlich freigemeldet.`, "radio");
  renderAll();
}

function addPopupButton(parent, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", handler);
  parent.append(button);
}

function toggleVehicleSignal(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  if (vehicle.routeMeta) {
    const oldSignal = vehicle.routeMeta.signal;
    vehicle.routeMeta.signal = !vehicle.routeMeta.signal;
    rescaleVehicleRouteForSignal(vehicle, oldSignal, vehicle.routeMeta.signal);
    logRadio(`${vehicle.name}: Fahrt ${vehicle.routeMeta.signal ? "mit" : "ohne"} Sondersignal fortgesetzt.`, "radio");
  } else {
    vehicle.dispatchSignal = !vehicle.dispatchSignal;
    logRadio(`${vehicle.name}: Anfahrt ${vehicle.dispatchSignal ? "mit" : "ohne"} Sondersignal vorgemerkt.`, "radio");
  }
  renderAll();
}

function rescaleVehicleRouteForSignal(vehicle, oldSignal, newSignal) {
  if (!vehicle.routeMeta || oldSignal === newSignal || vehicle.type === "RTH") return;
  const oldDuration = routeTravelDurationMs(vehicle, vehicle.routeMeta, oldSignal);
  const newDuration = routeTravelDurationMs(vehicle, vehicle.routeMeta, newSignal);
  if (!oldDuration || !newDuration || oldDuration === newDuration) return;
  const now = Date.now();
  const remaining = Math.max(0, vehicle.routeMeta.endAt - now) * (newDuration / oldDuration);
  vehicle.routeMeta.endAt = now + remaining;
  if (vehicle.routeTimer) {
    clearTimeout(vehicle.routeTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.routeTimer);
  }
  if (vehicle.routeArrivalHandler) vehicle.routeTimer = scheduleTimeout(vehicle.routeArrivalHandler, remaining);
}

function changeTransportDestination(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === vehicle?.incidentId);
  if (!vehicle || !incident || vehicle.status !== 7) return;
  cancelVehicleRoute(vehicle);
  vehicle.status = 4;
  vehicle.statusText = "wartet auf neues Transportziel";
  holdBoundDoctorForDestinationChange(vehicle, incident);
  incident.status = "wartet auf Zielklinik";
  incident.transportRequest = {
    id: makeId(),
    vehicleId: vehicle.id,
    report: incident.patient?.report || "Zielortwechsel angefordert.",
    requiredDepartment: incident.patient?.requiredDepartment || "Notaufnahme",
    patientId: vehicle.patientId || patientForVehicle(vehicle, incident)?.id || null
  };
  incident.transportRequests = [incident.transportRequest];
  state.selectedIncidentId = incident.id;
  logRadio(`${vehicle.name}: Zielortwechsel angefordert.`, "warn");
  renderAll();
}

function addMapMarker(group, lat, lng, label, type, popup) {
  const icon = L.divIcon({
    className: "",
    html: `<span class="map-marker ${type}">${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
  const marker = L.marker([lat, lng], { icon }).bindPopup(popup).addTo(state.map);
  state.layers[group].push(marker);
  return marker;
}

function clearMapLayers() {
  Object.values(state.layers).flat().forEach((layer) => layer.remove());
  state.layers = {
    stations: [],
    hospitals: [],
    incidents: [],
    vehicles: [],
    routes: [],
    coverage: []
  };
}

function renderCoveragePins() {
  state.vehicles
    .filter((vehicle) => vehicle.coveragePoint && Number.isFinite(vehicle.coveragePoint.lat) && Number.isFinite(vehicle.coveragePoint.lng))
    .forEach((vehicle) => {
      addMapMarker(
        "coverage",
        vehicle.coveragePoint.lat,
        vehicle.coveragePoint.lng,
        "G",
        "coverage",
        `<strong>Gebietsabsicherung</strong><br>${escapeHtml(vehicle.shortName || vehicle.name)}`
      );
    });
}

function renderIncidents() {
  const active = state.incidents.filter((incident) => incident.status !== "geschlossen");
  el.incidentCount.textContent = `${active.length} offen`;
  renderIncidentTabCounts(active);
  const visible = active
    .filter((incident) => incidentListBucket(incident) === state.incidentFilter)
    .sort((a, b) => (b.createdAtMinute ?? 0) - (a.createdAtMinute ?? 0));

  if (!visible.length) {
    el.incidentList.className = "incident-list empty-state";
    el.incidentList.textContent = "Keine offenen Einsätze.";
    return;
  }

  el.incidentList.className = "incident-list";
  el.incidentList.innerHTML = "";
  renderIncidentsCollapsible(visible);
  return;
  visible.forEach((incident) => {
    const card = document.createElement("article");
    card.className = `incident-card ${incident.id === state.selectedIncidentId ? "active" : ""}`;
    appendTextBlock(card, "h3", incident.keyword);
    appendTextBlock(card, "p", incident.location || "Regensburg");
    appendTextBlock(card, "p", `Status: ${incident.status}${incident.signal ? " | Sondersignal" : ""}`);
    appendTextBlock(card, "p", `Fahrzeuge: ${incident.assigned.length ? incident.assigned.map(unitName).join(", ") : "noch keine"}`);
    if (incident.patient && incidentHasVehicleStatus(incident, 4)) {
      appendTextBlock(card, "p", `Patienten: ${incident.patient.patientCount || 1} | ${incident.patient.status}, ${incident.patient.requiredDepartment}`);
      if (incident.patient.report) appendTextBlock(card, "p", `Rückmeldung: ${incident.patient.report}`);
      if (incident.patient.outcome) appendTextBlock(card, "p", `Ergebnis: ${incident.patient.outcome}`);
    }
    pendingDispatchVehicles(incident).forEach((vehicle) => {
      appendTextBlock(card, "p", `${vehicle.name} meldet: noch ca. ${remainingDispatchMinutes(vehicle)} min bis Ausrücken.`);
      const replacementButton = document.createElement("button");
      replacementButton.type = "button";
      replacementButton.textContent = `anderes Auto statt ${vehicle.name}`;
      replacementButton.addEventListener("click", (event) => {
        event.stopPropagation();
        releasePendingVehicle(vehicle.id, incident.id);
      });
      card.append(replacementButton);
    });
    if (incident.note) appendTextBlock(card, "p", `Bemerkung: ${incident.note}`);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten / nachalarmieren";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openIncidentDialog(incident);
    });
    card.append(editButton);

    const handoffBox = document.createElement("div");
    handoffBox.className = "handoff-actions";
    [
      ["FW", "an FW"],
      ["POL", "an POL"],
      ["AEND", "an ÄND"]
    ].forEach(([service, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handoffIncident(incident.id, service);
      });
      handoffBox.append(button);
    });
    card.append(handoffBox);

    const summaryTransportRequests = activeTransportRequests(incident);
    summaryTransportRequests.forEach((request) => {
      const transportBox = document.createElement("div");
      transportBox.className = "transport-choice";
      appendTransportRequestHeader(transportBox, incident, request);
      appendForeignHospitalToggle(transportBox, incident, request);
      appendHospitalChoices(transportBox, incident, request);
      ["Tod festgestellt", "Keine Indikation RD", "Transport verweigert"].forEach((reason) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = reason;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          finishWithoutTransport(incident.id, reason);
        });
        transportBox.append(button);
      });
      card.append(transportBox);
    });

    card.addEventListener("click", () => {
      selectIncidentFromMapOrList(incident);
      const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
      const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
      if (state.mapReady) state.map.setView([lat, lng], 15);
      renderIncidents();
    });

    nearestAvailableVehicles(incident).forEach((vehicle) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${vehicle.name} alarmieren`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        assignVehicle(vehicle.id, incident.id);
      });
      card.append(button);
    });
    el.incidentList.append(card);
  });
}

function selectIncidentFromMapOrList(incident) {
  state.selectedIncidentId = incident.id;
  state.incidentFilter = incidentListBucket(incident);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === state.incidentFilter);
  });
}

function incidentListBucket(incident) {
  if (incident.signal || incident.type === "emergency") return "emergency";
  if (incident.type === "scheduled") return "scheduled";
  return "transport";
}

function renderIncidentTabCounts(active) {
  const labels = { emergency: "Notfall", transport: "Transport", scheduled: "Planbar" };
  const stats = Object.fromEntries(Object.keys(labels).map((key) => [key, { total: 0, attention: 0 }]));
  active.forEach((incident) => {
    const bucket = incidentListBucket(incident);
    if (!stats[bucket]) return;
    stats[bucket].total += 1;
    if (incidentNeedsDispositionAttention(incident)) stats[bucket].attention += 1;
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    const key = tab.dataset.filter;
    const count = stats[key] || { total: 0, attention: 0 };
    const alertClass = key === "emergency" ? "danger" : "warn";
    tab.innerHTML = `
      <span>${escapeHtml(labels[key] || key)}</span>
      <span class="tab-metric${count.attention ? " has-alert" : ""}">
        <span class="tab-total">${count.total}</span>
        ${count.attention ? `<span class="tab-alert ${alertClass}">${count.attention}</span>` : ""}
      </span>
    `;
  });
}

function incidentNeedsDispositionAttention(incident) {
  if (!incident.assigned?.length) return true;
  if (incident.assistanceDecision?.missing?.length) return true;
  return /^Nachforderung/i.test(incident.status || "");
}

function incidentNeedsSlowAlert(incident) {
  return incident.signal && !incident.assigned?.length && incident.status !== "geschlossen";
}

function nearestAvailableVehicles(incident) {
  return state.vehicles
    .filter((vehicle) => !vehicle.foreign && isAlarmable(vehicle))
    .sort((a, b) => distanceToIncident(a, incident) - distanceToIncident(b, incident))
    .slice(0, 4);
}

function renderIncidentsCollapsible(visible) {
  visible.forEach((incident) => {
    const isOpen = incident.id === state.selectedIncidentId;
    const card = document.createElement("article");
    card.className = `incident-card ${isOpen ? "active" : ""} ${incidentHasRadioAttention(incident) ? "attention" : ""} ${incidentNeedsSlowAlert(incident) ? "slow-alert" : ""}`;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "incident-summary";
    summary.innerHTML = `
      <span>
        <strong>${escapeHtml(incident.keyword)}</strong>
        <small>${escapeHtml(incident.location || "Regensburg")}</small>
      </span>
      <span class="incident-state">${incidentStartTimeLabel(incident)} | ${incidentElapsedLabel(incident)} | ${escapeHtml(incident.status)}</span>
    `;
    summary.addEventListener("click", () => {
      if (isOpen) state.selectedIncidentId = null;
      else selectIncidentFromMapOrList(incident);
      const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
      const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
      if (!isOpen && state.mapReady) state.map.setView([lat, lng], 15);
      renderAll();
    });
    card.append(summary);
    if (!isOpen) {
      el.incidentList.append(card);
      return;
    }

    const details = document.createElement("div");
    details.className = "incident-details";
    details.append(renderIncidentVehicleStatus(incident));
    const destinationInfo = renderIncidentDestinationInfo(incident);
    if (destinationInfo) details.append(destinationInfo);
    if (incident.patient && incidentHasVehicleStatus(incident, 4)) {
      if (incident.patient.report) details.append(renderIncidentReport(incident.patient.report));
      if (incident.patient.outcome) appendTextBlock(details, "p", `Ergebnis: ${incident.patient.outcome}`);
      details.append(renderPatientAssignments(incident));
    }
    pendingDispatchVehicles(incident).forEach((vehicle) => {
      appendTextBlock(details, "p", `${vehicle.name} meldet: noch ca. ${remainingDispatchMinutes(vehicle)} min bis Ausrücken.`);
      const replacementButton = document.createElement("button");
      replacementButton.type = "button";
      replacementButton.textContent = `anderes Auto statt ${vehicle.name}`;
      replacementButton.addEventListener("click", (event) => {
        event.stopPropagation();
        releasePendingVehicle(vehicle.id, incident.id);
      });
      details.append(replacementButton);
    });
    if (incident.note) appendTextBlock(details, "p", `Bemerkung: ${incident.note}`);

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten / nachalarmieren";
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openIncidentDialog(incident);
    });
    details.append(editButton);

    const handoffBox = document.createElement("div");
    handoffBox.className = "handoff-actions";
    [
      ["FW", "an FW"],
      ["POL", "an POL"],
      ["AEND", "an ÄND"]
    ].forEach(([service, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        handoffIncident(incident.id, service);
      });
      handoffBox.append(button);
    });
    handoffBox.hidden = true;
    details.append(renderServiceSupport(incident));
    if (incident.assistanceDecision) details.append(renderAssistanceDecision(incident));
    if (incident.ktwHandoverDecision) details.append(renderKtwHandoverDecision(incident));
    if (incident.elrdWaitDecision) details.append(renderElrdWaitDecision(incident));

    activeTransportRequests(incident).forEach((request) => {
      const transportBox = document.createElement("div");
      transportBox.className = "transport-choice";
      appendTransportRequestHeader(transportBox, incident, request);
      appendForeignHospitalToggle(transportBox, incident, request);
      appendHospitalChoices(transportBox, incident, request);
      details.append(transportBox);
    });

    card.append(details);
    el.incidentList.append(card);
  });
}

function renderIncidentReport(text) {
  const box = document.createElement("section");
  box.className = "incident-report-card";
  box.innerHTML = `<strong>Rückmeldung</strong><p>${escapeHtml(text)}</p>`;
  return box;
}

function incidentElapsedLabel(incident) {
  const createdAt = Number.isFinite(incident.createdAtAbsoluteMinute)
    ? incident.createdAtAbsoluteMinute
    : (state.absoluteMinute - ((state.minute - (incident.createdAtMinute ?? state.minute) + 1440) % 1440));
  const elapsed = Math.max(0, Math.floor(state.absoluteMinute - createdAt));
  return `${elapsed} min`;
}

function renderIncidentDestinationInfo(incident) {
  const destination = incidentDestinationPoint(incident);
  if (!destination) return null;
  const box = document.createElement("div");
  box.className = "incident-target-info";
  const distance = mapDistance(incident.lat, incident.lng, destination.lat, destination.lng);
  const status = incidentDestinationTravelStatus(incident, destination);
  box.innerHTML = `
    <strong>Ziel:</strong> ${escapeHtml(destination.label || destination.address || "Zielort")}
    <span> | ${distance.toFixed(1).replace(".", ",")} km Luftlinie${incidentDestinationTravelMarkup(status)}</span>
  `;
  requestIncidentDestinationTravelTime(incident, destination);
  return box;
}

function incidentDestinationPoint(incident) {
  if (!incident?.patient) return null;
  if (incident.patient.fixedDestination && Number.isFinite(incident.patient.fixedDestination.lat) && Number.isFinite(incident.patient.fixedDestination.lng)) {
    return incident.patient.fixedDestination;
  }
  if (incident.patient.fixedDestinationId) {
    return state.center.hospitals.find((hospital) => hospital.id === incident.patient.fixedDestinationId) || null;
  }
  return null;
}

function incidentDestinationTravelStatus(incident, destination) {
  state.incidentDestinationTravelTimes ||= new Map();
  state.incidentDestinationTravelRequests ||= new Set();
  const key = incidentDestinationTravelKey(incident, destination);
  if (state.incidentDestinationTravelTimes.has(key)) return state.incidentDestinationTravelTimes.get(key);
  if (state.incidentDestinationTravelRequests.has(key)) return { state: "loading" };
  return { state: "idle" };
}

function incidentDestinationTravelMarkup(status) {
  if (status?.state === "ready") {
    const minutes = Math.max(1, Math.round(status.durationMs / 60000));
    const source = status.source === "fallback" ? "Fallback" : status.source === "air" ? "direkt" : "Route";
    return ` | ca. ${minutes} min Fahrt (${source})`;
  }
  if (status?.state === "loading") return " | Fahrzeit...";
  return "";
}

function incidentDestinationTravelKey(incident, destination) {
  return [
    incident.id,
    Number(incident.lat).toFixed(5),
    Number(incident.lng).toFixed(5),
    Number(destination.lat).toFixed(5),
    Number(destination.lng).toFixed(5)
  ].join("|");
}

async function requestIncidentDestinationTravelTime(incident, destination) {
  state.incidentDestinationTravelTimes ||= new Map();
  state.incidentDestinationTravelRequests ||= new Set();
  const key = incidentDestinationTravelKey(incident, destination);
  if (state.incidentDestinationTravelTimes.has(key) || state.incidentDestinationTravelRequests.has(key)) return;
  state.incidentDestinationTravelRequests.add(key);
  try {
    const route = await buildRoute({ type: "KTW", lat: incident.lat, lng: incident.lng }, destination);
    state.incidentDestinationTravelTimes.set(key, {
      state: "ready",
      durationMs: Math.max(1, route.baseDurationMs || 0),
      source: route.source
    });
  } catch {
    state.incidentDestinationTravelTimes.set(key, { state: "error" });
  } finally {
    state.incidentDestinationTravelRequests.delete(key);
  }
  if (state.selectedIncidentId === incident.id) renderIncidents();
}

function incidentStartTimeLabel(incident) {
  const minute = Math.floor(Number.isFinite(incident.createdAtMinute) ? incident.createdAtMinute : state.minute) % 1440;
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return hours + ":" + minutes;
}

function renderAssistanceDecision(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  const missing = incident.assistanceDecision?.missing || [];
  appendTextBlock(wrapper, "strong", `Nachforderung: ${missing.join(", ")}`);
  const patientRows = assistanceDecisionPatients(incident, missing);
  if (missing.includes("ELRD") && patientRows.length) {
    appendAssistanceButtons(wrapper, incident, ["ELRD"]);
  }
  if (patientRows.length) {
    patientRows.forEach(({ patient, missing: patientMissing }) => {
      const group = document.createElement("div");
      group.className = "assistance-patient-decision";
      appendTextBlock(group, "span", `${patient.label || "Patient"}: fehlt ${patientMissing.join(", ")}`);
      appendAssistanceButtons(group, incident, patientMissing, patient.id);
      wrapper.append(group);
    });
  } else {
    appendAssistanceButtons(wrapper, incident, missing);
  }
  return wrapper;
}

function assistanceDecisionPatients(incident, decisionMissing = []) {
  const patients = incident.patient?.patients || [];
  if (patients.length <= 1) return [];
  const decisionTypes = new Set(decisionMissing);
  return patients
    .filter((patient) => !patient.completed && !patient.transporting)
    .map((patient) => ({
      patient,
      missing: patientMissingTypes(patient).filter((type) => decisionTypes.has(type))
    }))
    .filter((entry) => entry.missing.length);
}

function appendAssistanceButtons(parent, incident, missing, patientId = null) {
  if (missing.includes("ELRD")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "ELRD nachalarmieren";
    button.addEventListener("click", () => openIncidentDialog(incident));
    parent.append(button);
  }
  if (missing.includes("NEF") || missing.includes("RTH")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = patientId
      ? "Für diesen Patienten nachfragen: Transport ohne Notarzt möglich?"
      : "Nachfragen: Transport ohne Notarzt möglich?";
    button.addEventListener("click", () => applyAssistanceAlternative(incident.id, "without-doctor", patientId));
    parent.append(button);
  }
  if (missing.includes("RTW")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = patientId
      ? "Für diesen Patienten nachfragen: Transport mit KTW statt RTW möglich?"
      : "Nachfragen: Transport mit KTW statt RTW möglich?";
    button.addEventListener("click", () => applyAssistanceAlternative(incident.id, "without-rtw", patientId));
    parent.append(button);
  }
  if (incident.assistanceDecision?.vehicleType === "KTW" && missing.includes("RTW") && (missing.includes("NEF") || missing.includes("RTH"))) {
    const nefKtw = document.createElement("button");
    nefKtw.type = "button";
    nefKtw.textContent = patientId
      ? "Für diesen Patienten nachfragen: Notarzt + KTW ausreichend?"
      : "Nachfragen: Notarzt + KTW ausreichend?";
    nefKtw.addEventListener("click", () => applyAssistanceAlternative(incident.id, "nef-ktw", patientId));
    parent.append(nefKtw);
    const rtwOnly = document.createElement("button");
    rtwOnly.type = "button";
    rtwOnly.textContent = patientId
      ? "Für diesen Patienten nachfragen: RTW alleine ausreichend?"
      : "Nachfragen: RTW alleine ausreichend?";
    rtwOnly.addEventListener("click", () => applyAssistanceAlternative(incident.id, "rtw-only", patientId));
    parent.append(rtwOnly);
  }
}

function renderKtwHandoverDecision(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  appendTextBlock(wrapper, "strong", "KTW-Patient: KTW zeitnah verfügbar?");
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "Ja, KTW nachfordern";
  yes.addEventListener("click", () => answerKtwHandover(incident.id, true));
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "Nein, RTW transportiert";
  no.addEventListener("click", () => answerKtwHandover(incident.id, false));
  wrapper.append(yes, no);
  return wrapper;
}

function renderElrdWaitDecision(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  const request = incident.elrdWaitDecision || {};
  const patientLabel = request.patientLabel || "Patient";
  appendTextBlock(wrapper, "strong", `${patientLabel}: auf ELRD vor Transportziel warten?`);
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "Ja, auf ELRD warten";
  yes.addEventListener("click", () => answerElrdWait(incident.id, true));
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "Nein, Transportziel abfragen";
  no.addEventListener("click", () => answerElrdWait(incident.id, false));
  wrapper.append(yes, no);
  return wrapper;
}

function answerElrdWait(incidentId, shouldWait) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const request = incident?.elrdWaitDecision;
  if (!incident || !request) return;
  const vehicle = state.vehicles.find((unit) => unit.id === request.vehicleId);
  const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
  incident.elrdWaitDecision = null;
  if (!vehicle || !patient) return;
  if (shouldWait) {
    patient.waitForElrdBeforeTransport = true;
    patient.elrdWaitBypassed = false;
    vehicle.statusText = `${patient.label} transportbereit, wartet auf ELRD`;
    maybeRequestAdditionalResources(vehicle, incident);
    logRadio(`${vehicle.name}: Wartet mit Transportzielabfrage auf ELRD.`, "radio");
    scheduleTreatmentCompletion(vehicle, incident);
    openIncidentDialog(incident);
  } else {
    patient.waitForElrdBeforeTransport = false;
    patient.elrdWaitBypassed = true;
    logRadio(`${vehicle.name}: ELRD wird nicht abgewartet, Transportzielabfrage folgt.`, "radio");
    requestTransportDestination(vehicle, incident);
  }
  renderAll();
}

function answerKtwHandover(incidentId, available) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const request = incident?.ktwHandoverDecision;
  if (!incident || !request) return;
  const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
  const rtw = state.vehicles.find((vehicle) => vehicle.id === request.vehicleId);
  incident.ktwHandoverDecision = null;
  if (!patient || !rtw) return;
  if (!available) {
    patient.rtwMustTransport = true;
    patient.awaitingKtwHandover = false;
    logRadio(`${rtw.name}: Kein KTW zeitnah verfügbar, RTW übernimmt Transport.`, "radio");
    scheduleTreatmentCompletion(rtw, incident);
    renderAll();
    return;
  }
  patient.awaitingKtwHandover = true;
  patient.rtwMustTransport = false;
  patient.supportCapReachedAt = state.minute;
  patient.supportCapValue = Math.min(patientTreatmentProgress(patient, incident), 0.95);
  logRadio(`${rtw.name}: KTW soll nachgeführt werden, Versorgung bis Übergabe.`, "radio");
  openIncidentDialog(incident);
  scheduleTreatmentCompletion(rtw, incident);
  renderAll();
}

function nearestAvailableVehicleOfType(incident, type) {
  return state.vehicles
    .filter((vehicle) => vehicle.type === type && isAlarmable(vehicle))
    .sort((a, b) => distanceToIncident(a, incident) - distanceToIncident(b, incident))[0] || null;
}

function applyAssistanceAlternative(incidentId, mode, patientId = null) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident?.assistanceDecision) return;
  const patient = patientId ? (incident.patient?.patients || []).find((item) => item.id === patientId) : null;
  const chance = mode === "rtw-only" ? .25 : .5;
  const accepted = Math.random() < chance;
  if (!accepted) {
    logRadio(`Rückfrage ${incident.keyword}: nicht möglich, Nachforderung bleibt bestehen.`, "warn");
    renderAll();
    return;
  }
  if (patient) {
    if (mode === "without-doctor" || mode === "rtw-only") removeRequirementFromPatient(patient, ["NEF", "RTH"]);
    if (mode === "without-rtw" || mode === "nef-ktw") replaceRequirementForPatient(patient, "RTW", "KTW");
  } else {
    if (mode === "without-doctor" || mode === "rtw-only") removeRequirementFromIncident(incident, ["NEF", "RTH"]);
    if (mode === "without-rtw" || mode === "nef-ktw") replaceRequirementInIncident(incident, "RTW", "KTW");
  }
  incident.patient.forceTransportSignal = true;
  incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
  const remainingMissing = [
    ...missingVehicleTypesForDispatch(incident),
    ...missingExternalServices(incident, "dispatch")
  ];
  if (patient && remainingMissing.length) {
    incident.assistanceDecision = {
      ...incident.assistanceDecision,
      missing: remainingMissing,
      createdAtMinute: state.minute
    };
    incident.assistanceRequested = true;
    incident.status = "Nachforderung";
  } else {
    incident.assistanceDecision = null;
    incident.assistanceRequested = false;
    incident.status = missingVehicleTypes(incident).length ? "in Bearbeitung" : "vor Ort";
  }
  resetTreatmentCapsAfterRequirementChange(incident);
  const patientText = patient ? ` für ${patient.label || "Patient"}` : "";
  logRadio(`Rückfrage ${incident.keyword}${patientText}: Alternative akzeptiert, Transport später mit Sondersignal.`, "radio");
  rescheduleSceneTreatment(incident);
  renderAll();
}

function removeRequirementFromPatient(patient, types) {
  patient.required = (patient.required || []).filter((type) => !types.includes(type));
}

function removeRequirementFromIncident(incident, types) {
  (incident.patient?.patients || []).forEach((patient) => {
    removeRequirementFromPatient(patient, types);
  });
  incident.required = (incident.required || []).filter((type) => !types.includes(type));
}

function replaceRequirementForPatient(patient, fromType, toType) {
  patient.required = replaceRequirement(patient.required || [], fromType, toType);
}

function replaceRequirementInIncident(incident, fromType, toType) {
  (incident.patient?.patients || []).forEach((patient) => {
    replaceRequirementForPatient(patient, fromType, toType);
  });
  incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], replaceRequirement(incident.required || [], fromType, toType));
}

function replaceRequirement(required, fromType, toType) {
  const replaced = required.map((type) => type === fromType ? toType : type);
  return replaced.length ? replaced : [toType];
}

function resetTreatmentCapsAfterRequirementChange(incident) {
  (incident.patient?.patients || []).forEach((patient) => {
    const currentProgress = patientTreatmentProgress(patient, incident);
    if (patient.supportCapReachedAt) patient.supportCapReachedAt = state.minute;
    patient.supportCapValue = currentProgress;
    (patient.assignedVehicles || [])
      .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
      .filter(Boolean)
      .forEach((vehicle) => {
        vehicle.supportOnly = !(patient.required || []).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
      });
  });
}

function rescheduleSceneTreatment(incident) {
  (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4)
    .forEach((vehicle) => scheduleTreatmentCompletion(vehicle, incident));
}

function renderIncidentVehicleStatus(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "incident-vehicle-status";
  const title = document.createElement("strong");
  title.textContent = "Alarmierte Fahrzeuge";
  wrapper.append(title);
  const vehicles = incident.assigned
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  if (!vehicles.length) {
    const empty = document.createElement("span");
    empty.textContent = "noch keine";
    wrapper.append(empty);
    return wrapper;
  }
  vehicles.forEach((vehicle) => {
    const line = document.createElement("span");
    line.className = "incident-vehicle-chip";
    line.innerHTML = `<b>${escapeHtml(vehicle.shortName || vehicle.name)}</b><em class="status-pill status-${vehicle.status}">${vehicle.status}</em><small>${escapeHtml(vehicle.statusText)}${vehicle.radioStatus ? ` | ${vehicle.radioStatus === 0 ? "dringender Sprechwunsch" : "Sprechwunsch"} ${vehicle.radioStatus}` : ""}</small>`;
    wrapper.append(line);
  });
  return wrapper;
}

function renderPatientAssignments(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "patient-assignment-list";
  const patients = incident.patient?.patients || [];
  if (!patients.length) return wrapper;
  const progress = treatmentProgress(incident);
  const progressBox = document.createElement("div");
  progressBox.className = "treatment-progress";
  const remaining = remainingIncidentTreatmentMinutes(incident);
  progressBox.innerHTML = `<span>Behandlung${remaining > 0 ? `, ca. ${remaining} min` : ""}</span><strong>${Math.round(progress * 100)}%</strong><i><b style="width:${Math.round(progress * 100)}%"></b></i>`;
  wrapper.append(progressBox);
  const table = document.createElement("table");
  table.className = "patient-table";
  table.innerHTML = "<thead><tr><th>Patient</th><th>Versorgung</th><th>Bedarf</th><th>Klinik</th></tr></thead>";
  const body = document.createElement("tbody");
  patients.forEach((patient) => {
    const row = document.createElement("tr");
    const units = patient.completed
      ? "abgeschlossen"
      : patient.transporting
        ? `Transport mit ${unitName(patient.transportVehicleId)}`
        : (patient.assignedVehicles || []).map(unitName).join(", ") || "noch unversorgt";
    const need = (patient.required || []).join(" + ") || "ambulant";
    const progress = Math.round(patientTreatmentProgress(patient, incident) * 100);
    const condition = typeof patientConditionPercent === "function"
      ? Math.round(patientConditionPercent(patient, incident) * 100)
      : null;
    const reanimation = patient.acuity === "reanimation" && Number.isFinite(patient.reanimationSurvivalChance)
      ? ` | Rea ${Math.round(patient.reanimationSurvivalChance * 100)}%`
      : "";
    const conditionText = condition === null ? "" : ` | Zustand ${condition}%${reanimation}`;
    row.innerHTML = `<td>${escapeHtml(patient.label)}</td><td>${escapeHtml(units)}${escapeHtml(conditionText)}<div class="mini-progress"><b style="width:${progress}%"></b></div></td><td>${escapeHtml(need)}</td><td>${escapeHtml(patient.requiredDepartment)}</td>`;
    body.append(row);
  });
  table.append(body);
  wrapper.append(table);
  return wrapper;
}

function activeTransportRequests(incident) {
  const requests = incident.transportRequests?.length ? incident.transportRequests : (incident.transportRequest ? [incident.transportRequest] : []);
  return requests.filter((request) => {
    const vehicle = state.vehicles.find((unit) => unit.id === request.vehicleId);
    const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId) || patientForVehicle(vehicle, incident);
    return vehicle?.status === 4
      && (!patient || patientReadyForTransport(patient, incident))
      && (!patient || vehicleCanTransportPatient(vehicle, patient));
  });
}

function appendTransportRequestHeader(parent, incident, request = incident.transportRequest) {
  const patient = (incident.patient?.patients || []).find((item) => item.id === request?.patientId);
  const department = request?.requiredDepartment || patient?.requiredDepartment || "Fachrichtung nach Rückmeldung";
  const header = document.createElement("div");
  header.className = "transport-choice-head";
  header.innerHTML = `
    <strong>Transportziel${patient ? ` für ${escapeHtml(patient.label)}` : ""}</strong>
    <span>Benötige Krankenhaus-Zuweisung mit Fachrichtung: ${escapeHtml(department)}</span>
  `;
  parent.append(header);
  if (request?.report) parent.append(renderIncidentReport(request.report));
}

function appendForeignHospitalToggle(parent, incident, request = incident.transportRequest) {
  const foreignCount = nearestHospitals(incident, request, { includeForeign: true }).filter((hospital) => hospital.foreign).length;
  if (!foreignCount) return;
  const toggle = document.createElement("label");
  toggle.className = "foreign-hospital-toggle";
  toggle.addEventListener("click", (event) => event.stopPropagation());
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(state.showForeignHospitalsInTransport);
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", (event) => {
    event.stopPropagation();
    state.showForeignHospitalsInTransport = input.checked;
    renderAll();
  });
  toggle.append(input, document.createTextNode(` Fremd-KH zusaetzlich anzeigen (${foreignCount})`));
  parent.append(toggle);
}

function appendHospitalChoices(parent, incident, request = incident.transportRequest) {
  transportHospitalChoices(incident, request).forEach((hospital) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${hospital.suitable ? "hospital-choice suitable" : "hospital-choice unsuitable"}${hospital.foreign ? " foreign-hospital" : ""}`;
    button.textContent = `${hospital.foreign ? "Fremd-KH: " : ""}${hospital.label} (${hospital.distance.toFixed(1).replace(".", ",")} km)`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handleHospitalChoice(incident, hospital, request);
    });
    parent.append(button);
  });
}

function handleHospitalChoice(incident, hospital, request = incident.transportRequest) {
  if (shouldOfferRthForLongTransport(incident, hospital, request)) {
    const ok = window.confirm(`Transportziel ${hospital.label} liegt mehr als 30 km entfernt. RTH fuer Transport nachfordern und Krankenhausauswahl pausieren?`);
    if (ok) {
      requestRthForLongTransport(incident, hospital, request);
      return;
    }
  }
  beginTransport(incident.id, hospital.id, request.vehicleId, request.id);
}

function shouldOfferRthForLongTransport(incident, hospital, request = incident.transportRequest) {
  if (!incident || !hospital || !request || hospital.distance <= 30 || request.rthPrompted) return false;
  const vehicle = state.vehicles.find((unit) => unit.id === request.vehicleId);
  const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId) || patientForVehicle(vehicle, incident);
  if (!patient?.required?.some(isDoctorRequirement)) return false;
  return Boolean(findAvailableRthForLongTransport(incident));
}

function requestRthForLongTransport(incident, hospital, request = incident.transportRequest) {
  const rth = findAvailableRthForLongTransport(incident);
  if (!rth) {
    window.alert("Kein freier RTH verfuegbar.");
    beginTransport(incident.id, hospital.id, request.vehicleId, request.id);
    return;
  }
  request.rthPrompted = true;
  request.rthRequestedForHospitalId = hospital.id;
  incident.transportRequest = request;
  incident.status = "wartet auf RTH fuer Transport";
  logRadio(`RTH fuer langen Transport nach ${hospital.label} nachgefordert. Krankenhausauswahl bleibt offen.`, "warn");
  assignVehicle(rth.id, incident.id);
  renderAll();
}

function findAvailableRthForLongTransport(incident) {
  return state.vehicles
    .filter((vehicle) => vehicle.type === "RTH" && !vehicle.foreign && isAlarmable(vehicle) && !vehicle.nextIncidentId)
    .sort((a, b) => mapDistance(a.lat, a.lng, incident.lat, incident.lng) - mapDistance(b.lat, b.lng, incident.lat, incident.lng))[0] || null;
}

function transportHospitalChoices(incident, request = incident.transportRequest) {
  const localHospitals = nearestHospitals(incident, request);
  if (!state.showForeignHospitalsInTransport) return localHospitals;
  const used = new Set(localHospitals.map((hospital) => hospital.id));
  const foreignHospitals = nearestHospitals(incident, request, { includeForeign: true })
    .filter((hospital) => hospital.foreign && !used.has(hospital.id));
  return [...localHospitals, ...foreignHospitals];
}

function treatmentProgress(incident) {
  const patients = incident.patient?.patients || [];
  if (patients.length) {
    const values = patients.map((patient) => patientTreatmentProgress(patient, incident));
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (!incident.patient?.treatmentStartedAt) return 0;
  const elapsed = Math.max(0, state.minute - incident.patient.treatmentStartedAt);
  return Math.min(1, elapsed / treatmentMinutes(incident));
}

function patientTreatmentProgress(patient, incident) {
  if (patient.completed || patient.transporting) return 1;
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4);
  if (!assigned.length) return 0;
  const { cap, support } = currentTreatmentCap(patient, incident, assigned);
  const supportCapReachedAt = patient.supportCapReachedAt;
  const supportCapValue = patient.supportCapValue ?? 0.8;
  let startedAt = patient.treatmentStartedAt ?? incident.patient?.treatmentStartedAt ?? state.minute;
  let baseProgress = 0;
  if (supportCapReachedAt) {
    baseProgress = supportCapValue;
    if (cap > supportCapValue) {
      if (patient.treatmentResumedFromCap !== supportCapValue) {
        patient.treatmentResumedAt = state.minute;
        patient.treatmentResumedFromCap = supportCapValue;
      }
      startedAt = patient.treatmentResumedAt ?? state.minute;
    } else {
      startedAt = supportCapReachedAt;
    }
  }
  patient.treatmentStartedAt ??= startedAt;
  const elapsed = Math.max(0, state.minute - startedAt);
  const progress = Math.min(cap, baseProgress + elapsed / patientTreatmentMinutes(patient, incident));
  if (support && progress >= cap) {
    patient.supportCapReachedAt = patient.supportCapValue === cap && patient.supportCapReachedAt
      ? patient.supportCapReachedAt
      : state.minute;
    patient.supportCapValue = cap;
    patient.treatmentResumedAt = null;
    patient.treatmentResumedFromCap = null;
  }
  return progress;
}

function currentTreatmentCap(patient, incident, assignedVehicles = null) {
  const assigned = assignedVehicles || (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4);
  if (patient.awaitingKtwHandover && !patient.rtwMustTransport && !assigned.some((vehicle) => vehicle.type === "KTW")) {
    return { cap: 0.95, support: true };
  }
  const missing = patientMissingTypes(patient);
  if (!missing.length) return { cap: 1, support: false };
  const hasDoctorSupport = assigned.some((vehicle) => ["NEF", "RTH"].includes(vehicle.type));
  const hasRthSupport = assigned.some((vehicle) => vehicle.type === "RTH");
  const hasRefSupport = assigned.some((vehicle) => vehicle.type === "REF");
  const hasElrdSupport = assigned.some((vehicle) => vehicle.type === "ELRD");
  const waitingOnlyForTransport = missing.every((type) => ["RTW", "KTW"].includes(type));
  if (hasRthSupport && waitingOnlyForTransport) return { cap: 1, support: false };
  if (hasDoctorSupport && waitingOnlyForTransport) return { cap: 0.8, support: true };
  if (hasRefSupport) {
    if (missing.some(isDoctorRequirement)) return { cap: 0.5, support: true };
    if (waitingOnlyForTransport) return { cap: 0.8, support: true };
  }
  const hasKtwFirstResponse = assigned.some((vehicle) => vehicle.type === "KTW" && vehicle.supportOnly);
  const hasRequiredTransportUnit = assigned.some((vehicle) => (patient.required || []).some((type) => ["RTW", "KTW"].includes(type) && vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)));
  if (hasKtwFirstResponse && !hasRequiredTransportUnit) {
    if ((patient.required || []).includes("RTW")) return { cap: 0.5, support: true };
  }
  if (hasElrdSupport && !hasRequiredTransportUnit) return { cap: 0.5, support: true };
  return { cap: 0.5, support: true };
}

function remainingIncidentTreatmentMinutes(incident) {
  const patients = incident.patient?.patients || [];
  const remaining = patients
    .filter((patient) => !patient.completed && !patient.transporting)
    .map((patient) => {
      const progress = patientTreatmentProgress(patient, incident);
      const cap = currentTreatmentCap(patient, incident).cap;
      return Math.max(0, Math.ceil(patientTreatmentMinutes(patient, incident) * (Math.min(1, cap) - progress)));
    })
    .filter((value) => value > 0);
  return remaining.length ? Math.max(...remaining) : 0;
}

function patientHasTransportUnitAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && ["RTW", "KTW"].includes(vehicle.type) && vehicle.status === 4);
}

function pendingDispatchVehicles(incident) {
  return incident.assigned
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.nextIncidentId === incident.id && vehicle.status === 8);
}

function remainingDispatchMinutes(vehicle) {
  if (!vehicle.pendingDispatchUntil) return vehicle.pendingDispatchDelay || 0;
  return Math.max(1, Math.ceil((vehicle.pendingDispatchUntil - Date.now()) / 60000 * state.speed));
}

function releasePendingVehicle(vehicleId, incidentId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || vehicle.nextIncidentId !== incident.id) return;
  if (vehicle.dispatchTimer) {
    clearTimeout(vehicle.dispatchTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.dispatchTimer);
  }
  vehicle.dispatchTimer = null;
  vehicle.dispatchHandler = null;
  vehicle.nextIncidentId = null;
  vehicle.incidentId = vehicle.previousIncidentId;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  vehicle.statusText = "am Krankenhaus";
  incident.assigned = incident.assigned.filter((id) => id !== vehicle.id);
  incident.status = incident.assigned.length ? "in Bearbeitung" : "offen";
  vehicle.handoverTimer = scheduleTimeout(() => clearVehicle(vehicle.id), simulationDelay(handoverMinutes()));
  logRadio(`${vehicle.name}: Folgeeinsatz zurückgenommen, bleibt zunächst am Krankenhaus.`, "warn");
  renderAll();
}

function canRemoveAssignedVehicle(vehicle, incident) {
  return vehicle.nextIncidentId === incident.id || (vehicle.incidentId === incident.id && vehicle.status === 3);
}

function detachVehicleFromIncident(vehicleId, incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  incident.assigned = incident.assigned.filter((id) => id !== vehicleId);
  clearTransportRequest(incident, null, vehicleId);
  if (incident.status !== "geschlossen") {
    incident.status = incident.assigned.length ? "in Bearbeitung" : "offen";
  }
}

function removeAssignedVehicle(vehicleId, incidentId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || !canRemoveAssignedVehicle(vehicle, incident)) return;

  releasePatientAssignment(vehicle);
  if (vehicle.dispatchTimer) {
    clearTimeout(vehicle.dispatchTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.dispatchTimer);
  }
  if (vehicle.status === 3) {
    cancelVehicleRoute(vehicle);
    vehicle.status = 1;
    vehicle.statusText = "frei nach Rücknahme";
    vehicle.incidentId = null;
  } else {
    vehicle.statusText = vehicle.status === 8 ? "am Krankenhaus" : statusTextForIdleVehicle(vehicle);
    vehicle.incidentId = vehicle.previousIncidentId || null;
    if (vehicle.status === 8 && !vehicle.handoverTimer) {
      vehicle.handoverTimer = scheduleTimeout(() => clearVehicle(vehicle.id), simulationDelay(handoverMinutes()));
    }
  }
  vehicle.dispatchTimer = null;
  vehicle.dispatchHandler = null;
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  vehicle.pendingTransportRequest = null;
  incident.assigned = incident.assigned.filter((id) => id !== vehicle.id);
  incident.status = incident.assigned.length ? "in Bearbeitung" : "offen";
  clearResolvedAssistanceNeeds(incident);
  logRadio(`${vehicle.name}: vom Einsatz ${incident.keyword} zurückgenommen.`, "warn");
  renderDialogVehicles(incident, incident);
  renderAll();
}

function statusTextForIdleVehicle(vehicle) {
  if (vehicle.status === 1) return "frei über Funk";
  if (vehicle.status === 2) return vehicle.foreign ? "auf Fremdwache verfügbar" : "auf Wache";
  return vehicle.statusText || "frei";
}

function renderDialogVehicles(call, incident = null) {
  el.dialogVehicleList.innerHTML = "";
  const assignedIds = new Set(incident?.assigned || []);
  const unavailableIds = new Set([...assignedIds, ...state.selectedDialogVehicleIds]);
  renderQuickVehicleButtons(call, unavailableIds, incident);
  const foreignToggle = document.createElement("label");
  foreignToggle.className = "foreign-vehicle-toggle";
  const foreignInput = document.createElement("input");
  foreignInput.type = "checkbox";
  foreignInput.checked = Boolean(state.showForeignVehiclesInDialog);
  foreignInput.addEventListener("change", () => {
    state.showForeignVehiclesInDialog = foreignInput.checked;
    renderDialogVehicles(call, incident);
  });
  const foreignAvailableCount = state.vehicles.filter((vehicle) => vehicle.foreign && vehicle.status === 2 && !vehicle.nextIncidentId).length;
  foreignToggle.append(foreignInput, document.createTextNode(` Fremdfahrzeuge anzeigen (${foreignAvailableCount})`));
  el.dialogVehicleList.append(foreignToggle);
  if (assignedIds.size) {
    const assigned = document.createElement("section");
    assigned.className = "assigned-vehicles-note";
    const title = document.createElement("strong");
    title.textContent = "Bereits zugeordnet";
    assigned.append(title);
    [...assignedIds].forEach((id) => {
      const vehicle = state.vehicles.find((unit) => unit.id === id);
      if (!vehicle) return;
      const line = document.createElement("div");
      line.className = "assigned-vehicle-line";
      line.innerHTML = `<span>${escapeHtml(vehicle.name)} | Status ${vehicleDisplayStatus(vehicle)}${vehicle.nextIncidentId === incident.id ? " | alarmiert" : ""}</span>`;
      if (canRemoveAssignedVehicle(vehicle, incident)) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "entfernen";
        button.addEventListener("click", () => removeAssignedVehicle(vehicle.id, incident.id));
        line.append(button);
      }
      assigned.append(line);
    });
    el.dialogVehicleList.append(assigned);
  }
  const vehicles = state.vehicles
    .filter((vehicle) => {
      if (assignedIds.has(vehicle.id)) return false;
      if (vehicle.foreign) return state.showForeignVehiclesInDialog && vehicle.status === 2 && isAlarmable(vehicle);
      return isAlarmable(vehicle) || isPendingStatusC(vehicle);
    })
    .sort((a, b) => {
      const selectedDelta = Number(state.selectedDialogVehicleIds.has(b.id)) - Number(state.selectedDialogVehicleIds.has(a.id));
      return selectedDelta || distanceToCall(a, call) - distanceToCall(b, call);
    });
  const autoTravelTimeIds = new Set([...vehicles].sort((a, b) => distanceToCall(a, call) - distanceToCall(b, call)).slice(0, 3).map((vehicle) => vehicle.id));
  vehicles.forEach((vehicle) => {
      const row = document.createElement("button");
      const shiftNotice = shiftNoticeForVehicle(vehicle);
      const nextShift = nextShiftChangeText(vehicle);
      const distanceText = `${distanceToCall(vehicle, call).toFixed(1).replace(".", ",")} km Luftlinie`;
      const travelTime = dialogTravelTimeStatus(vehicle, call);
      row.type = "button";
      row.className = `dialog-vehicle-row ${vehicle.foreign ? "foreign-vehicle-row" : ""} ${shiftNotice ? `shift-${shiftNotice.type}` : ""} ${state.selectedDialogVehicleIds.has(vehicle.id) ? "selected" : ""}`;
      row.innerHTML = `
        <div>
          <h3><span class="vehicle-type-badge">${escapeHtml(vehicle.type)}</span> ${escapeHtml(vehicle.name)}</h3>
          <p>${escapeHtml(vehicle.station)} | ${escapeHtml(distanceText)} <span class="dialog-travel-time">${travelTimeMarkup(travelTime)}</span> | ${escapeHtml(vehicle.statusText)}</p>
          ${nextShift ? `<small class="dialog-shift-next">${escapeHtml(nextShift)}</small>` : ""}
          ${shiftNotice ? `<small class="dialog-shift-hint">${escapeHtml(shiftNotice.text)}</small>` : ""}
        </div>
        <span class="status-pill status-${vehicleDisplayStatus(vehicle)}">${vehicleDisplayStatus(vehicle)}</span>
      `;
      const travelButton = row.querySelector(".dialog-travel-time-button");
      travelButton?.addEventListener("click", (event) => {
        event.stopPropagation();
        requestDialogTravelTime(vehicle, call, true);
      });
      travelButton?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        requestDialogTravelTime(vehicle, call, true);
      });
      row.addEventListener("click", () => {
        if (state.selectedDialogVehicleIds.has(vehicle.id)) {
          state.selectedDialogVehicleIds.delete(vehicle.id);
          row.classList.remove("selected");
        } else {
          state.selectedDialogVehicleIds.add(vehicle.id);
          row.classList.add("selected");
        }
      });
      el.dialogVehicleList.append(row);
      if (autoTravelTimeIds.has(vehicle.id)) requestDialogTravelTime(vehicle, call);
    });
}

function isPendingStatusC(vehicle) {
  return Boolean(vehicle?.status === 2 && vehicle.nextIncidentId && !vehicle.incidentId);
}

function vehicleDisplayStatus(vehicle) {
  return isPendingStatusC(vehicle) ? "C" : String(vehicle?.status ?? "");
}

function dialogTravelTimeStatus(vehicle, call) {
  const key = dialogTravelTimeKey(vehicle, call);
  if (state.dialogTravelTimes?.has(key)) return state.dialogTravelTimes.get(key);
  if (state.dialogTravelTimeRequests?.has(key)) return { state: "loading" };
  return { state: "idle" };
}

function travelTimeMarkup(status) {
  if (status?.state === "ready") {
    const minutes = Math.max(1, Math.round(status.durationMs / 60000));
    const source = status.source === "fallback" ? "Fallback" : status.source === "air" ? "direkt" : "Route";
    return `&middot; ca. ${minutes} min Fahrt <small>${escapeHtml(source)}</small>`;
  }
  if (status?.state === "loading") return `&middot; Fahrzeit...`;
  return `&middot; <span class="dialog-travel-time-button" role="button" tabindex="0">Fahrzeit</span>`;
}

function dialogTravelTimeKey(vehicle, call) {
  const destination = dialogTravelTimeDestination(call);
  const signal = dialogTravelTimeSignal(call) ? "1" : "0";
  return [
    vehicle.id,
    Number(vehicle.lat).toFixed(5),
    Number(vehicle.lng).toFixed(5),
    Number(destination.lat).toFixed(5),
    Number(destination.lng).toFixed(5),
    signal
  ].join("|");
}

function dialogRouteKey(vehicle, call) {
  const destination = dialogTravelTimeDestination(call);
  return [
    vehicle.id,
    Number(vehicle.lat).toFixed(5),
    Number(vehicle.lng).toFixed(5),
    Number(destination.lat).toFixed(5),
    Number(destination.lng).toFixed(5)
  ].join("|");
}

function dialogTravelTimeDestination(call) {
  return {
    lat: Number.isFinite(call?.lat) ? call.lat : state.center.mapCenter[0],
    lng: Number.isFinite(call?.lng) ? call.lng : state.center.mapCenter[1],
    label: call?.location || "Einsatzort"
  };
}

function dialogTravelTimeSignal(call) {
  if (el.incidentSignal) return el.incidentSignal.value === "yes";
  return Boolean(call?.signal);
}

async function requestDialogTravelTime(vehicle, call, force = false) {
  state.dialogRoutes ||= new Map();
  state.dialogTravelTimes ||= new Map();
  state.dialogTravelTimeRequests ||= new Set();
  const key = dialogTravelTimeKey(vehicle, call);
  if (!force && (state.dialogTravelTimes.has(key) || state.dialogTravelTimeRequests.has(key))) return;
  if (state.dialogTravelTimeRequests.has(key)) return;
  state.dialogTravelTimeRequests.add(key);
  const destination = dialogTravelTimeDestination(call);
  const signal = dialogTravelTimeSignal(call);
  try {
    const routeKey = dialogRouteKey(vehicle, call);
    const route = state.dialogRoutes.get(routeKey) || await buildRoute(vehicle, destination);
    state.dialogRoutes.set(routeKey, route);
    state.dialogTravelTimes.set(key, {
      state: "ready",
      durationMs: routeTravelDurationMs(vehicle, route, signal),
      source: route.source
    });
  } catch {
    state.dialogTravelTimes.set(key, { state: "error" });
  } finally {
    state.dialogTravelTimeRequests.delete(key);
  }
  if (el.incidentDialog?.open) {
    const source = currentIncidentDialogSource();
    const incident = state.editingIncidentId ? state.incidents.find((item) => item.id === state.editingIncidentId) : null;
    if (source) renderDialogVehicles(source, incident);
  }
}

function renderQuickVehicleButtons(call, assignedIds, incident = null) {
  const wrapper = document.createElement("section");
  wrapper.className = "quick-vehicle-picker";
  ["RTW", "KTW", "NEF", "RTH", "ELRD"].forEach((type) => {
    const vehicle = nearestFreeVehicleOfType(call, type, assignedIds);
    const shiftNotice = shiftNoticeForVehicle(vehicle);
    const button = document.createElement("button");
    button.type = "button";
    if (shiftNotice) button.classList.add(`shift-${shiftNotice.type}`);
    button.title = shiftNotice?.text || "";
    button.innerHTML = vehicle
      ? `<strong>${escapeHtml(type)}:</strong> ${escapeHtml(vehicle.shortName || vehicle.name)}${shiftNotice ? `<small>${escapeHtml(shiftNotice.text)}</small>` : ""}`
      : `<strong>${escapeHtml(type)}:</strong> kein Fzg`;
    button.disabled = !vehicle;
    button.addEventListener("click", () => {
      if (!vehicle) return;
      if (state.selectedDialogVehicleIds.has(vehicle.id)) state.selectedDialogVehicleIds.delete(vehicle.id);
      else state.selectedDialogVehicleIds.add(vehicle.id);
      renderDialogVehicles(call, incident);
    });
    wrapper.append(button);
  });
  el.dialogVehicleList.append(wrapper);
}

function nearestFreeVehicleOfType(call, type, assignedIds) {
  return state.vehicles
    .filter((vehicle) => !vehicle.foreign && !assignedIds.has(vehicle.id) && isAlarmable(vehicle) && vehicle.type === type)
    .sort((a, b) => distanceToCall(a, call) - distanceToCall(b, call))[0];
}

function nextShiftChangeText(vehicle) {
  const intervals = vehicleShiftIntervals(vehicle).filter((interval) => interval.valid);
  if (!intervals.length || intervals.some((interval) => interval.label === "24h")) return "";
  const now = Math.floor(state.minute) % 1440;
  const active = intervals.find((interval) => interval.active);
  if (active) {
    const end = shiftEndMinuteFromLabel(active.label);
    const minutes = shiftMinutesUntilEnd(now, end);
    return Number.isFinite(minutes) ? `Schichtwechsel in ${minutes} min` : "";
  }
  const starts = intervals
    .map((interval) => ({ label: interval.label, start: shiftStartMinuteFromLabel(interval.label) }))
    .filter((item) => Number.isFinite(item.start))
    .map((item) => ({ ...item, minutes: (item.start - now + 1440) % 1440 }))
    .sort((a, b) => a.minutes - b.minutes);
  return starts[0] ? `Dienstbeginn in ${starts[0].minutes} min` : "";
}

function shiftStartMinuteFromLabel(label) {
  const start = String(label || "").split("-")[0];
  if (!start) return NaN;
  const [hour, minute = "0"] = start.split(":");
  return shiftTimeToMinute(hour, minute);
}

function renderVehicles() {
  const vehicleSortName = (vehicle) => vehicle.shortName || vehicle.name;
  const typeOrder = { RTW: 1, NEF: 2, KTW: 3, REF: 4, RTH: 5, ELRD: 6 };
  const vehicleTypeRank = (vehicle) => typeOrder[vehicle.type] || 99;
  const statusRank = (vehicle) => vehicle.status === 6 ? 99 : vehicle.status;
  const sorted = state.vehicles.filter((vehicle) => !vehicle.foreign).sort((a, b) => {
    if (el.vehicleSort.value === "status") return statusRank(a) - statusRank(b) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    if (el.vehicleSort.value === "type") return a.type.localeCompare(b.type) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    if (el.vehicleSort.value === "type-status") return statusRank(a) - statusRank(b) || vehicleTypeRank(a) - vehicleTypeRank(b) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    return a.station.localeCompare(b.station) || vehicleSortName(a).localeCompare(vehicleSortName(b));
  });

  el.vehicleList.innerHTML = "";
  sorted.forEach((vehicle) => {
    const displayName = vehicle.shortName || vehicle.name;
    const isOpen = vehicle.id === state.selectedVehicleId;
    const row = document.createElement("article");
    row.className = `vehicle-row ${isOpen ? "active" : ""} ${vehicle.shiftWarning ? "shift-warning" : ""}`;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "vehicle-summary";
    summary.innerHTML = `
      <strong>${escapeHtml(displayName)}</strong>
      <span class="vehicle-type-label vehicle-type-${escapeHtml(vehicle.type)}">${escapeHtml(vehicle.type)}</span>
      <span class="vehicle-station-shift">
        <span>${escapeHtml(vehicle.station)}</span>
        ${currentShiftBadgeHtml(vehicle)}
      </span>
      <em class="status-pill status-${vehicleDisplayStatus(vehicle)}">${vehicleDisplayStatus(vehicle)}</em>
    `;
    summary.addEventListener("click", () => {
      state.selectedVehicleId = isOpen ? null : vehicle.id;
      renderVehicles();
    });
    row.append(summary);
    if (isOpen) {
      const details = document.createElement("div");
      details.className = "vehicle-details";
      appendTextBlock(details, "p", `${vehicle.statusText}${vehicle.radioMessage ? ` | ${vehicle.radioMessage}` : ""}`);
      if (vehicle.shortName && vehicle.shortName !== vehicle.name) appendTextBlock(details, "p", `FRN: ${vehicle.name}`);
      details.append(renderVehicleShiftInfo(vehicle));
      if (vehicle.shiftWarning) appendTextBlock(details, "p", "Schichtende überschritten, Wechsel erst an der Wache möglich.");
      const actions = document.createElement("div");
      actions.className = "vehicle-actions";
      addVehicleAction(actions, "Orten", () => locateVehicle(vehicle.id));
      if ([1, 2].includes(vehicle.status) && !vehicle.nextIncidentId) {
        addVehicleAction(actions, "Gebietsabsicherung", () => startCoveragePinSelection(vehicle.id));
      }
      if (vehicle.radioStatus === 5) addVehicleAction(actions, "J", () => sendSpeechPrompt(vehicle.id));
      if (vehicle.radioStatus === 0) addVehicleAction(actions, "dringenden Sprechwunsch annehmen", () => sendSpeechPrompt(vehicle.id));
      if (vehicle.status === 1) addVehicleAction(actions, "Status H", () => sendVehicleHome(vehicle.id));
      if (vehicle.status === 3) addVehicleAction(actions, "Einsatzabbruch (E)", () => abortVehicleMission(vehicle.id));
      if (vehicle.status === 7) addVehicleAction(actions, "Zielort ändern", () => changeTransportDestination(vehicle.id));
      if (vehicle.supportGroupId) addVehicleAction(actions, "UGRD einruecken", () => recallSupportGroupVehicle(vehicle.id));
      if (canReleaseAccompanyingDoctor(vehicle)) addVehicleAction(actions, "abkömmlich frei", () => releaseAccompanyingDoctor(vehicle.id));
      if (canAskAccompanyingDoctorRelease(vehicle)) addVehicleAction(actions, "Abkoemmlich?", () => askAccompanyingDoctorRelease(vehicle.id));
      if (vehicle.status === 8) addVehicleAction(actions, "Einsatzklar?", () => askVehicleReadiness(vehicle.id));
      details.append(actions);
      row.append(details);
    }
    el.vehicleList.append(row);
  });
}

function currentShiftBadgeHtml(vehicle) {
  const intervals = vehicleShiftIntervals(vehicle);
  const active = intervals.find((interval) => interval.active);
  const notice = shiftNoticeForVehicle(vehicle);
  const label = notice?.text || active?.label || "ausser Dienst";
  const toneClass = notice?.type === "ending" ? " shift-current-ending"
    : notice?.type === "overtime" ? " shift-current-expired"
      : active ? ""
        : " shift-current-inactive";
  return `<small class="shift-current${toneClass}">${escapeHtml(label)}</small>`;
}

function shiftNoticeForVehicle(vehicle) {
  if (!vehicle) return null;
  const intervals = vehicleShiftIntervals(vehicle);
  const active = intervals.find((interval) => interval.active);
  const expired = shiftExpiredMinutes(vehicle);
  if (vehicle.shiftWarning) {
    return {
      type: "overtime",
      text: expired !== null ? `Überstunden: Schichtende vor ${expired} min` : "Überstunden: Schichtende überschritten"
    };
  }
  if (active?.endingSoon) {
    const minutes = shiftMinutesUntilEnd(Math.floor(state.minute) % 1440, shiftEndMinuteFromLabel(active.label));
    return {
      type: "ending",
      text: Number.isFinite(minutes) ? `Bald Feierabend in ${minutes} min` : "Bald Feierabend"
    };
  }
  return null;
}

function shiftEndMinuteFromLabel(label) {
  const end = String(label || "").split("-")[1];
  if (!end) return NaN;
  const [hour, minute = "0"] = end.split(":");
  return shiftTimeToMinute(hour, minute);
}

function shiftExpiredMinutes(vehicle) {
  const expired = vehicleShiftIntervals(vehicle)
    .filter((interval) => interval.expired && Number.isFinite(interval.minutesSinceEnd))
    .sort((a, b) => a.minutesSinceEnd - b.minutesSinceEnd)[0];
  return expired ? Math.max(1, Math.floor(expired.minutesSinceEnd)) : null;
}

function renderVehicleShiftInfo(vehicle) {
  const wrapper = document.createElement("div");
  wrapper.className = "vehicle-shift-list";
  const title = document.createElement("strong");
  title.textContent = "Schicht";
  wrapper.append(title);
  vehicleShiftIntervals(vehicle).forEach((interval) => {
    const badge = document.createElement("span");
    badge.className = `vehicle-shift-chip${interval.active ? " active" : ""}${interval.endingSoon ? " ending" : ""}${vehicle.shiftWarning && interval.expired ? " expired" : ""}`;
    badge.textContent = interval.label;
    wrapper.append(badge);
  });
  return wrapper;
}

function addVehicleAction(parent, label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    handler();
  });
  parent.append(button);
}

function locateVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || !state.mapReady) return;
  state.map.setView([vehicle.lat, vehicle.lng], 15);
  logRadio(`${vehicle.name}: Ortung gesendet, aktuelle Position auf Karte markiert.`, "radio");
}

function queryVehicleStatus(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const reachable = [1, 3, 7].includes(vehicle.status);
  logRadio(reachable
    ? `${vehicle.name}: Status bestätigt (${vehicle.status} - ${vehicle.statusText}).`
    : `${vehicle.name}: keine Antwort auf Statusabfrage.`, reachable ? "radio" : "warn");
}
