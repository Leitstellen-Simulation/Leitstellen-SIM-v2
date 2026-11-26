function renderAll() {
  syncSpeedSelect();
  renderClock();
  renderMap();
  renderIncidents();
  renderVehicles();
  renderRadioAlerts();
  renderAdminStatusBar();
  renderTransportDestinationDialogIfOpen();
}

function syncSpeedSelect() {
  if (!el.speedSelect) return;
  const value = String(state.speed || 1);
  if (el.speedSelect.value !== value) el.speedSelect.value = value;
}

function renderRadioAlerts() {
  if (!el.radioAlerts) return;
  const alerts = vehiclesWithRadioAlerts();
  updateDispatchBadge(el.mobileRadioCount, alerts.length, alerts.some((vehicle) => vehicle.radioStatus === 0));
  const existing = new Map([...el.radioAlerts.children].map((button) => [button.dataset.vehicleId, button]));
  const activeIds = new Set(alerts.map((vehicle) => vehicle.id));
  for (const [id, button] of existing) {
    if (!activeIds.has(id)) button.remove();
  }
  alerts.forEach((vehicle) => {
    const button = existing.get(vehicle.id) || document.createElement("button");
    if (!button.isConnected) {
      button.type = "button";
      button.dataset.vehicleId = vehicle.id;
      button.addEventListener("click", () => sendSpeechPrompt(vehicle.id));
      el.radioAlerts.append(button);
    }
    button.className = `radio-alert radio-alert-${vehicle.radioStatus}`;
    const text = `${vehicle.radioStatus} · ${vehicle.shortName || vehicle.name}`;
    if (button.textContent !== text) button.textContent = text;
    button.title = vehicle.radioStatus === 6
      ? `Status 6 ${vehicle.name} quittieren`
      : `Status ${vehicle.radioStatus} ${vehicle.radioStatus === 0 ? "dringenden Sprechwunsch" : "Sprechwunsch"} ${vehicle.name} annehmen`;
    button.setAttribute("aria-label", button.title);
  });
  renderDispatchQueue();
}

function vehiclesWithRadioAlerts() {
  return state.vehicles.filter((vehicle) => [0, 5, 6].includes(vehicle.radioStatus));
}

function renderRadioIncidentFilter() {
  const incident = state.incidents.find((item) => item.id === state.selectedIncidentId && item.status !== "geschlossen");
  if (!incident) state.radioIncidentFilter = false;
  const button = el.radioIncidentFilter;
  button.disabled = !incident;
  button.setAttribute("aria-pressed", String(state.radioIncidentFilter));
  button.title = incident ? `${incident.keyword} · ${incident.location}` : "Einsatz in der Liste oder auf der Karte auswählen";
  const incidentId = state.radioIncidentFilter ? incident.id : undefined;
  if (el.radioLog.dataset.incidentId === incidentId) return;
  if (incidentId) el.radioLog.dataset.incidentId = incidentId;
  else delete el.radioLog.dataset.incidentId;
  for (const entry of el.radioLog.children) {
    entry.hidden = Boolean(incidentId && !entry.dataset.incidentIds?.split(" ").includes(incidentId));
  }
  el.radioLog.scrollTop = 0;
}

function updateDispatchBadge(badge, count, urgent = false) {
  if (!badge) return;
  if (badge.textContent !== String(count)) badge.textContent = String(count);
  badge.dataset.level = urgent ? "urgent" : count ? "pending" : "idle";
}

function renderClock() {
  const displayMinute = Math.floor(state.minute);
  const hours = String(Math.floor(displayMinute / 60)).padStart(2, "0");
  const minutes = String(displayMinute % 60).padStart(2, "0");
  el.clockLabel.textContent = `${hours}:${minutes}`;
  if (el.callDispositionDialog.open) renderCallElapsed();
}

