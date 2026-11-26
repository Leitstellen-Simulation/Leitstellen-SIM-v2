const POST_TRANSPORT_CLEANUP_PROBABILITY = {
  KTW: 0.004,
  RTW: 0.008,
  RTH: 0.006,
  ITH: 0.006
};
const GLOBAL_TRAVEL_SPEED_FACTOR = 1.25;
const DOCTOR_VEHICLE_TYPES = ["NEF", "VEF", "RTH", "ITH", "ITW"];
const DOCTOR_REQUIREMENT_TYPES = ["NEF", "VEF", "RTH"];
const AIR_MEDICAL_VEHICLE_TYPES = ["RTH", "ITH"];
const ROAD_TRANSPORT_VEHICLE_TYPES = ["KTW", "RTW", "ITW"];
const TRANSPORT_VEHICLE_TYPES = ["KTW", "RTW", "RTH", "ITH", "ITW"];
const ROAD_TRANSPORT_REQUIREMENT_TYPES = ["KTW", "RTW", "ITW"];
const STABILIZER_VEHICLE_TYPES = ["HVO", "FR"];
const DETERIORATION_SUPPORT_VEHICLE_TYPES = ["HVO", "FR", "ELRD"];
const SUPPORT_GROUP_LOCKOUT_MINUTES = 45;

function simMinuteNow() {
  return Number.isFinite(state.absoluteMinute) ? state.absoluteMinute : state.minute;
}

function supportGroupLockRemainingMinutes(groupState) {
  const until = Number(groupState?.lockedUntilAbsoluteMinute);
  if (!Number.isFinite(until)) return 0;
  const remaining = Math.ceil(until - simMinuteNow());
  if (remaining <= 0 && groupState) {
    groupState.lockedUntilAbsoluteMinute = null;
    if (groupState.status === "locked") groupState.status = "bereit";
    return 0;
  }
  return remaining;
}

function supportGroupCanAlarm(group, dispatch = supportGroupState(group.id)) {
  return supportGroupUnits(group).length > 0 && !dispatch.incidentId && dispatch.status !== "alarmed"
    && !dispatch.pending && !dispatch.activeVehicleIds.length && supportGroupLockRemainingMinutes(dispatch) === 0;
}

function incidentHasDisposition(incident) {
  return Boolean(incident.assigned?.length)
    || Object.values(state.supportGroupStates || {}).some((dispatch) => dispatch.incidentId === incident.id);
}

function reopenIncidentWithoutDisposition(incident) {
  if (incident && incident.status !== "geschlossen" && !incidentHasDisposition(incident)) incident.status = "offen";
}

function alarmIncidentResources(incident, vehicleIds, groupIds) {
  const alarmBatch = { entries: [], summarized: false };
  vehicleIds.forEach((id) => assignVehicle(id, incident.id, alarmBatch));
  for (const groupId of groupIds) {
    if (alarmSupportGroup(groupId, incident.id, alarmBatch)) continue;
    const group = state.center.supportGroups.find((entry) => entry.id === groupId);
    const name = group ? supportGroupDisplayName(group) : groupId;
    logRadio(`${name}: Alarmierung fehlgeschlagen, Komponente nicht mehr verfügbar.`, "warn", incident.id);
  }

  const count = alarmBatch.entries.reduce((sum, entry) => sum + entry.vehicleCount, 0);
  alarmBatch.summarized = count >= 5;
  if (alarmBatch.summarized) {
    const label = incident.modId === "manv" || /\bMANV\b/i.test(incident.keyword) ? "MANV-Alarm" : "Sammelalarm";
    logRadio(`${label} · ${count} Fahrzeuge alarmiert · ${incident.keyword}`, "warn", incident.id);
  } else {
    alarmBatch.entries.forEach(({ message, kind }) => logRadio(message, kind, incident.id));
  }
  alarmBatch.entries.length = 0;
}

function logDispatchAlarm(incidentId, message, kind, alarmBatch, vehicleCount = 1) {
  if (!alarmBatch) logRadio(message, kind, incidentId);
  else if (!alarmBatch.summarized) alarmBatch.entries.push({ message, kind, vehicleCount });
}

function alarmSupportGroup(groupId, incidentId, alarmBatch) {
  const group = (state.center?.supportGroups || []).find((item) => item.id === groupId);
  const incident = state.incidents.find((item) => item.id === incidentId && item.status !== "geschlossen");
  if (!group || !incident || !supportGroupCanAlarm(group)) return false;

  const dispatch = supportGroupState(group.id);
  const units = supportGroupUnits(group);
  const component = supportGroupKind(group) !== "ugrd";
  const probability = normalizeProbability(group.availabilityProbability ?? 0.75, 0.75);
  const { min, max } = supportGroupResponseWindow(group);
  const name = supportGroupDisplayName(group);
  const cycle = dispatch.alarmCycle = (dispatch.alarmCycle || 0) + 1;
  dispatch.status = "alarmed";
  dispatch.incidentId = incidentId;
  dispatch.pending = 0;
  if (incident.status === "offen") incident.status = "alarmiert";
  logDispatchAlarm(incidentId, `${name}: alarmiert zu ${incident.keyword}.`, "warn", alarmBatch, units.length);

  const responding = component
    ? (Math.random() < probability ? units : [])
    : units.filter((unit) => Math.random() < normalizeProbability(unit.availabilityProbability ?? probability, probability));
  const componentDelay = component ? randomRange(min, max) : null;
  responding.forEach((unit, index) => {
    dispatch.pending++;
    scheduleTimeout(() => {
      if (dispatch.alarmCycle !== cycle || dispatch.status !== "alarmed" || incident.status === "geschlossen") return;
      dispatch.pending--;
      const vehicle = createSupportGroupVehicle(group, unit, index);
      state.vehicles.push(vehicle);
      dispatch.activeVehicleIds.push(vehicle.id);
      assignVehicle(vehicle.id, incident.id, alarmBatch?.summarized ? alarmBatch : undefined);
      if (incident.modId) appMods.incidentEvent("group.unitAvailable", incident, { groupId, vehicleId: vehicle.id });
    }, simulationDelay(componentDelay ?? randomRange(min, max)));
  });
  const missing = units.length - responding.length;
  if (missing) scheduleTimeout(() => {
    if (dispatch.alarmCycle !== cycle || incident.status === "geschlossen") return;
    if (responding.length) {
      logRadio(`${name}: ${missing} von ${units.length} Fahrzeugen nach ${max} min nicht ausgerückt.`, "urgent", incidentId);
      return;
    }
    dispatch.status = "locked";
    dispatch.incidentId = null;
    reopenIncidentWithoutDisposition(incident);
    dispatch.lockedUntilAbsoluteMinute = simMinuteNow() + SUPPORT_GROUP_LOCKOUT_MINUTES;
    logRadio(`${name}: nach ${max} min nicht ausgerückt. ${SUPPORT_GROUP_LOCKOUT_MINUTES} min nicht verfügbar.`, "urgent", incidentId);
    if (incident.modId) appMods.incidentEvent("group.unavailable", incident, { groupId });
    renderAll();
  }, simulationDelay(max));
  renderAll();
  return true;
}

function createSupportGroupVehicle(group, unit, index) {
  const home = supportGroupLocation(state.center, group, unit);
  const type = unit.type || "RTW";
  const unitId = unit.id || `${group.id}-${index + 1}`;
  const name = unit.fullName || unit.name || `${type} ${group.label || group.id}/${index + 1}`;
  return {
    id: `ugrd-${group.id}-${unitId}-${Date.now()}-${index}`,
    name,
    shortName: unit.shortName || unit.short || name,
    type,
    label: vehicleTypeLabel(type),
    station: home.label,
    stationId: home.id,
    supportGroupId: group.id,
    supportGroupUnitId: unitId,
    awaitingSupportDeparture: true,
    background: true,
    temporary: true,
    status: 1,
    statusText: "UGRD/SEG einsatzbereit",
    lat: home.lat,
    lng: home.lng,
    target: null,
    incidentId: null,
    radioStatus: null,
    radioMessage: "",
    pendingRadioMessage: "",
    awaitingSpeechPrompt: false,
    waitingForSpeechPrompt: false,
    pendingTransportRequest: null,
    coveragePointId: null
  };
}

function standDownSupportGroup(groupId, incidentId = null) {
  const group = (state.center?.supportGroups || []).find((item) => item.id === groupId);
  const groupState = supportGroupState(groupId);
  if (groupState.incidentId && groupState.incidentId !== incidentId) return;
  const incident = state.incidents.find((entry) => entry.id === groupState.incidentId);
  groupState.incidentId = null;
  groupState.alarmCycle = (groupState.alarmCycle || 0) + 1;
  groupState.status = groupState.activeVehicleIds.length ? "standdown" : "bereit";
  groupState.pending = 0;
  state.vehicles
    .filter((vehicle) => vehicle.supportGroupId === groupId)
    .forEach((vehicle) => recallSupportGroupVehicle(vehicle.id));
  reopenIncidentWithoutDisposition(incident);
  logRadio(`${group?.label || groupId}: UGRD/SEG-Alarm beendet.`, "radio", incidentId);
  renderAll();
}

function standDownIncidentSupportGroups(incidentId) {
  for (const [groupId, dispatch] of Object.entries(state.supportGroupStates || {})) {
    if (dispatch.incidentId === incidentId) standDownSupportGroup(groupId, incidentId);
  }
}

function recallSupportGroupVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle?.supportGroupId) return;
  if ([7, 8].includes(vehicle.status) || vehicle.boundTransportVehicleId || vehicle.boundDoctorVehicleId
      || vehicle.modTransportOrder || vehicle.modEscortTransportId) {
    vehicle.statusText = vehicle.status === 8 ? "Übergabe im Krankenhaus, rückt danach ein" : "Rückt nach Transportende ein";
    return;
  }
  const oldIncidentId = vehicle.nextIncidentId || vehicle.incidentId;
  if (vehicle.dispatchTimer) clearDispatchTimer(vehicle);
  cancelVehicleRoute(vehicle);
  releasePatientAssignment(vehicle);
  if (oldIncidentId) detachVehicleFromIncident(vehicle.id, oldIncidentId);
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.incidentId = null;
  vehicle.patientId = null;
  vehicle.status = 1;
  vehicle.statusText = "UGRD/SEG rueckt ein";
  const group = state.center.supportGroups.find((entry) => entry.id === vehicle.supportGroupId);
  const home = supportGroupLocation(state.center, group || { id: vehicle.supportGroupId, label: vehicle.station }, vehicle);
  driveVehicleTo(vehicle, home, { signal: false, phase: "station" }, () => removeSupportGroupVehicle(vehicle.id));
}

function removeSupportGroupVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle?.supportGroupId) return;
  const groupState = supportGroupState(vehicle.supportGroupId);
  groupState.activeVehicleIds = (groupState.activeVehicleIds || []).filter((id) => id !== vehicle.id);
  state.vehicles = state.vehicles.filter((unit) => unit.id !== vehicle.id);
  if (["standdown", "alarmed"].includes(groupState.status) && !groupState.activeVehicleIds.length && !groupState.pending) {
    const incident = state.incidents.find((entry) => entry.id === groupState.incidentId);
    groupState.status = "bereit";
    groupState.incidentId = null;
    reopenIncidentWithoutDisposition(incident);
  }
  logRadio(`${vehicle.name}: UGRD/SEG eingerueckt, wieder ausser Dienst.`, "radio");
  renderAll();
}

function assignVehicle(vehicleId, incidentId, alarmBatch) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || incident.assigned.includes(vehicle.id)) return;
  const groupIncidentId = vehicle.supportGroupId && state.supportGroupStates?.[vehicle.supportGroupId]?.incidentId;
  if (groupIncidentId && groupIncidentId !== incident.id) return;

  if (vehicle.nextIncidentId && vehicle.nextIncidentId !== incident.id) {
    if (!vehicleCanBeRedispatchedBeforeResponse(vehicle)) return;
    removePendingVehicleFromPreviousIncident(vehicle, incident);
  } else if (!isAlarmable(vehicle)) {
    return;
  }

  if (vehicle.status === 8 && vehicle.incidentId && vehicle.incidentId !== incident.id) {
    detachVehicleFromIncident(vehicle.id, vehicle.incidentId);
  }

  if (vehicle.status === 3) {
    const previousIncidentId = vehicle.incidentId;
    if (vehicle.incidentId && vehicle.incidentId !== incident.id) {
      releasePatientAssignment(vehicle);
      detachVehicleFromIncident(vehicle.id, vehicle.incidentId);
      vehicle.incidentId = null;
      vehicle.previousIncidentId = null;
    }
    cancelVehicleRoute(vehicle);
    logRadio(`${vehicle.name}: Folgeauftrag übernommen, bricht aktuelle Anfahrt ab.`, "warn", [previousIncidentId, incident.id]);
  }
  if (vehicle.coveragePointId) {
    cancelVehicleRoute(vehicle);
    vehicle.coveragePointId = null;
    vehicle.coveragePoint = null;
    vehicle.coverageDispatch = null;
    logRadio(`${vehicle.name}: Gebietsabsicherung aufgehoben, übernimmt Einsatz.`, "radio", incident.id);
  }

  vehicle.dispatchSignal = Boolean(incident.signal);
  const ugrd = vehicle.ugrdAvailabilityProbability !== undefined;
  if (!ugrd && isStabilizerVehicle(vehicle.type)
      && !checkVehicleTurnout(vehicle, incident, vehicle.responderAvailabilityProbability, 5, alarmBatch)) return;
  const delayMinutes = vehicle.status === 8 ? status8DispatchDelayMinutes(vehicle) : turnoutDelayMinutes(vehicle);
  if (ugrd && vehicle.status === 2) {
    const nominalMinutes = configuredUgrdTurnoutMinutes(vehicle);
    const failureDelay = nominalMinutes === null ? delayMinutes : Math.round(nominalMinutes * 1.5 * 100) / 100;
    if (!checkVehicleTurnout(vehicle, incident, vehicle.ugrdAvailabilityProbability, failureDelay, alarmBatch)) return;
  }
  vehicle.nextIncidentId = incident.id;
  vehicle.previousIncidentId = vehicle.status === 8 ? vehicle.incidentId : null;
  vehicle.pendingDispatchUntil = Date.now() + simulationDelay(delayMinutes);
  vehicle.pendingDispatchDelay = delayMinutes;
  vehicle.statusText = vehicle.status === 8
    ? `Folgeeinsatz möglich in ca. ${delayMinutes} min`
    : `alarmiert, rückt in ca. ${delayMinutes} min aus`;

  if (vehicle.handoverTimer) {
    cancelScheduledTimeout(vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (vehicle.status8ReadyTimer) {
    cancelScheduledTimeout(vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.supportReleaseTimer) {
    cancelScheduledTimeout(vehicle.supportReleaseTimer);
    vehicle.supportReleaseTimer = null;
  }
  if (vehicle.surplusReleaseTimer) {
    cancelScheduledTimeout(vehicle.surplusReleaseTimer);
    vehicle.surplusReleaseTimer = null;
  }
  if (vehicle.postTransportCleanupTimer) {
    cancelScheduledTimeout(vehicle.postTransportCleanupTimer);
    vehicle.postTransportCleanupTimer = null;
  }

  incident.assigned.push(vehicle.id);
  if (!incident.patient?.patients?.some((patient) => patient.transporting)) {
    incident.status = hasRequiredVehicles(incident) ? "alarmiert" : "in Bearbeitung";
  }
  clearResolvedAssistanceNeedsAfterDispatch(incident);
  logDispatchAlarm(incident.id, `${vehicle.name}: Einsatzauftrag erhalten, Ausrücken in ca. ${delayMinutes} Minute(n).`,
    vehicle.status === 8 ? "warn" : "radio", alarmBatch);
  if (incident.modId) appMods.incidentEvent("vehicle.alarmed", incident, { vehicleId });
  playPagerTone();
  renderAll();
  scheduleDispatchTimer(vehicle, delayMinutes, () => startResponse(vehicle.id));
}

function checkVehicleTurnout(vehicle, incident, availability, delayMinutes, alarmBatch) {
  const probability = normalizeProbability(availability ?? 1, 1);
  if (Math.random() < probability) return true;
  clearDispatchTimer(vehicle);
  vehicle.nextIncidentId = incident.id;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = Date.now() + simulationDelay(delayMinutes);
  vehicle.pendingDispatchDelay = delayMinutes;
  vehicle.statusText = `alarmiert, Rückmeldung in ca. ${delayMinutes} min`;
  if (!incident.assigned.includes(vehicle.id)) incident.assigned.push(vehicle.id);
  incident.status = hasRequiredVehicles(incident) ? "alarmiert" : "in Bearbeitung";
  clearResolvedAssistanceNeedsAfterDispatch(incident);
  logDispatchAlarm(incident.id, `${vehicle.name}: Einsatzauftrag erhalten, Rückmeldung in ca. ${delayMinutes} min.`, "radio", alarmBatch);
  playPagerTone();
  renderAll();
  scheduleDispatchTimer(vehicle, delayMinutes, () => failVehicleTurnout(vehicle.id, incident.id));
  return false;
}

function failVehicleTurnout(vehicleId, incidentId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || vehicle.nextIncidentId !== incidentId) return;
  clearDispatchTimer(vehicle);
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
  vehicle.statusText = "nicht ausgerückt";
  if (incident) {
    incident.assigned = incident.assigned.filter((id) => id !== vehicle.id);
    if (incident.status !== "geschlossen") {
      incident.status = incident.assigned.length
        ? hasRequiredVehicles(incident) ? "alarmiert" : "in Bearbeitung"
        : incidentHasDisposition(incident) ? "alarmiert" : "offen";
    }
    logRadio(`${vehicle.name}: ${vehicle.type} nicht ausgerückt.`, "urgent", incident.id);
  }
  renderAll();
}

function vehicleCanBeRedispatchedBeforeResponse(vehicle) {
  return Boolean(vehicle?.nextIncidentId && vehicle.status === 2 && !vehicle.incidentId);
}

function removePendingVehicleFromPreviousIncident(vehicle, newIncident) {
  const previousIncident = state.incidents.find((item) => item.id === vehicle.nextIncidentId);
  clearDispatchTimer(vehicle);
  if (previousIncident) {
    previousIncident.assigned = previousIncident.assigned.filter((id) => id !== vehicle.id);
    previousIncident.status = previousIncident.assigned.length
      ? hasRequiredVehicles(previousIncident) ? "alarmiert" : "in Bearbeitung"
      : incidentHasDisposition(previousIncident) ? "alarmiert" : "offen";
    clearTransportRequest(previousIncident, null, vehicle.id);
    logRadio(`${vehicle.name}: Umplanung von ${previousIncident.keyword} zu ${newIncident.keyword}.`, "warn", [previousIncident.id, newIncident.id]);
  }
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
}

function scheduleDispatchTimer(vehicle, delayMinutes, handler) {
  clearDispatchTimer(vehicle);
  vehicle.pendingDispatchUntil = Date.now() + simulationDelay(delayMinutes);
  vehicle.pendingDispatchDelay = delayMinutes;
  vehicle.dispatchHandler = handler;
  vehicle.dispatchTimer = scheduleTimeout(() => {
    vehicle.dispatchTimer = null;
    vehicle.dispatchHandler = null;
    handler();
  }, simulationDelay(delayMinutes));
}

function clearDispatchTimer(vehicle) {
  if (!vehicle?.dispatchTimer) return;
  cancelScheduledTimeout(vehicle.dispatchTimer);
  vehicle.dispatchTimer = null;
  vehicle.dispatchHandler = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
}

function hasPersistentSpeechRequest(vehicle) {
  return vehicle.radioStatus === 0 && Boolean(vehicle.pendingAssistanceRequest || vehicle.pendingSituationReport
    || vehicle.radioContext === "mod-report" || vehicle.radioContext?.startsWith("tna-"));
}

function triggerRadioStatus(vehicle, code, message, { context, ignoreCooldown = false, displayMinutes = code === 0 || code === 5 ? 5 : .5 } = {}) {
  if (code === 5 && hasPersistentSpeechRequest(vehicle)) return false;
  if (code === 0) {
    const departure = context === "response-start" || context === "boundary";
    const replacesDeparture = !departure && ["response-start", "boundary"].includes(vehicle.radioContext);
    if (vehicle.radioStatus === 0 && !replacesDeparture) return false;
    if (!ignoreCooldown && !departure && !replacesDeparture && Date.now() < (vehicle.status0CooldownUntilMs || 0)) return false;
    const hasUrgentContext = Boolean(vehicle.pendingAssistanceRequest || vehicle.pendingSituationReport);
    const alreadyDispatched = vehicle.status === 3 || vehicle.status === 4 || vehicle.status === 7;
    if (!hasUrgentContext && !alreadyDispatched) return false;
    if (vehicle.nextIncidentId && !vehicle.incidentId) return false;
  }
  clearRadioDisplayTimer(vehicle);
  if (context || ["response-start", "boundary"].includes(vehicle.radioContext)) vehicle.radioContext = context || null;
  if (code === 0 || code === 5) {
    vehicle.radioReturnStatusText = radioReturnStatusText(vehicle);
  }
  vehicle.radioStatus = code;
  vehicle.radioMessage = code === 0 ? "dringender Sprechwunsch" : "Sprechwunsch";
  vehicle.pendingRadioMessage = message;
  vehicle.awaitingSpeechPrompt = code === 5;
  if (code === 0) vehicle.awaitingSpeechPrompt = true;
  const incidentId = radioIncidentId(vehicle, code);
  let phase = "";
  if (context === "response-start") phase = "Ausrücken";
  else if (context === "boundary") phase = "Gebietsgrenze";
  else if (code === 0 && vehicle.status === 4) phase = "Einsatzstelle";
  else if (code === 0 && vehicle.status === 7) phase = "Transport";
  logRadio(`${vehicle.name}: Status ${code} - ${vehicle.radioMessage}${phase ? ` (${phase})` : ""}`, code === 0 ? "warn" : "radio", incidentId);
  if (!hasPersistentSpeechRequest(vehicle)) {
    vehicle.radioDisplayTimer = scheduleTimeout(() => expireRadioDisplay(vehicle.id, code), simulationDelay(displayMinutes));
  }
  renderRadioAlerts();
  return true;
}

function clearRadioDisplayTimer(vehicle) {
  if (!vehicle?.radioDisplayTimer) return;
  cancelScheduledTimeout(vehicle.radioDisplayTimer);
  vehicle.radioDisplayTimer = null;
}

function radioReturnStatusText(vehicle) {
  if (vehicle.status === 4) return "am Einsatzort";
  if (vehicle.status === 3) return vehicle.statusText || "auf Anfahrt";
  if (vehicle.status === 7) return vehicle.statusText || "im Transport";
  return vehicle.statusText || "";
}

function expireRadioDisplay(vehicleId, code) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.radioStatus !== code) return;
  const expiredClearRequest = code === 5 ? vehicle.pendingClearRequest : null;
  clearRadioDisplayTimer(vehicle);
  if (["response-start", "boundary", "mod-report", "mod-clinic"].includes(vehicle.radioContext) || vehicle.radioContext?.startsWith("tna-")) vehicle.radioContext = null;
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.pendingRadioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  if (/^Status [05]:/i.test(vehicle.statusText || "")) {
    vehicle.statusText = vehicle.radioReturnStatusText || radioReturnStatusText(vehicle);
  }
  vehicle.radioReturnStatusText = null;
  clearExpiredRadioContext(vehicle, code);
  if (expiredClearRequest) {
    if (!completeClearRequestIfSafe(vehicle, expiredClearRequest)) return;
    clearVehicle(vehicle.id);
    return;
  }
  if (vehicle.status === 4 && vehicle.incidentId) {
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(0.2));
  }
  renderVehicles();
  renderIncidents();
  renderRadioAlerts();
}

