function renderAll() {
  renderClock();
  renderMap();
  renderIncidents();
  renderVehicles();
  renderRadioAlerts();
}

function renderRadioAlerts() {
  if (!el.radioAlerts) return;
  const alerts = state.vehicles.filter((vehicle) => vehicle.radioStatus === 5 || vehicle.radioStatus === 0);
  el.radioAlerts.innerHTML = "";
  alerts.forEach((vehicle) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `radio-alert radio-alert-${vehicle.radioStatus}`;
    button.textContent = `${vehicle.radioStatus} - ${vehicle.shortName || vehicle.name}`;
    button.title = `Status ${vehicle.radioStatus} ${vehicle.name} annehmen`;
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
    const shouldWarn = !inShift && ![2, 6].includes(vehicle.status);
    if (vehicle.shiftWarning !== shouldWarn) {
      vehicle.shiftWarning = shouldWarn;
      changed = true;
    }
    if (!inShift && vehicle.status === 2) {
      vehicle.status = 6;
      vehicle.statusText = "außer Dienst";
      changed = true;
    }
    if (inShift && vehicle.status === 6) {
      vehicle.status = 2;
      vehicle.statusText = "auf Wache";
      changed = true;
    }
  });
  if (changed) renderVehicles();
}

function vehicleInShift(vehicle) {
  if (!vehicle.shift || vehicle.shift.toLowerCase() === "24h") return true;
  return vehicle.shift.split(",").some((interval) => vehicleInShiftInterval(interval.trim()));
}