function updateShiftStates() {
  let changed = false;
  state.vehicles.forEach((vehicle) => {
    if (vehicle.supportGroupId) return;
    const inShift = vehicleInShift(vehicle);
    const preShiftActive = vehiclePreShiftActive(vehicle);
    const effectiveInShift = inShift || preShiftActive;
    const canShiftChange = vehicleCanShiftChangeAtStation(vehicle);
    if (inShift && (vehicle.preShiftActiveUntilAbsoluteMinute || vehicle.preShiftRejectedStartKey)) {
      vehicle.preShiftActiveUntilAbsoluteMinute = null;
      vehicle.preShiftRejectedStartKey = null;
      changed = true;
    }
    const shouldWarn = !effectiveInShift && vehicle.status !== 6 && !canShiftChange;
    if (vehicle.shiftWarning !== shouldWarn) {
      vehicle.shiftWarning = shouldWarn;
      changed = true;
    }
    if (!effectiveInShift && canShiftChange) {
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
  return Boolean(vehicle.supportGroupId) || vehicleShiftIntervals(vehicle).some((interval) => interval.active);
}

function renderSimMinuteNow() {
  return Number.isFinite(state.absoluteMinute) ? state.absoluteMinute : state.minute;
}

function vehiclePreShiftActive(vehicle) {
  const until = Number(vehicle?.preShiftActiveUntilAbsoluteMinute);
  return vehicle?.status !== 6 && Number.isFinite(until) && renderSimMinuteNow() < until;
}

function vehicleCanShiftChangeAtStation(vehicle) {
  if (!vehicle || vehicle.status !== 2 || vehicle.nextIncidentId || vehicle.coverageDispatch) return false;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (!station) return true;
  if (String(vehicle.statusText || "").toLowerCase().includes("wache")) return true;
  return mapDistance(vehicle.lat, vehicle.lng, station.lat, station.lng) < .75;
}

function vehicleShiftIntervals(vehicle) {
  if (vehicle.supportGroupId) return [];
  if (!vehicle.shift || vehicle.shift.toLowerCase() === "24h") {
    return [{ label: "24h", active: true, endingSoon: false, expired: false, valid: true }];
  }
  return vehicle.shift.split(/[,;\/]/)
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
  const minutesUntilEnd = active && start !== end ? shiftMinutesUntilEnd(now, end) : null;
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

  state.center.stations.forEach((station) => {
    if (station.supportStation) return;
    const stationLabel = stationMapSymbol(station);
    if (["HvO", "FR"].includes(stationLabel) && !el.mapResponderStations.checked) return;
    const availableCount = stationAvailableVehicles(station).length;
    const foreignStation = isForeignMapPoint(station);
    const stationType = `${availableCount ? "station station-available" : "station station-empty"}${foreignStation ? " foreign-map-point" : ""}`;
    const availabilityText = availableCount ? `${availableCount} Fahrzeug(e) an der Wache` : "keine Fahrzeuge an der Wache";
    const stationKind = stationLabel === "RTH"
      ? (foreignStation ? "Fremde Luftrettungsstation" : "Luftrettungsstation")
      : (foreignStation ? "Fremdwache" : "Rettungswache");
    const marker = addMapMarker("stations", station.lat, station.lng, stationLabel, stationType, "", {
      title: `${station.label} · ${stationKind} · ${availabilityText}`,
      count: availableCount
    });
    marker.bindPopup(stationPopupContent(station), { autoClose: true, closeOnClick: true, closeButton: true });
  });
  if (state.incidents.some((incident) => incident.modId === "manv" && incident.status !== "geschlossen")) renderSupportLocations();
  renderHospitalMarkers();
  const occupied = [];
  const mapSize = state.map.getSize();
  state.incidents.filter((incident) => incident.status !== "geschlossen").forEach((incident) => {
    const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
    const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
    const attention = incidentHasRadioAttention(incident) ? " attention" : "";
    const bucket = incidentListBucket(incident);
    const selected = incident.id === state.selectedIncidentId;
    const location = state.map.latLngToContainerPoint([lat, lng]);
    occupied.push({ x: location.x, y: location.y, width: 36, height: 36 });
    const marker = addMapMarker("incidents", lat, lng, { emergency: "!", transport: "T", scheduled: "P" }[bucket], `incident incident-${bucket}${attention}${selected ? " map-selected" : ""}`, `${escapeHtml(incident.keyword)}<br>${escapeHtml(incident.location || "Regensburg")}`, { title: incident.keyword, zIndexOffset: selected ? 300 : 100 });
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

    const width = 80;
    const height = 34;
    const location = state.map.latLngToContainerPoint([vehicle.lat, vehicle.lng]);
    const offset = vehicleMarkerOffset(location, mapSize, occupied, width, height);
    if (Math.hypot(offset.x, offset.y) > 18) {
      const pin = state.map.containerPointToLatLng([location.x + offset.x, location.y + offset.y]);
      const guide = L.polyline([[vehicle.lat, vehicle.lng], pin], {
        color: "#526776", weight: 1, opacity: .65, interactive: false
      }).addTo(state.map);
      state.layers.routes.push(guide);
    }
    const icon = L.divIcon({
      className: "",
      html: `<span class="vehicle-marker vehicle-${vehicle.type} ${vehicle.status > 2 ? "busy" : ""} ${vehicle.routeMeta?.signal ? "signal" : ""} ${vehicle.radioStatus ? "radio-attention" : ""}"><span class="vehicle-marker-text"><strong><span class="vehicle-map-symbol" aria-hidden="true">${vehicleMapSymbol(vehicle.type)}</span> ${escapeHtml(vehicle.type)}</strong><small>${escapeHtml(vehicle.shortName || vehicle.name)}</small></span><em class="vehicle-marker-status status-${vehicle.status}">${vehicle.status}</em></span>`,
      iconSize: [width, height],
      iconAnchor: [width / 2 - offset.x, height / 2 - offset.y],
      popupAnchor: [offset.x, offset.y - height / 2]
    });
    const marker = L.marker([vehicle.lat, vehicle.lng], { icon, title: vehicle.name })
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

function renderSupportLocations() {
  const groups = state.center.supportGroups || [];
  const stations = state.center.supportStations || [];
  const stationIds = new Set(stations.map((station) => station.id));
  for (const station of stations) {
    const components = groups.filter((group) => group.supportStationId === station.id);
    const popup = stationPopupContent(station);
    for (const group of components) appendTextBlock(popup, "p", supportGroupDisplayName(group));
    addMapMarker("stations", station.lat, station.lng, "SEG", "support", popup, {
      title: station.label, count: stationAvailableVehicles(station).length || undefined
    });
  }
  for (const group of groups) {
    if (stationIds.has(group.supportStationId)) continue;
    const point = supportGroupLocation(state.center, group);
    const name = supportGroupDisplayName(group);
    const symbol = supportGroupKind(group) === "ugrd" ? "UGRD" : "SEG";
    addMapMarker("stations", point.lat, point.lng, symbol, "support", escapeHtml(name), { title: name });
  }
}

function vehicleMarkerOffset(point, mapSize, occupied, width, height) {
  if (point.x < 0 || point.y < 0 || point.x > mapSize.x || point.y > mapSize.y) return { x: 0, y: 0 };
  const xMin = Math.min(width / 2 + 4, mapSize.x / 2);
  const yMin = Math.min(height / 2 + 4, mapSize.y / 2);
  const anchorX = Math.min(mapSize.x - xMin, Math.max(xMin, point.x));
  const anchorY = Math.min(mapSize.y - yMin, Math.max(yMin, point.y));
  const fits = (x, y) => x >= xMin && y >= yMin && x <= mapSize.x - xMin && y <= mapSize.y - yMin
    && occupied.every((marker) => Math.abs(marker.x - x) >= (marker.width + width) / 2 + 4
      || Math.abs(marker.y - y) >= (marker.height + height) / 2 + 4);
  const reserve = (x, y) => {
    occupied.push({ x, y, width, height });
    return { x: x - point.x, y: y - point.y };
  };
  if (fits(anchorX, anchorY)) return reserve(anchorX, anchorY);
  for (let ring = 1; ring <= 3; ring++) {
    for (let row = -ring; row <= ring; row++) {
      for (let column = -ring; column <= ring; column++) {
        if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
        const x = anchorX + column * (width + 5);
        const y = anchorY + row * (height + 5);
        if (fits(x, y)) return reserve(x, y);
      }
    }
  }
  return reserve(anchorX, anchorY);
}

function vehicleMapSymbol(type) {
  if (isStabilizerVehicle(type)) return MAP_RESPONDER_SYMBOL;
  return { RTH: "↕", ITH: "↕", NEF: "✚", VEF: "✚", ELRD: "◆", "GW-SAN": "✚" }[type] || "▰";
}

function renderHospitalMarkers() {
  for (const entries of groupHospitalsByLocation(state.center.hospitals)) {
    const first = entries[0];
    const foreign = entries.every(isForeignMapPoint);
    const unavailable = entries.every(hospitalIsUnavailable);
    const count = entries.length > 1 ? entries.length : undefined;
    const title = hospitalMapMarkerTitle(entries);
    const popup = entries.map((hospital) => {
      const detail = [hospitalIsUnavailable(hospital) && "abgemeldet", isForeignMapPoint(hospital) && "Fremdkrankenhaus"].filter(Boolean);
      return `<div><strong>${escapeHtml(hospital.label)}</strong>${detail.length ? ` · ${detail.join(" · ")}` : ""}</div>`;
    }).join("");
    addMapMarker("hospitals", first.lat, first.lng, "+", `hospital${foreign ? " foreign-map-point" : ""}${unavailable ? " hospital-unavailable" : ""}`, popup, { title, count });
  }
}

function stationAvailableVehicles(station) {
  return state.vehicles.filter((vehicle) => vehicle.stationId === station.id && vehicle.status === 2 && !vehicle.nextIncidentId && !vehicle.coveragePoint && !vehicle.coverageDispatch && vehicleAtHomeStation(vehicle));
}

function vehicleVisibleOnMap(vehicle) {
  if (vehicle?.awaitingSupportDeparture) return false;
  if ([4, 8].includes(vehicle?.status)) return false;
  return Boolean(vehicle.coveragePoint || vehicle.routeMeta || vehicle.route?.length || [3, 7].includes(vehicle.status) || (vehicle.status !== 2 && vehicleAwayFromStation(vehicle)));
}

function vehicleAwayFromStation(vehicle) {
  if (!vehicle || vehicle.status === 6) return false;
  return !vehicleAtHomeStation(vehicle);
}

function vehicleAtHomeStation(vehicle) {
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (!station) return false;
  if (String(vehicle.statusText || "").toLowerCase().includes("wache")) return true;
  if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lng) || !Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return false;
  return mapDistance(vehicle.lat, vehicle.lng, station.lat, station.lng) < .75;
}

function incidentHasRadioAttention(incident) {
  const hasTransportDestinationRequest = activeTransportRequests(incident).length > 0;
  if (!incidentHasDisposition(incident) || hasTransportDestinationRequest || incident.modClinicTargets > 0
      || incident.modAttention?.length || openReportedAssistanceNeeds(incident).length) return true;
  return incident.assigned.some((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    return [0, 5].includes(vehicle?.radioStatus) && radioIncidentId(vehicle, vehicle.radioStatus) === incident.id;
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
  const vehicles = state.vehicles.filter((vehicle) => vehicle.stationId === station.id && vehicle.status !== 6 && !vehicle.awaitingSupportDeparture);
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
  if (vehicle.status === 7 && !vehicle.boundTransportVehicleId) addPopupButton(wrapper, "Zielortwechsel", () => changeTransportDestination(vehicle.id));
  if (vehicle.supportGroupId) addPopupButton(wrapper, "SEG / UGRD einrücken", () => recallSupportGroupVehicle(vehicle.id));
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
  logRadio(`${vehicle.name}: RTW übernimmt den Transport.`, "radio", incident.id);
  scheduleTreatmentCompletion(vehicle, incident);
  renderAll();
}

function canReleaseAccompanyingDoctor(vehicle) {
  return isDoctorVehicle(vehicle.type) && vehicle.status === 7 && vehicle.accompanyingActive === false && /abkömmlich|abkoemmlich/i.test(vehicle.statusText || "");
}

function canAskAccompanyingDoctorRelease(vehicle) {
  return isDoctorVehicle(vehicle.type) && vehicle.status === 7 && vehicle.boundTransportVehicleId && vehicle.accompanyingActive !== false;
}

function askAccompanyingDoctorRelease(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || !canAskAccompanyingDoctorRelease(vehicle)) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const patient = incident ? patientForVehicle(vehicle, incident) : null;
  const canRelease = !patientRequiresDoctorAccompaniment(patient) && Math.random() < 0.25;
  if (canRelease) {
    vehicle.accompanyingActive = false;
    vehicle.statusText = vehicle.statusText.replace(/begleitet aktiv/i, "begleitet abkoemmlich");
    logRadio(`${vehicle.name}: Status 5 - Notarzt abkoemmlich, Freimeldung moeglich.`, "radio", incident?.id);
    releaseAccompanyingDoctor(vehicle.id);
    return;
  }
  logRadio(`${vehicle.name}: Status 5 - Notarzt derzeit nicht abkoemmlich.`, "radio", incident?.id);
  vehicle.statusText = "Notarztbegleitung weiter gebunden";
  renderAll();
}

function releaseAccompanyingDoctor(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || !canReleaseAccompanyingDoctor(vehicle)) return;
  const incidentId = vehicle.incidentId;
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
  logRadio(`${vehicle.name}: Status 1, Notarzt abkömmlich freigemeldet.`, "radio", incidentId);
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
    logRadio(`${vehicle.name}: Fahrt ${vehicle.routeMeta.signal ? "mit" : "ohne"} Sondersignal fortgesetzt.`, "radio", vehicle.incidentId);
  } else {
    vehicle.dispatchSignal = !vehicle.dispatchSignal;
    logRadio(`${vehicle.name}: Anfahrt ${vehicle.dispatchSignal ? "mit" : "ohne"} Sondersignal vorgemerkt.`, "radio", vehicle.nextIncidentId);
  }
  renderAll();
}

function rescaleVehicleRouteForSignal(vehicle, oldSignal, newSignal) {
  if (!vehicle.routeMeta || oldSignal === newSignal || isAirMedicalVehicle(vehicle.type)) return;
  const oldDuration = routeTravelDurationMs(vehicle, vehicle.routeMeta, oldSignal);
  const newDuration = routeTravelDurationMs(vehicle, vehicle.routeMeta, newSignal);
  if (!oldDuration || !newDuration || oldDuration === newDuration) return;
  const now = state.paused && Number.isFinite(state.pauseStartedAt) ? state.pauseStartedAt : Date.now();
  const total = Math.max(1, vehicle.routeMeta.endAt - vehicle.routeMeta.startAt);
  const progress = Math.min(1, Math.max(0, (now - vehicle.routeMeta.startAt) / total));
  const remaining = Math.max(0, vehicle.routeMeta.endAt - now) * (newDuration / oldDuration);
  const newTotal = progress >= 1 ? 1 : remaining / Math.max(.001, 1 - progress);
  vehicle.routeMeta.startAt = now - progress * newTotal;
  vehicle.routeMeta.endAt = now + remaining;
  if (vehicle.routeTimer) {
    cancelScheduledTimeout(vehicle.routeTimer);
  }
  if (vehicle.routeArrivalHandler) vehicle.routeTimer = scheduleTimeout(vehicle.routeArrivalHandler, remaining);
}

function changeTransportDestination(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === vehicle?.incidentId);
  if (!vehicle || !incident || vehicle.status !== 7 || vehicle.modEscortTransportId) return;
  const existing = incident.transportRequests?.find((request) => request.vehicleId === vehicleId && request.destinationChange);
  if (existing) return existing.id;
  const rendezvousSignal = !incident.modId && tna.destinationChanging(incident);
  const previousSignal = Boolean(vehicle.routeMeta?.signal ?? rendezvousSignal);
  cancelVehicleRoute(vehicle);
  vehicle.statusText = "wartet auf neues Transportziel";
  holdBoundDoctorForDestinationChange(vehicle, incident);
  incident.status = "Zielortwechsel im Transport";
  const request = {
    id: makeId(),
    vehicleId: vehicle.id,
    destinationChange: true,
    previousSignal,
    report: incident.patient?.report || "Zielortwechsel angefordert.",
    requiredDepartment: incident.patient?.requiredDepartment || "Notaufnahme",
    patientId: vehicle.patientId || patientForVehicle(vehicle, incident)?.id || null
  };
  incident.transportRequests = [...(incident.transportRequests || []).filter((item) => item.vehicleId !== vehicleId), request];
  incident.transportRequest = incident.transportRequests[0];
  state.selectedIncidentId = incident.id;
  logRadio(`${vehicle.name}: Zielortwechsel angefordert.`, "warn", incident.id);
  if (incident.modId) appMods.incidentEvent("transport.destinationRequested", incident, {
    transportId: vehicle.modTransportOrder?.id, vehicleId, patientId: request.patientId, requestId: request.id
  });
  renderAll();
  return request.id;
}

function addMapMarker(group, lat, lng, label, type, popup, { title = label, count, zIndexOffset = 0 } = {}) {
  const icon = createMapPointIcon(label, type, count);
  const marker = L.marker([lat, lng], { icon, title, zIndexOffset }).addTo(state.map);
  marker.getElement()?.setAttribute("aria-label", title);
  if (popup) marker.bindPopup(popup);
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
  renderDispatchQueue();
  const previousScrollTop = el.incidentList?.scrollTop ?? 0;
  const active = state.incidents.filter((incident) => incident.status !== "geschlossen");
  renderRadioIncidentFilter();
  el.incidentCount.textContent = `${active.length} offen`;
  renderIncidentTabCounts(active);
  const visible = active
    .filter((incident) => incidentListBucket(incident) === state.incidentFilter)
    .sort((a, b) => (b.createdAtAbsoluteMinute ?? b.createdAtMinute ?? 0) - (a.createdAtAbsoluteMinute ?? a.createdAtMinute ?? 0));

  if (!visible.length) {
    el.incidentList.className = "incident-list empty-state";
    el.incidentList.textContent = "Keine offenen Einsätze.";
    return;
  }

  el.incidentList.className = "incident-list";
  el.incidentList.innerHTML = "";
  renderIncidentsCollapsible(visible);
  restoreIncidentListScroll(previousScrollTop);
}

function selectIncidentFromMapOrList(incident) {
  state.selectedIncidentId = incident.id;
  state.incidentFilter = incidentListBucket(incident);
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.filter === state.incidentFilter);
  });
}