function clearExpiredRadioContext(vehicle, code) {
  if (code === 5) {
    vehicle.pendingClearRequest = null;
    vehicle.pendingKtwHandoverRequest = null;
    vehicle.pendingItwSubstitutionRequest = null;
  } else if (code === 0) {
    const pendingAssistance = state.incidents.find((incident) => incident.id === vehicle.pendingAssistanceRequest?.incidentId);
    const pendingReport = state.incidents.find((incident) => incident.id === vehicle.pendingSituationReport?.incidentId);
    if (pendingAssistance && !pendingAssistance.assistanceDecision && !incidentHasPendingAssistanceRadio(pendingAssistance)) {
      pendingAssistance.assistanceRequested = false;
    }
    if (pendingReport?.patient && !pendingReport.patient.situationReported) pendingReport.patient.situationRequested = false;
    vehicle.pendingAssistanceRequest = null;
    vehicle.pendingSituationReport = null;
  }
}

function sendSpeechPrompt(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const pendingTransportRequest = vehicle.radioStatus === 5 ? vehicle.pendingTransportRequest : null;
  const pendingClearRequest = vehicle.radioStatus === 5 ? vehicle.pendingClearRequest : null;
  const pendingAssistanceRequest = vehicle.radioStatus === 0 ? vehicle.pendingAssistanceRequest : null;
  const pendingSituationReport = vehicle.radioStatus === 0 ? vehicle.pendingSituationReport : null;
  const pendingKtwHandoverRequest = vehicle.radioStatus === 5 ? vehicle.pendingKtwHandoverRequest : null;
  const pendingItwSubstitutionRequest = vehicle.radioStatus === 5 ? vehicle.pendingItwSubstitutionRequest : null;
  const radioContext = vehicle.radioContext || null;
  const logIncidentId = radioIncidentId(vehicle, vehicle.radioStatus);
  const relatedIncident = relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (vehicle.radioStatus === 6) {
    logRadio(`${vehicle.name}: Status 6 quittiert.`, "radio", logIncidentId);
    vehicle.radioStatus = null;
    vehicle.radioContext = null;
    vehicle.radioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    renderAll();
    renderRadioAlerts();
    return;
  }
  if (vehicle.radioStatus === 5 || vehicle.radioStatus === 0) {
    clearRadioDisplayTimer(vehicle);
    const radioStatus = vehicle.radioStatus;
    const radioMessage = vehicle.pendingRadioMessage || vehicle.radioMessage;
    logRadio(`${vehicle.name}: Sprechaufforderung J gesendet.`, radioStatus === 0 ? "warn" : "radio", logIncidentId);
    vehicle.radioStatus = null;
    vehicle.radioMessage = "";
    vehicle.pendingRadioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    vehicle.waitingForSpeechPrompt = false;
    tna.acceptingRadio(vehicle, radioContext);
    if (["response-start", "boundary"].includes(radioContext) || radioContext?.startsWith("tna-")) vehicle.radioContext = null;
    else if (radioStatus === 0) vehicle.status0CooldownUntilMs = Date.now() + Math.max(5000, simulationDelay(2));
    renderAll();
    renderRadioAlerts();
    scheduleTimeout(() => completeSpeechPromptResponse(vehicle.id, {
      radioStatus,
      pendingTransportRequest,
      pendingClearRequest,
      pendingAssistanceRequest,
      pendingSituationReport,
      pendingKtwHandoverRequest,
      pendingItwSubstitutionRequest,
      radioContext,
      radioMessage,
      logIncidentId,
      relatedIncidentId: relatedIncident?.id || null
    }), simulationDelay(randomRange(5, 12) / 60));
    return;
  }
  completeSpeechPromptResponse(vehicle.id, {
    radioStatus: vehicle.radioStatus,
    pendingTransportRequest,
    pendingClearRequest,
    pendingAssistanceRequest,
    pendingSituationReport,
    pendingKtwHandoverRequest,
    pendingItwSubstitutionRequest,
    radioContext,
    radioMessage: vehicle.radioMessage,
    logIncidentId,
    relatedIncidentId: relatedIncident?.id || null
  });
}

function vehicleRequestQuestion(types) {
  const required = (types || []).filter(Boolean);
  const label = required.join(" + ") || "regulaere Rettungsmittel";
  return `${required.length === 1 ? "Soll" : "Sollen"} stattdessen ${label} anfahren?`;
}

function completeSpeechPromptResponse(vehicleId, context) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const pendingTransportRequest = context.pendingTransportRequest;
  const pendingClearRequest = context.pendingClearRequest;
  const pendingAssistanceRequest = context.pendingAssistanceRequest;
  const pendingSituationReport = context.pendingSituationReport;
  const pendingKtwHandoverRequest = context.pendingKtwHandoverRequest;
  const pendingItwSubstitutionRequest = context.pendingItwSubstitutionRequest;
  const radioContext = context.radioContext;
  const radioMessage = context.radioMessage;
  if (radioContext?.startsWith("tna-")) {
    tna.answerRadio(vehicle, radioContext);
    return;
  }
  if (["response-start", "boundary"].includes(radioContext)) {
    logRadio(`${vehicle.name}: ${radioMessage}`, "radio", context.logIncidentId);
    return;
  }
  if (radioContext === "mod-report" || radioContext === "mod-clinic") {
    if (vehicle.radioContext === radioContext) vehicle.radioContext = null;
    const incident = state.incidents.find((item) => item.id === context.logIncidentId && item.status !== "geschlossen");
    if (!incident?.modId || (radioContext === "mod-clinic" && incident.modClinicTargets === 0)) return;
    logRadio(`${vehicle.name}: ${radioMessage}`, radioContext === "mod-report" ? "warn" : "radio", incident.id);
    selectIncidentFromMapOrList(incident);
    if (radioContext === "mod-clinic") appMods.openPanel(incident.modId, incident.id);
    renderAll();
    appMods.incidentEvent("vehicle.reportAnswered", incident, { vehicleId });
    return;
  }
  const relatedIncident = state.incidents.find((incident) => incident.id === context.relatedIncidentId) || relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (context.radioStatus === 5) {
    if (pendingClearRequest) {
      if (!completeClearRequestIfSafe(vehicle, pendingClearRequest)) return;
    } else if (pendingKtwHandoverRequest) {
      logRadio(`${vehicle.name}: KTW-Patient. Ist ein KTW zeitnah verfügbar?`, "radio", pendingKtwHandoverRequest.incidentId);
      const incident = state.incidents.find((item) => item.id === pendingKtwHandoverRequest.incidentId);
      if (incident) {
        incident.ktwHandoverDecision = pendingKtwHandoverRequest;
        selectIncidentFromMapOrList(incident);
      }
    } else if (pendingItwSubstitutionRequest) {
      logRadio(`${vehicle.name}: ITW nicht zwingend erforderlich. ${vehicleRequestQuestion(pendingItwSubstitutionRequest.regularRequired)}`, "radio", pendingItwSubstitutionRequest.incidentId);
      const incident = state.incidents.find((item) => item.id === pendingItwSubstitutionRequest.incidentId);
      if (incident) {
        incident.itwSubstitutionDecision = pendingItwSubstitutionRequest;
        selectIncidentFromMapOrList(incident);
      }
    } else if (vehicle.status === 3 && isCoverageRun(vehicle)) {
      confirmCoverageRun(vehicle);
    } else if (vehicle.status === 3 || vehicle.nextIncidentId) {
      logRadio(`${vehicle.name}: unterwegs zu ${vehicleDestinationText(vehicle, relatedIncident)}.`, "radio", context.logIncidentId);
    } else if (radioContext === "shift-start") {
      logRadio(`${vehicle.name}: Status 2 - ${radioMessage || `${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} einsatzklar`}.`, "radio");
    } else if (radioMessage && !pendingTransportRequest) {
      logRadio(`${vehicle.name}: ${radioMessage}`, "radio", context.logIncidentId);
    }
  } else if (context.radioStatus === 0 && pendingSituationReport) {
    const incident = state.incidents.find((item) => item.id === pendingSituationReport.incidentId);
    if (incident && incident.status !== "geschlossen") {
      const report = incident.patient.situationReport || assistanceSituationText(incident);
      incident.patient.situationReportText = report;
      incident.patient.report = report;
      incident.patient.situationReported = true;
      incident.status = "Lage gemeldet";
      selectIncidentFromMapOrList(incident);
      const requestedResources = maybeRequestAdditionalResources(vehicle, incident, { asPartOfReport: true });
      const reason = incident.assistanceDecision?.reason;
      const requestText = requestedResources.length ? ` ${assistanceRadioText(requestedResources, reason, report)}` : "";
      logRadio(`${vehicle.name}: Lage: ${report}${requestText}`, "warn", incident.id);
    }
  } else if (context.radioStatus === 0 && pendingAssistanceRequest) {
    const incident = state.incidents.find((item) => item.id === pendingAssistanceRequest.incidentId);
    if (incident && incident.status !== "geschlossen") {
      const stillMissing = currentAssistanceMissingForDispatch(incident);
      if (!stillMissing.length) {
        incident.assistanceDecision = null;
        incident.assistanceRequested = false;
        if (incident.status === "Nachforderung" || incident.status === "Nachforderung offen") {
          incident.status = "vor Ort";
        }
        logRadio(`${vehicle.name}: Nachforderung nicht mehr erforderlich, Rettungsmittel vollstaendig vor Ort.`, "radio", incident.id);
      } else {
        const reason = recordAssistanceDecision(vehicle, incident, stillMissing);
        logRadio(`${vehicle.name}: ${assistanceRadioText(stillMissing, reason)}`, "warn", incident.id);
      }
      selectIncidentFromMapOrList(incident);
    }
  } else {
    logRadio(`${vehicle.name}: Status ${context.radioStatus} quittiert.`, "radio", context.logIncidentId);
  }
  vehicle.radioStatus = null;
  vehicle.radioContext = null;
  vehicle.radioMessage = "";
  vehicle.pendingRadioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  restoreRadioStatusText(vehicle);
  vehicle.pendingAssistanceRequest = null;
  vehicle.pendingSituationReport = null;
  vehicle.pendingClearRequest = null;
  vehicle.pendingKtwHandoverRequest = null;
  vehicle.pendingItwSubstitutionRequest = null;
  if (pendingTransportRequest) {
    activateTransportRequest(vehicle, pendingTransportRequest.incidentId);
  }
  if (pendingClearRequest) {
    clearVehicle(vehicle.id);
    return;
  }
  if ((pendingSituationReport || pendingAssistanceRequest) && vehicle.status === 4) {
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(.2));
  }
  renderAll();
  renderRadioAlerts();
}

function completeClearRequestIfSafe(vehicle, pendingClearRequest) {
  const incident = state.incidents.find((item) => item.id === pendingClearRequest.incidentId) || relatedIncidentForVehicle(vehicle);
  const blockReason = vehicleClearBlockReason(vehicle, incident);
  if (blockReason) {
    vehicle.pendingClearRequest = null;
    vehicle.radioStatus = null;
    vehicle.radioContext = null;
    vehicle.radioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    vehicle.waitingForSpeechPrompt = false;
    vehicle.statusText = blockReason;
    logRadio(`${vehicle.name}: Freimeldung abgelehnt - ${blockReason}.`, "warn", incident?.id);
    renderAll();
    renderRadioAlerts();
    return false;
  }
  logRadio(`${vehicle.name}: ${pendingClearRequest.reason || "nicht benötigt"}, meldet frei.`, "radio", incident?.id);
  return true;
}

function restoreRadioStatusText(vehicle) {
  if (/^Status [05]:/i.test(vehicle.statusText || "")) {
    vehicle.statusText = vehicle.radioReturnStatusText || radioReturnStatusText(vehicle);
  }
  vehicle.radioReturnStatusText = null;
}

function confirmCoverageRun(vehicle) {
  vehicle.status = 1;
  vehicle.incidentId = null;
  vehicle.patientId = null;
  vehicle.supportOnly = false;
  vehicle.statusText = `auf Gebietsabsicherung${vehicle.coveragePoint?.label ? `: ${vehicle.coveragePoint.label}` : ""}`;
  logRadio(`${vehicle.name}: Status 1, Gebietsabsicherung bestaetigt.`, "radio");
}

function isCoverageRun(vehicle) {
  return Boolean(vehicle.coveragePointId || vehicle.coveragePoint || /Gebietsabsicherung/i.test(vehicle.statusText || ""));
}

function relatedIncidentForVehicle(vehicle, pendingTransportRequest = null, pendingAssistanceRequest = null) {
  const id = pendingTransportRequest?.incidentId
    || pendingAssistanceRequest?.incidentId
    || vehicle.nextIncidentId
    || vehicle.incidentId;
  return state.incidents.find((item) => item.id === id) || null;
}

function radioIncidentId(vehicle, code) {
  if (vehicle.radioContext === "shift-start") return null;
  if (vehicle.radioContext === "response-start") return vehicle.incidentId;
  if (code === 0) return vehicle.pendingSituationReport?.incidentId || vehicle.pendingAssistanceRequest?.incidentId || vehicle.incidentId;
  return vehicle.pendingClearRequest?.incidentId
    || vehicle.pendingKtwHandoverRequest?.incidentId
    || vehicle.pendingItwSubstitutionRequest?.incidentId
    || vehicle.pendingTransportRequest?.incidentId
    || vehicle.incidentId
    || vehicle.nextIncidentId;
}

function releasePatientAssignment(vehicle) {
  if (!vehicle?.patientId) return;
  state.incidents.forEach((incident) => {
    (incident.patient?.patients || []).forEach((patient) => {
      patient.assignedVehicles = (patient.assignedVehicles || []).filter((id) => id !== vehicle.id);
    });
  });
  vehicle.patientId = null;
}

function vehicleDestinationText(vehicle, incident) {
  const keyword = incident?.keyword ? `${incident.keyword} - ` : "";
  if (vehicle.target?.label) return vehicle.target.label;
  if (vehicle.routeMeta?.destination?.label) return vehicle.routeMeta.destination.label;
  if (vehicle.coveragePoint?.label) return vehicle.coveragePoint.label;
  if (incident?.location) return `${keyword}${incident.location}`;
  return "Einsatzstelle";
}

function responseStartRadioMode(incident, signal, settings) {
  if (incident.modId === "manv" || /\bMANV\b/i.test(incident.keyword) || incident.assigned.length > 10) return "none";
  const modes = normalizeStatus3Radio(settings);
  return signal ? modes.signal : modes.normal;
}

function startResponse(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle?.nextIncidentId) return;
  const incident = state.incidents.find((item) => item.id === vehicle.nextIncidentId);
  if (!incident) return;

  cancelVehicleRoute(vehicle);
  vehicle.status = 3;
  if (vehicle.supportGroupId) vehicle.awaitingSupportDeparture = false;
  vehicle.statusText = "auf Anfahrt";
  vehicle.coveragePointId = null;
  vehicle.coverageDispatch = null;
  vehicle.patientId = null;
  vehicle.incidentId = incident.id;
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
  vehicle.status8ReadyAt = null;
  vehicle.status8ReadyDelay = null;
  vehicle.status8ReadyTimer = null;
  vehicle.dispatchTimer = null;
  vehicle.dispatchHandler = null;
  const signal = Boolean(vehicle.dispatchSignal);
  const mode = responseStartRadioMode(incident, signal, state.center.status3Radio);
  const message = `Status 3, Anfahrt ${incident.keyword}${signal ? " mit SoSi" : ""}.`;
  if (mode === "none" || (vehicle.foreign && !pointInsideServiceArea(vehicle.lat, vehicle.lng))) {
    logRadio(`${vehicle.name}: ${message}`, "radio", incident.id);
  } else {
    triggerRadioStatus(vehicle, Number(mode), message, { context: "response-start" });
  }
  renderAll();
  vehicle.dispatchSignal = false;
  if (incident.modId) appMods.incidentEvent("vehicle.departed", incident, { vehicleId });
  if (!tna.routeDoctor(incident, vehicle)) {
    driveVehicleTo(vehicle, incident, { signal, phase: "scene" }, () => arriveOnScene(vehicle.id));
  }
}

function arriveOnScene(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 3) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  if (!incident) return;

  vehicle.status = 4;
  incident.firstUnitOnSceneAtMinute ??= simMinuteNow();
  vehicle.statusText = "am Einsatzort";
  vehicle.lat = incident.lat;
  vehicle.lng = incident.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  if (incident.modId) {
    if (["response-start", "boundary"].includes(vehicle.radioContext) && vehicle.radioStatus) {
      expireRadioDisplay(vehicle.id, vehicle.radioStatus);
    }
    incident.status = "vor Ort";
    logRadio(`${vehicle.name}: Status 4, Einsatzstelle erreicht.`, "radio", incident.id);
    appMods.incidentEvent("vehicle.arrived", incident, { vehicleId });
    renderAll();
    return;
  }
  if (vehicle.type === "GW-SAN") {
    if (incident.status === "alarmiert" || incident.status === "in Bearbeitung") incident.status = "vor Ort";
    logRadio(`${vehicle.name}: Status 4, Einsatzstelle erreicht. SEG Behandlung vor Ort.`, "radio", incident.id);
    renderAll();
    return;
  }
  assignVehicleToPatient(vehicle, incident);
  logRadio(`${vehicle.name}: Status 4, Einsatzstelle erreicht${vehicle.type === "ELRD" ? "." : ". Patientenversorgung begonnen."}`, "radio", incident.id);
  tna.doctorOnScene(incident, vehicle);
  scheduleSceneSupportReleaseAfterHandover(incident, vehicle.id);
  releaseSupportDoctorsReadyForHandover(incident);
  resolveElrdWaitOnArrival(incident);
  maybeRequestKtwHandover(vehicle, incident);
  maybeRequestItwSubstitution(vehicle, incident);
  const assignedPatient = patientForVehicle(vehicle, incident);
  const requestsTna = tna.requestAtScene(vehicle, incident, assignedPatient);
  const firstResponderNeedsTransport = vehicle.supportOnly
    && assignedPatient
    && patientMissingTypes(assignedPatient).some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type));
  if (!requestsTna && firstResponderNeedsTransport) {
    maybeRequestAdditionalResources(vehicle, incident);
  } else if (!requestsTna) {
    maybeSendSituationReport(vehicle, incident);
    if (!incident.patient?.situationRequested) maybeRequestAdditionalResources(vehicle, incident);
  }
  incident.patient.status = "in Behandlung";
  if (incident.patient.patients?.some((patient) => patient.assignedVehicles?.length)) {
    incident.patient.treatmentStartedAt ??= simMinuteNow();
  }
  incident.status = "vor Ort";
  releaseElrdIfNoPatientsAtScene(incident);
  renderAll();
  maybeScheduleLongTransportRthHint(vehicle, incident);
  scheduleSurplusVehicleClearances(incident);
  scheduleTreatmentCompletion(vehicle, incident);
}

function maybeScheduleLongTransportRthHint(vehicle, incident) {
  if (!vehicle || vehicle.type !== "RTW" || !incident || incident.longTransportRthHintScheduled) return;
  const patient = patientForVehicle(vehicle, incident);
  if (!patient?.required?.some(isDoctorRequirement)) return;
  if (suitableHospitalWithinKm(incident, null, 30)) return;
  incident.longTransportRthHintScheduled = true;
  scheduleTimeout(() => {
    if (vehicle.status !== 4 || vehicle.incidentId !== incident.id) return;
    if (incident.status === "Transport" || patient.transporting || patient.completed) return;
    triggerRadioStatus(vehicle, 5, "Kein geeignetes Krankenhaus im 30-km-Umkreis. RTH fuer Transport pruefen?");
    renderAll();
  }, simulationDelay(2));
}

function releaseSupportDoctorsReadyForHandover(incident) {
  (incident.patient?.patients || []).forEach((patient) => {
    if (!patientHasTransportUnitAtScene(patient) || patientTreatmentProgress(patient, incident) < 0.8) return;
    (patient.assignedVehicles || [])
      .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
      .filter((vehicle) => vehicle && isDoctorVehicle(vehicle.type) && vehicle.status === 4 && vehicle.supportOnly)
      .forEach((vehicle) => {
        vehicle.statusText = `${patient.label} bis Übernahme stabilisiert`;
      });
  });
}

function scheduleSceneSupportReleaseAfterHandover(incident, activeVehicleId = null) {
  const activeVehicle = state.vehicles.find((unit) => unit.id === activeVehicleId);
  if (activeVehicle?.type === "ELRD") return;
  (incident.assigned || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.id !== activeVehicleId && unit.status === 4)
    .filter((unit) => !activeVehicle?.patientId || !unit.patientId || unit.patientId === activeVehicle.patientId)
    .filter((unit) => !unit.supportReleaseTimer && !unit.pendingClearRequest && !unit.radioStatus)
    .filter((unit) => sceneSupportCanRelease(unit, incident))
    .forEach((unit) => {
      const patient = patientForVehicle(unit, incident);
      const delay = randomInt(5, 10);
      const taker = activeVehicleId ? unitName(activeVehicleId) : "Rettungsmittel";
      const reason = patient
        ? `${patient.label} an ${taker} übergeben`
        : "an der Einsatzstelle nicht mehr benötigt";
      unit.statusText = `${reason}, frei in ca. ${delay} min`;
      unit.supportReleaseTimer = scheduleTimeout(() => {
        unit.supportReleaseTimer = null;
        if (unit.status !== 4 || unit.incidentId !== incident.id) return;
        if (!sceneSupportCanRelease(unit, incident)) return;
        requestVehicleClearance(unit, incident, reason);
      }, simulationDelay(delay));
    });
}