function vehicleInShiftInterval(interval) {
  const match = interval.match(/(\d{1,2})(?::?(\d{2}))?\s*-\s*(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return true;
  const start = Number(match[1]) * 60 + Number(match[2] || 0);
  const end = Number(match[3]) * 60 + Number(match[4] || 0);
  const now = Math.floor(state.minute) % 1440;
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

function renderMap() {
  if (!state.mapReady) return;
  clearMapLayers();

  state.center.stations.forEach((station) => {
    const vehicleSummary = Object.entries(station.vehicles || {})
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");
    const availableCount = stationAvailableVehicles(station).length;
    const stationType = availableCount ? "station station-available" : "station station-empty";
    const stationLabel = station.vehicles?.RTH && !station.vehicles?.RTW && !station.vehicles?.KTW ? "RTH"
      : station.vehicles?.NEF && !station.vehicles?.RTW && !station.vehicles?.KTW ? "NEF"
        : "RW";
    const availabilityText = availableCount ? `${availableCount} Fahrzeug(e) an der Wache` : "keine Fahrzeuge an der Wache";
    const position = offsetStationPosition(station);
    const marker = addMapMarker("stations", position.lat, position.lng, stationLabel, stationType, `<strong>${escapeHtml(station.label)}</strong><br>${escapeHtml(station.address)}<br>${escapeHtml(vehicleSummary)}<br>${escapeHtml(availabilityText)}`);
    marker.bindPopup(stationPopupContent(station), { autoClose: true, closeOnClick: true, closeButton: true });
  });
  state.center.hospitals.forEach((hospital) => {
    addMapMarker("hospitals", hospital.lat, hospital.lng, "KH", "hospital", `<strong>${escapeHtml(hospital.label)}</strong><br>${escapeHtml(hospital.address)}`);
  });
  state.incidents.filter((incident) => incident.status !== "geschlossen").forEach((incident) => {
    const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
    const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
    const attention = incidentHasRadioAttention(incident) ? " attention" : "";
    const marker = addMapMarker("incidents", lat, lng, "!", `incident${attention}`, `${incident.keyword}<br>${incident.location || "Regensburg"}`);
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
    const marker = L.marker([vehicle.lat, vehicle.lng], { icon })
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

function offsetStationPosition(station) {
  const overlapsHospital = state.center.hospitals.some((hospital) => mapDistance(station.lat, station.lng, hospital.lat, hospital.lng) < .08);
  if (!overlapsHospital) return { lat: station.lat, lng: station.lng };
  return { lat: station.lat + .0012, lng: station.lng - .0012 };
}

function stationAvailableVehicles(station) {
  return state.vehicles.filter((vehicle) => vehicle.stationId === station.id && vehicle.status === 2 && !vehicle.nextIncidentId);
}

function vehicleVisibleOnMap(vehicle) {
  return Boolean(vehicle.coveragePoint || vehicle.routeMeta || vehicle.route?.length || [3, 7].includes(vehicle.status));
}

function incidentHasRadioAttention(incident) {
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
  if (canReleaseAccompanyingDoctor(vehicle)) addPopupButton(wrapper, "abkömmlich freimelden", () => releaseAccompanyingDoctor(vehicle.id));
  if (vehicle.status === 8) addPopupButton(wrapper, "einsatzklar?", () => clearVehicle(vehicle.id));
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
  const oldSpeed = routeSpeedKmh(vehicle, oldSignal);
  const newSpeed = routeSpeedKmh(vehicle, newSignal);
  if (!oldSpeed || !newSpeed || oldSpeed === newSpeed) return;
  const now = Date.now();
  const remaining = Math.max(0, vehicle.routeMeta.endAt - now) * (oldSpeed / newSpeed);
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
    if (incident.note) appendTextBlock(card, "p", `Zusatz: ${incident.note}`);

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

    if (incident.transportRequest) {
      const transportBox = document.createElement("div");
      transportBox.className = "transport-choice";
      appendTransportRequestHeader(transportBox, incident);
      nearestHospitals(incident).slice(0, 5).forEach((hospital) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = hospital.suitable ? "hospital-choice suitable" : "hospital-choice unsuitable";
        button.textContent = `${hospital.label} (${hospital.distance.toFixed(1).replace(".", ",")} km)`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          beginTransport(incident.id, hospital.id);
        });
        transportBox.append(button);
      });
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
    }

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
  if (incident.signal) return "emergency";
  if (incident.assigned?.length) return "transport";
  return "scheduled";
}

function incidentNeedsSlowAlert(incident) {
  return incident.signal && !incident.assigned?.length && incident.status !== "geschlossen";
}

function nearestAvailableVehicles(incident) {
  return state.vehicles
    .filter((vehicle) => isAlarmable(vehicle))
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
      <span class="incident-state">${incidentElapsedLabel(incident)} | ${escapeHtml(incident.status)}</span>
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
    if (incident.note) appendTextBlock(details, "p", `Zusatz: ${incident.note}`);

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

    activeTransportRequests(incident).forEach((request) => {
      const transportBox = document.createElement("div");
      transportBox.className = "transport-choice";
      appendTransportRequestHeader(transportBox, incident, request);
      nearestHospitals(incident, request).slice(0, 5).forEach((hospital) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = hospital.suitable ? "hospital-choice suitable" : "hospital-choice unsuitable";
        button.textContent = `${hospital.label} (${hospital.distance.toFixed(1).replace(".", ",")} km)`;
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          beginTransport(incident.id, hospital.id, request.vehicleId, request.id);
        });
        transportBox.append(button);
      });
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
  const elapsed = Math.max(0, Math.floor(state.minute - (incident.createdAtMinute ?? state.minute)));
  return `${elapsed} min`;
}

function renderAssistanceDecision(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  const missing = incident.assistanceDecision?.missing || [];
  appendTextBlock(wrapper, "strong", `Nachforderung: ${missing.join(", ")}`);
  if (missing.includes("NEF") || missing.includes("RTH")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Nachfragen: Transport ohne Notarzt möglich?";
    button.addEventListener("click", () => applyAssistanceAlternative(incident.id, "without-doctor"));
    wrapper.append(button);
  }
  if (missing.includes("RTW")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Nachfragen: Transport ohne RTW möglich?";
    button.addEventListener("click", () => applyAssistanceAlternative(incident.id, "without-rtw"));
    wrapper.append(button);
  }
  if (incident.assistanceDecision?.vehicleType === "KTW" && missing.includes("RTW") && (missing.includes("NEF") || missing.includes("RTH"))) {
    const nefKtw = document.createElement("button");
    nefKtw.type = "button";
    nefKtw.textContent = "Nachfragen: Notarzt + KTW ausreichend?";
    nefKtw.addEventListener("click", () => applyAssistanceAlternative(incident.id, "nef-ktw"));
    wrapper.append(nefKtw);
    const rtwOnly = document.createElement("button");
    rtwOnly.type = "button";
    rtwOnly.textContent = "Nachfragen: RTW alleine ausreichend?";
    rtwOnly.addEventListener("click", () => applyAssistanceAlternative(incident.id, "rtw-only"));
    wrapper.append(rtwOnly);
  }
  return wrapper;
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

function applyAssistanceAlternative(incidentId, mode) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident?.assistanceDecision) return;
  const chance = mode === "rtw-only" ? .25 : .5;
  const accepted = Math.random() < chance;
  if (!accepted) {
    logRadio(`Rückfrage ${incident.keyword}: nicht möglich, Nachforderung bleibt bestehen.`, "warn");
    incident.assistanceDecision = null;
    renderAll();
    return;
  }
  if (mode === "without-doctor" || mode === "rtw-only") removeRequirementFromIncident(incident, ["NEF", "RTH"]);
  if (mode === "without-rtw" || mode === "nef-ktw") replaceRequirementInIncident(incident, "RTW", "KTW");
  incident.patient.forceTransportSignal = true;
  incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
  incident.assistanceDecision = null;
  incident.assistanceRequested = false;
  incident.status = missingVehicleTypes(incident).length ? "in Bearbeitung" : "vor Ort";
  resetTreatmentCapsAfterRequirementChange(incident);
  logRadio(`Rückfrage ${incident.keyword}: Alternative akzeptiert, Transport später mit Sondersignal.`, "radio");
  rescheduleSceneTreatment(incident);
  renderAll();
}

function removeRequirementFromIncident(incident, types) {
  (incident.patient?.patients || []).forEach((patient) => {
    patient.required = (patient.required || []).filter((type) => !types.includes(type));
  });
  incident.required = (incident.required || []).filter((type) => !types.includes(type));
}

function replaceRequirementInIncident(incident, fromType, toType) {
  (incident.patient?.patients || []).forEach((patient) => {
    patient.required = replaceRequirement(patient.required || [], fromType, toType);
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
    line.innerHTML = `<b>${escapeHtml(vehicle.shortName || vehicle.name)}</b><em class="status-pill status-${vehicle.status}">${vehicle.status}</em><small>${escapeHtml(vehicle.statusText)}${vehicle.radioStatus ? ` | Sprechwunsch ${vehicle.radioStatus}` : ""}</small>`;
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
  progressBox.innerHTML = `<span>Behandlung</span><strong>${Math.round(progress * 100)}%</strong><i><b style="width:${Math.round(progress * 100)}%"></b></i>`;
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
    row.innerHTML = `<td>${escapeHtml(patient.label)}</td><td>${escapeHtml(units)}<div class="mini-progress"><b style="width:${progress}%"></b></div></td><td>${escapeHtml(need)}</td><td>${escapeHtml(patient.requiredDepartment)}</td>`;
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
    return vehicle?.status === 4;
  });
}

function appendTransportRequestHeader(parent, incident, request = incident.transportRequest) {
  const patient = (incident.patient?.patients || []).find((item) => item.id === request?.patientId);
  const header = document.createElement("div");
  header.className = "transport-choice-head";
  header.innerHTML = `
    <strong>Transportziel${patient ? ` für ${escapeHtml(patient.label)}` : ""}</strong>
    <span>${escapeHtml(request?.requiredDepartment || patient?.requiredDepartment || "Fachrichtung nach Rückmeldung")}</span>
  `;
  parent.append(header);
  if (request?.report) parent.append(renderIncidentReport(request.report));
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
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4);
  if (!assigned.length) return 0;
  const { cap, support } = currentTreatmentCap(patient, incident, assigned);
  const supportCapReachedAt = patient.supportCapReachedAt;
  const startedAt = supportCapReachedAt ?? patient.treatmentStartedAt ?? incident.patient?.treatmentStartedAt ?? state.minute;
  patient.treatmentStartedAt ??= startedAt;
  const elapsed = Math.max(0, state.minute - startedAt);
  const baseProgress = supportCapReachedAt ? (patient.supportCapValue ?? 0.8) : 0;
  const progress = Math.min(cap, baseProgress + elapsed / treatmentMinutes(incident));
  if (support && progress >= cap) {
    patient.supportCapReachedAt ??= state.minute;
    patient.supportCapValue = cap;
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
  const waitingOnlyForTransport = missing.every((type) => ["RTW", "KTW"].includes(type));
  if (hasRthSupport && waitingOnlyForTransport) return { cap: 1, support: false };
  if (hasDoctorSupport && waitingOnlyForTransport) return { cap: 0.8, support: true };
  if (hasRefSupport) {
    if (missing.some(isDoctorRequirement)) return { cap: 0.5, support: true };
    if (waitingOnlyForTransport) return { cap: 0.8, support: true };
  }
  const hasKtwFirstResponse = assigned.some((vehicle) => vehicle.type === "KTW" && vehicle.supportOnly);
  const hasRequiredTransportUnit = assigned.some((vehicle) => (patient.required || []).some((type) => ["RTW", "KTW"].includes(type) && vehicleSatisfiesRequirement(vehicle.type, type)));
  if (hasKtwFirstResponse && !hasRequiredTransportUnit) {
    const required = patient.required || [];
    if (required.includes("RTW") && (required.includes("NEF") || required.includes("RTH"))) return { cap: 0.25, support: true };
    if (required.length === 1 && required.includes("RTW")) return { cap: 0.4, support: true };
  }
  return { cap: 0.5, support: true };
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
  logRadio(`${vehicle.name}: vom Einsatz ${incident.keyword} zurückgenommen.`, "warn");
  renderDialogVehicles(incident, incident);
  renderAll();
}

function statusTextForIdleVehicle(vehicle) {
  if (vehicle.status === 1) return "frei über Funk";
  if (vehicle.status === 2) return "auf Wache";
  return vehicle.statusText || "frei";
}

function renderDialogVehicles(call, incident = null) {
  el.dialogVehicleList.innerHTML = "";
  const assignedIds = new Set(incident?.assigned || []);
  const unavailableIds = new Set([...assignedIds, ...state.selectedDialogVehicleIds]);
  renderQuickVehicleButtons(call, unavailableIds, incident);
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
      line.innerHTML = `<span>${escapeHtml(vehicle.name)} | Status ${vehicle.status}${vehicle.nextIncidentId === incident.id ? " | alarmiert" : ""}</span>`;
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
  state.vehicles
    .filter((vehicle) => isAlarmable(vehicle) && !assignedIds.has(vehicle.id))
    .sort((a, b) => distanceToCall(a, call) - distanceToCall(b, call))
    .forEach((vehicle) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `dialog-vehicle-row ${state.selectedDialogVehicleIds.has(vehicle.id) ? "selected" : ""}`;
      row.innerHTML = `
        <div>
          <h3><span class="vehicle-type-badge">${escapeHtml(vehicle.type)}</span> ${escapeHtml(vehicle.name)}</h3>
          <p>${escapeHtml(vehicle.station)} | ${distanceToCall(vehicle, call).toFixed(1).replace(".", ",")} km | ${escapeHtml(vehicle.statusText)}</p>
        </div>
        <span class="status-pill status-${vehicle.status}">${vehicle.status}</span>
      `;
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
    });
}