function restoreIncidentListScroll(scrollTop) {
  if (!el.incidentList || !Number.isFinite(scrollTop)) return;
  const restore = () => {
    const maxScroll = Math.max(0, el.incidentList.scrollHeight - el.incidentList.clientHeight);
    el.incidentList.scrollTop = Math.min(scrollTop, maxScroll);
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(restore);
  else restore();
}

function incidentListBucket(incident) {
  if (incident.signal || incident.type === "emergency") return "emergency";
  if (incident.type === "scheduled" && !(incident.assigned || []).length) return "scheduled";
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
  if (!incidentHasDisposition(incident)) return true;
  if (incident.modAttention?.length || incident.modClinicTargets > 0) return true;
  if (tna.requestTime(incident) !== null) return true;
  if (activeTransportRequests(incident).length) return true;
  return openReportedAssistanceNeeds(incident).length > 0;
}

function incidentNeedsSlowAlert(incident) {
  return incident.signal && !incidentHasDisposition(incident) && incident.status !== "geschlossen";
}

function renderIncidentsCollapsible(visible) {
  visible.forEach((incident) => {
    const isOpen = incident.id === state.selectedIncidentId;
    const isManv = incident.modId === "manv";
    const card = document.createElement("article");
    const clinicPending = incident.modClinicTargets > 0 || activeTransportRequests(incident).length > 0;
    card.className = `incident-card ${isOpen ? "active" : ""} ${incidentHasRadioAttention(incident) ? "attention" : ""} ${incidentNeedsSlowAlert(incident) ? "slow-alert" : ""} ${clinicPending ? "transport-pending" : ""}`;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "incident-summary";
    const location = incident.location || "Regensburg";
    const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
    const town = parts.at(-1);
    const cityFirst = parts.length > 1 && !/\d/.test(town) ? `${town} · ${parts.slice(0, -1).join(", ")}` : location;
    const timing = `${incidentStartTimeLabel(incident)} | ${incidentElapsedLabel(incident)} | ${incident.status}`;
    summary.title = `${cityFirst}\n${incident.keyword}\n${timing}`;
    summary.setAttribute("aria-expanded", String(isOpen));
    const tnaBadge = tna.onScene(incident)
      ? '<span class="incident-tna" title="Telenotarzt unterstützt vor Ort" aria-label="Telenotarzt unterstützt vor Ort">TNA</span>'
      : "";
    const patientCount = incident.reportedPatientCount;
    const patientBadge = isManv
      ? Number.isInteger(patientCount)
        ? `<span class="incident-patient-count">${patientCount} ${patientCount === 1 ? "Patient" : "Patienten"}</span>`
        : '<span class="incident-patient-count" title="Patientenzahl offen">Pat. offen</span>'
      : "";
    summary.innerHTML = `
      <strong class="incident-location">${escapeHtml(cityFirst)}</strong>
      <small>${escapeHtml(incident.keyword)}</small>
      <span class="incident-meta">${tnaBadge}${patientBadge}<span class="incident-state">${escapeHtml(incidentElapsedLabel(incident))} · ${escapeHtml(incident.status)}</span></span>
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
    if (!isManv) {
      details.append(renderIncidentVehicleStatus(incident));
      const destinationInfo = renderIncidentDestinationInfo(incident);
      if (destinationInfo) details.append(destinationInfo);
    }
    if (!isManv && incident.patient && incidentHasVehicleStatus(incident, 4)) {
      if (incident.patient.report) details.append(renderIncidentReport(incident.patient.report));
      if (incident.patient.outcome) appendTextBlock(details, "p", `Ergebnis: ${incident.patient.outcome}`);
      details.append(renderPatientAssignments(incident));
    }
    (isManv ? [] : pendingDispatchVehicles(incident)).forEach((vehicle) => {
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
    editButton.className = "incident-edit-action";
    editButton.title = editButton.textContent;
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openIncidentDialog(incident);
    });
    const actions = document.createElement("div");
    actions.className = "incident-actions";
    actions.append(editButton, renderServiceSupport(incident));
    details.append(actions);
    if (incident.modId) {
      const moduleButton = document.createElement("button");
      moduleButton.type = "button";
      moduleButton.textContent = appMods.panelLabel(incident.modId);
      moduleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        appMods.openPanel(incident.modId, incident.id);
      });
      details.append(moduleButton);
    }
    const tnaStatus = tna.status(incident);
    if (tnaStatus) {
      const tnaRow = document.createElement("div");
      tnaRow.className = "tna-status";
      appendTextBlock(tnaRow, "strong", tnaStatus);
      if (tna.requestTime(incident) !== null) {
        const connect = document.createElement("button");
        connect.type = "button";
        connect.textContent = "TNA verbinden";
        connect.addEventListener("click", () => tna.connect(incident.id));
        tnaRow.append(connect);
      }
      details.append(tnaRow);
    }

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
    const assistance = openReportedAssistanceNeeds(incident);
    if (assistance.length) details.append(renderAssistanceDecision(incident, assistance));
    if (incident.ktwHandoverDecision) details.append(renderKtwHandoverDecision(incident));
    if (incident.itwSubstitutionDecision) details.append(renderItwSubstitutionDecision(incident));
    if (incident.elrdWaitDecision) details.append(renderElrdWaitDecision(incident));

    const transportRequests = activeTransportRequests(incident);
    if (transportRequests.length) details.append(renderTransportDestinationNotice(incident, transportRequests));

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

function renderAssistanceDecision(incident, missing) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  appendTextBlock(wrapper, "strong", `Nachforderung: ${missing.join(", ")}`);
  if (incident.assistanceDecision?.reason) appendTextBlock(wrapper, "span", incident.assistanceDecision.reason);
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
      missing: patientMissingTypes(patient).filter((type) => type !== "ELRD" && decisionTypes.has(type))
    }))
    .filter((entry) => entry.missing.length);
}

function applyNoElrdDecision(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  incident.noElrd = true;
  incident.required = (incident.required || []).filter((type) => type !== "ELRD");
  if (incident.patient?.requiredVehicles) {
    incident.patient.requiredVehicles = incident.patient.requiredVehicles.filter((type) => type !== "ELRD");
  }
  if (incident.assistanceDecision?.missing) {
    incident.assistanceDecision.missing = incident.assistanceDecision.missing.filter((type) => type !== "ELRD");
    if (!incident.assistanceDecision.missing.length) {
      incident.assistanceDecision = null;
      incident.assistanceRequested = false;
      if (incident.status === "Nachforderung" || incident.status === "Nachforderung offen") {
        incident.status = missingVehicleTypesForDispatch(incident).length ? "in Bearbeitung" : "vor Ort";
      }
    }
  }
  logRadio(`${incident.keyword}: ELRD nicht erforderlich.`, "radio", incident.id);
  renderAll();
}

function appendAssistanceButtons(parent, incident, missing, patientId = null) {
  const patient = patientId ? (incident.patient?.patients || []).find((item) => item.id === patientId) : null;
  const reanimationLocked = (patient ? patient.acuity === "reanimation" : incident.patient?.patients?.some((item) => item.acuity === "reanimation"))
    || tna.physicalMissing(incident).length > 0;
  const dismissed = assistanceAlternativeDismissed(incident, patientId);
  const needsDoctor = missing.some(isDoctorRequirement);
  const needsRtw = missing.includes("RTW");
  if (missing.includes("ELRD")) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "ELRD nachalarmieren";
    button.addEventListener("click", () => openIncidentDialog(incident));
    parent.append(button);
    const noElrd = document.createElement("button");
    noElrd.type = "button";
    noElrd.textContent = "Kein ELRD erforderlich";
    noElrd.addEventListener("click", () => applyNoElrdDecision(incident.id));
    parent.append(noElrd);
  }
  if (reanimationLocked) return;
  const alternatives = needsRtw && needsDoctor
    ? [["ktw-only", "KTW allein ausreichend?"], ["without-rtw", "KTW mit Notarzt ausreichend?"], ["rtw-only", "RTW ohne Notarzt ausreichend?"]]
    : needsRtw ? [["without-rtw", "KTW statt RTW ausreichend?"]]
      : needsDoctor ? [["without-doctor", "Transport ohne Notarzt möglich?"]] : [];
  for (const [mode, question] of alternatives) {
    if (dismissed.has(mode)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Nachfragen: ${question}`;
    button.addEventListener("click", () => applyAssistanceAlternative(incident.id, mode, patientId));
    parent.append(button);
  }
}

function assistanceAlternativeDismissed(incident, patientId = null) {
  const dismissed = incident?.assistanceDecision?.dismissedAlternatives || {};
  return new Set([
    ...(dismissed.all || []),
    ...(patientId ? dismissed[patientId] || [] : [])
  ]);
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

function renderItwSubstitutionDecision(incident) {
  const wrapper = document.createElement("div");
  wrapper.className = "assistance-decision";
  const request = incident.itwSubstitutionDecision || {};
  const replacement = (request.regularRequired || []).join(" + ") || "regulaere Rettungsmittel";
  appendTextBlock(wrapper, "strong", `ITW nicht zwingend erforderlich: ${replacement} nachfuehren?`);
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "Ja, regulaere Mittel";
  yes.addEventListener("click", () => answerItwSubstitution(incident.id, true));
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "Nein, ITW uebernimmt";
  no.addEventListener("click", () => answerItwSubstitution(incident.id, false));
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

function answerItwSubstitution(incidentId, useRegularVehicles) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const request = incident?.itwSubstitutionDecision;
  if (!incident || !request) return;
  const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
  const itw = state.vehicles.find((vehicle) => vehicle.id === request.vehicleId);
  incident.itwSubstitutionDecision = null;
  if (itw) itw.pendingItwSubstitutionRequest = null;
  if (!patient || !itw) return;
  if (useRegularVehicles) {
    patient.itwAwaitingRegular = true;
    patient.itwMustTransport = false;
    itw.supportOnly = true;
    itw.statusText = `${patient.label} bis Uebergabe an regulaere Rettungsmittel versorgt`;
    logRadio(`${itw.name}: Regulaere Rettungsmittel sollen nachgefuehrt werden (${(request.regularRequired || []).join(" + ")}).`, "radio", incident.id);
    maybeRequestAdditionalResources(itw, incident);
  } else {
    patient.itwAwaitingRegular = false;
    patient.itwMustTransport = true;
    itw.supportOnly = false;
    itw.statusText = `${patient.label} wird durch ITW weiter versorgt`;
    logRadio(`${itw.name}: ITW uebernimmt Versorgung und Transport.`, "radio", incident.id);
    scheduleTreatmentCompletion(itw, incident);
  }
  renderAll();
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
    logRadio(`${vehicle.name}: Wartet mit Transportzielabfrage auf ELRD.`, "radio", incident.id);
    scheduleTreatmentCompletion(vehicle, incident);
    openIncidentDialog(incident);
  } else {
    patient.waitForElrdBeforeTransport = false;
    patient.elrdWaitBypassed = true;
    logRadio(`${vehicle.name}: ELRD wird nicht abgewartet, Transportzielabfrage folgt.`, "radio", incident.id);
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
  logRadio(`${rtw.name}: Kein KTW zeitnah verfügbar, RTW übernimmt Transport.`, "radio", incident.id);
    scheduleTreatmentCompletion(rtw, incident);
    renderAll();
    return;
  }
  patient.awaitingKtwHandover = true;
  patient.rtwMustTransport = false;
  patient.supportCapReachedAt = simMinuteNow();
  patient.supportCapValue = Math.min(patientTreatmentProgress(patient, incident), 0.95);
  logRadio(`${rtw.name}: KTW soll nachgeführt werden, Versorgung bis Übergabe.`, "radio", incident.id);
  openIncidentDialog(incident);
  scheduleTreatmentCompletion(rtw, incident);
  renderAll();
}

function applyAssistanceAlternative(incidentId, mode, patientId = null) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident?.assistanceDecision) return;
  const patient = patientId ? (incident.patient?.patients || []).find((item) => item.id === patientId) : null;
  const affectedPatients = patient ? [patient] : (incident.patient?.patients || []).filter((item) => !item.completed && !item.transporting);
  if (affectedPatients.some((item) => item.acuity === "reanimation")) {
    logRadio(`Rueckfrage ${incident.keyword}: nicht moeglich, Reanimation erfordert RTW und NEF.`, "warn", incident.id);
    dismissAssistanceAlternative(incident, mode, patientId);
    renderAll();
    return;
  }
  const withoutDoctor = ["without-doctor", "rtw-only", "ktw-only"].includes(mode);
  const withKtw = ["without-rtw", "ktw-only"].includes(mode);
  const chance = mode === "rtw-only" ? .25 : .5;
  const accepted = Math.random() < chance;
  if (!accepted) {
    logRadio(`Rückfrage ${incident.keyword}: nicht möglich, Nachforderung bleibt bestehen.`, "warn", incident.id);
    dismissAssistanceAlternative(incident, mode, patientId);
    renderAll();
    return;
  }
  if (patient) {
    if (withoutDoctor) removeRequirementFromPatient(patient, DOCTOR_REQUIREMENT_TYPES);
    if (withKtw) replaceRequirementForPatient(patient, "RTW", "KTW");
  } else {
    if (withoutDoctor) removeRequirementFromIncident(incident, DOCTOR_REQUIREMENT_TYPES);
    if (withKtw) replaceRequirementInIncident(incident, "RTW", "KTW");
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
      createdAtMinute: state.minute,
      createdAtAbsoluteMinute: simMinuteNow()
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
  logRadio(`Rückfrage ${incident.keyword}${patientText}: Alternative akzeptiert, Transport später mit Sondersignal.`, "radio", incident.id);
  rescheduleSceneTreatment(incident);
  renderAll();
}

function dismissAssistanceAlternative(incident, mode, patientId = null) {
  if (!incident?.assistanceDecision) return;
  incident.assistanceDecision.dismissedAlternatives ||= {};
  const key = patientId || "all";
  incident.assistanceDecision.dismissedAlternatives[key] ||= [];
  if (!incident.assistanceDecision.dismissedAlternatives[key].includes(mode)) {
    incident.assistanceDecision.dismissedAlternatives[key].push(mode);
  }
}

function removeRequirementFromPatient(patient, types) {
  if (patient?.acuity === "reanimation") return;
  patient.required = (patient.required || []).filter((type) => !types.includes(type));
}

function removeRequirementFromIncident(incident, types) {
  (incident.patient?.patients || []).forEach((patient) => {
    removeRequirementFromPatient(patient, types);
  });
  incident.required = (incident.required || []).filter((type) => !types.includes(type));
}

function replaceRequirementForPatient(patient, fromType, toType) {
  if (patient?.acuity === "reanimation") return;
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
    if (patient.supportCapReachedAt) patient.supportCapReachedAt = simMinuteNow();
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
  title.textContent = "Alarmierte Fahrzeuge und Komponenten";
  wrapper.append(title);
  const vehicles = incident.assigned
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  const groups = (state.center.supportGroups || []).filter((group) => {
    const dispatch = state.supportGroupStates[group.id];
    return dispatch?.incidentId === incident.id && (dispatch.pending || !vehicles.some((vehicle) => vehicle.supportGroupId === group.id));
  });
  if (!vehicles.length && !groups.length) {
    const empty = document.createElement("span");
    empty.textContent = "noch keine";
    wrapper.append(empty);
    return wrapper;
  }
  for (const group of groups) {
    const line = document.createElement("span");
    line.className = "incident-component-chip";
    line.textContent = `${supportGroupDisplayName(group)} · alarmiert, wartet auf Ausrücken`;
    wrapper.append(line);
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
    const units = patient.deceased && !patient.completed
      ? "verstorben, Todesfeststellung offen"
      : patient.completed
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
    const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId) || patientForVehicle(vehicle, incident);
    const canChooseDestination = vehicle?.status === 4 || (vehicle?.status === 7 && request.destinationChange);
    const patientTransportReady = request.destinationChange || !patient || patientReadyForTransport(patient, incident);
    return canChooseDestination
      && patientTransportReady
      && (!patient || vehicleCanTransportPatient(vehicle, patient));
  });
}