function sceneSupportCanRelease(unit, incident) {
  if (vehicleClearBlockReason(unit, incident)) return false;
  const patient = patientForVehicle(unit, incident);
  if (!patient) return !patientsNeedVehicleType(incident, unit.type);
  if (patientMissingTypes(patient).length > 0) return false;
  if (doctorStillRequiredForPatient(unit, patient)) return false;
  if (!vehicleStillRequiredForAssignedPatient(unit, incident) && patientHasRequiredTransportUnitAtScene(patient)) return true;
  return unit.supportOnly || !vehicleCanTransportPatient(unit, patient);
}

function vehicleClearBlockReason(vehicle, incident) {
  if (!vehicle || !incident || incident.status === "geschlossen") return "";
  if (incident.modId) {
    if (vehicle.modRole?.incidentId === incident.id) return "Fahrzeug ist für eine Einsatzrolle gebunden";
    return vehicle.patientId ? "Fahrzeug ist einem Patienten zugeordnet" : "";
  }
  if (vehicle.type === "ELRD" && incidentHasPatientAtScene(incident)) {
    return "ELRD bleibt bis kein Patient mehr an der Einsatzstelle ist";
  }
  const patient = vehicle.patientId
    ? (incident.patient?.patients || []).find((item) => item.id === vehicle.patientId)
    : null;
  if (patient && !patient.completed && !patient.transporting) {
    if (!vehicleStillRequiredForAssignedPatient(vehicle, incident)
      && patientMissingTypes(patient).length === 0
      && patientHasRequiredTransportUnitAtScene(patient)
      && !doctorStillRequiredForPatient(vehicle, patient)) {
      return "";
    }
    if ((vehicle.supportOnly || !vehicleCanTransportPatient(vehicle, patient))
      && patientMissingTypes(patient).length === 0
      && patientHasRequiredTransportUnitAtScene(patient)
      && !doctorStillRequiredForPatient(vehicle, patient)) {
      return "";
    }
    return `${patient.label || "Patient"} ist noch an der Einsatzstelle in Versorgung`;
  }
  if (!patient && incidentHasPatientAtScene(incident) && patientsNeedVehicleType(incident, vehicle.type)) {
    return `${vehicle.type} wird noch fuer Patienten an der Einsatzstelle benoetigt`;
  }
  return "";
}

function doctorStillRequiredForPatient(unit, patient) {
  return isDoctorVehicle(unit?.type)
    && patientRequiresTransport(patient)
    && !patient.doctorCareCompleted
    && (patient.required || []).some(isDoctorRequirement);
}

function scheduleTreatmentCompletion(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!patient) return;
  const remaining = remainingTreatmentMinutes(patient, incident);
  if (remaining <= 0) {
    transportOrClear(vehicle.id);
    return;
  }
  if (vehicle.treatmentTimer) {
    cancelScheduledTimeout(vehicle.treatmentTimer);
  }
  vehicle.treatmentTimer = scheduleTimeout(() => {
    vehicle.treatmentTimer = null;
    vehicle.treatmentDueAt = null;
    transportOrClear(vehicle.id);
  }, simulationDelay(remaining));
  vehicle.treatmentDueAt = Date.now() + simulationDelay(remaining);
}

function remainingTreatmentMinutes(patient, incident) {
  const progress = patientTreatmentProgress(patient, incident);
  const cap = currentTreatmentCap(patient, incident).cap;
  return Math.max(0, patientTreatmentMinutes(patient, incident) * (cap - progress));
}

function requestVehicleClearance(vehicle, incident, reason, { automatic = false } = {}) {
  if (vehicle.radioStatus || vehicle.pendingClearRequest) return;
  const blockReason = vehicleClearBlockReason(vehicle, incident);
  if (blockReason) {
    vehicle.statusText = blockReason;
    renderAll();
    return;
  }
  vehicle.pendingClearRequest = { incidentId: incident?.id || vehicle.incidentId, reason };
  vehicle.statusText = "Status 5: Freimeldung";
  triggerRadioStatus(vehicle, 5, `Freimeldung: ${reason}.`, automatic ? { displayMinutes: 1 } : undefined);
  renderAll();
}

function scheduleSurplusVehicleClearances(incident) {
  if (incident.firstUnitOnSceneAtMinute == null || !incident.patient?.patients?.length) return;
  for (const id of incident.assigned) {
    const unit = state.vehicles.find((vehicle) => vehicle.id === id);
    if (!unit) continue;
    if (!vehicleIsSurplus(unit, incident)) {
      if (unit.surplusReleaseTimer) cancelScheduledTimeout(unit.surplusReleaseTimer);
      unit.surplusReleaseTimer = null;
      continue;
    }
    if (unit.surplusReleaseTimer) continue;
    const release = () => {
      unit.surplusReleaseTimer = null;
      if (!vehicleIsSurplus(unit, incident)) return;
      if (unit.status === 4) {
        if (unit.radioStatus) {
          unit.surplusReleaseTimer = scheduleTimeout(release, simulationDelay(1));
          return;
        }
        markSurplusRequirementsResolved(incident, { vehicleIds: [unit.id] });
        requestVehicleClearance(unit, incident, "für diesen Einsatz nicht mehr benötigt", { automatic: true });
      } else if (unit.supportGroupId) {
        recallSupportGroupVehicle(unit.id);
        logRadio(`${unit.name}: Für diesen Einsatz nicht mehr benötigt, rückt ein.`, "radio", incident.id);
        renderAll();
      } else {
        removeAssignedVehicle(unit.id, incident.id);
      }
    };
    unit.surplusReleaseTimer = scheduleTimeout(release, simulationDelay(randomRange(5, 13)));
  }
}

function vehicleIsSurplus(unit, incident) {
  if (incident.status === "geschlossen" || !incident.assigned.includes(unit.id)
      || unit.pendingClearRequest || unit.supportReleaseTimer || unit.boundTransportVehicleId || unit.boundDoctorVehicleId) return false;
  if (unit.status === 4) {
    if (unit.incidentId !== incident.id || unit.pendingTransportRequest || vehicleClearBlockReason(unit, incident)) return false;
  } else if (!canRemoveAssignedVehicle(unit, incident)) return false;
  if (unit.type === "ELRD" && incidentRequiresElrd(incident)) return false;
  if (vehicleStillRequiredForAssignedPatient(unit, incident) && !doctorCanReleaseForAmbulatoryPatient(unit, incident)) return false;
  return !patientsNeedVehicleType(incident, unit.type);
}

function markSurplusRequirementsResolved(incident, request) {
  const surplusDoctors = (request.vehicleIds || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit?.status === 4 && isDoctorVehicle(unit.type));
  for (const patient of incident.patient?.patients || []) {
    if (patient.acuity === "reanimation" || patient.requiresDoctorAccompaniment) continue;
    if (!surplusDoctors.some((unit) => unit.patientId === patient.id && patient.assignedVehicles?.includes(unit.id))) continue;
    if ((patient.required || []).some(isDoctorRequirement) && patientHasTransportUnitAtScene(patient)) patient.doctorCareCompleted = true;
  }
}

function patientsNeedVehicleType(incident, vehicleType) {
  return (incident.patient?.patients || [])
    .filter((patient) => !patient.completed && !patient.transporting)
    .some((patient) => patientMissingTypes(patient).some((type) => vehicleSatisfiesPatientRequirement(vehicleType, type, patient)));
}

function incidentRequiresElrd(incident) {
  if (!incident || incident.modId || incident.noElrd) return false;
  if ((incident.required || []).includes("ELRD")) return true;
  const activePatients = (incident.patient?.patients || [])
    .filter((patient) => !patient.completed && !patient.transporting);
  return activePatients.length >= 2;
}

function elrdAtScene(incident) {
  return (incident?.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.type === "ELRD" && vehicle.status === 4 && vehicle.incidentId === incident.id);
}

function incidentHasPatientAtScene(incident) {
  return (incident?.patient?.patients || []).some((patient) => !patient.completed && !patient.transporting);
}

function releaseElrdIfNoPatientsAtScene(incident) {
  if (!incident || incident.modId || incidentHasPatientAtScene(incident)) return;
  (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.type === "ELRD" && vehicle.status === 4 && vehicle.incidentId === incident.id)
    .filter((vehicle) => !vehicle.pendingClearRequest && !vehicle.radioStatus)
    .forEach((vehicle) => requestVehicleClearance(vehicle, incident, "kein Patient mehr an der Einsatzstelle"));
}

function resolveElrdWaitOnArrival(incident) {
  if (!incident?.elrdWaitDecision || !elrdAtScene(incident)) return;
  const request = incident.elrdWaitDecision;
  incident.elrdWaitDecision = null;
  const vehicle = state.vehicles.find((unit) => unit.id === request.vehicleId);
  const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
  if (patient) patient.waitForElrdBeforeTransport = false;
  if (vehicle?.status === 4 && vehicle.incidentId === incident.id) {
    logRadio(`${vehicle.name}: ELRD an der Einsatzstelle, Transportfreigabe wird fortgesetzt.`, "radio", incident.id);
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(.5));
  }
}

function vehicleHasDirectPatientAssignment(vehicle, incident) {
  if (!vehicle?.patientId) return false;
  return (incident.patient?.patients || []).some((patient) => patient.id === vehicle.patientId);
}

function vehicleStillRequiredForAssignedPatient(vehicle, incident) {
  if (!vehicleHasDirectPatientAssignment(vehicle, incident)) return false;
  const patient = (incident.patient?.patients || []).find((item) => item.id === vehicle.patientId);
  if (!patient || patient.completed || patient.transporting) return false;
  const assignedWithoutVehicle = (patient.assignedVehicles || [])
    .filter((id) => id !== vehicle.id)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status !== 6);
  const missingWithoutVehicle = missingRequiredTypesForResources(
    patientEffectiveRequiredTypes(patient),
    assignedWithoutVehicle,
    (unit, requiredTypes) => vehicleCoverageForPatient(unit, patient, requiredTypes)
  );
  return missingWithoutVehicle.some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
}

function doctorCanReleaseForAmbulatoryPatient(vehicle, incident) {
  if (!isDoctorVehicle(vehicle?.type) || !vehicle.patientId) return false;
  const patient = (incident.patient?.patients || []).find((item) => item.id === vehicle.patientId);
  return Boolean(patient && patientAmbulatorySelected(patient) && patientHasDispatchedVehicleType(patient, "RTW"));
}

function assignVehicleToPatient(vehicle, incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length || vehicle.patientId) return;
  let preferred = isStabilizerVehicle(vehicle.type)
    ? patients
      .filter((patient) => !patient.completed && !patient.transporting && patientRecommendedMissingTypes(patient).includes(vehicle.type))
      .sort((a, b) => patientConditionPercent(a, incident) - patientConditionPercent(b, incident))[0]
    : null;
  preferred ??= vehicle.type === "KTW"
    ? patients.find((patient) => patient.awaitingKtwHandover && !patient.completed && !patient.transporting)
    : null;
  preferred ??= patients
    .filter((patient) => patientMissingTypes(patient).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)))
    .sort((a, b) => (a.assignedVehicles?.length || 0) - (b.assignedVehicles?.length || 0))[0];
  if (!preferred && isDoctorVehicle(vehicle.type)) {
    preferred = patients
      .filter((patient) => !patient.completed && !patient.transporting && patientNeedsTransportUnit(patient))
      .sort((a, b) => patientTreatmentProgress(a, incident) - patientTreatmentProgress(b, incident))[0];
  }
  if (!preferred && vehicle.type === "KTW") {
    preferred = patients
      .filter((patient) => ktwCanFirstRespond(patient))
      .filter((patient) => !patient.completed && !patient.transporting && !patientHasRequiredTransportUnitAtScene(patient))
      .filter((patient) => !(patient.assignedVehicles || []).some((id) => state.vehicles.find((unit) => unit.id === id)?.type === "KTW"))
      .sort((a, b) => patientTreatmentProgress(a, incident) - patientTreatmentProgress(b, incident))[0];
  }
  if (!preferred && vehicle.type === "REF") {
    preferred = patients
      .filter((patient) => refCanFirstRespond(patient))
      .filter((patient) => !patient.completed && !patient.transporting)
      .sort((a, b) => patientTreatmentProgress(a, incident) - patientTreatmentProgress(b, incident))[0];
  }
  if (!preferred && vehicle.type === "ELRD") {
    preferred = patients
      .filter((patient) => elrdCanFirstRespond(patient))
      .filter((patient) => !patientHasNonElrdCareAtScene(patient))
      .filter((patient) => !(patient.assignedVehicles || []).some((id) => state.vehicles.find((unit) => unit.id === id)?.type === "ELRD"))
      .sort((a, b) => patientTreatmentProgress(a, incident) - patientTreatmentProgress(b, incident))[0];
  }
  const patient = preferred;
  if (!patient) return;
  const canContribute = (patient.required || []).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
  const canFirstRespond = vehicle.type === "KTW" && ktwCanFirstRespond(patient);
  const canRefFirstRespond = vehicle.type === "REF" && refCanFirstRespond(patient);
  const canElrdFirstRespond = vehicle.type === "ELRD" && elrdCanFirstRespond(patient);
  const canStabilize = isStabilizerVehicle(vehicle.type);
  if (!canContribute && !isDoctorVehicle(vehicle.type) && !canFirstRespond && !canRefFirstRespond && !canElrdFirstRespond && !canStabilize && (patient.assignedVehicles || []).length) return;
  patient.assignedVehicles = patient.assignedVehicles || [];
  patient.assignedVehicles.push(vehicle.id);
  if (!canStabilize) patient.treatmentStartedAt ??= simMinuteNow();
  vehicle.patientId = patient.id;
  vehicle.supportOnly = !canContribute && (isDoctorVehicle(vehicle.type) || canFirstRespond || canRefFirstRespond || canElrdFirstRespond || canStabilize);
  if (patientRequiresOnlyRef(patient)) {
    patient.transportNeeded = false;
    patient.noTransportProbability = 1;
    patient.noTransportText = patient.noTransportText || "Ambulante Versorgung durch REF ausreichend, kein Transport.";
  }
  if (vehicle.type === "KTW" && patient.awaitingKtwHandover) {
    patient.supportCapReachedAt = simMinuteNow();
    patient.supportCapValue = Math.min(patient.supportCapValue || 0.95, 0.95);
  }
}

function ktwCanFirstRespond(patient) {
  const required = patient.required || [];
  if (required.includes("KTW")) return false;
  return required.includes("RTW") || required.some(isDoctorRequirement) || required.includes("REF");
}

function refCanFirstRespond(patient) {
  const required = patient?.required || [];
  if (required.includes("REF")) return true;
  return required.some((type) => ["RTW", "KTW"].includes(type) || isDoctorRequirement(type));
}

function elrdCanFirstRespond(patient) {
  return Boolean(patient && !patient.completed && !patient.transporting);
}

function patientHasNonElrdCareAtScene(patient) {
  return (patient?.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && vehicle.type !== "ELRD" && vehicle.status === 4);
}

const patientAcuityRules = {
  "planned-transport": { label: "planbarer Krankentransport", start: [1, 1], decline: 0 },
  stable: { label: "stabil", start: [0.6, 1], decline: 0.006 },
  "potential-critical": { label: "potentiell kritisch", start: [0.3, 0.6], decline: 0.008 },
  critical: { label: "kritisch", start: [0.01, 0.3], decline: 0.01 },
  reanimation: { label: "Reanimation", start: [0, 0], decline: 0 }
};

function updateDynamicPatientStates() {
  (state.incidents || []).forEach((incident) => {
    if (incident.modId || incident.status === "geschlossen") return;
    (incident.patient?.patients || []).forEach((patient) => {
      const condition = patientConditionPercent(patient, incident);
      if (patient.completed || patient.transporting) return;
      if (patient.acuity === "reanimation") updateReanimationState(patient, incident);
      if (patientRequiresOnlyRef(patient) && condition < 0.6) escalateRefPatientToRtw(patient, incident);
    });
    releaseElrdIfNoPatientsAtScene(incident);
    scheduleSurplusVehicleClearances(incident);
  });
}

function normalizeAcuityKey(value) {
  const key = String(value || "stable").toLowerCase();
  return patientAcuityRules[key] ? key : "stable";
}

function initializePatientCondition(patient, incident) {
  if (patient.conditionInitialized) return;
  const key = normalizeAcuityKey(patient.acuity || (incident?.type === "scheduled" ? "planned-transport" : "stable"));
  const rule = patientAcuityRules[key];
  patient.acuity = key;
  patient.conditionStartedAt = incident?.createdAtAbsoluteMinute ?? incident?.createdAtMinute ?? simMinuteNow();
  patient.conditionStartPercent = Number.isFinite(patient.conditionStartPercent)
    ? patient.conditionStartPercent
    : randomFloat(rule.start[0], rule.start[1]);
  patient.deteriorationPerMinute = Number.isFinite(patient.deteriorationPerMinute)
    ? patient.deteriorationPerMinute
    : rule.decline;
  if (key === "reanimation") {
    patient.conditionStartPercent = 0;
    patient.reanimationSurvivalStart = Number.isFinite(patient.reanimationSurvivalStart)
      ? patient.reanimationSurvivalStart
      : randomFloat(0.5, 1);
    patient.reanimationStartedAt = incident?.createdAtAbsoluteMinute ?? incident?.createdAtMinute ?? simMinuteNow();
    patient.reanimationLastUpdateAt = patient.reanimationStartedAt;
    enforceReanimationRequirements(patient, incident);
  }
  patient.conditionInitialized = true;
}

function patientConditionPercent(patient, incident) {
  if (!patient) return 1;
  initializePatientCondition(patient, incident);
  if (patient.deceased) return 0;
  if (patient.completed || patient.transporting) return patient.conditionCurrentPercent ?? 1;
  if (patient.acuity === "planned-transport") return 1;
  if (patient.acuity === "reanimation") return 0;
  const elapsed = Math.max(0, simMinuteNow() - (patient.conditionStartedAt ?? incident?.createdAtAbsoluteMinute ?? incident?.createdAtMinute ?? simMinuteNow()));
  const rate = dynamicDeteriorationRate(patient, incident);
  const value = Math.max(0, (patient.conditionStartPercent ?? 1) - (elapsed * rate));
  patient.conditionCurrentPercent = value;
  if (value <= 0) startReanimationFromDeterioration(patient, incident);
  return patient.conditionCurrentPercent ?? value;
}

function dynamicDeteriorationRate(patient, incident) {
  const base = Number(patient.deteriorationPerMinute) || 0;
  if (!base) return 0;
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4);
  if (!assigned.length) return base;
  const missing = patientMissingTypes(patient);
  if (missing.length === 0) return 0;
  if (missing.includes("RTW") && assigned.some((vehicle) => vehicle.type === "REF")) return 0;
  const hasRefOrRtw = assigned.some((vehicle) => ["REF", "RTW"].includes(vehicle.type));
  const hasOnlyDeteriorationSupport = assigned.every((vehicle) => isDeteriorationSupportVehicle(vehicle.type));
  const needsDoctor = missing.some(isDoctorRequirement);
  if (hasRefOrRtw && needsDoctor) {
    if (patient.acuity === "stable") return base * 0.25;
    if (patient.acuity === "potential-critical") return base * 0.4;
    if (patient.acuity === "critical") return base * 0.5;
  }
  if (patient.acuity === "stable") return base * (hasOnlyDeteriorationSupport ? 0.8 : 0.6);
  if (patient.acuity === "potential-critical") return base * (hasOnlyDeteriorationSupport ? 0.8 : 0.7);
  if (patient.acuity === "critical") return base * 0.7;
  return base;
}

function startReanimationFromDeterioration(patient, incident) {
  if (patient.acuity === "reanimation" || patient.deceased) return;
  patient.acuity = "reanimation";
  patient.conditionCurrentPercent = 0;
  patient.reanimationStartedAt = simMinuteNow();
  patient.reanimationLastUpdateAt = simMinuteNow();
  patient.reanimationSurvivalStart = randomFloat(0.5, 1);
  patient.rthTransportMode = null;
  patient.ambulatorySelected = false;
  enforceReanimationRequirements(patient, incident);
  patient.conditionReport = `${patient.label || "Patient"} reanimationspflichtig.`;
  if ((incident.patient?.patients || []).length <= 1) {
    incident.patient.situationReport = `${patient.label || "Patient"} reanimationspflichtig.`;
  }
  incident.assistanceRequested = false;
  clearResolvedAssistanceNeeds(incident);
  if (!tna.onReanimation(incident, patient)) requestReanimationResourcesAfterDeterioration(patient, incident);
}

function requestReanimationResourcesAfterDeterioration(patient, incident) {
  if (!incident || incident.status === "geschlossen") return;
  if (!patientMissingTypes(patient).length) return;
  if (incident.assistanceDecision) {
    const missing = currentAssistanceMissingForDispatch(incident);
    if (!missing.length) return;
    incident.assistanceDecision = { ...incident.assistanceDecision, missing, reason: "Verschlechterung zur Reanimation" };
    incident.assistanceRequested = true;
    return;
  }
  if (incident.assistanceRequested || incidentHasPendingAssistanceRadio(incident)) return;
  const responder = [
    ...(patient.assignedVehicles || []),
    ...(incident.assigned || [])
  ]
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.status === 4 && vehicle.incidentId === incident.id && vehicle.type !== "ELRD");
  if (!responder) return;
  maybeRequestAdditionalResources(responder, incident, { ignoreRadioCooldown: true });
}

function enforceReanimationRequirements(patient, incident = null) {
  if (!patient || patient.acuity !== "reanimation") return;
  if (patient.deceased) {
    patient.required = ["NEF"];
    patient.transportNeeded = false;
    patient.noTransportProbability = 0;
    if (incident) incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
    return;
  }
  patient.required = ["RTW", "NEF"];
  patient.transportNeeded = true;
  patient.noTransportProbability = 0;
  patient.doctorCareCompleted = false;
  patient.requiresDoctorAccompaniment = true;
  if (incident) incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
}