function renderQuickVehicleButtons(call, assignedIds, incident = null) {
  const wrapper = document.createElement("section");
  wrapper.className = "quick-vehicle-picker";
  ["RTW", "KTW", "NEF", "RTH"].forEach((type) => {
    const vehicle = nearestFreeVehicleOfType(call, type, assignedIds);
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = vehicle
      ? `<strong>${escapeHtml(type)}:</strong> ${escapeHtml(vehicle.shortName || vehicle.name)}`
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
    .filter((vehicle) => !assignedIds.has(vehicle.id) && isAlarmable(vehicle) && vehicle.type === type)
    .sort((a, b) => distanceToCall(a, call) - distanceToCall(b, call))[0];
}

function renderVehicles() {
  const sorted = [...state.vehicles].sort((a, b) => {
    if (el.vehicleSort.value === "status") return a.status - b.status || a.name.localeCompare(b.name);
    if (el.vehicleSort.value === "type") return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
    return a.station.localeCompare(b.station) || a.name.localeCompare(b.name);
  });

  el.vehicleList.innerHTML = "";
  sorted.forEach((vehicle) => {
    const isOpen = vehicle.id === state.selectedVehicleId;
    const row = document.createElement("article");
    row.className = `vehicle-row ${isOpen ? "active" : ""} ${vehicle.shiftWarning ? "shift-warning" : ""}`;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "vehicle-summary";
    summary.innerHTML = `
      <strong>${escapeHtml(vehicle.name)}</strong>
      <span class="vehicle-type-label">${escapeHtml(vehicle.type)}</span>
      <span>${escapeHtml(vehicle.station)}</span>
      <em class="status-pill status-${vehicle.status}">${vehicle.status}</em>
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
      if (vehicle.shortName && vehicle.shortName !== vehicle.name) appendTextBlock(details, "p", `Kurz: ${vehicle.shortName}`);
    if (vehicle.shift) appendTextBlock(details, "p", `Schicht: ${vehicle.shift}`);
      if (vehicle.shiftWarning) appendTextBlock(details, "p", "Schichtende überschritten, Wechsel erst an der Wache möglich.");
      const actions = document.createElement("div");
      actions.className = "vehicle-actions";
      addVehicleAction(actions, "Orten", () => locateVehicle(vehicle.id));
      if ([1, 2].includes(vehicle.status) && !vehicle.nextIncidentId) {
        addVehicleAction(actions, "Gebietsabsicherung", () => startCoveragePinSelection(vehicle.id));
      }
      if (vehicle.radioStatus === 5) addVehicleAction(actions, "J", () => sendSpeechPrompt(vehicle.id));
      if (vehicle.radioStatus === 0) addVehicleAction(actions, "Sprechwunsch annehmen", () => sendSpeechPrompt(vehicle.id));
      if (vehicle.status === 1) addVehicleAction(actions, "Status H", () => sendVehicleHome(vehicle.id));
      if (vehicle.status === 3) addVehicleAction(actions, "Einsatzabbruch (E)", () => abortVehicleMission(vehicle.id));
      if (vehicle.status === 7) addVehicleAction(actions, "Zielort ändern", () => changeTransportDestination(vehicle.id));
      if (canReleaseAccompanyingDoctor(vehicle)) addVehicleAction(actions, "abkömmlich frei", () => releaseAccompanyingDoctor(vehicle.id));
      if (vehicle.status === 8) addVehicleAction(actions, "Einsatzklar?", () => clearVehicle(vehicle.id));
      details.append(actions);
      row.append(details);
    }
    el.vehicleList.append(row);
  });
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