function renderTransportDestinationNotice(incident, requests = activeTransportRequests(incident)) {
  const box = document.createElement("section");
  box.className = "transport-destination-notice";
  const patients = requests
    .map((request) => (incident.patient?.patients || []).find((patient) => patient.id === request.patientId))
    .filter(Boolean);
  const label = requests.length === 1
    ? `Transportziel fuer ${patients[0]?.label || "Patient"} erforderlich`
    : `Transportziele fuer ${requests.length} Patienten erforderlich`;
  const departments = [...new Set(requests.map((request) => {
    const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
    return request.requiredDepartment || patient?.requiredDepartment || "Fachrichtung nach Rueckmeldung";
  }))];
  box.innerHTML = `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(departments.join(" | "))}</span>
    </div>
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Transportziel zuweisen";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openTransportDestinationDialog(incident.id);
  });
  box.append(button);
  return box;
}

function openTransportDestinationDialog(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident || !el.transportDestinationDialog) return;
  el.transportDestinationDialog.dataset.incidentId = incident.id;
  renderTransportDestinationDialog(incident, activeTransportRequests(incident), true);
  showDialog(el.transportDestinationDialog);
}

function renderTransportDestinationDialogIfOpen() {
  if (!el.transportDestinationDialog?.open) return;
  const incidentId = el.transportDestinationDialog.dataset.incidentId;
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident || incident.status === "geschlossen") {
    el.transportDestinationDialog.close();
    return;
  }
  const requests = activeTransportRequests(incident);
  if (!requests.length) {
    el.transportDestinationDialog.close();
    return;
  }
  const renderKey = transportDestinationRenderKey(incident, requests);
  if (el.transportDestinationDialog.dataset.renderKey === renderKey) return;
  renderTransportDestinationDialog(incident, requests);
}

function renderTransportDestinationDialog(incident, requests = activeTransportRequests(incident), force = false) {
  if (!el.transportDestinationBody) return;
  const renderKey = transportDestinationRenderKey(incident, requests);
  if (!force && el.transportDestinationDialog?.dataset.renderKey === renderKey) return;
  if (el.transportDestinationDialog) el.transportDestinationDialog.dataset.renderKey = renderKey;
  el.transportDestinationBody.innerHTML = "";
  const summary = document.createElement("section");
  summary.className = "transport-destination-summary";
  summary.innerHTML = `
    <strong>${escapeHtml(incident.keyword)}</strong>
    <span>${escapeHtml(incident.location || "Einsatzort")} | ${requests.length} offene Zuweisung${requests.length === 1 ? "" : "en"}</span>
  `;
  el.transportDestinationBody.append(summary);
  requests.forEach((request) => {
    const section = document.createElement("section");
    section.className = "transport-choice transport-choice-dialog";
    appendTransportRequestHeader(section, incident, request);
    appendForeignHospitalToggle(section, incident, request);
    appendHospitalChoices(section, incident, request);
    el.transportDestinationBody.append(section);
  });
}

function transportDestinationRenderKey(incident, requests = activeTransportRequests(incident)) {
  return [
    incident?.id || "",
    state.showForeignHospitalsInTransport ? "foreign" : "local",
    state.center.hospitals.map((hospital) => Number(hospitalIsUnavailable(hospital))).join(""),
    ...requests.map((request) => `${request.id || ""}:${request.vehicleId || ""}:${request.patientId || ""}:${request.destinationChange ? "change" : "new"}`)
  ].join("|");
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
    const unavailable = hospitalIsUnavailable(hospital);
    button.disabled = Boolean(incident.modId && !hospital.suitable);
    button.className = `${hospital.suitable ? "hospital-choice suitable" : "hospital-choice unsuitable"}${hospital.foreign ? " foreign-hospital" : ""}${unavailable ? " unavailable-hospital" : ""}`;
    const prefix = hospital.foreign ? "Fremd-KH: " : "";
    const suffix = unavailable ? " - abgemeldet" : "";
    button.textContent = `${prefix}${hospital.label}${suffix} (${hospital.distance.toFixed(1).replace(".", ",")} km)`;
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
  if (!incident || incident.modId || !hospital || !request || hospital.distance <= 30 || request.rthPrompted) return false;
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
  logRadio(`RTH fuer langen Transport nach ${hospital.label} nachgefordert. Krankenhausauswahl bleibt offen.`, "warn", incident.id);
  assignVehicle(rth.id, incident.id);
  renderAll();
}

function findAvailableRthForLongTransport(incident) {
  return state.vehicles
    .filter((vehicle) => isAirMedicalVehicle(vehicle.type) && !vehicle.foreign && isAlarmable(vehicle) && !vehicle.nextIncidentId)
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
  const elapsed = Math.max(0, simMinuteNow() - incident.patient.treatmentStartedAt);
  return Math.min(1, elapsed / treatmentMinutes(incident));
}

function patientTreatmentProgress(patient, incident) {
  if (patient.deceased && !patient.completed) return 0;
  if (patient.completed || patient.transporting) return 1;
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4);
  if (!assigned.length) return 0;
  const { cap, support } = currentTreatmentCap(patient, incident, assigned);
  const supportCapReachedAt = patient.supportCapReachedAt;
  const supportCapValue = patient.supportCapValue ?? 0.8;
  let startedAt = patient.treatmentStartedAt ?? incident.patient?.treatmentStartedAt ?? simMinuteNow();
  let baseProgress = 0;
  if (supportCapReachedAt) {
    baseProgress = supportCapValue;
    if (cap > supportCapValue) {
      if (patient.treatmentResumedFromCap !== supportCapValue) {
        patient.treatmentResumedAt = simMinuteNow();
        patient.treatmentResumedFromCap = supportCapValue;
      }
      startedAt = patient.treatmentResumedAt ?? simMinuteNow();
    } else {
      startedAt = supportCapReachedAt;
    }
  }
  patient.treatmentStartedAt ??= startedAt;
  const elapsed = Math.max(0, simMinuteNow() - startedAt);
  const progress = Math.min(cap, baseProgress + elapsed / patientTreatmentMinutes(patient, incident));
  if (support && progress >= cap) {
    patient.supportCapReachedAt = patient.supportCapValue === cap && patient.supportCapReachedAt
      ? patient.supportCapReachedAt
      : simMinuteNow();
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
  if (assigned.length && assigned.every((vehicle) => isStabilizerVehicle(vehicle.type))) {
    return { cap: 0, support: true };
  }
  if (patient.awaitingKtwHandover && !patient.rtwMustTransport && !assigned.some((vehicle) => vehicle.type === "KTW")) {
    return { cap: 0.95, support: true };
  }
  const missing = patientMissingTypes(patient);
  if (!missing.length) return { cap: 1, support: false };
  const hasDoctorSupport = assigned.some((vehicle) => isDoctorVehicle(vehicle.type));
  const hasRthSupport = assigned.some((vehicle) => isAirMedicalVehicle(vehicle.type));
  const hasRefSupport = assigned.some((vehicle) => vehicle.type === "REF");
  const hasElrdSupport = assigned.some((vehicle) => vehicle.type === "ELRD");
  const waitingOnlyForTransport = missing.every((type) => ["RTW", "KTW", "ITW"].includes(type));
  if (hasRthSupport && waitingOnlyForTransport) return { cap: 1, support: false };
  if (hasDoctorSupport && waitingOnlyForTransport) return { cap: 0.8, support: true };
  if (hasRefSupport) {
    if (missing.some(isDoctorRequirement)) return { cap: 0.5, support: true };
    if (waitingOnlyForTransport) return { cap: 0.8, support: true };
  }
  const hasKtwFirstResponse = assigned.some((vehicle) => vehicle.type === "KTW" && vehicle.supportOnly);
  const hasRequiredTransportUnit = assigned.some((vehicle) => (patient.required || []).some((type) => ["RTW", "KTW", "ITW"].includes(type) && vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)));
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
    .some((vehicle) => vehicle && isRoadTransportVehicle(vehicle.type) && vehicle.status === 4);
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
    cancelScheduledTimeout(vehicle.dispatchTimer);
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
  incident.status = incident.assigned.length ? "in Bearbeitung" : incidentHasDisposition(incident) ? "alarmiert" : "offen";
  vehicle.handoverTimer = scheduleTimeout(() => clearVehicle(vehicle.id), simulationDelay(handoverMinutes()));
  logRadio(`${vehicle.name}: Folgeeinsatz zurückgenommen, bleibt zunächst am Krankenhaus.`, "warn", incident.id);
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
    incident.status = incident.assigned.length ? "in Bearbeitung" : incidentHasDisposition(incident) ? "alarmiert" : "offen";
  }
}

function removeAssignedVehicle(vehicleId, incidentId, { refreshDialog = true } = {}) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || !canRemoveAssignedVehicle(vehicle, incident)) return;

  releasePatientAssignment(vehicle);
  if (vehicle.dispatchTimer) {
    cancelScheduledTimeout(vehicle.dispatchTimer);
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
  incident.status = incident.assigned.length ? "in Bearbeitung" : incidentHasDisposition(incident) ? "alarmiert" : "offen";
  clearResolvedAssistanceNeeds(incident);
  logRadio(`${vehicle.name}: vom Einsatz ${incident.keyword} zurückgenommen.`, "warn", incident.id);
  if (refreshDialog && el.incidentDialog.open && state.editingIncidentId === incident.id) renderDialogVehicles(incident, incident);
  renderAll();
}

function statusTextForIdleVehicle(vehicle) {
  if (vehicle.status === 1) return "frei über Funk";
  if (vehicle.status === 2) return vehicle.foreign ? "auf Fremdwache verfügbar" : "auf Wache";
  return vehicle.statusText || "frei";
}

function renderIncidentSelectedTypes(incident) {
  const assignedIds = new Set(incident?.assigned || []);
  const selected = [];
  const assigned = [];
  for (const vehicle of state.vehicles) {
    if (assignedIds.has(vehicle.id)) assigned.push(vehicle.type);
    else if (state.selectedDialogVehicleIds.has(vehicle.id)) selected.push(vehicle.type);
  }
  const source = incident || currentIncidentDialogSource();
  const defaults = dispositionDefaults(source);
  const required = defaults ? addElrdToRequiredForDialog(defaults.required, source) : [];
  const groups = (state.center.supportGroups || []).filter((group) => state.selectedDialogGroupIds.has(group.id));
  const missing = missingDispositionVehicleTypes(required, [...selected, ...assigned,
    ...groups.flatMap((group) => supportGroupUnits(group).map((unit) => unit.type))]);
  const summary = [...vehicleTypeCounts(selected), ...groups.map(supportGroupDisplayName)]
    .join(" · ") || (assigned.length ? "Keine neuen Fahrzeuge" : "Keine Fahrzeuge");
  const assignedSummary = assigned.length ? `Zugeordnet · ${vehicleTypeCounts(assigned).join(" · ")}` : "";
  const shortfall = missing.length ? `Fehlt · ${vehicleTypeCounts(missing).join(" · ")}` : "";
  if (el.incidentSelectedTypes.textContent !== summary) el.incidentSelectedTypes.textContent = summary;
  if (el.incidentAssignedTypes.textContent !== assignedSummary) el.incidentAssignedTypes.textContent = assignedSummary;
  el.incidentAssignedTypes.hidden = !assignedSummary;
  if (el.incidentMissingTypes.textContent !== shortfall) el.incidentMissingTypes.textContent = shortfall;
  el.incidentMissingTypes.hidden = !shortfall;
}

function renderDialogSupportGroups(call, incident, filters) {
  const groups = state.center.supportGroups || [];
  if (!groups.length) return null;
  const toggle = document.createElement("label");
  toggle.className = "foreign-vehicle-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = state.showSupportGroupsInDialog;
  checkbox.addEventListener("change", () => {
    state.showSupportGroupsInDialog = checkbox.checked;
    renderDialogVehicles(call, incident);
    el.dialogVehicleTools.querySelector("[data-support-toggle]")?.focus();
  });
  checkbox.dataset.supportToggle = "";
  toggle.append(checkbox, `SEG / UGRD (${groups.length})`);
  filters.append(toggle);
  if (!checkbox.checked) return null;

  const list = document.createElement("section");
  list.className = "dialog-support-groups";
  list.setAttribute("aria-label", "SEG- und UGRD-Komponenten");
  for (const group of groups) {
    const dispatch = supportGroupState(group.id);
    const available = supportGroupCanAlarm(group, dispatch);
    const lock = supportGroupLockRemainingMinutes(dispatch);
    const selected = state.selectedDialogGroupIds.has(group.id);
    const row = document.createElement("button");
    row.className = `dialog-vehicle-row dialog-support-row${selected ? " selected" : ""}`;
    row.type = "button";
    row.disabled = !available && !selected;
    row.setAttribute("aria-pressed", String(selected));
    const name = supportGroupDisplayName(group);
    const names = vehicleTypeCounts(supportGroupUnits(group).map((unit) => unit.type)).join(" · ");
    const status = lock ? `Nicht verfügbar · ${lock} min`
      : available ? `Alarmierbar · Ausrücken bis ${supportGroupResponseWindow(group).max} min`
        : dispatch.incidentId && dispatch.incidentId === incident?.id ? "Diesem Einsatz zugeteilt" : "Gebunden";
    row.innerHTML = `<div><h3>${escapeHtml(name)}</h3><p>${escapeHtml([names, status].filter(Boolean).join(" · "))}</p></div>`;
    row.addEventListener("click", () => {
      const next = !state.selectedDialogGroupIds.has(group.id);
      if (next && !supportGroupCanAlarm(group)) return;
      if (next) state.selectedDialogGroupIds.add(group.id);
      else state.selectedDialogGroupIds.delete(group.id);
      state.suggestedDialogGroupIds.delete(group.id);
      row.classList.toggle("selected", next);
      row.setAttribute("aria-pressed", String(next));
      renderIncidentSelectedTypes(incident);
    });
    list.append(row);
  }
  return list;
}

function renderDialogVehicles(call, incident = null) {
  renderIncidentSelectedTypes(incident);
  el.dialogVehicleList.innerHTML = "";
  const assignedIds = new Set(incident?.assigned || []);
  const unavailableIds = new Set([...assignedIds, ...state.selectedDialogVehicleIds]);
  const filters = document.createElement("div");
  filters.className = "dialog-vehicle-filter";
  filters.append(createDialogVehicleTypeFilter(call, incident));
  const foreignToggle = document.createElement("label");
  foreignToggle.className = "foreign-vehicle-toggle";
  const foreignInput = document.createElement("input");
  foreignInput.type = "checkbox";
  foreignInput.checked = Boolean(state.showForeignVehiclesInDialog);
  foreignInput.addEventListener("change", () => {
    state.showForeignVehiclesInDialog = foreignInput.checked;
    renderDialogVehicles(call, incident);
  });
  const foreignAvailableCount = state.vehicles.filter(foreignVehicleAvailableForDisposition).length;
  foreignToggle.append(foreignInput, document.createTextNode(`Fremdfahrzeuge (${foreignAvailableCount})`));
  filters.append(foreignToggle);
  const groups = renderDialogSupportGroups(call, incident, filters);
  el.dialogVehicleTools.replaceChildren(filters);
  renderQuickVehicleButtons(call, unavailableIds, incident);
  if (groups) el.dialogVehicleList.append(groups);
  if (assignedIds.size) {
    const isManv = incident.modId === "manv";
    const assigned = document.createElement(isManv ? "details" : "section");
    assigned.className = "assigned-vehicles-note";
    const title = document.createElement(isManv ? "summary" : "strong");
    title.textContent = isManv ? `Bereits zugeordnet (${assignedIds.size})` : "Bereits zugeordnet";
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
      if (vehicle.supportGroupId && state.supportGroupStates[vehicle.supportGroupId]?.incidentId) return false;
      if (state.dialogVehicleTypeFilter !== "all" && vehicle.type !== state.dialogVehicleTypeFilter) return false;
      if (vehicle.foreign) return state.showForeignVehiclesInDialog && foreignVehicleAvailableForDisposition(vehicle);
      return isAlarmable(vehicle) || isPendingStatusC(vehicle) || vehicle.status === 3;
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
      const isSelected = state.selectedDialogVehicleIds.has(vehicle.id);
      const ugrdBadge = vehicle.ugrdAvailabilityProbability === undefined ? ""
        : `<span class="dialog-ugrd-badge" title="Ausrückwahrscheinlichkeit auf Wache: ${Math.round(normalizeProbability(vehicle.ugrdAvailabilityProbability, 1) * 100)} %">UGRD</span>`;
      row.type = "button";
      row.setAttribute("aria-pressed", String(isSelected));
      row.className = `dialog-vehicle-row ${vehicle.foreign ? "foreign-vehicle-row" : ""} ${shiftNotice ? `shift-${shiftNotice.type}` : ""} ${isSelected ? "selected" : ""}`;
      row.innerHTML = `
        <div>
          <h3><span class="vehicle-type-badge">${escapeHtml(vehicle.type)}</span><span class="dialog-vehicle-name">${escapeHtml(vehicle.name)}</span>${ugrdBadge}</h3>
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
        const wasSelected = state.selectedDialogVehicleIds.has(vehicle.id);
        if (wasSelected) {
          state.selectedDialogVehicleIds.delete(vehicle.id);
        } else {
          state.selectedDialogVehicleIds.add(vehicle.id);
        }
        row.classList.toggle("selected", !wasSelected);
        row.setAttribute("aria-pressed", String(!wasSelected));
        renderIncidentSelectedTypes(incident);
      });
      el.dialogVehicleList.append(row);
      if (autoTravelTimeIds.has(vehicle.id)) requestDialogTravelTime(vehicle, call);
    });
}