function updateReanimationState(patient, incident) {
  if (patient.completed || patient.transporting || patient.deceased) return;
  initializePatientCondition(patient, incident);
  const now = simMinuteNow();
  const lastUpdate = patient.reanimationLastUpdateAt ?? patient.reanimationStartedAt ?? now;
  const elapsed = Math.max(0, now - lastUpdate);
  const rate = reanimationDeteriorationRate(patient);
  const current = Number.isFinite(patient.reanimationSurvivalChance)
    ? patient.reanimationSurvivalChance
    : patient.reanimationSurvivalStart ?? 0.75;
  const survival = Math.max(0, current - elapsed * rate);
  patient.reanimationSurvivalChance = survival;
  patient.reanimationLastUpdateAt = now;
  if (survival > 0) return;
  if (patientMissingTypes(patient).length === 0) return;
  markReanimationPatientDeceased(patient, incident);
}

function reanimationDeteriorationRate(patient) {
  if (patientMissingTypes(patient).length === 0 || patientHasDoctorAtScene(patient)) return 0;
  if (patientHasRtwAtScene(patient)) return 0.025;
  if (patientHasAnyResourceAtScene(patient)) return 0.05;
  return 0.1;
}

function markReanimationPatientDeceased(patient, incident) {
  if (!patient || patient.deceased) return;
  patient.deceased = true;
  patient.transportNeeded = false;
  patient.transporting = false;
  patient.conditionCurrentPercent = 0;
  patient.reanimationSurvivalChance = 0;
  patient.required = ["NEF"];
  patient.doctorCareCompleted = false;
  patient.outcome = "Reanimation ohne rechtzeitig passendes Rettungsmittel erfolglos, Patient verstorben.";
  if (incident?.patient) {
    incident.patient.outcome = patient.outcome;
    incident.patient.readyForTransport = false;
    incident.patient.status = "Todesfeststellung ausstehend";
    incident.patient.report = "Patient verstorben. Benoetige Notarzt zur Todesfeststellung.";
    incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
  }
}

function escalateRefPatientToRtw(patient, incident) {
  patient.required = ["RTW"];
  patient.transportNeeded = true;
  patient.noTransportProbability = 0;
  patient.conditionReport ||= "Zustandsverschlechterung, REF nicht mehr ausreichend.";
  incident.required = aggregateRequiredVehicles(incident.patient?.patients || [], incident.required);
}

function effectiveNoTransportProbability(patient) {
  if (!patient) return 0;
  if (patientRequiresOnlyRef(patient)) return patientConditionPercent(patient, incidentForPatient(patient)) < 0.6 ? 0 : 1;
  const base = Number(patient.noTransportProbability) || 0;
  if (patient.acuity === "potential-critical") return base * 0.5;
  if (patient.acuity === "critical") return base * 0.05;
  if (patient.acuity === "reanimation") return 0;
  return base;
}

function patientRequiresOnlyRef(patient) {
  const required = patient?.required || [];
  return required.length > 0 && required.every((type) => type === "REF");
}

function patientRequiresTransport(patient) {
  if (!patient) return false;
  if (patient.deceased) return false;
  if (patientRequiresOnlyRef(patient)) return false;
  if (patient.transportNeeded === false) return false;
  return !patientAmbulatorySelected(patient);
}

function patientAmbulatorySelected(patient) {
  if (!patient) return false;
  if (patientRequiresOnlyRef(patient)) {
    patient.ambulatoryDecisionMade = true;
    patient.ambulatorySelected = true;
    patient.transportNeeded = false;
    return true;
  }
  if (patient.ambulatoryDecisionMade) return Boolean(patient.ambulatorySelected);
  patient.ambulatoryDecisionMade = true;
  patient.ambulatorySelected = Math.random() < effectiveNoTransportProbability(patient);
  if (patient.ambulatorySelected) patient.transportNeeded = false;
  return patient.ambulatorySelected;
}

function vehicleSatisfiesPatientRequirement(vehicleType, requiredType, patient) {
  if (vehicleType === "ITW" && patient?.itwAwaitingRegular && !(patient.required || []).includes("ITW")) return false;
  if (vehicleSatisfiesRequirement(vehicleType, requiredType)) return true;
  if (requiredType === "REF" && vehicleType === "RTW") return true;
  if (patientAmbulatorySelected(patient) && vehicleType === "REF" && ["RTW", "KTW"].includes(requiredType)) return true;
  if (patientAmbulatorySelected(patient) && isDoctorVehicle(vehicleType) && requiredType === "KTW") return true;
  if (patientAmbulatorySelected(patient) && isDoctorVehicle(vehicleType) && requiredType === "RTW") {
    return !patientHasDispatchedVehicleType(patient, "RTW");
  }
  return false;
}

function vehicleCoverageForPatient(vehicle, patient, requiredTypes = null) {
  const vehicleType = typeof vehicle === "string" ? vehicle : vehicle?.type;
  if (!vehicleType) return [];
  const required = requiredTypes || patientEffectiveRequiredTypes(patient);
  return required.filter((requiredType) => vehicleSatisfiesPatientRequirement(vehicleType, requiredType, patient));
}

function patientEffectiveRequiredTypes(patient) {
  if (!patient) return [];
  const requiredTypes = patient.acuity !== "reanimation" && patient.rthTransportMode === "rth-transport"
    ? (patient.required || []).filter((type) => !ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type))
    : (patient.required || []);
  const hardRequiredTypes = requiredTypes.filter((type) => !isStabilizerVehicle(type));
  return patient.acuity !== "reanimation" && (patient.doctorCareCompleted || tna.covers(patient) || patientCanDropDoctorRequirement(patient))
    ? hardRequiredTypes.filter((type) => !isDoctorRequirement(type))
    : hardRequiredTypes;
}

function missingRequiredTypesForResources(requiredTypes, resources, coverageFn) {
  const missing = [...(requiredTypes || [])];
  const availableResources = [...(resources || [])]
    .map((resource) => ({ resource, coverage: [...new Set(coverageFn(resource, missing))] }))
    .filter((entry) => entry.coverage.length)
    .sort((a, b) => b.coverage.length - a.coverage.length);
  availableResources.forEach(({ resource }) => {
    const coverage = [...new Set(coverageFn(resource, missing))];
    coverage.forEach((coveredType) => {
      const index = missing.indexOf(coveredType);
      if (index >= 0) missing.splice(index, 1);
    });
  });
  return missing;
}

function patientHasDispatchedVehicleType(patient, type) {
  const incident = incidentForPatient(patient);
  if (!incident) return false;
  return (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.type === type && (vehicle.status === 3 || vehicle.status === 4 || vehicle.nextIncidentId === incident.id || vehicle.incidentId === incident.id));
}

function incidentForPatient(patient) {
  if (!patient) return null;
  return state.incidents.find((incident) => incident.patient?.patients?.includes(patient)) || null;
}

function patientHasRequiredTransportUnitAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && vehicle.status === 4 && (patient.required || []).some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type) && vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)));
}

function patientNeedsTransportUnit(patient) {
  return patientRequiresTransport(patient) && (patient.required || []).some((type) => TRANSPORT_VEHICLE_TYPES.includes(type));
}

function patientNeedsMoreVehicles(patient) {
  return patientMissingTypes(patient).length > 0;
}

function isStabilizerVehicle(type) {
  return STABILIZER_VEHICLE_TYPES.includes(type);
}

function isDeteriorationSupportVehicle(type) {
  return DETERIORATION_SUPPORT_VEHICLE_TYPES.includes(type);
}

function patientHasAnyResourceAtScene(patient) {
  return (patient?.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.status === 4)
    || patientHasStabilizerAtIncidentScene(patient);
}

function patientHasDoctorAtScene(patient) {
  return (patient?.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.status === 4 && isDoctorVehicle(vehicle.type));
}

function patientHasRtwAtScene(patient) {
  return (patient?.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.status === 4 && vehicle.type === "RTW");
}

function patientHasStabilizerAtIncidentScene(patient) {
  const incident = incidentForPatient(patient);
  if (!incident) return false;
  return (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.status === 4 && vehicle.incidentId === incident.id && isStabilizerVehicle(vehicle.type));
}

function patientMissingTypes(patient) {
  if (!patient || patient.completed) return [];
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  return missingRequiredTypesForResources(
    patientEffectiveRequiredTypes(patient),
    assigned,
    (vehicle, requiredTypes) => vehicleCoverageForPatient(vehicle, patient, requiredTypes)
  );
}

function maybeSendSituationReport(vehicle, incident) {
  if (incident.patient?.situationReported || incident.patient?.situationRequested) return;
  const missing = missingVehicleTypesForDispatch(incident);
  if ((incident.patient?.patientCount || 1) <= 1 && !missing.length) return;
  vehicle.pendingSituationReport = { incidentId: incident.id };
  const sent = triggerRadioStatus(vehicle, 0, `Lagemeldung: ${incident.patient.patientCount || 1} Patient(en).`);
  if (sent) incident.patient.situationRequested = true;
  else vehicle.pendingSituationReport = null;
}

function assistanceSituationText(incident) {
  const patients = incident.patient?.patients || [];
  const baseReport = incident.patient?.situationReport || incident.patient?.situationReportText
    || incident.patient?.pendingReport || incident.patient?.report || "";
  if (patients.length > 1) {
    const patientLines = patients.map((patient, index) => {
      const label = patient.label || `Pat ${index + 1}`;
      const acuity = patientAcuityLabel(patient);
      const requirement = normalizeRequiredVehicles(patient.required || []).join(" + ") || "unklar";
      return `${label}: ${acuity}, Bedarf ${requirement}`;
    });
    return `${baseReport ? `${baseReport} ` : ""}${patientLines.join("; ")}.`;
  }
  const patient = patients[0];
  if (!patient) return baseReport || "Lage wird erkundet.";
  return patient.conditionReport || patient.report || baseReport || `Zustand ${patientAcuityLabel(patient)}.`;
}

function assistanceRequestReason(vehicle, incident, missing) {
  const profile = incident.patient;
  const patients = (profile?.patients || []).filter((patient) => !patient.completed && !patient.transporting);
  const affected = patients.filter((patient) => patientMissingTypes(patient).some((type) => missing.includes(type)));
  const needsDoctor = missing.some(isDoctorRequirement);
  const reasons = [];
  if (affected.some((patient) => patient.acuity === "reanimation" && !patient.deceased)) {
    reasons.push("Reanimation läuft");
  } else if (needsDoctor && affected.some((patient) => patient.deceased)) {
    reasons.push("Notärztliche Todesfeststellung steht aus");
  } else {
    const findings = affected.map((patient) => {
      const text = patient.conditionReport || patient.report;
      return text && (patients.length > 1 ? `${patient.label || "Patient"}: ${text}` : text);
    }).filter(Boolean);
    const report = profile?.assistanceReason || findings.join(" ") || profile?.situationReport
      || profile?.pendingReport || profile?.situationReportText;
    if (report) reasons.push(report);
  }
  const tnaReason = needsDoctor ? tna.reason(incident) : null;
  if (tnaReason) reasons.push(tnaReason);
  if (!reasons.length) {
    if (missing.includes("RTW") && ["REF", "KTW"].includes(vehicle.type)) {
      reasons.push(`Der ${vehicle.type} kann die erforderliche Versorgung oder den Transport nicht übernehmen`);
    } else if (missing.some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type))) {
      reasons.push("Für die weitere Versorgung fehlt ein geeignetes Transportfahrzeug");
    }
    if (needsDoctor) reasons.push("Notärztliche Versorgung erforderlich");
    if (missing.includes("REF")) reasons.push("Rettungseinsatzfahrzeug für die Versorgung vor Ort erforderlich");
  }
  if (missing.includes("ELRD")) reasons.push("Versorgung mehrerer Patienten muss koordiniert werden");
  if (missing.includes("FW")) reasons.push("Unterstützung der Feuerwehr an der Einsatzstelle erforderlich");
  if (missing.includes("POL")) reasons.push("Unterstützung der Polizei an der Einsatzstelle erforderlich");
  return reasons.map((reason) => reason.trim().replace(/[.\s]+$/, "")).filter(Boolean).join(". ");
}

function recordAssistanceDecision(vehicle, incident, missing) {
  const reason = assistanceRequestReason(vehicle, incident, missing);
  incident.status = "Nachforderung";
  incident.assistanceDecision = {
    vehicleId: vehicle.id,
    vehicleType: vehicle.type,
    missing,
    reason,
    createdAtMinute: state.minute,
    createdAtAbsoluteMinute: simMinuteNow()
  };
  incident.assistanceRequested = true;
  return reason;
}

function assistanceRadioText(missing, reason, situation = "") {
  const suffix = reason && !situation.includes(reason) ? ` · ${reason}` : "";
  return `Nachforderung: ${missing.join(", ")}${suffix}.`;
}

function patientAcuityLabel(patient) {
  const labels = {
    scheduled: "planbarer Krankentransport",
    stable: "stabil",
    "potential-critical": "potentiell kritisch",
    critical: "kritisch",
    reanimation: "Reanimation"
  };
  return labels[patient?.acuity] || patient?.acuity || "Zustand unklar";
}

function maybeRequestAdditionalResources(vehicle, incident, options = {}) {
  if (incident.modId) return [];
  if (vehicle.status !== 4 || vehicle.incidentId !== incident.id) return [];
  const hasReanimationMissing = (incident.patient?.patients || []).some((patient) => patient.acuity === "reanimation" && patientMissingTypes(patient).length);
  if ((incident.patient?.patientCount || 1) > 1 && !incident.patient?.situationReported && !hasReanimationMissing) return [];
  clearResolvedAssistanceNeeds(incident);
  if (incident.assistanceRequested) return [];
  if (incidentHasPendingAssistanceRadio(incident)) return [];
  const missing = missingVehicleTypesForDispatch(incident).filter((type) => !tna.waitingAtScene(incident) || !isDoctorRequirement(type));
  const missingServices = missingExternalServices(incident, "dispatch");
  const needsDoctor = missing.some(isDoctorRequirement);
  const missingAfterCurrentVehicle = missingRequiredTypesForResources(missing, [vehicle], (unit, requiredTypes) => requiredTypes.filter((type) => vehicleSatisfiesRequirement(unit.type, type)));
  const needsSceneTransport = (isDoctorVehicle(vehicle.type) || vehicle.type === "REF") && missing.some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type));
  const needsAdditionalTransport = isRoadTransportVehicle(vehicle.type) && missingAfterCurrentVehicle.some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type));
  const needsTransport = vehicle.type === "KTW" && (missing.includes("RTW") || missing.some(isDoctorRequirement));
  const needsRef = vehicle.type === "KTW" && missing.includes("REF");
  const refNeedsTransport = vehicle.type === "REF" && missing.some((type) => ROAD_TRANSPORT_REQUIREMENT_TYPES.includes(type));
  const needsElrd = missing.includes("ELRD");
  if (![...missing, ...missingServices].length) return [];
  if (!needsDoctor && !needsSceneTransport && !needsAdditionalTransport && !needsTransport && !needsRef && !refNeedsTransport && !needsElrd && !missingServices.length) return [];
  const uncoveredAfterCurrentVehicle = missingAfterCurrentVehicle.length < missing.length
    ? missingAfterCurrentVehicle
    : missing;
  const allMissing = options.asPartOfReport
    ? [...uncoveredAfterCurrentVehicle, ...missingServices]
    : [...(needsAdditionalTransport && !needsDoctor ? missingAfterCurrentVehicle : uncoveredAfterCurrentVehicle), ...missingServices];
  if (options.asPartOfReport) {
    recordAssistanceDecision(vehicle, incident, allMissing);
    return allMissing;
  }
  vehicle.pendingAssistanceRequest = {
    incidentId: incident.id,
    missing: allMissing
  };
  const sent = triggerRadioStatus(vehicle, 0, `Nachforderung erforderlich: ${allMissing.join(", ") || "Transportmittel"}.`, {
    ignoreCooldown: Boolean(options.ignoreRadioCooldown)
  });
  if (!sent) {
    vehicle.pendingAssistanceRequest = null;
    return [];
  }
  incident.status = "Nachforderung offen";
  incident.assistanceRequested = true;
  return allMissing;
}

function incidentHasPendingAssistanceRadio(incident) {
  return (incident?.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle?.pendingAssistanceRequest?.incidentId === incident.id && vehicle.radioStatus === 0);
}

function currentAssistanceMissingForDispatch(incident) {
  clearResolvedAssistanceNeeds(incident);
  return [
    ...missingVehicleTypesForDispatch(incident),
    ...missingExternalServices(incident, "dispatch")
  ];
}

function openReportedAssistanceNeeds(incident) {
  const requested = incident.assistanceDecision?.missing;
  if (incident.firstUnitOnSceneAtMinute == null || !requested?.length) return [];
  const remaining = [...missingVehicleTypesForDispatch(incident), ...missingExternalServices(incident, "dispatch")];
  return requested.filter((type) => {
    const index = remaining.indexOf(type);
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

function missingVehicleTypesForDispatch(incident) {
  if (incident.modId) return missingVehicleTypes(incident);
  const patients = incident.patient?.patients || [];
  const rawMissing = patients.length
    ? patients
      .filter((patient) => !patient.completed && !patient.transporting)
      .flatMap((patient) => patientMissingTypes(patient))
    : missingVehicleTypes(incident);
  if (patients.length && incidentRequiresElrd(incident) && incidentHasPatientAtScene(incident)) rawMissing.push("ELRD");
  rawMissing.push(...tna.physicalMissing(incident));
  const coverResources = (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean)
    .filter((vehicle) => {
      if (vehicle.type === "ELRD" && vehicle.status === 4 && vehicle.incidentId === incident.id) return true;
      if (vehicle.status === 4 && !vehicle.patientId) return true;
      if (vehicle.status === 3 && vehicle.incidentId === incident.id) return true;
      return vehicle.nextIncidentId === incident.id;
    });
  return missingRequiredTypesForResources(
    rawMissing,
    coverResources,
    (vehicle, requiredTypes) => requiredTypes.filter((type) => vehicleCoversDispatchRequirement(vehicle, type, incident))
  );
}

function patientRecommendedMissingTypes(patient) {
  const recommended = [...new Set(patient?.recommendedVehicles || [])].filter(isStabilizerVehicle);
  if (!recommended.length) return [];
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  return missingRequiredTypesForResources(
    recommended,
    assigned,
    (vehicle, requiredTypes) => requiredTypes.filter((type) => vehicle.type === type)
  );
}

function vehicleCoversDispatchRequirement(vehicle, requiredType, incident) {
  if (!vehicle) return false;
  if (requiredType === "ELRD") {
    return vehicle.type === "ELRD"
      && (vehicle.status === 4 && vehicle.incidentId === incident.id
        || vehicle.status === 3 && vehicle.incidentId === incident.id
        || vehicle.nextIncidentId === incident.id);
  }
  return vehicleSatisfiesRequirement(vehicle.type, requiredType);
}

function clearResolvedAssistanceNeeds(incident) {
  if (!incident?.assistanceDecision?.missing?.length) return;
  const stillMissing = new Set([
    ...missingVehicleTypesForDispatch(incident),
    ...missingExternalServices(incident, "dispatch")
  ]);
  incident.assistanceDecision.missing = incident.assistanceDecision.missing.filter((type) => stillMissing.has(type));
  if (!incident.assistanceDecision.missing.length) {
    incident.assistanceDecision = null;
    incident.assistanceRequested = false;
    if (incident.status === "Nachforderung" || incident.status === "Nachforderung offen") {
      incident.status = missingVehicleTypes(incident).length ? "in Bearbeitung" : "vor Ort";
    }
  }
}

function clearResolvedAssistanceNeedsAfterDispatch(incident) {
  if ((incident?.patient?.patients || []).length > 1) return;
  clearResolvedAssistanceNeeds(incident);
}

function maybeRequestKtwHandover(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!vehicle || vehicle.type !== "RTW" || !patientRequiresOnlyKtw(patient)) return;
  if (patient.rtwMustTransport || patient.ktwHandoverAsked || patient.awaitingKtwHandover) return;
  patient.ktwHandoverAsked = true;
  vehicle.pendingKtwHandoverRequest = {
    incidentId: incident.id,
    vehicleId: vehicle.id,
    patientId: patient.id
  };
  vehicle.statusText = "Status 5: KTW-Rückfrage";
  triggerRadioStatus(vehicle, 5, "KTW-Patient, Rückfrage zur Übergabe.");
}

function patientRequiresOnlyKtw(patient) {
  const required = patient?.required || [];
  return required.length > 0 && required.every((type) => type === "KTW");
}

function maybeRequestItwSubstitution(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!vehicle || vehicle.type !== "ITW" || !patient || !patientRequiresTransport(patient)) return;
  if ((patient.required || []).includes("ITW")) return;
  if (patient.itwSubstitutionAsked || patient.itwMustTransport || patient.itwAwaitingRegular) return;
  const regularRequired = itwRegularReplacementTypes(patient);
  if (!regularRequired.length) return;
  patient.itwSubstitutionAsked = true;
  vehicle.pendingItwSubstitutionRequest = {
    incidentId: incident.id,
    vehicleId: vehicle.id,
    patientId: patient.id,
    regularRequired
  };
  vehicle.statusText = "Status 5: ITW-Rueckfrage";
  triggerRadioStatus(vehicle, 5, `ITW nicht zwingend erforderlich, Rueckfrage: ${vehicleRequestQuestion(regularRequired)}`);
}

function itwRegularReplacementTypes(patient) {
  const required = patient?.required || [];
  if (!required.length || required.includes("ITW")) return [];
  const replacements = [];
  if (required.some((type) => ["RTW", "KTW", "REF"].includes(type))) {
    replacements.push(required.includes("KTW") ? "KTW" : "RTW");
  }
  if (required.some(isDoctorRequirement)) replacements.push("NEF");
  return [...new Set(replacements)];
}

function missingExternalServices(incident, mode = "dispatch") {
  return (incident.requiredServices || []).filter((service) => {
    const status = incident.services?.[service]?.status || "nicht alarmiert";
    if (mode === "transport") return status !== "an Einsatzstelle";
    return status !== "unterwegs" && status !== "an Einsatzstelle";
  });
}

function handleRthTransportReadiness(vehicle, incident, patient) {
  if (!patient || patient.completed || patient.transporting) return false;
  const rth = rthAtSceneForPatient(patient);
  if (!rth) return false;
  const rtw = rtwAtSceneForPatient(patient);
  if (!patient.required?.some(isDoctorRequirement)) return false;
  patient.rthTransportMode ||= chooseRthTransportMode(patient);
  if (patient.acuity === "reanimation") patient.rthTransportMode = "joint-rtw-rth";
  if (patient.rthTransportMode !== "rth-transport" && !rtw && patientRequiresRoadTransportWithRth(patient)) {
    if (vehicle.id === rth.id) {
      maybeRequestAdditionalResources(vehicle, incident);
      vehicle.statusText = "wartet auf RTW für Transportentscheidung";
      renderAll();
      return true;
    }
    return false;
  }

  if (patient.rthTransportMode === "rth-release") {
    if (rth.status === 4) {
      releaseVehicleAfterRthDecision(rth, incident, "RTH-Notarzt nicht transportgebunden, RTW transportiert alleine");
    }
    return vehicle.id === rth.id;
  }

  if (patient.rthTransportMode === "rth-transport") {
    if (vehicle.id !== rth.id) {
      releaseVehicleAfterRthDecision(vehicle, incident, "Patient wird per RTH transportiert");
      scheduleTimeout(() => transportOrClear(rth.id), simulationDelay(.2));
      return true;
    }
    if (rtw && rtw.status === 4) {
      releaseVehicleAfterRthDecision(rtw, incident, "Patient wird per RTH transportiert");
    }
    return false;
  }

  if (patient.rthTransportMode === "joint-rtw-rth") {
    if (vehicle.id === rth.id) {
      vehicle.statusText = rtw ? `wartet auf Transport mit ${rtw.shortName || rtw.name}` : "wartet auf RTW-Transport";
      if (rtw) scheduleTimeout(() => transportOrClear(rtw.id), simulationDelay(.2));
      renderAll();
      return true;
    }
    return false;
  }

  return false;
}

function patientRequiresRoadTransportWithRth(patient) {
  const required = patient.required || [];
  return required.includes("RTW");
}

function chooseRthTransportMode(patient) {
  if (patient?.acuity === "reanimation") return "joint-rtw-rth";
  const roll = Math.random();
  if (patientRequiresDoctorAccompaniment(patient)) {
    return roll < .5 ? "rth-transport" : "joint-rtw-rth";
  }
  if (roll < .6) return "rth-release";
  if (roll < .8) return "rth-transport";
  return "joint-rtw-rth";
}

function rthAtSceneForPatient(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle && isAirMedicalVehicle(vehicle.type) && vehicle.status === 4);
}

function rtwAtSceneForPatient(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "RTW" && vehicle.status === 4);
}

function releaseVehicleAfterRthDecision(vehicle, incident, reason) {
  if (!vehicle || ![3, 4, 7].includes(vehicle.status)) return;
  logRadio(`${vehicle.name}: ${reason}, meldet frei.`, "radio", incident.id);
  clearVehicle(vehicle.id);
}

function startRthJointTransport(rth, transportingVehicle, patient, destination, signal) {
  patient.rthJointTransport = {
    rtwId: transportingVehicle.id,
    rthId: rth.id,
    releaseScheduled: false
  };
  rth.status = 7;
  rth.statusText = `RTH-Notarzt begleitet ${transportingVehicle.shortName || transportingVehicle.name} zu ${destination.label}`;
  rth.accompanyingActive = true;
  rth.pendingTransportRequest = null;
  rth.radioStatus = null;
  rth.radioMessage = "";
  logRadio(`${rth.name}: Status 7, RTH-Notarzt begleitet den Transport im RTW.`, "radio", rth.incidentId);
  const destinationPhase = destination.type === "destination" ? "destination" : "hospital";
  const arrivalHandler = destination.type === "destination" ? arriveAtTransportDestination : arriveAtHospital;
  driveVehicleTo(rth, destination, { signal, phase: destinationPhase }, () => arrivalHandler(rth.id));
}

function handleRthJointDestinationArrival(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  const joint = patient?.rthJointTransport;
  if (!joint || ![joint.rtwId, joint.rthId].includes(vehicle.id)) return false;
  const rtw = state.vehicles.find((unit) => unit.id === joint.rtwId);
  const rth = state.vehicles.find((unit) => unit.id === joint.rthId);
  if (!rtw || !rth) return vehicle.id === joint.rthId;
  if (rtw.status === 8 && rth.status === 8 && !joint.releaseScheduled) {
    joint.releaseScheduled = true;
    rth.statusText = "RTH-Notarztübergabe, frei in 10 min";
    rth.handoverTimer = scheduleTimeout(() => {
      if (rth.status === 8) clearVehicle(rth.id);
    }, simulationDelay(10));
    logRadio(`${rth.name}: RTH-Notarzt bleibt 10 Minuten am Ziel, danach frei.`, "radio", incident.id);
  }
  return vehicle.id === joint.rthId;
}

function transportOrClear(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 4) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  if (!incident || incident.status === "geschlossen") return;
  if (incident.modId) return;
  if (vehicle.pendingSituationReport || vehicle.pendingAssistanceRequest || hasPersistentSpeechRequest(vehicle)) return;
  const assignedPatient = patientForVehicle(vehicle, incident);

  if (assignedPatient?.deceased && !assignedPatient.completed) {
    if (vehicleCanCompleteNonTransportCare(vehicle, assignedPatient)) {
      finishPatientWithoutTransport(incident, assignedPatient, vehicle, nonTransportCompletionReason(assignedPatient));
      return;
    }
    maybeRequestAdditionalResources(vehicle, incident);
    vehicle.statusText = `${assignedPatient.label} verstorben, wartet auf Notarzt`;
    incident.patient.readyForTransport = false;
    incident.status = "Todesfeststellung ausstehend";
    renderAll();
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    return;
  }

  if (assignedPatient && !assignedPatient.completed && !assignedPatient.transporting) {
    const progress = patientTreatmentProgress(assignedPatient, incident);
    const cap = currentTreatmentCap(assignedPatient, incident).cap;
    if (progress < Math.min(1, cap) - 0.001) {
      scheduleTreatmentCompletion(vehicle, incident);
      return;
    }
    if (!patientRequiresTransport(assignedPatient)) {
      if (patientReadyForNonTransportCompletion(assignedPatient, incident) && vehicleCanCompleteNonTransportCare(vehicle, assignedPatient)) {
        finishPatientWithoutTransport(incident, assignedPatient, vehicle, nonTransportCompletionReason(assignedPatient));
        return;
      }
      waitForPatientHandover(vehicle, incident, assignedPatient, cap);
      return;
    }
    if (vehicle.supportOnly && !vehicleCanTransportPatient(vehicle, assignedPatient)) {
      if (patientMissingTypes(assignedPatient).length === 0 && patientHasTransportUnitAtScene(assignedPatient)) {
        requestVehicleClearance(vehicle, incident, "Patient an Transportfahrzeug übergeben");
        return;
      }
      waitForPatientHandover(vehicle, incident, assignedPatient, cap);
      return;
    }
  }

  if (assignedPatient && !patientReadyForTransport(assignedPatient, incident)) {
    waitForPatientReadiness(vehicle, incident, assignedPatient);
    return;
  }

  if (vehicle.type === "ITW" && (vehicle.pendingItwSubstitutionRequest || incident.itwSubstitutionDecision?.vehicleId === vehicle.id)) {
    vehicle.statusText = `${assignedPatient?.label || "Patient"} versorgt, ITW-Rueckfrage offen`;
    renderAll();
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    return;
  }

  if (assignedPatient) scheduleSupportReleaseAfterCareComplete(incident, assignedPatient, vehicle.id);

  incident.patient.status = "versorgt";
  incident.patient.readyForTransport = true;
  incident.patient.report = patientReport(incident, assignedPatient);
  if (vehicle.supportOnly && vehicle.type === "KTW" && assignedPatient && patientNeedsMoreVehicles(assignedPatient)) {
    maybeRequestAdditionalResources(vehicle, incident);
    vehicle.statusText = `${assignedPatient.label} erstversorgt, wartet auf Rettungsmittel`;
    renderAll();
    return;
  }
  if (vehicle.type === "RTW" && assignedPatient?.awaitingKtwHandover && !assignedPatient.rtwMustTransport) {
    const ktw = ktwForHandoverAtScene(assignedPatient);
    if (ktw) {
      requestVehicleClearance(vehicle, incident, `${assignedPatient.label} an ${ktw.shortName || ktw.name} übergeben`);
      scheduleTreatmentCompletion(ktw, incident);
    } else {
      vehicle.statusText = `${assignedPatient.label} bis Übergabe versorgt`;
      scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    }
    renderAll();
    return;
  }
  if (vehicle.type === "ITW" && assignedPatient?.itwAwaitingRegular && !assignedPatient.itwMustTransport) {
    if (patientMissingTypes(assignedPatient).length === 0 && patientHasTransportUnitAtScene(assignedPatient)) {
      requestVehicleClearance(vehicle, incident, `${assignedPatient.label} an regulaere Rettungsmittel uebergeben`);
    } else {
      maybeRequestAdditionalResources(vehicle, incident);
      vehicle.statusText = `${assignedPatient.label} bis Uebergabe versorgt`;
      scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    }
    renderAll();
    return;
  }
  const outcome = patientOutcome(incident, assignedPatient);
  if (outcome && vehicleCanCompleteNonTransportCare(vehicle, assignedPatient)) {
    finishPatientWithoutTransport(incident, assignedPatient, vehicle, outcome);
    return;
  }
  const missingServices = missingExternalServices(incident, "transport");
  if (missingServices.length) {
    const alreadyEnRoute = missingServices.every((service) => {
      const status = incident.services?.[service]?.status || "nicht alarmiert";
      return status === "alarmiert" || status === "unterwegs";
    });
    if (!alreadyEnRoute && !vehicle.pendingAssistanceRequest && vehicle.radioStatus !== 0) {
      vehicle.pendingAssistanceRequest = { incidentId: incident.id, missing: missingServices };
      const sent = triggerRadioStatus(vehicle, 0, `Transportbeginn wartet auf ${missingServices.join(" und ")}.`);
      if (!sent) vehicle.pendingAssistanceRequest = null;
    }
    if (alreadyEnRoute) {
      vehicle.statusText = `wartet auf ${missingServices.join(" und ")}`;
    }
    incident.status = "wartet auf Zusatzkräfte";
    renderAll();
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    return;
  }

  if (handleRthTransportReadiness(vehicle, incident, assignedPatient)) {
    return;
  }

  if (assignedPatient && handleElrdTransportWait(vehicle, incident, assignedPatient)) {
    return;
  }

  if (assignedPatient && !vehicleCanTransportPatient(vehicle, assignedPatient)) {
    const outcome = patientOutcome(incident, assignedPatient);
    if (outcome && vehicleCanCompleteNonTransportCare(vehicle, assignedPatient)) {
      finishPatientWithoutTransport(incident, assignedPatient, vehicle, outcome);
      return;
    }
    waitForPatientHandover(vehicle, incident, assignedPatient);
    return;
  }

  if (!isTransportVehicle(vehicle.type)) {
    const patient = patientForVehicle(vehicle, incident);
    if (vehicle.supportOnly && patient && patientTreatmentProgress(patient, incident) >= 0.8 && patientHasTransportUnitAtScene(patient)) {
      requestVehicleClearance(vehicle, incident, "Patient an Transportfahrzeug übergeben");
      return;
    }
    if (reassignVehicleToNextPatient(vehicle, incident)) {
      logRadio(`${vehicle.name}: übernimmt die Versorgung des nächsten Patienten.`, "radio", incident.id);
      renderAll();
      scheduleTreatmentCompletion(vehicle, incident);
      return;
    }
    requestVehicleClearance(vehicle, incident, "kein Patiententransport durch dieses Fahrzeug");
    return;
  }

  const fixedHospital = incident.patient.fixedDestinationId
    ? state.center.hospitals.find((hospital) => hospital.id === incident.patient.fixedDestinationId)
    : null;
  const noClinicTarget = transportPatientHasNoClinicTarget(assignedPatient || incident.patient);
  const fixedDestination = incident.patient.fixedDestination;
  if (fixedDestination && (noClinicTarget || fixedDestination.type === "hospital")) {
    beginTransportToDestination(incident.id, fixedDestination, vehicle.id);
    return;
  }
  if (fixedHospital) {
    beginTransport(incident.id, fixedHospital.id, vehicle.id);
    return;
  }
  const poiDestination = transportPoiDestinationForPatient(incident, assignedPatient);
  if (poiDestination) {
    beginTransportToDestination(incident.id, poiDestination, vehicle.id);
    return;
  }
  if (isAutomaticTransport(incident) && !noClinicTarget) {
    const hospital = nearestSuitableHospital(incident, { patientId: assignedPatient?.id }, { excludeOrigin: true });
    beginTransport(incident.id, hospital?.id, vehicle.id);
    return;
  }
  if (isAutomaticTransport(incident) && incident.patient.destinationMode !== "poi") {
    const destination = randomHomeDestinationNear({
      lat: incident.lat,
      lng: incident.lng,
      keyword: incident.keyword
    });
    beginTransportToDestination(incident.id, destination, vehicle.id);
    return;
  }

  requestTransportDestination(vehicle, incident);
}

function ktwForHandoverAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "KTW" && vehicle.status === 4);
}

function handleElrdTransportWait(vehicle, incident, patient) {
  if (!incidentRequiresElrd(incident) || elrdAtScene(incident)) {
    if (patient) patient.waitForElrdBeforeTransport = false;
    return false;
  }
  if (!patient || patient.completed || patient.transporting || patient.elrdWaitBypassed) return false;
  if (!patientReadyForTransport(patient, incident) || !vehicleCanTransportPatient(vehicle, patient)) return false;
  if (patient.waitForElrdBeforeTransport) {
    vehicle.statusText = `${patient.label} transportbereit, wartet auf ELRD`;
    maybeRequestAdditionalResources(vehicle, incident);
    renderAll();
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    return true;
  }
  if (incident.elrdWaitDecision) {
    vehicle.statusText = `${patient.label} transportbereit, ELRD-Rueckfrage offen`;
    renderAll();
    scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
    return true;
  }
  incident.elrdWaitDecision = {
    incidentId: incident.id,
    vehicleId: vehicle.id,
    patientId: patient.id,
    patientLabel: patient.label || "Patient",
    createdAtMinute: state.minute,
    createdAtAbsoluteMinute: simMinuteNow()
  };
  vehicle.statusText = "Status 5: ELRD-Rueckfrage";
  triggerRadioStatus(vehicle, 5, `${patient.label || "Patient"} transportbereit. Auf ELRD warten?`);
  renderAll();
  return true;
}

function patientReport(incident, assignedPatient = null) {
  if (assignedPatient?.deceased) {
    return assignedPatient.outcome || "Patient verstorben. Benoetige Notarzt zur Todesfeststellung.";
  }
  if (assignedPatient?.conditionReport) return assignedPatient.conditionReport;
  if (assignedPatient?.acuity === "reanimation" && !assignedPatient.reanimationCase) {
    return "Reanimation, laufende Wiederbelebungsmaßnahmen. Benötige RTW und Notarzt.";
  }
  if (assignedPatient?.report) return assignedPatient.report;
  const patient = incident.patient;
  if (patient.report && /Lage wird erkundet|Benötigt noch|Benötigt:\s*\d/i.test(patient.report)) {
    patient.situationReportText ||= patient.report;
  }
  if (patient.report && patient.report !== patient.situationReportText) return patient.report;
  if ((patient.patientCount || 1) > 1 && assignedPatient) {
    return `benötigt ${assignedPatient.requiredDepartment || patient.requiredDepartment}`;
  }
  if (patient.pendingReport) return patient.pendingReport;
  if (incident.type === "transport") {
    return `Patient transportbereit, benötigt ${patient.requiredDepartment}.`;
  }
  const stateText = patient.condition === "kritisch" ? "kritisch, aber transportfähig" : "stabil nach Erstversorgung";
  return `${stateText}; benötigt ${patient.requiredDepartment}.`;
}

function patientOutcome(incident, patient = null) {
  if (incident.type === "transport") return null;
  if (patient?.deceased) return patient.outcome || "Patient verstorben, kein Transport.";
  if (patient && patientAmbulatorySelected(patient)) {
    return patient.noTransportText || "Ambulante Versorgung ausreichend, kein Transport.";
  }
  return null;
}

function patientReadyForTransport(patient, incident) {
  if (!patient) return false;
  if (!patientRequiresTransport(patient)) return false;
  if (patient.completed || patient.transporting) return false;
  if (incident.modId) return patient.modTransportApproved === true;
  if (patientTreatmentProgress(patient, incident) < 1) return false;
  return patientMissingTypes(patient).length === 0;
}

function patientReadyForNonTransportCompletion(patient, incident) {
  if (!patient || patientRequiresTransport(patient) || patient.completed || patient.transporting) return false;
  if (patient.deceased) return patientMissingTypes(patient).length === 0;
  return patientTreatmentProgress(patient, incident) >= 1 && patientMissingTypes(patient).length === 0;
}