function createDialogVehicleTypeFilter(call, incident) {
  const label = document.createElement("label");
  label.textContent = "Fahrzeugklasse";
  const select = document.createElement("select");
  const types = ["all", ...vehicleTypeFilterOptions()];
  types.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type === "all" ? "Alle" : type;
    select.append(option);
  });
  select.value = types.includes(state.dialogVehicleTypeFilter) ? state.dialogVehicleTypeFilter : "all";
  select.addEventListener("change", () => {
    state.dialogVehicleTypeFilter = select.value;
    renderDialogVehicles(call, incident);
  });
  label.append(select);
  return label;
}

function vehicleTypeFilterOptions() {
  const preferred = ["RTW", "KTW", "NEF", "VEF", "REF", "ITW", "RTH", "ITH", "ELRD", "HVO", "FR"];
  const existing = new Set(state.vehicles.map((vehicle) => vehicle.type).filter(Boolean));
  return preferred.filter((type) => existing.has(type));
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
  wrapper.setAttribute("aria-label", "Fahrzeug-Schnellwahl");
  const options = automaticDispositionPolicy(call, el.incidentKeyword.value, state.center.manvSegTransportCount, state.manvAvailable);
  [
    { label: "RTW", types: ["RTW"] },
    { label: "KTW", types: ["KTW"] },
    { label: "NEF", types: ["NEF"] },
    { label: "VEF", types: ["VEF"] },
    { label: "ITW", types: ["ITW"] },
    { label: "RTH/ITH", types: ["RTH", "ITH"] },
    { label: "ELRD", types: ["ELRD"] },
    { label: "HvO/FR", types: ["HVO", "FR"] }
  ].forEach((group) => {
    const vehicle = nearestFreeVehicleOfTypes(call, group.types, assignedIds, options);
    const shiftNotice = shiftNoticeForVehicle(vehicle);
    const button = document.createElement("button");
    button.type = "button";
    if (shiftNotice) button.classList.add(`shift-${shiftNotice.type}`);
    button.title = [vehicle?.shortName || vehicle?.name, shiftNotice?.text].filter(Boolean).join(" · ");
    button.innerHTML = `<strong>${escapeHtml(group.label)}</strong>`;
    button.disabled = !vehicle;
    button.addEventListener("click", () => {
      const candidate = nearestFreeVehicleOfTypes(call, group.types, assignedIds, options);
      if (!candidate) return;
      state.selectedDialogVehicleIds.add(candidate.id);
      if (candidate.foreign) state.showForeignVehiclesInDialog = true;
      renderDialogVehicles(call, incident);
    });
    wrapper.append(button);
  });
  const previous = el.dialogVehicleTools.querySelector(".quick-vehicle-picker");
  if (previous) previous.replaceWith(wrapper);
  else el.dialogVehicleTools.append(wrapper);
}