function vehicleCanCompleteNonTransportCare(vehicle, patient) {
  if (!vehicle || !patient || vehicle.supportOnly) return false;
  if (patient.deceased) return isDoctorVehicle(vehicle.type) && patientMissingTypes(patient).length === 0;
  return patientMissingTypes(patient).every((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
}

function nonTransportCompletionReason(patient) {
  if (patient?.deceased) return patient.outcome || "Patient verstorben, kein Transport.";
  return patient?.noTransportText || (patientRequiresOnlyRef(patient)
    ? "Ambulante Versorgung durch REF abgeschlossen, kein Transport."
    : "Ambulante Versorgung ausreichend, kein Transport.");
}

function waitForPatientHandover(vehicle, incident, patient, cap = currentTreatmentCap(patient, incident).cap) {
  const missing = patientMissingTypes(patient);
  if (missing.length) maybeRequestAdditionalResources(vehicle, incident);
  incident.status = missing.length ? "Nachforderung offen" : "wartet auf Übernahme";
  incident.patient.readyForTransport = false;
  vehicle.statusText = `${patient.label} bis ${Math.round(cap * 100)}% versorgt, bleibt bis Übernahme vor Ort`;
  renderAll();
  scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
}

function waitForPatientReadiness(vehicle, incident, patient) {
  const missing = patientMissingTypes(patient);
  if (missing.length) maybeRequestAdditionalResources(vehicle, incident);
  incident.status = "wartet auf Rettungsmittel";
  incident.patient.readyForTransport = false;
  const reason = missing.length ? missing.join(", ") : "vollständige Versorgung";
  vehicle.statusText = `${patient.label} wartet auf ${reason}`;
  renderAll();
  scheduleTimeout(() => transportOrClear(vehicle.id), simulationDelay(1));
}

function finishPatientWithoutTransport(incident, patient, vehicle, reason, { deferClearance = false } = {}) {
  if (!incident || !patient) {
    finishWithoutTransport(incident?.id, reason);
    return;
  }
  const assignedUnitIds = [...(patient.assignedVehicles || [vehicle?.id]).filter(Boolean)];
  patient.outcome = reason;
  patient.transportNeeded = false;
  patient.transporting = false;
  patient.completed = true;
  patient.completedAtMinute = simMinuteNow();
  patient.assignedVehicles = [];
  incident.patient.outcome = reason;
  incident.patient.status = incidentHasOpenPatients(incident) ? "teilweise abgeschlossen" : "abgeschlossen ohne Transport";
  clearTransportRequest(incident, null, vehicle?.id || null);
  assignedUnitIds
    .map((id) => state.vehicles.find((unit) => unit?.id === id))
    .filter((unit) => unit && [3, 4].includes(unit.status))
    .forEach((unit) => {
      if (unit.patientId === patient.id) unit.patientId = null;
      unit.supportOnly = false;
      if (!deferClearance) requestVehicleClearance(unit, incident, reason);
    });
  releaseElrdIfNoPatientsAtScene(incident);
  closeIncidentIfAllPatientsDone(incident);
  renderAll();
}

function isAutomaticTransport(incident) {
  return incident.type === "transport" || incident.keyword.includes("KTP") || incident.keyword.includes("Verlegung");
}

function transportPatientHasNoClinicTarget(patient) {
  const keys = patient?.requiredDepartmentKeys || [patient?.requiredDepartmentKey || "none"];
  return keys.every((key) => normalizeDepartmentKey(key) === "none");
}

function transportPoiDestinationForPatient(incident, patient) {
  if (!incident || !patient || !transportPatientHasNoClinicTarget(patient) || !patientRequiresTransport(patient)) return null;
  if (patient.destinationDecisionMade) return patient.destinationDecision?.destination || null;
  patient.destinationDecisionMade = true;
  patient.destinationDecision = { type: "none", destination: null };
  const config = incident.patient || {};
  if (config.destinationMode !== "poi") return null;
  const destination = randomPoiTransportDestination(config, incident);
  if (!destination) {
    logRadio(`Kein passender Ziel-POI für ${incident.keyword} gefunden, Krankenhaus-Zuweisung bleibt aktiv.`, "warn", incident.id);
    return null;
  }
  patient.destinationDecision = { type: "poi", destination };
  return destination;
}

function randomPoiTransportDestination(config, incident = null) {
  const candidates = matchingDestinationPoiCandidates(config);
  if (!candidates.length) return null;
  const poi = typeof weightedLocationChoice === "function"
    ? weightedLocationChoice(candidates, { lat: incident?.lat || state.center.mapCenter[0], lng: incident?.lng || state.center.mapCenter[1] })
    : candidates[randomInt(0, candidates.length - 1)];
  return {
    id: poi.id,
    label: poi.label || poi.address || "POI-Ziel",
    address: poi.address || poi.label || "POI-Ziel",
    lat: poi.lat,
    lng: poi.lng,
    type: (poi.categories || []).includes("hospital") ? "hospital" : "destination",
    categories: poi.categories || []
  };
}

function matchingDestinationPoiCandidates(config) {
  const poiIds = listValue(config.destinationPoiIds).map((item) => item.toLowerCase());
  const categories = listValue(config.destinationPoiCategories).map((item) => item.toLowerCase());
  return (state.center.poi || [])
    .filter((poi) => Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .filter((poi) => pointInsideServiceArea(poi.lat, poi.lng))
    .filter((poi) => {
      const id = String(poi.id || poi.label || "").toLowerCase();
      const poiCategories = (poi.categories || []).map((category) => String(category).toLowerCase());
      const idMatches = !poiIds.length || poiIds.includes(id);
      const categoryMatches = !categories.length || categories.some((category) => poiCategories.includes(category));
      return idMatches && categoryMatches;
    });
}

function requestTransportDestination(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (patient && !patientRequiresTransport(patient)) {
    finishPatientWithoutTransport(incident, patient, vehicle, nonTransportCompletionReason(patient));
    return;
  }
  if (patient && patientHasActiveTransportVehicle(patient, incident, vehicle.id)) {
    requestVehicleClearance(vehicle, incident, `${patient.label || "Patient"} bereits durch ${unitName(patient.pendingTransportVehicleId || patient.transportVehicleId)} fuer Transport uebernommen`);
    return;
  }
  if (patient && !patientReadyForTransport(patient, incident)) {
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  incident.status = "wartet auf Zielklinik";
  if (patient) patient.pendingTransportVehicleId = vehicle.id;
  vehicle.pendingTransportRequest = {
    id: makeId(),
    incidentId: incident.id,
    report: patientReport(incident, patient),
    requiredDepartment: patient?.requiredDepartment || incident.patient.requiredDepartment,
    patientId: vehicle.patientId || patient?.id || null
  };
  vehicle.statusText = "Status 5: Sprechwunsch";
  triggerRadioStatus(vehicle, 5, `Benötige Krankenhaus-Zuweisung mit Fachrichtung: ${vehicle.pendingTransportRequest.requiredDepartment}.`);
  if (patient && !incident.modId) releaseRedundantTransportVehiclesForPatient(incident, patient, vehicle.id);
  renderAll();
}

function activateTransportRequest(vehicle, incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident || !vehicle.pendingTransportRequest) return;
  const patient = patientForVehicle(vehicle, incident);
  if (patient && !patientRequiresTransport(patient)) {
    vehicle.pendingTransportRequest = null;
    if (patient.pendingTransportVehicleId === vehicle.id) patient.pendingTransportVehicleId = null;
    finishPatientWithoutTransport(incident, patient, vehicle, nonTransportCompletionReason(patient));
    return;
  }
  if (patient && (!patientReadyForTransport(patient, incident) || !vehicleCanTransportPatient(vehicle, patient))) {
    vehicle.pendingTransportRequest = null;
    if (patient.pendingTransportVehicleId === vehicle.id) patient.pendingTransportVehicleId = null;
    vehicle.statusText = `${patient.label} wartet auf vollständige Transportfreigabe`;
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  const request = {
    id: vehicle.pendingTransportRequest.id || makeId(),
    vehicleId: vehicle.id,
    report: vehicle.pendingTransportRequest.report,
    requiredDepartment: vehicle.pendingTransportRequest.requiredDepartment,
    patientId: vehicle.pendingTransportRequest.patientId,
    patientLabel: patient?.label || null
  };
  incident.transportRequests = (incident.transportRequests || []).filter((item) => item.vehicleId !== vehicle.id);
  incident.transportRequests.push(request);
  incident.transportRequest = incident.transportRequests[0] || null;
  vehicle.pendingTransportRequest = null;
  vehicle.statusText = "wartet auf Transportziel";
  const reportText = request.report ? request.report.replace(/[.\s]+$/, "") : "";
  const message = (incident.patient?.patientCount || 1) > 1
    ? `${reportText ? `${request.patientLabel || "Patient"}: ${reportText}. ` : ""}Benötige Krankenhaus-Zuweisung mit Fachrichtung: ${request.requiredDepartment}.`
    : `Rückmeldung: ${request.report} Benötige Krankenhaus-Zuweisung mit Fachrichtung: ${request.requiredDepartment}.`;
  logRadio(`${vehicle.name}: ${message}`, "radio", incident.id);
  selectIncidentFromMapOrList(incident);
  renderAll();
}

function patientHasActiveTransportVehicle(patient, incident, currentVehicleId = null) {
  if (!patient) return false;
  const candidateIds = [
    patient.pendingTransportVehicleId,
    patient.transportVehicleId,
    ...(incident.transportRequests || [])
      .filter((request) => !request.patientId || request.patientId === patient.id)
      .map((request) => request.vehicleId),
    ...(patient.assignedVehicles || [])
      .map((id) => state.vehicles.find((unit) => unit.id === id))
      .filter((unit) => unit?.pendingTransportRequest?.patientId === patient.id)
      .map((unit) => unit.id)
  ].filter(Boolean);
  return candidateIds.some((id) => id !== currentVehicleId);
}

function releaseRedundantTransportVehiclesForPatient(incident, patient, activeVehicleId) {
  (patient.assignedVehicles || [])
    .filter((id) => id !== activeVehicleId)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status === 4)
    .filter((unit) => !unit.pendingTransportRequest)
    .filter((unit) => !doctorStillRequiredForPatient(unit, patient))
    .filter((unit) => vehicleCanTransportPatient(unit, patient))
    .forEach((unit) => requestVehicleClearance(unit, incident, `${patient.label || "Patient"} durch ${unitName(activeVehicleId)} fuer Transport uebernommen`));
}

function patientForVehicle(vehicle, incident) {
  return (incident.patient?.patients || []).find((patient) => patient.id === vehicle.patientId)
    || (!incident.modId && (incident.patient?.patients || [])[0])
    || null;
}

function beginTransport(incidentId, hospitalId, vehicleId = null, requestId = null, modOptions = {}) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  const request = requestId
    ? (incident.transportRequests || []).find((item) => item.id === requestId)
    : vehicleId
      ? (incident.transportRequests || []).find((item) => item.vehicleId === vehicleId)
        || (incident.transportRequest?.vehicleId === vehicleId ? incident.transportRequest : null)
      : incident.transportRequest;
  const vehicle = state.vehicles.find((unit) => unit.id === (vehicleId || request?.vehicleId));
  const hospital = state.center.hospitals.find((item) => item.id === hospitalId);
  const destinationChange = Boolean(request?.destinationChange && vehicle?.status === 7);
  if (requestId && (!request || (vehicleId && request.vehicleId !== vehicleId))) return;
  if (!vehicle || (vehicle.status !== 4 && !destinationChange)) return;
  const patient = patientForVehicle(vehicle, incident);
  if (incident.modId && (!patient || !hospital || !hospitalSuitableForIncident(hospital, incident, { patientId: patient.id }))) return;
  if (patient && !destinationChange && !patientReadyForTransport(patient, incident)) {
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  if (!hospital) {
    logRadio(`${vehicle.name}: Kein geeignetes Krankenhaus hinterlegt, Transportziel erforderlich.`, "warn", incident.id);
    requestTransportDestination(vehicle, incident);
    return;
  }
  if (incident.modId && !destinationChange) {
    const transportId = modOptions.transportId || request?.id || makeId();
    incident.modTransportIds ||= new Set();
    if (incident.modTransportIds.has(transportId)) return;
    incident.modTransportIds.add(transportId);
    vehicle.modTransportOrder = {
      id: transportId,
      patientId: patient.id,
      escortVehicleId: modOptions.escort?.id ?? null
    };
  }
  if (vehicle.modTransportOrder) vehicle.modTransportOrder.hospitalId = hospital.id;

  clearTransportRequest(incident, request?.id, vehicle.id);
  incident.patient.status = "Transport läuft";
  incident.status = "Transport";
  markPatientTransportStarted(vehicle, incident);
  if (!incident.modId) releaseNonRequiredDoctors(incident, vehicle.id);
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.pendingTransportRequest = null;
  vehicle.status = 7;
  vehicle.statusText = `Transport zu ${hospital.label}`;
  if (incident.modId) appMods.incidentEvent(destinationChange ? "transport.retargeted" : "transport.started", incident, {
    transportId: vehicle.modTransportOrder?.id, vehicleId: vehicle.id, patientId: patient.id, hospitalId,
    escortVehicleId: vehicle.modTransportOrder?.escortVehicleId ?? null
  });
  if (!incident.modId) tna.startTransport(incident, vehicle);
  logRadio(`${vehicle.name}: Status 7, Transportziel ${hospital.label}${destinationChange ? " nach Zielortwechsel" : ""}.`, "radio", incident.id);
  if (!hospitalSuitableForIncident(hospital, incident, request || { patientId: patient?.id })) {
    scheduleSecondaryTransfer(incident, hospital, hospitalIsUnavailable(hospital) ? "unavailable" : "unsuitable");
  }
  renderAll();
  const signal = destinationChange ? Boolean(request?.previousSignal) : transportUsesSignal(vehicle, incident);
  if (incident.modId) {
    const escort = state.vehicles.find((unit) => unit.id === vehicle.modTransportOrder?.escortVehicleId);
    if (escort) bindModTransportEscort(escort, vehicle, hospital, incident);
  } else if (destinationChange) {
    rerouteBoundDoctorAfterDestinationChange(vehicle, incident, hospital);
  } else if (!incident.modId) {
    maybeDoctorAccompaniesTransport(incident, vehicle, hospital, signal);
    if (patient) releaseSupportVehiclesAfterHandover(incident, patient, vehicle.id);
    releaseElrdIfNoPatientsAtScene(incident);
  }
  driveVehicleTo(vehicle, hospital, { signal, phase: "hospital" }, () => arriveAtHospital(vehicle.id));
  return true;
}

function bindModTransportEscort(escort, vehicle, hospital, incident) {
  cancelVehicleRoute(escort);
  escort.status = 7;
  escort.statusText = `Begleitet zu ${hospital.label}`;
  escort.accompanyingActive = true;
  escort.boundTransportVehicleId = vehicle.id;
  escort.modEscortTransportId = vehicle.modTransportOrder.id;
  escort.lat = vehicle.lat;
  escort.lng = vehicle.lng;
  vehicle.boundDoctorVehicleId = escort.id;
  logRadio(`${escort.name}: Begleitet den Transport von ${vehicle.shortName || vehicle.name}.`, "radio", incident.id);
}

function beginTransportToDestination(incidentId, destination, vehicleId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!incident || !vehicle || vehicle.status !== 4) return;
  const patient = patientForVehicle(vehicle, incident);
  if (patient && !patientReadyForTransport(patient, incident)) {
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  const target = {
    label: destination.label || "Zieladresse",
    lat: Number.isFinite(destination.lat) ? destination.lat : incident.lat,
    lng: Number.isFinite(destination.lng) ? destination.lng : incident.lng,
    type: destination.type || "destination"
  };
  clearTransportRequest(incident, null, vehicle.id);
  incident.patient.status = "Transport läuft";
  incident.status = "Transport";
  markPatientTransportStarted(vehicle, incident);
  releaseNonRequiredDoctors(incident, vehicle.id);
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.pendingTransportRequest = null;
  vehicle.status = 7;
  vehicle.statusText = `Transport zu ${target.label}`;
  tna.startTransport(incident, vehicle);
  logRadio(`${vehicle.name}: Status 7, Transportziel ${target.label}.`, "radio", incident.id);
  renderAll();
  const signal = transportUsesSignal(vehicle, incident);
  maybeDoctorAccompaniesTransport(incident, vehicle, target, signal);
  if (patient) releaseSupportVehiclesAfterHandover(incident, patient, vehicle.id);
  releaseElrdIfNoPatientsAtScene(incident);
  const arrivalHandler = target.type === "hospital" ? arriveAtHospital : arriveAtTransportDestination;
  driveVehicleTo(vehicle, target, { signal, phase: target.type === "hospital" ? "hospital" : "destination" }, () => arrivalHandler(vehicle.id));
}

function clearTransportRequest(incident, requestId = null, vehicleId = null) {
  const removed = [];
  incident.transportRequests = (incident.transportRequests || []).filter((request) => {
    if (requestId && request.id === requestId) {
      removed.push(request);
      return false;
    }
    if (vehicleId && request.vehicleId === vehicleId) {
      removed.push(request);
      return false;
    }
    return true;
  });
  incident.transportRequest = incident.transportRequests[0] || null;
  removed.forEach((request) => {
    const patient = (incident.patient?.patients || []).find((item) => item.id === request.patientId);
    if (patient?.pendingTransportVehicleId === request.vehicleId) patient.pendingTransportVehicleId = null;
  });
}

function transportUsesSignal(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (incident.patient?.forceTransportSignal || patient?.forceTransportSignal) return true;
  const probability = Number(patient?.transportSignalProbability) || 0;
  return Math.random() < probability;
}

function patientRequiresDoctorAccompaniment(patient) {
  return Boolean(patient?.requiresDoctorAccompaniment || patient?.acuity === "reanimation");
}

function releaseNonRequiredDoctors(incident, transportingVehicleId = null) {
  const doctorRequired = incident.required.some(isDoctorRequirement);
  if (doctorRequired) return;
}

function maybeDoctorAccompaniesTransport(incident, transportingVehicle, destination, signal) {
  const patient = patientForVehicle(transportingVehicle, incident);
  if (!patient?.required?.some(isDoctorRequirement)) return;
  const doctor = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle && isDoctorVehicle(vehicle.type) && vehicle.status === 4);
  if (!doctor) return;
  if (isAirMedicalVehicle(doctor.type)) {
    const mode = patient.rthTransportMode || chooseRthTransportMode(patient);
    patient.rthTransportMode = mode;
    if (mode === "rth-release") {
      releaseVehicleAfterRthDecision(doctor, incident, "RTH-Notarzt nicht transportgebunden, RTW transportiert alleine");
      return;
    }
    if (mode === "rth-transport") {
      return;
    }
    startRthJointTransport(doctor, transportingVehicle, patient, destination, signal);
    return;
  }
  const active = patientRequiresDoctorAccompaniment(patient) || Math.random() < 0.5;
  startDoctorAccompaniment(doctor, transportingVehicle, incident, destination, active);
}

function startDoctorAccompaniment(doctor, transportingVehicle, incident, destination, active, phase) {
  doctor.status = 7;
  doctor.statusText = active
    ? `begleitet aktiv zu ${destination.label}`
    : `begleitet abkömmlich zu ${destination.label}`;
  doctor.accompanyingActive = active;
  doctor.boundTransportVehicleId = transportingVehicle.id;
  transportingVehicle.boundDoctorVehicleId = doctor.id;
  doctor.pendingTransportRequest = null;
  doctor.radioStatus = null;
  doctor.radioMessage = "";
  logRadio(`${doctor.name}: Status 7, ${active ? "aktive" : "abkömmliche"} Notarztbegleitung.`, "radio", incident.id);
  const destinationPhase = phase || (destination.type === "destination" ? "destination" : "hospital");
  const arrivalHandler = destination.type === "destination" ? arriveAtTransportDestination : arriveAtHospital;
  driveVehicleTo(doctor, destination, { signal: false, phase: destinationPhase }, () => arrivalHandler(doctor.id));
}

function holdBoundDoctorForDestinationChange(transportingVehicle, incident) {
  const doctor = state.vehicles.find((vehicle) => vehicle.boundTransportVehicleId === transportingVehicle.id && vehicle.incidentId === incident.id);
  if (!doctor || !isDoctorVehicle(doctor.type) || doctor.status !== 7) return;
  cancelVehicleRoute(doctor);
  doctor.statusText = `wartet auf neues Transportziel mit ${transportingVehicle.shortName || transportingVehicle.name}`;
  doctor.radioStatus = null;
  doctor.radioMessage = "";
  doctor.pendingTransportRequest = null;
  logRadio(`${doctor.name}: Zielortwechsel an ${transportingVehicle.shortName || transportingVehicle.name} gebunden.`, "radio", incident.id);
}

function rerouteBoundDoctorAfterDestinationChange(transportingVehicle, incident, destination) {
  const doctor = state.vehicles.find((vehicle) => vehicle.boundTransportVehicleId === transportingVehicle.id && vehicle.incidentId === incident.id);
  if (!doctor || !isDoctorVehicle(doctor.type) || doctor.status !== 7) return;
  doctor.statusText = doctor.accompanyingActive === false
    ? `begleitet abkoemmlich zu ${destination.label}`
    : `begleitet aktiv zu ${destination.label}`;
  doctor.radioStatus = null;
  doctor.radioMessage = "";
  const destinationPhase = destination.type === "destination" ? "destination" : "hospital";
  const arrivalHandler = destination.type === "destination" ? arriveAtTransportDestination : arriveAtHospital;
  driveVehicleTo(doctor, destination, { signal: false, phase: destinationPhase }, () => arrivalHandler(doctor.id));
}

function markPatientTransportStarted(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!patient) return;
  patient.transporting = true;
  patient.transportVehicleId = vehicle.id;
  patient.pendingTransportVehicleId = null;
  if (!incident.modId) releaseRedundantTransportVehiclesForPatient(incident, patient, vehicle.id);
}

function releaseSupportVehiclesAfterHandover(incident, patient, activeVehicleId) {
  (patient.assignedVehicles || [])
    .filter((id) => id !== activeVehicleId)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status === 4)
    .filter((unit) => unit.boundTransportVehicleId !== activeVehicleId)
    .filter((unit) => !doctorStillRequiredForPatient(unit, patient))
    .filter((unit) => unit.supportOnly || !vehicleCanTransportPatient(unit, patient))
    .forEach((unit) => requestVehicleClearance(unit, incident, `${patient.label} durch ${unitName(activeVehicleId)} übernommen`));
}

function scheduleSupportReleaseAfterCareComplete(incident, patient, activeVehicleId) {
  const supportUnits = (patient.assignedVehicles || [])
    .filter((id) => id !== activeVehicleId)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status === 4)
    .filter((unit) => !doctorStillRequiredForPatient(unit, patient))
    .filter((unit) => unit.supportOnly || !vehicleCanTransportPatient(unit, patient));
  if (supportUnits.some((unit) => isDoctorVehicle(unit.type))) {
    patient.doctorCareCompleted = true;
  }
  supportUnits.forEach((unit) => {
      if (unit.supportReleaseTimer || unit.pendingClearRequest) return;
      const delay = randomInt(5, 10);
      unit.statusText = `${patient.label} an ${unitName(activeVehicleId)} übergeben, frei in ca. ${delay} min`;
      unit.supportReleaseTimer = scheduleTimeout(() => {
        unit.supportReleaseTimer = null;
        if (unit.status !== 4 || unit.incidentId !== incident.id) return;
        if (vehicleClearBlockReason(unit, incident)) return;
        requestVehicleClearance(unit, incident, `${patient.label} durch ${unitName(activeVehicleId)} übernommen`);
      }, simulationDelay(delay));
    });
}

function completeTransportedPatient(vehicle, incident) {
  const patient = (incident.patient?.patients || []).find((item) => item.transportVehicleId === vehicle.id)
    || patientForVehicle(vehicle, incident);
  if (!patient) return;
  if (patient.transportVehicleId && patient.transportVehicleId !== vehicle.id) return;
  patient.transporting = false;
  patient.completed = true;
  patient.completedAtMinute = simMinuteNow();
  if (!incident.modId) tna.end(incident);
  patient.transportVehicleId = null;
  clearTransportRequest(incident, null, vehicle.id);
}

function incidentHasOpenPatients(incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length) return false;
  return patients.some((patient) => !patient.completed);
}

function closeIncidentIfAllPatientsDone(incident) {
  if (!incident || incidentHasOpenPatients(incident)) return false;
  if (incident.modId && !incident.modCloseApproved) return false;
  if (incident.status === "geschlossen") return true;
  tna.end(incident);
  releaseElrdIfNoPatientsAtScene(incident);
  incident.transportRequest = null;
  incident.transportRequests = [];
  incident.assistanceDecision = null;
  incident.assistanceRequested = false;
  incident.modAttention = [];
  incident.modClinicTargets = 0;
  incident.closedAtMinute = simMinuteNow();
  incident.status = "geschlossen";
  logRadio(`Einsatz abgeschlossen: ${incident.keyword}.`, "radio", incident.id);
  if (incident.modId) appMods.incidentEvent("incident.closed", incident);
  standDownIncidentSupportGroups(incident.id);
  releaseCompletedIncidentSceneVehicles(incident);
  return true;
}

function discardIncidentSpeechRequest(vehicle, incidentId) {
  if (["mod-report", "mod-clinic"].includes(vehicle.radioContext) && vehicle.incidentId === incidentId) {
    if (vehicle.radioStatus) expireRadioDisplay(vehicle.id, vehicle.radioStatus);
    else vehicle.radioContext = null;
    return;
  }
  if (vehicle.radioStatus !== 0) return;
  if (vehicle.pendingSituationReport?.incidentId === incidentId || vehicle.pendingAssistanceRequest?.incidentId === incidentId) {
    expireRadioDisplay(vehicle.id, 0);
  }
}

function releaseCompletedIncidentSceneVehicles(incident) {
  (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4)
    .forEach((vehicle) => {
      discardIncidentSpeechRequest(vehicle, incident.id);
      vehicle.patientId = null;
      vehicle.supportOnly = false;
      requestVehicleClearance(vehicle, incident, "Einsatz abgeschlossen");
    });
}

function reassignVehicleToNextPatient(vehicle, incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length) return false;
  const previousPatientId = vehicle.patientId;
  if (previousPatientId && isAirMedicalVehicle(vehicle.type)) return false;
  const next = patients.find((patient) => {
    if (patient.id === previousPatientId) return false;
    if (patient.completed || patient.transporting) return false;
    const missing = patientMissingTypes(patient);
    return missing.some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient))
      || (isDoctorVehicle(vehicle.type) && patientNeedsTransportUnit(patient) && patientTreatmentProgress(patient, incident) < 0.8)
      || !(patient.assignedVehicles || []).length;
  });
  if (!next) return false;
  releasePatientAssignment(vehicle);
  next.assignedVehicles = next.assignedVehicles || [];
  if (!next.assignedVehicles.includes(vehicle.id)) next.assignedVehicles.push(vehicle.id);
  next.treatmentStartedAt ??= simMinuteNow();
  vehicle.patientId = next.id;
  vehicle.supportOnly = !next.required?.some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, next));
  vehicle.statusText = `versorgt ${next.label}`;
  maybeRequestAdditionalResources(vehicle, incident);
  return true;
}

function arriveAtTransportDestination(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 7) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const targetLabel = vehicle.target?.label || "Zielort";
  if (incident) completeTransportedPatient(vehicle, incident);
  vehicle.status = 8;
  vehicle.statusText = targetLabel;
  vehicle.lat = vehicle.target?.lat ?? vehicle.lat;
  vehicle.lng = vehicle.target?.lng ?? vehicle.lng;
  vehicle.patientId = null;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.accompanyingActive = false;
  logRadio(`${vehicle.name}: Status 8, ${targetLabel}`, "radio", incident?.id);
  const rthJointHandled = incident ? handleRthJointDestinationArrival(vehicle, incident) : false;
  if (incident) closeIncidentIfAllPatientsDone(incident);
  renderAll();
  if (rthJointHandled) return;
  vehicle.handoverTimer = scheduleTimeout(() => {
    if (vehicle.status === 8) clearVehicle(vehicle.id);
  }, simulationDelay(handoverMinutes()));
}

function scheduleSecondaryTransfer(sourceIncident, hospital, reason = "unsuitable") {
  if (sourceIncident.secondaryTransferScheduled) return;
  if (reason === "unavailable" && Math.random() >= 0.5) return;
  sourceIncident.secondaryTransferScheduled = true;
  const delayMinutes = reason === "unavailable" ? randomInt(15, 60) : randomInt(30, 75);
  scheduleTimeout(() => {
    const transfer = buildSecondaryTransferCall(sourceIncident, hospital, reason);
    if (typeof queueIncomingCall === "function") queueIncomingCall(transfer);
    else state.pendingCall = transfer;
    logRadio(`${reason === "unavailable" ? "Folgetransport wegen abgemeldeter Zielklinik" : "Folgetransport wegen ungeeigneter Zielklinik"} angelegt: ${hospital.label}.`, "warn", [sourceIncident.id, transfer.id]);
    renderAll();
  }, simulationDelay(delayMinutes));
}

function buildSecondaryTransferCall(sourceIncident, hospital, reason = "unsuitable") {
  const patient = sourceIncident.patient?.patients?.[0] || sourceIncident.patient || {};
  const ktwSufficient = reason === "unavailable" && Math.random() < 0.5;
  const required = ktwSufficient ? ["KTW"] : [...(patient.required?.length ? patient.required : sourceIncident.required || ["RTW"])];
  const critical = required.some(isDoctorRequirement) || sourceIncident.patient?.condition === "kritisch";
  const keyword = required.every((type) => type === "KTW")
    ? "RD KTP - Verlegung"
    : critical ? "RD 2 Verlegung - Notfalltransport mit NA" : "RD 1 Verlegung - Notfalltransport mit RTW";
  const defaults = keywordDefaults[keyword] || { type: "transport", required, signal: critical };
  const requiredText = required.length ? required.join(", ") : "Transportmittel";
  const department = sourceIncident.patient?.requiredDepartment || patient.requiredDepartment || "geeignete Fachrichtung";
  const callerText = reason === "unavailable"
    ? `Hallo, Klinik ${hospital.label}, wir sind momentan abgemeldet und koennen den Patienten nicht uebernehmen. Wir brauchen bitte einmal ${requiredText}. Benoetige Krankenhaus-Zuweisung mit Fachrichtung: ${department}`
    : `Hallo, Klinik ${hospital.label}, ihr habt uns vorhin einen Patienten gebracht, den wir nicht behandeln koennen. Wir brauchen bitte einmal ${requiredText}. Benoetige Krankenhaus-Zuweisung mit Fachrichtung: ${department}`;
  return {
    id: makeId(),
    type: defaults.type,
    keyword,
    callerName: `${hospital.label} Aufnahme`,
    callerText,
    location: hospital.label,
    lat: hospital.lat,
    lng: hospital.lng,
    required,
    requiredDepartmentKey: sourceIncident.patient?.requiredDepartmentKey || patient.requiredDepartmentKey || "emergency",
    priority: critical ? "hoch" : "normal",
    signal: defaults.signal,
    fixedDestinationId: nearestSuitableHospital(sourceIncident)?.id || null
  };
}

function nearestSuitableHospital(incident, request, options) {
  return nearestHospitals(incident, request, options).find((hospital) => hospital.suitable);
}

function suitableHospitalWithinKm(incident, request = incident?.transportRequest, maxKm = 30) {
  return nearestHospitals(incident, request, { includeForeign: true })
    .some((hospital) => hospital.suitable && hospital.distance <= maxKm);
}

function finishWithoutTransport(incidentId, reason) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  tna.end(incident);
  incident.patient.outcome = reason;
  incident.patient.transportNeeded = false;
  incident.patient.status = "abgeschlossen ohne Transport";
  incident.transportRequest = null;
  incident.transportRequests = [];
  incident.assistanceDecision = null;
  incident.assistanceRequested = false;
  (incident.patient.patients || []).forEach((patient) => {
    patient.transportNeeded = false;
    patient.transporting = false;
    patient.completed = true;
    patient.completedAtMinute = simMinuteNow();
  });
  incident.assigned.forEach((id) => {
    const assigned = state.vehicles.find((unit) => unit.id === id);
    if (assigned) {
      assigned.pendingTransportRequest = null;
      assigned.pendingAssistanceRequest = null;
      assigned.pendingSituationReport = null;
      assigned.pendingClearRequest = null;
      assigned.radioStatus = null;
      assigned.radioMessage = "";
      assigned.awaitingSpeechPrompt = false;
      assigned.supportOnly = false;
    }
  });
  logRadio(`Einsatz ${incident.keyword}: ${reason}`, "warn", incident.id);
  incident.assigned.forEach((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    if (vehicle && [3, 4, 7].includes(vehicle.status)) clearVehicle(vehicle.id);
  });
  incident.status = "geschlossen";
  standDownIncidentSupportGroups(incident.id);
  logRadio(`Einsatz abgeschlossen: ${incident.keyword}.`, "radio", incident.id);
  renderAll();
}

function handoffIncident(incidentId, service) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  tna.end(incident);
  const labels = { FW: "Feuerwehr", POL: "Polizei", AEND: "Ärztlichen Notdienst" };
  incident.status = "geschlossen";
  incident.handoff = service;
  incident.assigned.forEach((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    if (!vehicle) return;
    discardIncidentSpeechRequest(vehicle, incident.id);
    if ([1, 2, 3].includes(vehicle.status)) removeAssignedVehicle(vehicle.id, incident.id);
  });
  incident.status = "geschlossen";
  standDownIncidentSupportGroups(incident.id);
  logRadio(`Einsatz ${incident.keyword} an ${labels[service] || service} abgegeben.`, "warn", incident.id);
  renderAll();
}

function renderServiceSupport(incident) {
  if (!incident.services) {
    incident.services = { FW: createServiceState(), POL: createServiceState() };
  }
  const wrapper = document.createElement("div");
  wrapper.className = "service-support";
  ["FW", "POL"].forEach((service) => {
    const stateInfo = incident.services[service] || createServiceState();
    refreshServiceArrival(incident, service, stateInfo);
    incident.services[service] = stateInfo;
    if (stateInfo.status === "nicht alarmiert") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "service-chip";
      button.textContent = service;
      button.title = `${service} alarmieren`;
      button.setAttribute("aria-label", `${service} alarmieren`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        alarmService(incident.id, service);
      });
      wrapper.append(button);
    } else {
      const chip = document.createElement("span");
      chip.className = `service-chip service-${stateInfo.status.replace(/\s+/g, "-")}`;
      chip.title = `${service} ${stateInfo.status}`;
      const symbol = document.createElement("span");
      symbol.setAttribute("aria-hidden", "true");
      symbol.textContent = { alarmiert: "…", unterwegs: "→", "an Einsatzstelle": "✓" }[stateInfo.status] || "";
      chip.append(service, symbol);
      if (stateInfo.status === "unterwegs" && Number.isFinite(stateInfo.arriveAtMinute)) {
        const secondsLeft = Math.max(0, Math.ceil((stateInfo.arriveAtMinute - simMinuteNow()) * 60));
        const minutes = Math.floor(secondsLeft / 60);
        const seconds = secondsLeft % 60;
        const arrival = document.createElement("time");
        arrival.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
        arrival.dateTime = `PT${secondsLeft}S`;
        chip.classList.add("service-chip-with-arrival");
        chip.append(arrival);
        chip.title += `, noch ${minutes} min ${seconds} s bis zur Ankunft`;
      }
      chip.setAttribute("aria-label", chip.title);
      wrapper.append(chip);
    }
  });
  return wrapper;
}

function refreshServiceArrival(incident, service, serviceState) {
  if (serviceState.status !== "unterwegs" || !serviceState.arriveAtMinute || simMinuteNow() < serviceState.arriveAtMinute) return;
  completeServiceArrival(incident, service, serviceState);
}

function completeServiceArrival(incident, service, serviceState) {
  serviceState.status = "an Einsatzstelle";
  serviceState.eta = null;
  serviceState.arriveAtMinute = null;
  if (incident.modId) appMods.incidentEvent("service.arrived", incident, { service });
}

function alarmService(incidentId, service) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  if (!incident.services) incident.services = { FW: createServiceState(), POL: createServiceState() };
  const serviceState = incident.services[service] || createServiceState();
  if (serviceState.status !== "nicht alarmiert") return;
  const eta = randomInt(3, 12);
  serviceState.status = "alarmiert";
  serviceState.eta = eta;
  serviceState.arriveAtMinute = simMinuteNow() + eta;
  serviceState.alarmedAt = simMinuteNow();
  incident.services[service] = serviceState;
  clearResolvedAssistanceNeeds(incident);
  logRadio(`${service}: zu ${incident.keyword} alarmiert.`, "warn", incident.id);
  renderAll();
  scheduleTimeout(() => {
    if (serviceState.status !== "alarmiert") return;
    serviceState.status = "unterwegs";
    clearResolvedAssistanceNeeds(incident);
    logRadio(`${service}: unterwegs zu ${incident.location}.`, "radio", incident.id);
    renderAll();
  }, simulationDelay(.3));
  scheduleTimeout(() => {
    if (!["alarmiert", "unterwegs"].includes(serviceState.status)) return;
    completeServiceArrival(incident, service, serviceState);
    clearResolvedAssistanceNeeds(incident);
    renderAll();
  }, simulationDelay(eta));
}

function serviceRemainingMinutes(serviceState) {
  if (!serviceState.arriveAtMinute) return serviceState.eta || 0;
  return Math.max(1, Math.ceil(serviceState.arriveAtMinute - simMinuteNow()));
}

function arriveAtHospital(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 7) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  if (incident?.modId && vehicle.modTransportOrder) {
    arriveAtModTransportHospital(vehicle, incident);
    return;
  }
  const patientId = vehicle.patientId;
  const hospitalId = vehicle.target?.id;
  if (incident) completeTransportedPatient(vehicle, incident);
  vehicle.status = 8;
  vehicle.statusText = "am Krankenhaus";
  vehicle.patientId = null;
  vehicle.lat = vehicle.target?.lat ?? vehicle.lat;
  vehicle.lng = vehicle.target?.lng ?? vehicle.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.accompanyingActive = false;
  logRadio(`${vehicle.name}: Status 8, Übergabe im Krankenhaus.`, "radio", incident?.id);
  if (incident?.modId) appMods.incidentEvent("transport.arrived", incident, { vehicleId, patientId, hospitalId });
  const rthJointHandled = incident ? handleRthJointDestinationArrival(vehicle, incident) : false;
  if (incident) closeIncidentIfAllPatientsDone(incident);
  renderAll();
  if (rthJointHandled) return;
  vehicle.handoverTimer = scheduleTimeout(() => {
    if (vehicle.status === 8) clearVehicle(vehicle.id);
  }, simulationDelay(handoverMinutes()));
}

function arriveAtModTransportHospital(vehicle, incident) {
  const order = vehicle.modTransportOrder;
  const hospitalId = vehicle.target?.id;
  const escort = state.vehicles.find((unit) => unit.id === order.escortVehicleId);
  const arrived = [vehicle, escort].filter(Boolean);
  for (const unit of arrived) {
    unit.status = 8;
    unit.statusText = "Übergabe im Krankenhaus";
    unit.lat = vehicle.target?.lat ?? vehicle.lat;
    unit.lng = vehicle.target?.lng ?? vehicle.lng;
    if (unit !== vehicle) {
      unit.target = null;
      unit.route = null;
      unit.routeMeta = null;
    }
  }
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  const payload = { transportId: order.id, vehicleId: vehicle.id, patientId: order.patientId, hospitalId, escortVehicleId: order.escortVehicleId };
  logRadio(`${vehicle.name}: Status 8, Übergabe im Krankenhaus.`, "radio", incident.id);
  appMods.incidentEvent("transport.arrived", incident, payload);
  renderAll();
  vehicle.handoverTimer = scheduleTimeout(() => {
    if (vehicle.modTransportOrder !== order || vehicle.status !== 8) return;
    completeTransportedPatient(vehicle, incident);
    vehicle.modTransportOrder = null;
    if (escort) {
      escort.modEscortTransportId = null;
      escort.accompanyingActive = false;
      clearVehicle(escort.id);
    }
    appMods.incidentEvent("transport.handover", incident, payload);
    clearVehicle(vehicle.id);
  }, simulationDelay(handoverMinutes()));
}

function clearVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.modTransportOrder || vehicle.modEscortTransportId) return;
  const oldStatus = vehicle.status;
  const oldIncidentId = vehicle.incidentId;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const group = vehicle.supportGroupId && state.center.supportGroups?.find((entry) => entry.id === vehicle.supportGroupId);
  const station = group ? supportGroupLocation(state.center, group, vehicle) : state.center.stations.find((item) => item.id === vehicle.stationId);
  if (oldStatus === 4) {
    const blockReason = vehicleClearBlockReason(vehicle, incident);
    if (blockReason) {
      vehicle.pendingClearRequest = null;
      vehicle.statusText = blockReason;
      renderAll();
      return;
    }
  }
  cancelVehicleRoute(vehicle);
  if (vehicle.status8ReadyTimer) {
    cancelScheduledTimeout(vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.handoverTimer) {
    cancelScheduledTimeout(vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (vehicle.treatmentTimer) {
    cancelScheduledTimeout(vehicle.treatmentTimer);
    vehicle.treatmentTimer = null;
  }
  if (vehicle.supportReleaseTimer) {
    cancelScheduledTimeout(vehicle.supportReleaseTimer);
    vehicle.supportReleaseTimer = null;
  }
  if (vehicle.surplusReleaseTimer) {
    cancelScheduledTimeout(vehicle.surplusReleaseTimer);
    vehicle.surplusReleaseTimer = null;
  }
  if (vehicle.postTransportCleanupTimer) {
    cancelScheduledTimeout(vehicle.postTransportCleanupTimer);
    vehicle.postTransportCleanupTimer = null;
  }
  vehicle.treatmentDueAt = null;
  vehicle.status8ReadyAt = null;
  vehicle.status8ReadyDelay = null;
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  vehicle.coverageDispatch = null;
  const boundTransport = state.vehicles.find((unit) => unit.id === vehicle.boundTransportVehicleId);
  if (boundTransport?.boundDoctorVehicleId === vehicle.id) boundTransport.boundDoctorVehicleId = null;
  const boundDoctor = state.vehicles.find((unit) => unit.id === vehicle.boundDoctorVehicleId);
  if (boundDoctor?.boundTransportVehicleId === vehicle.id) boundDoctor.boundTransportVehicleId = null;
  vehicle.boundTransportVehicleId = null;
  vehicle.boundDoctorVehicleId = null;
  releasePatientAssignment(vehicle);
  vehicle.modRole = null;

  if (shouldStartPostTransportCleanup(vehicle, oldStatus, station)) {
    vehicle.status = 6;
    vehicle.status6Reason = "post-transport-cleanup";
    vehicle.statusText = "Nachbereitung, auf dem Weg zur Wache";
    vehicle.radioStatus = null;
    vehicle.radioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    vehicle.incidentId = null;
    vehicle.patientId = null;
    if (oldIncidentId) detachVehicleFromIncident(vehicle.id, oldIncidentId);
    logRadio(`${vehicle.name}: Status 6 - Nachbereitung, faehrt zur Wache zum Auffuellen/Putzen.`, "radio", oldIncidentId);
    if (incident && !incidentHasOpenPatients(incident) && incident.assigned.every((id) => {
      const assigned = state.vehicles.find((unit) => unit.id === id);
      return assigned && [1, 2].includes(assigned.status);
    })) {
      closeIncidentIfAllPatientsDone(incident);
    }
    renderAll();
    driveVehicleTo(vehicle, station, { signal: false, phase: "station" }, () => startPostTransportCleanupAtStation(vehicle.id));
    return;
  }

  vehicle.status = 1;
  vehicle.status6Reason = null;
  vehicle.statusText = "frei über Funk";
  vehicle.incidentId = null;
  vehicle.patientId = null;
  vehicle.supportOnly = false;
  vehicle.radioStatus = null;
  vehicle.radioContext = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.pendingClearRequest = null;
  vehicle.pendingTransportRequest = null;
  vehicle.pendingAssistanceRequest = null;
  vehicle.pendingSituationReport = null;
  vehicle.pendingKtwHandoverRequest = null;
  if (oldIncidentId) detachVehicleFromIncident(vehicle.id, oldIncidentId);
  logRadio(`${vehicle.name}: Status 1, einsatzbereit.`, "radio", oldIncidentId);

  if (incident && !incidentHasOpenPatients(incident) && incident.assigned.every((id) => {
    const assigned = state.vehicles.find((unit) => unit.id === id);
    return assigned && [1, 2].includes(assigned.status);
  })) {
    closeIncidentIfAllPatientsDone(incident);
  }

  renderAll();
  if (station) driveVehicleTo(vehicle, station, { signal: false, phase: "station" }, () => returnToStation(vehicle.id));
}

function shouldStartPostTransportCleanup(vehicle, oldStatus, station) {
  if (vehicle.supportGroupId) return false;
  if (oldStatus !== 8 || !station || vehicle.nextIncidentId) return false;
  const probability = POST_TRANSPORT_CLEANUP_PROBABILITY[vehicle.type] || 0;
  return probability > 0 && Math.random() < probability;
}

function startPostTransportCleanupAtStation(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 6 || vehicle.status6Reason !== "post-transport-cleanup") return;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (station) {
    vehicle.lat = station.lat;
    vehicle.lng = station.lng;
  }
  const delay = postTransportCleanupMinutes();
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.statusText = `Nachbereitung an der Wache, frei in ca. ${delay} min`;
  logRadio(`${vehicle.name}: Status 6 - Nachbereitung an der Wache, frei in ca. ${delay} Minuten.`, "radio");
  renderAll();
  vehicle.postTransportCleanupTimer = scheduleTimeout(() => finishPostTransportCleanup(vehicle.id), simulationDelay(delay));
}

function finishPostTransportCleanup(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 6 || vehicle.status6Reason !== "post-transport-cleanup") return;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  vehicle.postTransportCleanupTimer = null;
  vehicle.status = 2;
  vehicle.status6Reason = null;
  vehicle.statusText = vehicle.foreign ? "auf Fremdwache verfuegbar" : "auf Wache";
  vehicle.radioStatus = null;
  vehicle.radioContext = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.incidentId = null;
  vehicle.patientId = null;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  if (station) {
    vehicle.lat = station.lat;
    vehicle.lng = station.lng;
  }
  logRadio(`${vehicle.name}: Status 2 - Nachbereitung abgeschlossen.`, "radio");
  renderAll();
}

function postTransportCleanupMinutes() {
  return Math.max(10, Math.min(60, Math.round(10 + 50 * Math.pow(Math.random(), 2.32))));
}

function returnToStation(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 1) return;
  if (vehicle.supportGroupId) {
    removeSupportGroupVehicle(vehicle.id);
    return;
  }
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (!station) return;
  vehicle.status = 2;
  vehicle.statusText = vehicle.foreign ? "auf Fremdwache verfügbar" : "auf Wache";
  vehicle.lat = station.lat;
  vehicle.lng = station.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.incidentId = null;
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  vehicle.coverageDispatch = null;
  renderAll();
}

async function driveVehicleTo(vehicle, destination, options, onArrival) {
  const token = makeId();
  vehicle.routeToken = token;
  const route = await buildRoute(vehicle, destination);
  if (vehicle.routeToken !== token) return;
  const startInsideServiceArea = pointInsideServiceArea(vehicle.lat, vehicle.lng);
  const destinationInsideServiceArea = pointInsideServiceArea(destination.lat, destination.lng);
  vehicle.target = { id: destination.id, label: destination.label, lat: destination.lat, lng: destination.lng };
  vehicle.route = route.points;
  vehicle.routeDistanceKm = route.distanceKm;
  const travelMs = routeSimulationTravelMs(vehicle, route, options.signal);
  vehicle.routeMeta = {
    token,
    startAt: Date.now(),
    endAt: Date.now() + travelMs,
    points: route.points,
    cumulative: routeCumulative(route.points),
    distanceKm: route.distanceKm,
    baseDurationMs: route.baseDurationMs,
    routeSource: route.source,
    destination,
    phase: options.phase,
    signal: Boolean(options.signal),
    boundaryMonitor: startInsideServiceArea !== destinationInsideServiceArea || (vehicle.foreign && options.phase === "scene" && !startInsideServiceArea),
    boundaryInside: startInsideServiceArea
  };
  renderAll();
  vehicle.routeArrivalHandler = () => {
    if (vehicle.routeToken !== token) return;
    updateVehicleBoundaryRadio(vehicle, destination);
    onArrival();
  };
  vehicle.routeTimer = scheduleTimeout(vehicle.routeArrivalHandler, travelMs);
}

async function buildRoute(vehicle, destination) {
  const directDistance = mapDistance(vehicle.lat, vehicle.lng, destination.lat, destination.lng);
  const fallbackDistance = directDistance * 1.35;
  const fallbackSpeedKmh = fallbackRouteBaseSpeedKmh(fallbackDistance);
  const fallback = {
    distanceKm: Math.max(.2, fallbackDistance),
    baseDurationMs: (Math.max(.2, fallbackDistance) / fallbackSpeedKmh) * 3600000,
    source: "fallback",
    points: [[vehicle.lat, vehicle.lng], [destination.lat, destination.lng]]
  };
  const useFallback = () => {
    state.systemStatus.routing = "fallback";
    renderAdminStatusBar();
    return fallback;
  };
  if (isAirMedicalVehicle(vehicle.type)) {
    const airSpeedKmh = randomRange(180, 200);
    const distanceKm = Math.max(.2, directDistance);
    return {
      distanceKm,
      baseDurationMs: (distanceKm / airSpeedKmh) * 3600000,
      source: "air",
      points: [[vehicle.lat, vehicle.lng], [destination.lat, destination.lng]]
    };
  }

  if (!window.fetch) return useFallback();

  const routeUrl = routeApiUrl(vehicle, destination);
  try {
    const response = await fetch(routeUrl);
    if (!response.ok) return useFallback();
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return useFallback();
    state.systemStatus.routing = "online";
    renderAdminStatusBar();
    return {
      distanceKm: Math.max(.2, route.distance / 1000),
      baseDurationMs: Number.isFinite(route.duration) ? route.duration * 1000 : fallback.baseDurationMs,
      source: "osrm",
      points: route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    };
  } catch {
    return useFallback();
  }
}