function nearestFreeVehicleOfType(call, type, assignedIds, options) {
  return nearestFreeVehicleOfTypes(call, [type], assignedIds, options);
}

function foreignVehicleAvailableForDisposition(vehicle) {
  return vehicle.foreign && [1, 2].includes(vehicle.status) && isAlarmable(vehicle);
}

function automaticDispositionVehicle(vehicle, { allowUgrd = false } = {}) {
  return !vehicle.supportGroupId && (allowUgrd || vehicle.ugrdAvailabilityProbability === undefined);
}

function nearestFreeVehicleOfTypes(call, types, assignedIds, options) {
  const typeSet = new Set(types);
  return state.vehicles
    .filter((vehicle) => automaticDispositionVehicle(vehicle, options) && !assignedIds.has(vehicle.id)
      && typeSet.has(vehicle.type) && (vehicle.foreign ? foreignVehicleAvailableForDisposition(vehicle) : isAlarmable(vehicle)))
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

function upcomingFirstShiftStart(vehicle, windowMinutes = 20) {
  if (!vehicle || vehicle.foreign || vehicle.status !== 6 || vehicle.status6Reason) return null;
  const intervals = vehicleShiftIntervals(vehicle).filter((interval) => interval.valid && interval.label !== "24h");
  if (!intervals.length) return null;
  const now = Math.floor(state.minute) % 1440;
  const dayStarts = intervals
    .map((interval) => shiftStartMinuteFromLabel(interval.label))
    .filter((start) => Number.isFinite(start))
    .sort((a, b) => a - b);
  const next = intervals
    .map((interval) => ({ label: interval.label, start: shiftStartMinuteFromLabel(interval.label) }))
    .filter((item) => Number.isFinite(item.start))
    .map((item) => ({ ...item, minutes: (item.start - now + 1440) % 1440 }))
    .filter((item) => item.minutes > 0 && item.minutes <= windowMinutes)
    .sort((a, b) => a.minutes - b.minutes)[0];
  if (!next) return null;
  if (dayStarts.length && next.start !== dayStarts[0]) return null;
  return {
    ...next,
    key: `${next.label}:${next.start}`,
    probability: preShiftAvailabilityProbability(next.minutes, windowMinutes)
  };
}

function preShiftAvailabilityProbability(minutesUntilStart, windowMinutes = 20) {
  if (minutesUntilStart <= 1) return .9;
  const progress = (windowMinutes - minutesUntilStart) / Math.max(1, windowMinutes - 1);
  return Math.max(.2, Math.min(.9, .2 + progress * .7));
}

function shiftStartMinuteFromLabel(label) {
  const start = String(label || "").split("-")[0];
  if (!start) return NaN;
  const [hour, minute = "0"] = start.split(":");
  return shiftTimeToMinute(hour, minute);
}

function vehicleVisibleInFleet(vehicle) {
  return !vehicle.foreign && !vehicle.awaitingSupportDeparture
    && (!["LNA", "ORGL"].includes(vehicle.type) || vehicle.status === 3);
}

function renderVehicles() {
  const vehicleSortName = (vehicle) => vehicle.shortName || vehicle.name;
  const typeOrder = { RTW: 1, ITW: 2, NEF: 3, VEF: 4, KTW: 5, REF: 6, RTH: 7, ITH: 8, ELRD: 9, HVO: 10, FR: 11 };
  const vehicleTypeRank = (vehicle) => typeOrder[vehicle.type] || 99;
  const statusRank = (vehicle) => vehicle.status === 6 ? 99 : vehicle.status;
  const sorted = state.vehicles.filter(vehicleVisibleInFleet).sort((a, b) => {
    if (el.vehicleSort.value === "status") return statusRank(a) - statusRank(b) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    if (el.vehicleSort.value === "type") return a.type.localeCompare(b.type) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    if (el.vehicleSort.value === "type-status") return statusRank(a) - statusRank(b) || vehicleTypeRank(a) - vehicleTypeRank(b) || vehicleSortName(a).localeCompare(vehicleSortName(b));
    return a.station.localeCompare(b.station) || vehicleSortName(a).localeCompare(vehicleSortName(b));
  });

  el.vehicleList.innerHTML = "";
  sorted.forEach((vehicle) => {
    const displayName = vehicle.shortName || vehicle.name;
    const isOpen = vehicle.id === state.selectedVehicleId;
    const preShiftNotice = preShiftNoticeForVehicle(vehicle);
    const row = document.createElement("article");
    row.className = `vehicle-row ${isOpen ? "active" : ""} ${vehicle.shiftWarning ? "shift-warning" : ""} ${preShiftNotice ? "pre-shift-available" : ""}`;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "vehicle-summary";
    summary.innerHTML = `
      <em class="vehicle-status-strip status-${vehicleDisplayStatus(vehicle)}">${vehicleDisplayStatus(vehicle)}</em>
      <strong>${escapeHtml(displayName)}</strong>
      <span class="vehicle-type-label vehicle-type-${escapeHtml(vehicle.type)}">${escapeHtml(vehicle.type)}</span>
      <span class="vehicle-station-name">${escapeHtml(vehicle.station)}</span>
      ${vehicle.ugrdAvailabilityProbability !== undefined || vehicle.supportGroupId ? ""
        : `<span class="vehicle-shift-summary">${shiftSummaryBadgesHtml(vehicle)}</span>`}
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
      if (preShiftNotice) appendTextBlock(details, "p", preShiftNotice.text);
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
      if (preShiftNotice?.actionable) addVehicleAction(actions, "Anruf vor Schichtbeginn?", () => askPreShiftAvailability(vehicle.id));
      if (vehicle.status === 7 && !vehicle.boundTransportVehicleId) addVehicleAction(actions, "Zielort ändern", () => changeTransportDestination(vehicle.id));
      if (vehicle.supportGroupId) addVehicleAction(actions, "SEG / UGRD einrücken", () => recallSupportGroupVehicle(vehicle.id));
      if (canReleaseAccompanyingDoctor(vehicle)) addVehicleAction(actions, "abkömmlich frei", () => releaseAccompanyingDoctor(vehicle.id));
      if (canAskAccompanyingDoctorRelease(vehicle)) addVehicleAction(actions, "Abkoemmlich?", () => askAccompanyingDoctorRelease(vehicle.id));
      if (vehicle.status === 8) addVehicleAction(actions, "Einsatzklar?", () => askVehicleReadiness(vehicle.id));
      details.append(actions);
      row.append(details);
    }
    el.vehicleList.append(row);
  });
}

function shiftSummaryBadgesHtml(vehicle) {
  const intervals = vehicleShiftIntervals(vehicle);
  const ended = vehicle.shiftWarning || !intervals.some((interval) => interval.active)
    ? intervals.filter((interval) => interval.expired).sort((a, b) => a.minutesSinceEnd - b.minutesSinceEnd)[0] : null;
  const chips = intervals.map((interval) => {
    const classes = [
      "shift-summary-chip",
      interval.active ? "active" : "inactive",
      interval.endingSoon ? "ending" : "",
      interval === ended ? "expired" : ""
    ].filter(Boolean).join(" ");
    return `<small class="${classes}">${escapeHtml(interval.label)}</small>`;
  }).join("");
  const schedule = intervals.map((interval) => interval.label).join(", ");
  return `<span class="shift-summary-list" title="${escapeHtml(schedule)}">${chips}</span>`;
}

function shiftNoticeForVehicle(vehicle) {
  if (!vehicle) return null;
  const intervals = vehicleShiftIntervals(vehicle);
  const active = intervals.find((interval) => interval.active);
  if (vehiclePreShiftActive(vehicle)) {
    return {
      type: "pre-start",
      text: "vorzeitig ausgerueckt"
    };
  }
  if (vehicle.shiftWarning) {
    return {
      type: "overtime",
      text: "Schichtende überschritten"
    };
  }
  const preShiftNotice = preShiftNoticeForVehicle(vehicle);
  if (preShiftNotice) {
    return {
      type: "pre-start",
      text: `Beginn: ${preShiftNotice.minutes} min`
    };
  }
  if (active?.endingSoon) {
    const endMinute = shiftEndMinuteFromLabel(active.label);
    const minutes = shiftMinutesUntilEnd(Math.floor(state.minute) % 1440, endMinute);
    return {
      type: "ending",
      text: Number.isFinite(minutes) ? `Feierabend: ${minutes} min` : "Feierabend",
      endTime: Number.isFinite(endMinute) ? timeLabel(endMinute % 1440) : null
    };
  }
  return null;
}

function preShiftNoticeForVehicle(vehicle) {
  const next = upcomingFirstShiftStart(vehicle);
  if (!next) return null;
  const rejected = vehicle.preShiftRejectedStartKey === next.key;
  return {
    ...next,
    actionable: !rejected,
    text: rejected
      ? `Dienstbeginn in ${next.minutes} min, vorzeitiger Anruf bereits abgelehnt.`
      : `Dienstbeginn in ${next.minutes} min, vorzeitige Indienstnahme ${Math.round(next.probability * 100)}% wahrscheinlich.`
  };
}

function askPreShiftAvailability(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const notice = preShiftNoticeForVehicle(vehicle);
  if (!vehicle || !notice?.actionable) return;
  if (Math.random() < notice.probability) {
    vehicle.status = 2;
    vehicle.statusText = "vorzeitig auf Wache";
    vehicle.radioStatus = 5;
    vehicle.radioContext = "shift-start";
    vehicle.radioMessage = `${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} vorzeitig einsatzklar`;
    vehicle.awaitingSpeechPrompt = false;
    vehicle.preShiftActiveUntilAbsoluteMinute = renderSimMinuteNow() + notice.minutes;
    vehicle.preShiftRejectedStartKey = null;
    logRadio(`${vehicle.name}: Status 5 - Sprechwunsch zur vorzeitigen Indienstmeldung.`, "radio");
  } else {
    vehicle.preShiftRejectedStartKey = notice.key;
    vehicle.statusText = `ausser Dienst, Dienstbeginn in ${notice.minutes} min`;
    logRadio(`${vehicle.name}: Vor Schichtbeginn nicht moeglich, melden uns puenktlich an.`, "warn");
  }
  renderAll();
}

function shiftEndMinuteFromLabel(label) {
  const end = String(label || "").split("-")[1];
  if (!end) return NaN;
  const [hour, minute = "0"] = end.split(":");
  return shiftTimeToMinute(hour, minute);
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
  logRadio(`${vehicle.name}: Ortung gesendet, aktuelle Position auf Karte markiert.`, "radio", vehicle.incidentId || vehicle.nextIncidentId);
}