function routeApiUrl(vehicle, destination) {
  const params = new URLSearchParams({
    fromLng: String(vehicle.lng),
    fromLat: String(vehicle.lat),
    toLng: String(destination.lng),
    toLat: String(destination.lat)
  });
  if (location.protocol === "http:" || location.protocol === "https:") return `/api/route?${params}`;
  return `https://router.project-osrm.org/route/v1/driving/${vehicle.lng},${vehicle.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
}

function fallbackRouteBaseSpeedKmh(distanceKm) {
  if (distanceKm < 3) return 34;
  if (distanceKm < 8) return 48;
  if (distanceKm < 20) return 68;
  return 82;
}

function routeSimulationTravelMs(vehicle, route, signal) {
  return Math.max(8000, routeTravelDurationMs(vehicle, route, signal) / state.speed);
}

function routeTravelDurationMs(vehicle, route, signal) {
  if (!route) return 0;
  if (isAirMedicalVehicle(vehicle?.type)) return Math.max(1, (route.baseDurationMs || (route.distanceKm / 190) * 3600000) / GLOBAL_TRAVEL_SPEED_FACTOR);
  const profile = routeTravelProfile(vehicle?.type, signal);
  let durationMs = Math.max(1, route.baseDurationMs || (route.distanceKm / 38) * 3600000) / (profile.factor * GLOBAL_TRAVEL_SPEED_FACTOR);
  if (profile.maxKmh) {
    durationMs = Math.max(durationMs, (route.distanceKm / (profile.maxKmh * GLOBAL_TRAVEL_SPEED_FACTOR)) * 3600000);
  }
  return durationMs;
}

function routeTravelProfile(type, signal) {
  if (type === "KTW") return { factor: signal ? 1.3 : 1 };
  if (type === "RTW") return { factor: signal ? 1.2 : 0.9, maxKmh: signal ? 130 : 80 };
  if (type === "ITW") return { factor: signal ? 1.1 : 0.9, maxKmh: signal ? 110 : 80 };
  if (type === "NEF" || type === "VEF" || type === "REF" || type === "ELRD") return { factor: signal ? 1.4 : 1 };
  return { factor: signal ? 1.3 : 1 };
}

function treatmentMinutes(incident) {
  if (incident.required.some(isDoctorRequirement)) return 30;
  if (incident.type === "transport" || incident.keyword?.includes("KTP")) return 15;
  return 25;
}

function patientTreatmentMinutes(patient, incident) {
  if (!patient) return treatmentMinutes(incident);
  if (!Number.isFinite(patient.treatmentMinutes)) {
    patient.treatmentMinutes = randomizedTreatmentMinutes(treatmentMinutes(incident));
  }
  return patient.treatmentMinutes;
}

function randomizedTreatmentMinutes(mean) {
  return Math.max(5, Math.round(randomRange(mean * 0.85, mean * 1.15)));
}

function vehicleCanTransportPatient(vehicle, patient) {
  if (!vehicle || !patient || !isTransportVehicle(vehicle.type)) return false;
  if (!patientRequiresTransport(patient)) return false;
  if (patient.modCarrierId === vehicle.id) return true;
  if (vehicle.type === "ITW" && patient.itwAwaitingRegular && !(patient.required || []).includes("ITW")) return false;
  if (isAirMedicalVehicle(vehicle.type)) return (patient.required || []).some((type) => isDoctorRequirement(type) || type === vehicle.type);
  return (patient.required || []).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
}

function status8DispatchDelayMinutes(vehicle) {
  if (vehicle.status8ReadyAt) {
    return Math.max(0.1, Math.ceil((vehicle.status8ReadyAt - Date.now()) / simulationDelay(1)));
  }
  return randomInt(2, 15);
}

function askVehicleReadiness(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 8 || vehicle.modTransportOrder || vehicle.modEscortTransportId) return;
  if (vehicle.status8ReadyTimer) {
    cancelScheduledTimeout(vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.handoverTimer) {
    cancelScheduledTimeout(vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (Math.random() < 0.125) {
    logRadio(`${vehicle.name}: Ja, einsatzklar.`, "radio", radioIncidentId(vehicle));
    if (vehicle.nextIncidentId) {
      startResponse(vehicle.id);
    } else {
      clearVehicle(vehicle.id);
    }
    return;
  }
  const delay = randomInt(5, 20);
  vehicle.status8ReadyDelay = delay;
  vehicle.status8ReadyAt = Date.now() + simulationDelay(delay);
  vehicle.statusText = vehicle.nextIncidentId
    ? `nicht einsatzklar, Folgeauftrag in ca. ${delay} min`
    : `nicht einsatzklar, frei in ca. ${delay} min`;
  logRadio(`${vehicle.name}: Nein, brauchen noch ${delay} Minuten.`, "radio", radioIncidentId(vehicle));
  if (vehicle.nextIncidentId) {
    rescheduleStatus8Dispatch(vehicle, delay);
  } else {
    vehicle.status8ReadyTimer = scheduleTimeout(() => {
      vehicle.status8ReadyTimer = null;
      vehicle.status8ReadyAt = null;
      vehicle.status8ReadyDelay = null;
      if (vehicle.status === 8 && !vehicle.nextIncidentId) clearVehicle(vehicle.id);
    }, simulationDelay(delay));
  }
  renderAll();
}

function rescheduleStatus8Dispatch(vehicle, delay) {
  scheduleDispatchTimer(vehicle, delay, () => {
    vehicle.status8ReadyAt = null;
    vehicle.status8ReadyDelay = null;
    startResponse(vehicle.id);
  });
}

function patientCanDropDoctorRequirement(patient) {
  const required = patient?.required || [];
  if (patient?.acuity === "reanimation") return false;
  if (!required.some(isDoctorRequirement) || !patientAmbulatorySelected(patient)) return false;
  return patientHasAssignedDoctorVehicle(patient);
}

function patientHasAssignedDoctorVehicle(patient) {
  return (patient?.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && isDoctorVehicle(vehicle.type));
}

function handoverMinutes() {
  const roll = Math.random();
  if (roll < .7) return randomRange(15, 20);
  if (roll < .9) return randomRange(10, 14);
  return randomRange(21, 45);
}

function simulationDelay(minutes) {
  return minutes * 60000 / state.speed;
}

function scheduleTimeout(handler, delay) {
  const timeout = {
    nativeId: null,
    handler,
    createdAt: Date.now(),
    dueAt: Date.now() + Math.max(0, Number(delay) || 0),
    cancelled: false,
    fire: null
  };
  timeout.fire = () => {
    if (timeout.cancelled) return;
    if (state.paused) {
      armScheduledTimeout(timeout, 500);
      return;
    }
    state.timeouts = state.timeouts.filter((item) => item !== timeout);
    timeout.cancelled = true;
    timeout.nativeId = null;
    timeout.handler();
  };
  state.timeouts.push(timeout);
  armScheduledTimeout(timeout, Math.max(0, Number(delay) || 0));
  return timeout;
}

function armScheduledTimeout(timeout, delay) {
  if (!timeout || timeout.cancelled) return;
  if (timeout.nativeId !== null) window.clearTimeout(timeout.nativeId);
  timeout.nativeId = window.setTimeout(timeout.fire, Math.max(0, Number(delay) || 0));
}

function cancelScheduledTimeout(timeout) {
  if (!timeout) return;
  timeout.cancelled = true;
  if (timeout.nativeId !== null) window.clearTimeout(timeout.nativeId);
  timeout.nativeId = null;
  state.timeouts = state.timeouts.filter((item) => item !== timeout);
}

function cancelAllScheduledTimeouts() {
  [...state.timeouts].forEach(cancelScheduledTimeout);
  state.timeouts = [];
}

function rescaleScheduledTimeouts(factor) {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
  const now = Date.now();
  const referenceNow = state.paused && Number.isFinite(state.pauseStartedAt) ? state.pauseStartedAt : now;
  state.timeouts.forEach((timeout) => {
    if (!timeout || timeout.cancelled) return;
    const clockReference = Math.max(referenceNow, timeout.createdAt);
    const remaining = Math.max(0, timeout.dueAt - clockReference) * factor;
    timeout.dueAt = clockReference + remaining;
    armScheduledTimeout(timeout, Math.max(0, timeout.dueAt - now));
  });
}

function shiftScheduledTimeouts(offsetMs, pauseStartedAt = Date.now() - offsetMs) {
  if (!Number.isFinite(offsetMs) || offsetMs <= 0) return;
  const now = Date.now();
  state.timeouts.forEach((timeout) => {
    if (!timeout || timeout.cancelled) return;
    const pausedOverlap = Math.max(0, now - Math.max(pauseStartedAt, timeout.createdAt));
    timeout.dueAt += pausedOverlap;
    armScheduledTimeout(timeout, Math.max(0, timeout.dueAt - now));
  });
}

function updateVehicleTracking() {
  let changed = false;
  const now = Date.now();
  state.vehicles.forEach((vehicle) => {
    if (!vehicle.routeMeta) return;
    const progress = Math.min(1, Math.max(0, (now - vehicle.routeMeta.startAt) / (vehicle.routeMeta.endAt - vehicle.routeMeta.startAt)));
    const position = pointAtProgress(vehicle.routeMeta, progress);
    if (!position) return;
    vehicle.lat = position.lat;
    vehicle.lng = position.lng;
    if (vehicle.modTransportOrder?.escortVehicleId) {
      const escort = state.vehicles.find((unit) => unit.id === vehicle.modTransportOrder.escortVehicleId);
      if (escort?.modEscortTransportId === vehicle.modTransportOrder.id) {
        escort.lat = position.lat;
        escort.lng = position.lng;
      }
    }
    updateVehicleBoundaryRadio(vehicle, position);
    changed = true;
  });
  if (changed) renderMap();
}

function updateVehicleBoundaryRadio(vehicle, position) {
  if (!vehicle.routeMeta?.boundaryMonitor) return;
  const inside = pointInsideServiceArea(position.lat, position.lng);
  if (inside === vehicle.routeMeta.boundaryInside) return;
  vehicle.routeMeta.boundaryInside = inside;
  if (inside) {
    reportVehicleEnteredServiceArea(vehicle);
  } else {
    reportVehicleLeftServiceArea(vehicle);
  }
}

function reportVehicleLeftServiceArea(vehicle) {
  reportBoundaryStatus(vehicle, "Verlassen das Einsatzgebiet. Bis später");
}

function reportVehicleEnteredServiceArea(vehicle) {
  if (vehicle.status === 1) {
    reportBoundaryStatus(vehicle, "Frei - Wieder im Einsatzgebiet");
    return;
  }
  if (vehicle.status === 3) {
    const message = `Im Einsatzgebiet, unterwegs zu ${vehicleBoundaryDestinationText(vehicle)}.`;
    const settings = normalizeStatus3Radio(state.center.status3Radio);
    const mode = vehicle.foreign ? (vehicle.routeMeta?.signal ? settings.signal : settings.normal) : "5";
    reportBoundaryStatus(vehicle, message, mode);
    return;
  }
  reportBoundaryStatus(vehicle, "Wieder im Einsatzgebiet");
}

function reportBoundaryStatus(vehicle, message, mode = "5") {
  if (mode === "none" || vehicle.radioStatus) {
    logRadio(`${vehicle.name}: ${message}`, "radio", vehicle.incidentId);
    return;
  }
  triggerRadioStatus(vehicle, Number(mode), message, { context: "boundary" });
}

function vehicleBoundaryDestinationText(vehicle) {
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId || item.id === vehicle.nextIncidentId);
  if (incident) return incident.keyword || incident.location || "Einsatz";
  return vehicle.routeMeta?.destination?.label || vehicle.target?.label || "Ziel";
}

function pointInsideServiceArea(lat, lng) {
  const geometry = serviceAreaGeometry(state.center?.coverageGeoJson);
  if (!geometry) return true;
  return geometryContainsPoint(geometry, lat, lng);
}

function serviceAreaGeometry(geoJson) {
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

function geometryContainsPoint(geometry, lat, lng) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return polygonContainsPoint(geometry.coordinates, lat, lng);
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).some((polygon) => polygonContainsPoint(polygon, lat, lng));
  if (geometry.type === "GeometryCollection") return (geometry.geometries || []).some((item) => geometryContainsPoint(item, lat, lng));
  return false;
}

function polygonContainsPoint(rings, lat, lng) {
  if (!Array.isArray(rings) || !rings.length) return false;
  if (!ringContainsPoint(rings[0], lat, lng)) return false;
  return !rings.slice(1).some((ring) => ringContainsPoint(ring, lat, lng));
}

function ringContainsPoint(ring, lat, lng) {
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

function routeCumulative(points) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    const [lat1, lng1] = points[index - 1];
    const [lat2, lng2] = points[index];
    cumulative[index] = cumulative[index - 1] + mapDistance(lat1, lng1, lat2, lng2);
  }
  return cumulative;
}

function pointAtProgress(routeMeta, progress) {
  const total = routeMeta.cumulative.at(-1) || routeMeta.distanceKm;
  if (!total || routeMeta.points.length < 2) return null;
  const targetDistance = total * progress;
  let segment = 1;
  while (segment < routeMeta.cumulative.length && routeMeta.cumulative[segment] < targetDistance) {
    segment += 1;
  }
  const previousDistance = routeMeta.cumulative[segment - 1] || 0;
  const nextDistance = routeMeta.cumulative[segment] || total;
  const localProgress = nextDistance === previousDistance ? 1 : (targetDistance - previousDistance) / (nextDistance - previousDistance);
  const [lat1, lng1] = routeMeta.points[segment - 1];
  const [lat2, lng2] = routeMeta.points[segment] || routeMeta.points.at(-1);
  return {
    lat: lat1 + (lat2 - lat1) * localProgress,
    lng: lng1 + (lng2 - lng1) * localProgress
  };
}

function cancelVehicleRoute(vehicle) {
  snapVehicleToRoutePosition(vehicle);
  if (vehicle.routeTimer) {
    cancelScheduledTimeout(vehicle.routeTimer);
  }
  vehicle.routeTimer = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.routeToken = null;
  vehicle.routeArrivalHandler = null;
  vehicle.target = null;
}

function snapVehicleToRoutePosition(vehicle) {
  if (!vehicle?.routeMeta) return;
  const total = Math.max(1, vehicle.routeMeta.endAt - vehicle.routeMeta.startAt);
  const progress = Math.min(1, Math.max(0, (Date.now() - vehicle.routeMeta.startAt) / total));
  const position = pointAtProgress(vehicle.routeMeta, progress);
  if (!position) return;
  vehicle.lat = position.lat;
  vehicle.lng = position.lng;
}

function isAlarmable(vehicle) {
  if (vehicle.modTransportOrder || vehicle.modEscortTransportId) return false;
  return ([1, 2, 8].includes(vehicle.status)
    || (vehicle.status === 3 && vehicle.routeMeta && !vehicle.routeMeta.signal)
    || (isDoctorVehicle(vehicle.type) && vehicle.status === 7 && !vehicle.accompanyingActive)) && !vehicle.nextIncidentId && !vehicle.coverageDispatch;
}

function configuredUgrdTurnoutMinutes(vehicle) {
  if (vehicle.status !== 2 || !Number.isFinite(vehicle.ugrdTurnoutMinutes)) return null;
  return Math.max(0, Math.min(90, vehicle.ugrdTurnoutMinutes));
}

function turnoutDelayMinutes(vehicle) {
  const nominalMinutes = configuredUgrdTurnoutMinutes(vehicle);
  if (nominalMinutes !== null) return Math.round(randomFloat(nominalMinutes * .5, nominalMinutes * 1.5) * 100) / 100;
  let delay = randomRange(.5, 2);
  if (vehicle.status === 1) delay = 0;
  if (vehicle.status === 3) delay = .5;
  if (!vehicle.dispatchSignal) delay *= 1.5;
  if (isAirMedicalVehicle(vehicle.type)) delay *= 2;
  if (isStabilizerVehicle(vehicle.type)) delay *= 2;
  return Math.round(delay * 10) / 10;
}

function randomInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function randomRange(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function randomFloat(min, max) {
  return min + Math.random() * (max - min);
}

function nearestHospitals(incident, request = incident.transportRequest, options = {}) {
  return state.center.hospitals
    .filter((hospital) => options.includeForeign || !hospital.foreign)
    .filter((hospital) => !options.excludeOrigin || hospital.lat !== incident.lat || hospital.lng !== incident.lng)
    .map((hospital) => ({
      ...hospital,
      distance: mapDistance(hospital.lat, hospital.lng, incident.lat, incident.lng),
      suitable: hospitalSuitableForIncident(hospital, incident, request)
    }))
    .sort((a, b) => a.distance - b.distance);
}

function hospitalSuitableForIncident(hospital, incident, request = incident.transportRequest) {
  if (hospitalIsUnavailable(hospital)) return false;
  const keys = requiredDepartmentKeysForTransport(incident, request).map(normalizeDepartmentKey);
  if (!keys.length || keys.includes("none")) return true;
  if (hospital.pediatricOnly && !keys.includes("pediatrics")) return false;
  const departments = hospital.departments || [];
  return keys.every((key) => departments.includes(key));
}

function requiredDepartmentKeysForTransport(incident, request = incident.transportRequest) {
  const patientId = request?.patientId;
  const patients = incident.patient?.patients || [];
  const patient = patients.find((item) => item.id === patientId) || patients[0];
  return patient?.requiredDepartmentKeys || (patient?.requiredDepartmentKey ? [patient.requiredDepartmentKey] : incident.patient?.requiredDepartmentKeys || [incident.patient?.requiredDepartmentKey || "internal"]);
}

function hasRequiredVehicles(incident) {
  return !missingVehicleTypes(incident).length;
}

function missingVehicleTypes(incident) {
  const assigned = incident.assigned
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((vehicle) => vehicle && ![6].includes(vehicle.status));
  return missingRequiredTypesForResources(
    (incident.required || []).filter((type) => !isStabilizerVehicle(type)),
    assigned,
    (vehicle, requiredTypes) => requiredTypes.filter((type) => vehicleSatisfiesRequirement(vehicle.type, type))
  );
}

function isDoctorVehicle(type) {
  return DOCTOR_VEHICLE_TYPES.includes(type);
}

function isDoctorRequirement(type) {
  return DOCTOR_REQUIREMENT_TYPES.includes(type);
}

function vehicleSatisfiesRequirement(vehicleType, requiredType) {
  if (vehicleType === requiredType) return true;
  if (requiredType === "KTW" && ["RTW", "ITW"].includes(vehicleType)) return true;
  if (requiredType === "RTW" && vehicleType === "ITW") return true;
  if (requiredType === "REF" && ["RTW", "ITW"].includes(vehicleType)) return true;
  if (requiredType === "NEF" && ["VEF", "RTH", "ITH", "ITW"].includes(vehicleType)) return true;
  if (requiredType === "VEF" && ["NEF", "RTH", "ITH", "ITW"].includes(vehicleType)) return true;
  if (requiredType === "RTH" && vehicleType === "ITH") return true;
  return false;
}

function isAirMedicalVehicle(type) {
  return AIR_MEDICAL_VEHICLE_TYPES.includes(type);
}

function isRoadTransportVehicle(type) {
  return ROAD_TRANSPORT_VEHICLE_TYPES.includes(type);
}

function isTransportVehicle(type) {
  return TRANSPORT_VEHICLE_TYPES.includes(type);
}

function setSpeed() {
  const oldSpeed = state.speed || 1;
  advanceShiftClock();
  state.speed = Number(el.speedSelect.value) || 1;
  rescaleActiveTimers(oldSpeed, state.speed);
}

function rescaleActiveTimers(oldSpeed, newSpeed) {
  if (!oldSpeed || !newSpeed || oldSpeed === newSpeed) return;
  const factor = oldSpeed / newSpeed;
  const now = Date.now();
  const referenceNow = state.paused && Number.isFinite(state.pauseStartedAt) ? state.pauseStartedAt : now;
  rescaleScheduledTimeouts(factor);
  state.vehicles.forEach((vehicle) => {
    if (vehicle.routeMeta) {
      const total = Math.max(1, vehicle.routeMeta.endAt - vehicle.routeMeta.startAt);
      const progress = Math.min(1, Math.max(0, (referenceNow - vehicle.routeMeta.startAt) / total));
      const remaining = Math.max(0, vehicle.routeMeta.endAt - referenceNow) * factor;
      const newTotal = progress >= 1 ? 1 : remaining / Math.max(.001, 1 - progress);
      vehicle.routeMeta.startAt = referenceNow - progress * newTotal;
      vehicle.routeMeta.endAt = referenceNow + remaining;
    }
    if (vehicle.dispatchTimer && vehicle.pendingDispatchUntil) {
      const remaining = Math.max(0, vehicle.pendingDispatchUntil - referenceNow) * factor;
      vehicle.pendingDispatchUntil = referenceNow + remaining;
    }
    if (vehicle.treatmentTimer && vehicle.treatmentDueAt) {
      const remaining = Math.max(0, vehicle.treatmentDueAt - referenceNow) * factor;
      vehicle.treatmentDueAt = referenceNow + remaining;
    }
    if (vehicle.status8ReadyTimer && vehicle.status8ReadyAt) {
      const remaining = Math.max(0, vehicle.status8ReadyAt - referenceNow) * factor;
      vehicle.status8ReadyAt = referenceNow + remaining;
    }
  });
}

function togglePause() {
  const now = Date.now();
  advanceShiftClock(now);
  state.paused = !state.paused;
  if (state.paused) {
    state.pauseStartedAt = now;
  } else if (state.pauseStartedAt) {
    const pausedMs = now - state.pauseStartedAt;
    shiftScheduledTimeouts(pausedMs, state.pauseStartedAt);
    state.vehicles.forEach((vehicle) => {
      if (vehicle.routeMeta) {
        vehicle.routeMeta.startAt += pausedMs;
        vehicle.routeMeta.endAt += pausedMs;
      }
      if (vehicle.pendingDispatchUntil) vehicle.pendingDispatchUntil += pausedMs;
      if (vehicle.treatmentDueAt) vehicle.treatmentDueAt += pausedMs;
      if (vehicle.status8ReadyAt) vehicle.status8ReadyAt += pausedMs;
    });
    state.pauseStartedAt = null;
    state.lastClockTick = now;
  }
  el.pauseButton.textContent = state.paused ? "Weiter" : "Pause";
}
