const POST_TRANSPORT_CLEANUP_PROBABILITY = {
  KTW: 0.004,
  RTW: 0.008,
  RTH: 0.006
};
const GLOBAL_TRAVEL_SPEED_FACTOR = 1.25;

function assignVehicle(vehicleId, incidentId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || incident.assigned.includes(vehicle.id)) return;

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
    cancelVehicleRoute(vehicle);
    logRadio(`${vehicle.name}: Folgeauftrag übernommen, bricht aktuelle Anfahrt ab.`, "warn");
  }
  if (vehicle.coveragePointId) {
    cancelVehicleRoute(vehicle);
    vehicle.coveragePointId = null;
    vehicle.coveragePoint = null;
    vehicle.coverageDispatch = null;
    logRadio(`${vehicle.name}: Gebietsabsicherung aufgehoben, übernimmt Einsatz.`, "radio");
  }

  vehicle.dispatchSignal = Boolean(incident.signal);
  const delayMinutes = vehicle.status === 8 ? status8DispatchDelayMinutes(vehicle) : turnoutDelayMinutes(vehicle);
  vehicle.nextIncidentId = incident.id;
  vehicle.previousIncidentId = vehicle.incidentId;
  vehicle.pendingDispatchUntil = Date.now() + simulationDelay(delayMinutes);
  vehicle.pendingDispatchDelay = delayMinutes;
  vehicle.statusText = vehicle.status === 8
    ? `Folgeeinsatz möglich in ca. ${delayMinutes} min`
    : `alarmiert, rückt in ca. ${delayMinutes} min aus`;

  if (vehicle.handoverTimer) {
    clearTimeout(vehicle.handoverTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (vehicle.status8ReadyTimer) {
    clearTimeout(vehicle.status8ReadyTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.supportReleaseTimer) {
    clearTimeout(vehicle.supportReleaseTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.supportReleaseTimer);
    vehicle.supportReleaseTimer = null;
  }
  if (vehicle.surplusCancellationTimer) {
    clearTimeout(vehicle.surplusCancellationTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.surplusCancellationTimer);
    vehicle.surplusCancellationTimer = null;
  }
  if (vehicle.postTransportCleanupTimer) {
    clearTimeout(vehicle.postTransportCleanupTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.postTransportCleanupTimer);
    vehicle.postTransportCleanupTimer = null;
  }

  incident.assigned.push(vehicle.id);
  incident.status = hasRequiredVehicles(incident) ? "alarmiert" : "in Bearbeitung";
  logRadio(`${vehicle.name}: Einsatzauftrag erhalten, Ausrücken in ca. ${delayMinutes} Minute(n).`, vehicle.status === 8 ? "warn" : "radio");
  playPagerTone();
  renderAll();
  scheduleDispatchTimer(vehicle, delayMinutes, () => startResponse(vehicle.id));
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
      : "offen";
    clearTransportRequest(previousIncident, null, vehicle.id);
    logRadio(`${vehicle.name}: Umplanung von ${previousIncident.keyword} zu ${newIncident.keyword}.`, "warn");
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
  clearTimeout(vehicle.dispatchTimer);
  state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.dispatchTimer);
  vehicle.dispatchTimer = null;
  vehicle.dispatchHandler = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
}

function triggerRadioStatus(vehicle, code, message) {
  if (code === 0) {
    if (vehicle.radioStatus === 0 || Date.now() < (vehicle.status0CooldownUntilMs || 0)) return;
    const hasUrgentContext = Boolean(vehicle.pendingAssistanceRequest || vehicle.pendingSituationReport);
    const alreadyDispatched = vehicle.status === 3 || vehicle.status === 4 || vehicle.status === 7;
    if (!hasUrgentContext && !alreadyDispatched) return;
    if (vehicle.nextIncidentId && !vehicle.incidentId) return;
  }
  clearRadioDisplayTimer(vehicle);
  if (code === 0 || code === 5) {
    vehicle.radioReturnStatusText = radioReturnStatusText(vehicle);
  }
  vehicle.radioStatus = code;
  vehicle.radioMessage = code === 0 ? "dringender Sprechwunsch" : message;
  vehicle.awaitingSpeechPrompt = code === 5;
  if (code === 0) vehicle.awaitingSpeechPrompt = true;
  logRadio(`${vehicle.name}: Status ${code}${code === 0 ? " - dringender Sprechwunsch" : ` - ${message}`}`, code === 0 ? "warn" : "radio");
  vehicle.radioDisplayTimer = scheduleTimeout(() => expireRadioDisplay(vehicle.id, code), simulationDelay(code === 0 || code === 5 ? 5 : .5));
}

function clearRadioDisplayTimer(vehicle) {
  if (!vehicle?.radioDisplayTimer) return;
  clearTimeout(vehicle.radioDisplayTimer);
  state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.radioDisplayTimer);
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
  vehicle.radioDisplayTimer = null;
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  if (/^Status [05]:/i.test(vehicle.statusText || "")) {
    vehicle.statusText = vehicle.radioReturnStatusText || radioReturnStatusText(vehicle);
  }
  vehicle.radioReturnStatusText = null;
  clearExpiredRadioContext(vehicle, code);
  if (expiredClearRequest) {
    releasePatientAssignment(vehicle);
    clearVehicle(vehicle.id);
    return;
  }
  renderVehicles();
  renderIncidents();
  renderRadioAlerts();
}

function clearExpiredRadioContext(vehicle, code) {
  if (code === 5) {
    if (vehicle.pendingSurplusCancellationRequest) {
      clearSurplusCancellationMarks(vehicle.pendingSurplusCancellationRequest.incidentId, vehicle.pendingSurplusCancellationRequest.vehicleIds);
    }
    vehicle.pendingClearRequest = null;
    vehicle.pendingSurplusCancellationRequest = null;
    vehicle.pendingKtwHandoverRequest = null;
    vehicle.pendingTransportRequest = null;
  } else if (code === 0) {
    vehicle.pendingAssistanceRequest = null;
    vehicle.pendingSituationReport = null;
  }
}

function sendSpeechPrompt(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const pendingTransportRequest = vehicle.radioStatus === 5 ? vehicle.pendingTransportRequest : null;
  const pendingClearRequest = vehicle.radioStatus === 5 ? vehicle.pendingClearRequest : null;
  const pendingSurplusCancellationRequest = vehicle.radioStatus === 5 ? vehicle.pendingSurplusCancellationRequest : null;
  const pendingAssistanceRequest = vehicle.radioStatus === 0 ? vehicle.pendingAssistanceRequest : null;
  const pendingSituationReport = vehicle.radioStatus === 0 ? vehicle.pendingSituationReport : null;
  const pendingKtwHandoverRequest = vehicle.radioStatus === 5 ? vehicle.pendingKtwHandoverRequest : null;
  const radioContext = vehicle.radioContext || null;
  const relatedIncident = relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (vehicle.radioStatus === 6) {
    logRadio(`${vehicle.name}: Status 6 quittiert.`, "radio");
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
    const radioMessage = vehicle.radioMessage;
    if (radioStatus !== 0 || (!pendingSituationReport && !pendingAssistanceRequest)) {
      logRadio(`${vehicle.name}: Sprechaufforderung J gesendet.`, radioStatus === 0 ? "warn" : "radio");
    }
    vehicle.radioStatus = null;
    vehicle.radioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    vehicle.waitingForSpeechPrompt = false;
    if (radioStatus === 0) vehicle.status0CooldownUntilMs = Date.now() + Math.max(5000, simulationDelay(2));
    renderAll();
    renderRadioAlerts();
    scheduleTimeout(() => completeSpeechPromptResponse(vehicle.id, {
      radioStatus,
      pendingTransportRequest,
      pendingClearRequest,
      pendingSurplusCancellationRequest,
      pendingAssistanceRequest,
      pendingSituationReport,
      pendingKtwHandoverRequest,
      radioContext,
      radioMessage,
      relatedIncidentId: relatedIncident?.id || null
    }), simulationDelay(randomRange(5, 12) / 60));
    return;
  }
  completeSpeechPromptResponse(vehicle.id, {
    radioStatus: vehicle.radioStatus,
    pendingTransportRequest,
    pendingClearRequest,
    pendingSurplusCancellationRequest,
    pendingAssistanceRequest,
    pendingSituationReport,
    pendingKtwHandoverRequest,
    radioContext,
    radioMessage: vehicle.radioMessage,
    relatedIncidentId: relatedIncident?.id || null
  });
}

function completeSpeechPromptResponse(vehicleId, context) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const pendingTransportRequest = context.pendingTransportRequest;
  const pendingClearRequest = context.pendingClearRequest;
  const pendingSurplusCancellationRequest = context.pendingSurplusCancellationRequest;
  const pendingAssistanceRequest = context.pendingAssistanceRequest;
  const pendingSituationReport = context.pendingSituationReport;
  const pendingKtwHandoverRequest = context.pendingKtwHandoverRequest;
  const radioContext = context.radioContext;
  const radioMessage = context.radioMessage;
  const relatedIncident = state.incidents.find((incident) => incident.id === context.relatedIncidentId) || relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (vehicle.radioStatus === 5) {
    if (pendingClearRequest) {
      releasePatientAssignment(vehicle);
      logRadio(`${vehicle.name}: ${pendingClearRequest.reason || "nicht benötigt"}, meldet frei.`, "radio");
    } else if (pendingSurplusCancellationRequest) {
      confirmSurplusCancellation(vehicle, pendingSurplusCancellationRequest);
    } else if (vehicle.status === 3 && isCoverageRun(vehicle)) {
      confirmCoverageRun(vehicle);
    } else if (vehicle.status === 3 || vehicle.nextIncidentId) {
      logRadio(`${vehicle.name}: unterwegs zu ${vehicleDestinationText(vehicle, relatedIncident)}.`, "radio");
    } else if (radioContext === "shift-start") {
      logRadio(`${vehicle.name}: Status 2 - ${radioMessage || `${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} einsatzklar`}.`, "radio");
    }
  } else if (context.radioStatus === 5) {
    if (pendingClearRequest) {
      releasePatientAssignment(vehicle);
      logRadio(`${vehicle.name}: ${pendingClearRequest.reason || "nicht benötigt"}, meldet frei.`, "radio");
    } else if (pendingSurplusCancellationRequest) {
      confirmSurplusCancellation(vehicle, pendingSurplusCancellationRequest);
    } else if (pendingKtwHandoverRequest) {
      logRadio(`${vehicle.name}: KTW-Patient. Ist ein KTW zeitnah verfügbar?`, "radio");
      const incident = state.incidents.find((item) => item.id === pendingKtwHandoverRequest.incidentId);
      if (incident) {
        incident.ktwHandoverDecision = pendingKtwHandoverRequest;
        state.selectedIncidentId = incident.id;
      }
    } else if (vehicle.status === 3 && isCoverageRun(vehicle)) {
      confirmCoverageRun(vehicle);
    } else if (vehicle.status === 3 || vehicle.nextIncidentId) {
      logRadio(`${vehicle.name}: unterwegs zu ${vehicleDestinationText(vehicle, relatedIncident)}.`, "radio");
    } else if (radioContext === "shift-start") {
      logRadio(`${vehicle.name}: Status 2 - ${radioMessage || `${vehicle.shortName || vehicle.name} an Wache ${vehicle.station} einsatzklar`}.`, "radio");
    }
  } else if (context.radioStatus === 0 && pendingSituationReport) {
    logRadio(`${vehicle.name}: Lage: ${pendingSituationReport.text}`, "warn");
    const incident = state.incidents.find((item) => item.id === pendingSituationReport.incidentId);
    if (incident) {
      incident.patient.situationReportText = pendingSituationReport.text;
      incident.patient.report = pendingSituationReport.text;
      incident.patient.situationReported = true;
      incident.status = "Lage gemeldet";
      state.selectedIncidentId = incident.id;
      const requestedResources = maybeRequestAdditionalResources(vehicle, incident, { asPartOfReport: true });
      if (requestedResources?.length) {
        logRadio(`${vehicle.name}: Nachforderung: ${requestedResources.join(", ")}.`, "warn");
      }
    }
  } else if (context.radioStatus === 0 && pendingAssistanceRequest) {
    logRadio(`${vehicle.name}: Nachforderung: ${pendingAssistanceRequest.missing.join(", ")}.`, "warn");
    const incident = state.incidents.find((item) => item.id === pendingAssistanceRequest.incidentId);
    if (incident) {
      incident.status = "Nachforderung";
      incident.assistanceDecision = {
        vehicleId: vehicle.id,
        vehicleType: vehicle.type,
        missing: pendingAssistanceRequest.missing,
        createdAtMinute: state.minute
      };
      state.selectedIncidentId = incident.id;
    }
  } else {
    logRadio(`${vehicle.name}: Status ${context.radioStatus} quittiert.`, "radio");
  }
  vehicle.radioStatus = null;
  vehicle.radioContext = null;
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  restoreRadioStatusText(vehicle);
  vehicle.pendingAssistanceRequest = null;
  vehicle.pendingSituationReport = null;
  vehicle.pendingClearRequest = null;
  vehicle.pendingSurplusCancellationRequest = null;
  vehicle.pendingKtwHandoverRequest = null;
  if (pendingTransportRequest) {
    activateTransportRequest(vehicle, pendingTransportRequest.incidentId);
  }
  if (pendingClearRequest) {
    clearVehicle(vehicle.id);
    return;
  }
  renderAll();
  renderRadioAlerts();
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
  if (vehicle.target?.label) return vehicle.target.label;
  if (vehicle.routeMeta?.destination?.label) return vehicle.routeMeta.destination.label;
  if (vehicle.coveragePoint?.label) return vehicle.coveragePoint.label;
  if (incident?.location) return incident.location;
  return "Einsatzstelle";
}

function startResponse(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle?.nextIncidentId) return;
  const incident = state.incidents.find((item) => item.id === vehicle.nextIncidentId);
  if (!incident) return;

  vehicle.status = 3;
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
  if (vehicle.radioStatus === 5) {
    vehicle.radioMessage = "Sprechwunsch offen";
  }
  if (vehicle.foreign) {
    logRadio(`${vehicle.name}: Status 3, Anfahrt ${incident.keyword}.`, "radio");
  } else {
    triggerRadioStatus(vehicle, 5, `Status 3, Anfahrt ${incident.keyword}. Fahrzeug rückt aus.`);
  }
  renderAll();
  const signal = Boolean(vehicle.dispatchSignal);
  vehicle.dispatchSignal = false;
  driveVehicleTo(vehicle, incident, { signal, phase: "scene" }, () => arriveOnScene(vehicle.id));
}

function arriveOnScene(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 3) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  if (!incident) return;

  vehicle.status = 4;
  vehicle.statusText = "am Einsatzort";
  vehicle.lat = incident.lat;
  vehicle.lng = incident.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  assignVehicleToPatient(vehicle, incident);
  scheduleSceneSupportReleaseAfterHandover(incident, vehicle.id);
  releaseSupportDoctorsReadyForHandover(incident);
  maybeRequestKtwHandover(vehicle, incident);
  maybeSendSituationReport(vehicle, incident);
  if (!incident.patient?.situationRequested) maybeRequestAdditionalResources(vehicle, incident);
  incident.patient.status = "in Behandlung";
  if (incident.patient.patients?.some((patient) => patient.assignedVehicles?.length)) {
    incident.patient.treatmentStartedAt ??= state.minute;
  }
  incident.status = "vor Ort";
  logRadio(`${vehicle.name}: Status 4, Einsatzstelle erreicht. Patientenversorgung begonnen.`, "radio");
  renderAll();
  scheduleSurplusCancellationReport(vehicle, incident);
  scheduleTreatmentCompletion(vehicle, incident);
}

function releaseSupportDoctorsReadyForHandover(incident) {
  (incident.patient?.patients || []).forEach((patient) => {
    if (!patientHasTransportUnitAtScene(patient) || patientTreatmentProgress(patient, incident) < 0.8) return;
    (patient.assignedVehicles || [])
      .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
      .filter((vehicle) => vehicle && ["NEF", "RTH"].includes(vehicle.type) && vehicle.status === 4 && vehicle.supportOnly)
      .forEach((vehicle) => {
        vehicle.statusText = `${patient.label} bis Übernahme stabilisiert`;
      });
  });
}

function scheduleSceneSupportReleaseAfterHandover(incident, activeVehicleId = null) {
  (incident.assigned || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.id !== activeVehicleId && unit.status === 4)
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
  const patient = patientForVehicle(unit, incident);
  if (!patient) return !patientsNeedVehicleType(incident, unit.type);
  if (patientMissingTypes(patient).length > 0) return false;
  return unit.supportOnly || !vehicleCanTransportPatient(unit, patient);
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
    clearTimeout(vehicle.treatmentTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.treatmentTimer);
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

function scheduleSurplusRelease(incidentId) {
  return incidentId;
}

function surplusVehiclesAtScene(incident) {
  const requiredCounts = incident.required.reduce((counts, type) => {
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const usedCounts = {};
  return incident.assigned
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter((vehicle) => vehicle?.status === 4)
    .filter((vehicle) => !vehicle.patientId)
    .filter((vehicle) => {
      const doctorRequired = (requiredCounts.NEF || 0) + (requiredCounts.RTH || 0) > 0;
      if (isDoctorVehicle(vehicle.type) && !doctorRequired) return true;
      usedCounts[vehicle.type] = (usedCounts[vehicle.type] || 0) + 1;
      return usedCounts[vehicle.type] > (requiredCounts[vehicle.type] || 0);
    });
}

function requestVehicleClearance(vehicle, incident, reason) {
  if (vehicle.radioStatus || vehicle.pendingClearRequest) return;
  vehicle.pendingClearRequest = { incidentId: incident?.id || vehicle.incidentId, reason };
  vehicle.statusText = "Status 5: Freimeldung";
  triggerRadioStatus(vehicle, 5, `Freimeldung: ${reason}.`);
  renderAll();
}

function scheduleSurplusCancellationReport(reporter, incident) {
  if (!reporter || !incident || reporter.surplusCancellationTimer || reporter.pendingSurplusCancellationRequest) return;
  const surplus = surplusAssignedVehiclesForSceneReport(incident, reporter);
  if (!surplus.length) return;
  markSurplusCancellationTargets(incident.id, surplus, reporter.id);
  const delay = randomRange(2, 3);
  reporter.surplusCancellationTimer = scheduleTimeout(() => {
    reporter.surplusCancellationTimer = null;
    const currentIncident = state.incidents.find((item) => item.id === incident.id);
    const currentReporter = state.vehicles.find((unit) => unit.id === reporter.id);
    if (!currentIncident || !currentReporter || currentReporter.status !== 4 || currentReporter.incidentId !== currentIncident.id) {
      clearSurplusCancellationMarks(incident.id, surplus.map((unit) => unit.id));
      return;
    }
    const currentSurplus = surplusAssignedVehiclesForSceneReport(currentIncident, currentReporter);
    if (!currentSurplus.length || currentReporter.radioStatus || currentReporter.pendingSurplusCancellationRequest) {
      clearSurplusCancellationMarks(currentIncident.id, surplus.map((unit) => unit.id));
      return;
    }
    const types = [...new Set(currentSurplus.map((unit) => unit.type))];
    currentReporter.pendingSurplusCancellationRequest = {
      incidentId: currentIncident.id,
      vehicleIds: currentSurplus.map((unit) => unit.id),
      types
    };
    currentReporter.statusText = "Status 5: Ueberalarmierung";
    triggerRadioStatus(currentReporter, 5, `Rueckmeldung: ${types.join(", ")} nicht erforderlich.`);
    renderAll();
  }, simulationDelay(delay));
}

function surplusAssignedVehiclesForSceneReport(incident, reporter) {
  const patients = incident.patient?.patients || [];
  if (!patients.length) return [];
  return (incident.assigned || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.id !== reporter.id)
    .filter((unit) => unit.nextIncidentId === incident.id || unit.incidentId === incident.id)
    .filter((unit) => unit.status === 3 || (unit.status === 2 && unit.nextIncidentId === incident.id))
    .filter((unit) => !unit.surplusCancellationIncidentId || unit.surplusCancellationIncidentId === incident.id && unit.surplusCancellationReporterId === reporter.id)
    .filter((unit) => !vehicleHasDirectPatientAssignment(unit, incident) || doctorCanReleaseForAmbulatoryPatient(unit, incident))
    .filter((unit) => !patientsNeedVehicleType(incident, unit.type));
}

function markSurplusCancellationTargets(incidentId, units, reporterId) {
  units.forEach((unit) => {
    unit.surplusCancellationIncidentId = incidentId;
    unit.surplusCancellationReporterId = reporterId;
  });
}

function clearSurplusCancellationMarks(incidentId, vehicleIds = []) {
  const ids = new Set(vehicleIds || []);
  state.vehicles.forEach((unit) => {
    if (unit.surplusCancellationIncidentId !== incidentId) return;
    if (ids.size && !ids.has(unit.id)) return;
    unit.surplusCancellationIncidentId = null;
    unit.surplusCancellationReporterId = null;
  });
}

function patientsNeedVehicleType(incident, vehicleType) {
  return (incident.patient?.patients || [])
    .filter((patient) => !patient.completed && !patient.transporting)
    .some((patient) => patientMissingTypes(patient).some((type) => vehicleSatisfiesPatientRequirement(vehicleType, type, patient)));
}

function vehicleHasDirectPatientAssignment(vehicle, incident) {
  if (!vehicle?.patientId) return false;
  return (incident.patient?.patients || []).some((patient) => patient.id === vehicle.patientId);
}

function doctorCanReleaseForAmbulatoryPatient(vehicle, incident) {
  if (!isDoctorVehicle(vehicle?.type) || !vehicle.patientId) return false;
  const patient = (incident.patient?.patients || []).find((item) => item.id === vehicle.patientId);
  return Boolean(patient && patientAmbulatorySelected(patient) && patientHasDispatchedVehicleType(patient, "RTW"));
}

function confirmSurplusCancellation(reporter, request) {
  const incident = state.incidents.find((item) => item.id === request.incidentId);
  const names = (request.vehicleIds || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter(Boolean)
    .map((unit) => unit.shortName || unit.name);
  const detail = names.length ? ` (${names.join(", ")})` : "";
  logRadio(`${reporter.name}: ${request.types?.join(", ") || "weitere Fahrzeuge"} nicht erforderlich${detail}. Entscheidung Leitstelle.`, "radio");
  clearSurplusCancellationMarks(request.incidentId, request.vehicleIds);
  if (incident) {
    markSurplusRequirementsResolved(incident, request);
    clearResolvedAssistanceNeeds(incident);
  }
}

function markSurplusRequirementsResolved(incident, request) {
  const surplusUnits = (request.vehicleIds || [])
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter(Boolean);
  if (!surplusUnits.some((unit) => isDoctorVehicle(unit.type))) return;
  (incident.patient?.patients || []).forEach((patient) => {
    if (!(patient.required || []).some(isDoctorRequirement)) return;
    if (!patientHasTransportUnitAtScene(patient)) return;
    patient.doctorCareCompleted = true;
  });
}

function assignVehicleToPatient(vehicle, incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length || vehicle.patientId) return;
  let preferred = vehicle.type === "KTW"
    ? patients.find((patient) => patient.awaitingKtwHandover && !patient.completed && !patient.transporting)
    : null;
  preferred ??= patients
    .filter((patient) => patientMissingTypes(patient).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)))
    .sort((a, b) => (a.assignedVehicles?.length || 0) - (b.assignedVehicles?.length || 0))[0];
  if (!preferred && ["NEF", "RTH"].includes(vehicle.type)) {
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
  const patient = preferred;
  if (!patient) return;
  const canContribute = (patient.required || []).some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
  const canFirstRespond = vehicle.type === "KTW" && ktwCanFirstRespond(patient);
  const canRefFirstRespond = vehicle.type === "REF" && refCanFirstRespond(patient);
  if (!canContribute && !["NEF", "RTH"].includes(vehicle.type) && !canFirstRespond && !canRefFirstRespond && (patient.assignedVehicles || []).length) return;
  patient.assignedVehicles = patient.assignedVehicles || [];
  patient.assignedVehicles.push(vehicle.id);
  patient.treatmentStartedAt ??= state.minute;
  vehicle.patientId = patient.id;
  vehicle.supportOnly = !canContribute && (["NEF", "RTH"].includes(vehicle.type) || canFirstRespond || canRefFirstRespond);
  if (patientRequiresOnlyRef(patient)) {
    patient.transportNeeded = false;
    patient.noTransportProbability = 1;
    patient.noTransportText = patient.noTransportText || "Ambulante Versorgung durch REF ausreichend, kein Transport.";
  }
  if (vehicle.type === "KTW" && patient.awaitingKtwHandover) {
    patient.supportCapReachedAt = state.minute;
    patient.supportCapValue = Math.min(patient.supportCapValue || 0.95, 0.95);
  }
}

function ktwCanFirstRespond(patient) {
  const required = patient.required || [];
  if (required.includes("KTW")) return false;
  return required.includes("RTW") || required.includes("NEF") || required.includes("RTH") || required.includes("REF");
}

function refCanFirstRespond(patient) {
  const required = patient?.required || [];
  if (required.includes("REF")) return true;
  return required.some((type) => ["RTW", "KTW", "NEF", "RTH"].includes(type));
}

function patientRequiresOnlyRef(patient) {
  const required = patient?.required || [];
  return required.length > 0 && required.every((type) => type === "REF");
}

function patientRequiresTransport(patient) {
  if (!patient) return false;
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
  patient.ambulatorySelected = Math.random() < (Number(patient.noTransportProbability) || 0);
  if (patient.ambulatorySelected) patient.transportNeeded = false;
  return patient.ambulatorySelected;
}

function vehicleSatisfiesPatientRequirement(vehicleType, requiredType, patient) {
  if (vehicleSatisfiesRequirement(vehicleType, requiredType)) return true;
  if (requiredType === "REF" && vehicleType === "RTW") return true;
  if (patientAmbulatorySelected(patient) && vehicleType === "REF" && ["RTW", "KTW"].includes(requiredType)) return true;
  if (patientAmbulatorySelected(patient) && isDoctorVehicle(vehicleType) && requiredType === "KTW") return true;
  if (patientAmbulatorySelected(patient) && isDoctorVehicle(vehicleType) && requiredType === "RTW") {
    return !patientHasDispatchedVehicleType(patient, "RTW");
  }
  return false;
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
  return state.incidents.find((incident) => (incident.patient?.patients || []).some((item) => item.id === patient.id)) || null;
}

function patientHasRequiredTransportUnitAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && vehicle.status === 4 && (patient.required || []).some((type) => ["RTW", "KTW"].includes(type) && vehicleSatisfiesPatientRequirement(vehicle.type, type, patient)));
}

function patientNeedsTransportUnit(patient) {
  return patientRequiresTransport(patient) && (patient.required || []).some((type) => ["RTW", "KTW", "RTH"].includes(type));
}

function patientNeedsMoreVehicles(patient) {
  return patientMissingTypes(patient).length > 0;
}

function patientMissingTypes(patient) {
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  const used = new Set();
  const requiredTypes = patient.rthTransportMode === "rth-transport"
    ? (patient.required || []).filter((type) => !["RTW", "KTW"].includes(type))
    : (patient.required || []);
  const effectiveRequiredTypes = (patient.doctorCareCompleted || patientCanDropDoctorRequirement(patient))
    ? requiredTypes.filter((type) => !isDoctorRequirement(type))
    : requiredTypes;
  return effectiveRequiredTypes.filter((requiredType) => {
    const match = assigned.find((vehicle) => !used.has(vehicle.id) && vehicleSatisfiesPatientRequirement(vehicle.type, requiredType, patient));
    if (!match) return true;
    used.add(match.id);
    return false;
  });
}

function maybeSendSituationReport(vehicle, incident) {
  if (incident.patient?.situationReported || incident.patient?.situationRequested) return;
  const missing = missingVehicleTypesForDispatch(incident);
  if ((incident.patient?.patientCount || 1) <= 1 && !missing.length) return;
  incident.patient.situationRequested = true;
  vehicle.pendingSituationReport = {
    incidentId: incident.id,
    text: incident.patient.situationReport || `${incident.patient.patientCount || 1} Patient(en), Lage wird erkundet. ${patientNeedSummary(incident)}`
  };
  triggerRadioStatus(vehicle, 0, `Lagemeldung: ${incident.patient.patientCount || 1} Patient(en).`);
}

function patientNeedSummary(incident) {
  const missing = missingVehicleTypesForDispatch(incident);
  if (!missing.length) return "Keine weiteren Rettungsmittel benötigt.";
  const counts = missing.reduce((sum, type) => {
    sum[type] = (sum[type] || 0) + 1;
    return sum;
  }, {});
  return `Benötigt noch: ${Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(", ")}.`;
}

function maybeRequestAdditionalResources(vehicle, incident, options = {}) {
  if ((incident.patient?.patientCount || 1) > 1 && !incident.patient?.situationReported) return [];
  clearResolvedAssistanceNeeds(incident);
  if (incident.assistanceRequested) return [];
  const missing = missingVehicleTypesForDispatch(incident);
  const missingServices = missingExternalServices(incident, "dispatch");
  const needsDoctor = missing.some(isDoctorRequirement);
  const needsSceneTransport = ["NEF", "RTH", "REF"].includes(vehicle.type) && missing.some((type) => ["RTW", "KTW"].includes(type));
  const needsAdditionalTransport = ["RTW", "KTW"].includes(vehicle.type) && missing.some((type) => ["RTW", "KTW"].includes(type));
  const needsTransport = vehicle.type === "KTW" && (missing.includes("RTW") || missing.includes("NEF"));
  const needsRef = vehicle.type === "KTW" && missing.includes("REF");
  const refNeedsTransport = vehicle.type === "REF" && (missing.includes("RTW") || missing.includes("KTW"));
  if (![...missing, ...missingServices].length) return [];
  if (!needsDoctor && !needsSceneTransport && !needsAdditionalTransport && !needsTransport && !needsRef && !refNeedsTransport && !missingServices.length) return [];
  const allMissing = [...missing, ...missingServices];
  if (options.asPartOfReport) {
    incident.status = "Nachforderung";
    incident.assistanceDecision = {
      vehicleId: vehicle.id,
      vehicleType: vehicle.type,
      missing: allMissing,
      createdAtMinute: state.minute
    };
    incident.assistanceRequested = true;
    return allMissing;
  }
  vehicle.pendingAssistanceRequest = {
    incidentId: incident.id,
    missing: allMissing
  };
  triggerRadioStatus(vehicle, 0, `Nachforderung erforderlich: ${allMissing.join(", ") || "Transportmittel"}.`);
  incident.status = "Nachforderung offen";
  incident.assistanceRequested = true;
  return allMissing;
}

function missingVehicleTypesForDispatch(incident) {
  const patients = incident.patient?.patients || [];
  const rawMissing = patients.length
    ? patients
      .filter((patient) => !patient.completed && !patient.transporting)
      .flatMap((patient) => patientMissingTypes(patient))
    : missingVehicleTypes(incident);
  const coverResources = (incident.assigned || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean)
    .filter((vehicle) => {
      if (vehicle.status === 4 && !vehicle.patientId) return true;
      if (vehicle.status === 3 && vehicle.incidentId === incident.id) return true;
      return vehicle.nextIncidentId === incident.id;
    });
  const used = new Set();
  return rawMissing.filter((requiredType) => {
    const match = coverResources.find((vehicle) => !used.has(vehicle.id) && vehicleSatisfiesRequirement(vehicle.type, requiredType));
    if (!match) return true;
    used.add(match.id);
    return false;
  });
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
  const roll = Math.random();
  if (patient.requiresDoctorAccompaniment) {
    return roll < .5 ? "rth-transport" : "joint-rtw-rth";
  }
  if (roll < .6) return "rth-release";
  if (roll < .8) return "rth-transport";
  return "joint-rtw-rth";
}

function rthAtSceneForPatient(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "RTH" && vehicle.status === 4);
}

function rtwAtSceneForPatient(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "RTW" && vehicle.status === 4);
}

function releaseVehicleAfterRthDecision(vehicle, incident, reason) {
  if (!vehicle || ![3, 4, 7].includes(vehicle.status)) return;
  logRadio(`${vehicle.name}: ${reason}, meldet frei.`, "radio");
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
  logRadio(`${rth.name}: Status 7, RTH-Notarzt begleitet den Transport im RTW.`, "radio");
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
    logRadio(`${rth.name}: RTH-Notarzt bleibt 10 Minuten am Ziel, danach frei.`, "radio");
  }
  return vehicle.id === joint.rthId;
}

function transportOrClear(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 4) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  if (!incident) return;
  const assignedPatient = patientForVehicle(vehicle, incident);

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
      triggerRadioStatus(vehicle, 0, `Transportbeginn wartet auf ${missingServices.join(" und ")}.`);
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

  if (assignedPatient && !vehicleCanTransportPatient(vehicle, assignedPatient)) {
    const outcome = patientOutcome(incident, assignedPatient);
    if (outcome && vehicleCanCompleteNonTransportCare(vehicle, assignedPatient)) {
      finishPatientWithoutTransport(incident, assignedPatient, vehicle, outcome);
      return;
    }
    waitForPatientHandover(vehicle, incident, assignedPatient);
    return;
  }

  if (!["RTW", "KTW", "RTH"].includes(vehicle.type)) {
    const patient = patientForVehicle(vehicle, incident);
    if (vehicle.supportOnly && patient && patientTreatmentProgress(patient, incident) >= 0.8 && patientHasTransportUnitAtScene(patient)) {
      requestVehicleClearance(vehicle, incident, "Patient an Transportfahrzeug übergeben");
      return;
    }
    if (reassignVehicleToNextPatient(vehicle, incident)) {
      logRadio(`${vehicle.name}: übernimmt die Versorgung des nächsten Patienten.`, "radio");
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
  if (incident.patient.fixedDestination) {
    beginTransportToDestination(incident.id, incident.patient.fixedDestination, vehicle.id);
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
  if (isAutomaticTransport(incident)) {
    beginTransport(incident.id, nearestHospital(incident)?.id, vehicle.id);
    return;
  }

  requestTransportDestination(vehicle, incident);
}

function ktwForHandoverAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "KTW" && vehicle.status === 4);
}

function patientReport(incident, assignedPatient = null) {
  if (assignedPatient?.conditionReport) return assignedPatient.conditionReport;
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
  if (patient && patientAmbulatorySelected(patient)) {
    return patient.noTransportText || "Ambulante Versorgung ausreichend, kein Transport.";
  }
  return null;
}

function patientReadyForTransport(patient, incident) {
  if (!patient) return false;
  if (!patientRequiresTransport(patient)) return false;
  if (patient.completed || patient.transporting) return false;
  if (patientTreatmentProgress(patient, incident) < 1) return false;
  return patientMissingTypes(patient).length === 0;
}

function patientReadyForNonTransportCompletion(patient, incident) {
  if (!patient || patientRequiresTransport(patient) || patient.completed || patient.transporting) return false;
  return patientTreatmentProgress(patient, incident) >= 1 && patientMissingTypes(patient).length === 0;
}

function vehicleCanCompleteNonTransportCare(vehicle, patient) {
  if (!vehicle || !patient || vehicle.supportOnly) return false;
  return patientMissingTypes(patient).every((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
}

function nonTransportCompletionReason(patient) {
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

function finishPatientWithoutTransport(incident, patient, vehicle, reason) {
  if (!incident || !patient) {
    finishWithoutTransport(incident?.id, reason);
    return;
  }
  patient.outcome = reason;
  patient.transportNeeded = false;
  patient.transporting = false;
  patient.completed = true;
  patient.completedAtMinute = state.minute;
  incident.patient.outcome = reason;
  incident.patient.status = incidentHasOpenPatients(incident) ? "teilweise abgeschlossen" : "abgeschlossen ohne Transport";
  clearTransportRequest(incident, null, vehicle?.id || null);
  (patient.assignedVehicles || [vehicle?.id])
    .map((id) => state.vehicles.find((unit) => unit?.id === id))
    .filter((unit) => unit && [3, 4].includes(unit.status))
    .forEach((unit) => requestVehicleClearance(unit, incident, reason));
  closeIncidentIfAllPatientsDone(incident);
  renderAll();
}

function isAutomaticTransport(incident) {
  return incident.type === "transport" || incident.keyword.includes("KTP") || incident.keyword.includes("Verlegung");
}

function transportPoiDestinationForPatient(incident, patient) {
  if (!incident || !patient || !patientRequiresTransport(patient)) return null;
  if (patient.destinationDecisionMade) return patient.destinationDecision?.destination || null;
  patient.destinationDecisionMade = true;
  patient.destinationDecision = { type: "none", destination: null };
  const config = incident.patient || {};
  if (config.destinationMode !== "poi") return null;
  const destination = randomPoiTransportDestination(config);
  if (!destination) {
    logRadio(`Kein passender Ziel-POI fÃ¼r ${incident.keyword} gefunden, Krankenhaus-Zuweisung bleibt aktiv.`, "warn");
    return null;
  }
  patient.destinationDecision = { type: "poi", destination };
  return destination;
}

function randomPoiTransportDestination(config) {
  const candidates = matchingDestinationPoiCandidates(config);
  if (!candidates.length) return null;
  const poi = candidates[randomInt(0, candidates.length - 1)];
  return {
    id: poi.id,
    label: poi.label || poi.address || "POI-Ziel",
    address: poi.address || poi.label || "POI-Ziel",
    lat: poi.lat,
    lng: poi.lng,
    type: "destination",
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
  if (patient && !patientReadyForTransport(patient, incident)) {
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  incident.status = "wartet auf Zielklinik";
  vehicle.pendingTransportRequest = {
    id: makeId(),
    incidentId: incident.id,
    report: patientReport(incident, patient),
    requiredDepartment: patient?.requiredDepartment || incident.patient.requiredDepartment,
    patientId: vehicle.patientId || patient?.id || null
  };
  vehicle.statusText = "Status 5: Sprechwunsch";
  triggerRadioStatus(vehicle, 5, `Benötige Krankenhaus-Zuweisung mit Fachrichtung: ${vehicle.pendingTransportRequest.requiredDepartment}.`);
  renderAll();
}

function activateTransportRequest(vehicle, incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident || !vehicle.pendingTransportRequest) return;
  const patient = patientForVehicle(vehicle, incident);
  if (patient && !patientRequiresTransport(patient)) {
    vehicle.pendingTransportRequest = null;
    finishPatientWithoutTransport(incident, patient, vehicle, nonTransportCompletionReason(patient));
    return;
  }
  if (patient && (!patientReadyForTransport(patient, incident) || !vehicleCanTransportPatient(vehicle, patient))) {
    vehicle.pendingTransportRequest = null;
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
  logRadio(`${vehicle.name}: ${message}`, "radio");
  renderAll();
}

function patientForVehicle(vehicle, incident) {
  return (incident.patient?.patients || []).find((patient) => patient.id === vehicle.patientId)
    || (incident.patient?.patients || [])[0]
    || null;
}

function beginTransport(incidentId, hospitalId, vehicleId = null, requestId = null) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  const request = requestId
    ? (incident.transportRequests || []).find((item) => item.id === requestId)
    : incident.transportRequest;
  const vehicle = state.vehicles.find((unit) => unit.id === (vehicleId || request?.vehicleId));
  const hospital = state.center.hospitals.find((item) => item.id === hospitalId);
  if (!vehicle || vehicle.status !== 4) return;
  const patient = patientForVehicle(vehicle, incident);
  if (patient && !patientReadyForTransport(patient, incident)) {
    waitForPatientReadiness(vehicle, incident, patient);
    return;
  }
  if (!hospital) {
    logRadio(`${vehicle.name}: Kein geeignetes Krankenhaus hinterlegt, Transportziel erforderlich.`, "warn");
    requestTransportDestination(vehicle, incident);
    return;
  }

  clearTransportRequest(incident, request?.id, vehicle.id);
  incident.patient.status = "Transport läuft";
  incident.status = "Transport";
  markPatientTransportStarted(vehicle, incident);
  releaseNonRequiredDoctors(incident, vehicle.id);
  vehicle.radioStatus = null;
  vehicle.radioMessage = "";
  vehicle.pendingTransportRequest = null;
  vehicle.status = 7;
  vehicle.statusText = `Transport zu ${hospital.label}`;
  logRadio(`${vehicle.name}: Status 7, Transportziel ${hospital.label}.`, "radio");
  if (!hospitalSuitableForIncident(hospital, incident, request)) {
    scheduleSecondaryTransfer(incident, hospital);
  }
  renderAll();
  const signal = transportUsesSignal(vehicle, incident);
  maybeDoctorAccompaniesTransport(incident, vehicle, hospital, signal);
  if (patient) releaseSupportVehiclesAfterHandover(incident, patient, vehicle.id);
  driveVehicleTo(vehicle, hospital, { signal, phase: "hospital" }, () => arriveAtHospital(vehicle.id));
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
  logRadio(`${vehicle.name}: Status 7, Transportziel ${target.label}.`, "radio");
  renderAll();
  const signal = transportUsesSignal(vehicle, incident);
  maybeDoctorAccompaniesTransport(incident, vehicle, target, signal);
  if (patient) releaseSupportVehiclesAfterHandover(incident, patient, vehicle.id);
  driveVehicleTo(vehicle, target, { signal, phase: "destination" }, () => arriveAtTransportDestination(vehicle.id));
}

function clearTransportRequest(incident, requestId = null, vehicleId = null) {
  incident.transportRequests = (incident.transportRequests || []).filter((request) => {
    if (requestId && request.id === requestId) return false;
    if (vehicleId && request.vehicleId === vehicleId) return false;
    return true;
  });
  incident.transportRequest = incident.transportRequests[0] || null;
}

function transportUsesSignal(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (incident.patient?.forceTransportSignal || patient?.forceTransportSignal) return true;
  const probability = Number(patient?.transportSignalProbability) || 0;
  return Math.random() < probability;
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
  if (doctor.type === "RTH") {
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
  const active = patient.requiresDoctorAccompaniment || Math.random() < 0.5;
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
  logRadio(`${doctor.name}: Status 7, ${active ? "aktive" : "abkömmliche"} Notarztbegleitung.`, "radio");
  const destinationPhase = destination.type === "destination" ? "destination" : "hospital";
  const arrivalHandler = destination.type === "destination" ? arriveAtTransportDestination : arriveAtHospital;
  driveVehicleTo(doctor, destination, { signal, phase: destinationPhase }, () => arrivalHandler(doctor.id));
}

function holdBoundDoctorForDestinationChange(transportingVehicle, incident) {
  const doctor = state.vehicles.find((vehicle) => vehicle.boundTransportVehicleId === transportingVehicle.id && vehicle.incidentId === incident.id);
  if (!doctor || !isDoctorVehicle(doctor.type) || doctor.status !== 7) return;
  cancelVehicleRoute(doctor);
  doctor.status = 4;
  doctor.statusText = `wartet auf neues Transportziel mit ${transportingVehicle.shortName || transportingVehicle.name}`;
  doctor.radioStatus = null;
  doctor.radioMessage = "";
  doctor.pendingTransportRequest = null;
  logRadio(`${doctor.name}: Zielortwechsel an ${transportingVehicle.shortName || transportingVehicle.name} gebunden.`, "radio");
}

function markPatientTransportStarted(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!patient) return;
  patient.transporting = true;
  patient.transportVehicleId = vehicle.id;
}

function releaseSupportVehiclesAfterHandover(incident, patient, activeVehicleId) {
  (patient.assignedVehicles || [])
    .filter((id) => id !== activeVehicleId)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status === 4)
    .filter((unit) => unit.boundTransportVehicleId !== activeVehicleId)
    .filter((unit) => unit.supportOnly || !vehicleCanTransportPatient(unit, patient))
    .forEach((unit) => requestVehicleClearance(unit, incident, `${patient.label} durch ${unitName(activeVehicleId)} übernommen`));
}

function scheduleSupportReleaseAfterCareComplete(incident, patient, activeVehicleId) {
  const supportUnits = (patient.assignedVehicles || [])
    .filter((id) => id !== activeVehicleId)
    .map((id) => state.vehicles.find((unit) => unit.id === id))
    .filter((unit) => unit && unit.status === 4)
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
  patient.completedAtMinute = state.minute;
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
  if (incident.status === "geschlossen") return true;
  incident.transportRequest = null;
  incident.transportRequests = [];
  incident.assistanceDecision = null;
  incident.assistanceRequested = false;
  incident.closedAtMinute = state.minute;
  incident.status = "geschlossen";
  logRadio(`Einsatz abgeschlossen: ${incident.keyword}.`, "radio");
  return true;
}

function reassignVehicleToNextPatient(vehicle, incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length) return false;
  const previousPatientId = vehicle.patientId;
  const next = patients.find((patient) => {
    if (patient.id === previousPatientId) return false;
    if (patient.completed || patient.transporting) return false;
    const missing = patientMissingTypes(patient);
    return missing.some((type) => vehicleSatisfiesPatientRequirement(vehicle.type, type, patient))
      || (["NEF", "RTH"].includes(vehicle.type) && patientNeedsTransportUnit(patient) && patientTreatmentProgress(patient, incident) < 0.8)
      || !(patient.assignedVehicles || []).length;
  });
  if (!next) return false;
  releasePatientAssignment(vehicle);
  next.assignedVehicles = next.assignedVehicles || [];
  if (!next.assignedVehicles.includes(vehicle.id)) next.assignedVehicles.push(vehicle.id);
  next.treatmentStartedAt ??= state.minute;
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
  logRadio(`${vehicle.name}: Status 8, ${targetLabel}`, "radio");
  const rthJointHandled = incident ? handleRthJointDestinationArrival(vehicle, incident) : false;
  if (incident) closeIncidentIfAllPatientsDone(incident);
  renderAll();
  if (rthJointHandled) return;
  vehicle.handoverTimer = scheduleTimeout(() => {
    if (vehicle.status === 8) clearVehicle(vehicle.id);
  }, simulationDelay(handoverMinutes()));
}

function scheduleSecondaryTransfer(sourceIncident, hospital) {
  if (sourceIncident.secondaryTransferScheduled) return;
  sourceIncident.secondaryTransferScheduled = true;
  const delayMinutes = randomInt(30, 75);
  scheduleTimeout(() => {
    const transfer = buildSecondaryTransferCall(sourceIncident, hospital);
    if (typeof queueIncomingCall === "function") queueIncomingCall(transfer);
    else state.pendingCall = transfer;
    logRadio(`Folgetransport wegen ungeeigneter Zielklinik angelegt: ${hospital.label}.`, "warn");
    renderAll();
  }, simulationDelay(delayMinutes));
}

function buildSecondaryTransferCall(sourceIncident, hospital) {
  const patient = sourceIncident.patient?.patients?.[0] || sourceIncident.patient || {};
  const required = [...(patient.required?.length ? patient.required : sourceIncident.required || ["RTW"])];
  const critical = required.some(isDoctorRequirement) || sourceIncident.patient?.condition === "kritisch";
  const keyword = required.every((type) => type === "KTW")
    ? "RD KTP - Verlegung"
    : critical ? "RD 2 Verlegung - Notfalltransport mit NA" : "RD 1 Verlegung - Notfalltransport mit RTW";
  const defaults = keywordDefaults[keyword] || { type: "transport", required, signal: critical };
  const requiredText = required.length ? required.join(", ") : "Transportmittel";
  const department = sourceIncident.patient?.requiredDepartment || patient.requiredDepartment || "geeignete Fachrichtung";
  return {
    id: makeId(),
    type: defaults.type,
    keyword,
    callerName: `${hospital.label} Aufnahme`,
    callerText: `Hallo, Klinik ${hospital.label}, ihr habt uns vorhin einen Patienten gebracht, den wir nicht behandeln koennen. Wir brauchen bitte einmal ${requiredText}. Benoetige Krankenhaus-Zuweisung mit Fachrichtung: ${department}`,
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

function nearestSuitableHospital(incident) {
  return nearestHospitals(incident).find((hospital) => hospital.suitable);
}

function finishWithoutTransport(incidentId, reason) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
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
    patient.completedAtMinute = state.minute;
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
  logRadio(`Einsatz ${incident.keyword}: ${reason}`, "warn");
  incident.assigned.forEach((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    if (vehicle && [3, 4, 7].includes(vehicle.status)) clearVehicle(vehicle.id);
  });
  incident.status = "geschlossen";
  logRadio(`Einsatz abgeschlossen: ${incident.keyword}.`, "radio");
  renderAll();
}

function handoffIncident(incidentId, service) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  const labels = { FW: "Feuerwehr", POL: "Polizei", AEND: "Ärztlichen Notdienst" };
  incident.status = "geschlossen";
  incident.handoff = service;
  incident.assigned.forEach((id) => {
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    if (vehicle && [1, 2, 3].includes(vehicle.status)) removeAssignedVehicle(vehicle.id, incident.id);
  });
  incident.status = "geschlossen";
  logRadio(`Einsatz ${incident.keyword} an ${labels[service] || service} abgegeben.`, "warn");
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
    const box = document.createElement("div");
    box.className = `service-box service-${stateInfo.status.replace(/\s+/g, "-")}`;
    const title = document.createElement("strong");
    title.textContent = service;
    const status = document.createElement("span");
    status.textContent = stateInfo.arriveAtMinute && stateInfo.status === "unterwegs"
      ? `${stateInfo.status}, ca. ${serviceRemainingMinutes(stateInfo)} min`
      : stateInfo.status;
    box.append(title, status);
    if (stateInfo.status === "nicht alarmiert") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${service} alarmieren`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        alarmService(incident.id, service);
      });
      box.append(button);
    }
    wrapper.append(box);
  });
  return wrapper;
}

function refreshServiceArrival(incident, service, serviceState) {
  if (serviceState.status !== "unterwegs" || !serviceState.arriveAtMinute || state.minute < serviceState.arriveAtMinute) return;
  serviceState.status = "an Einsatzstelle";
  serviceState.eta = null;
  serviceState.arriveAtMinute = null;
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
  serviceState.arriveAtMinute = state.minute + eta;
  serviceState.alarmedAt = state.minute;
  incident.services[service] = serviceState;
  clearResolvedAssistanceNeeds(incident);
  logRadio(`${service}: zu ${incident.keyword} alarmiert.`, "warn");
  renderAll();
  scheduleTimeout(() => {
    if (serviceState.status !== "alarmiert") return;
    serviceState.status = "unterwegs";
    clearResolvedAssistanceNeeds(incident);
    logRadio(`${service}: unterwegs zu ${incident.location}.`, "radio");
    renderAll();
  }, simulationDelay(.3));
  scheduleTimeout(() => {
    if (!["alarmiert", "unterwegs"].includes(serviceState.status)) return;
    serviceState.status = "an Einsatzstelle";
    serviceState.eta = null;
    serviceState.arriveAtMinute = null;
    clearResolvedAssistanceNeeds(incident);
    renderAll();
  }, simulationDelay(eta));
}

function serviceRemainingMinutes(serviceState) {
  if (!serviceState.arriveAtMinute) return serviceState.eta || 0;
  return Math.max(1, Math.ceil(serviceState.arriveAtMinute - state.minute));
}

function arriveAtHospital(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 7) return;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
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
  logRadio(`${vehicle.name}: Status 8, Übergabe im Krankenhaus.`, "radio");
  const rthJointHandled = incident ? handleRthJointDestinationArrival(vehicle, incident) : false;
  if (incident) closeIncidentIfAllPatientsDone(incident);
  renderAll();
  if (rthJointHandled) return;
  vehicle.handoverTimer = scheduleTimeout(() => {
    if (vehicle.status === 8) clearVehicle(vehicle.id);
  }, simulationDelay(handoverMinutes()));
}

function clearVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const oldStatus = vehicle.status;
  const oldIncidentId = vehicle.incidentId;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  cancelVehicleRoute(vehicle);
  if (vehicle.status8ReadyTimer) {
    clearTimeout(vehicle.status8ReadyTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.handoverTimer) {
    clearTimeout(vehicle.handoverTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (vehicle.treatmentTimer) {
    clearTimeout(vehicle.treatmentTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.treatmentTimer);
    vehicle.treatmentTimer = null;
  }
  if (vehicle.supportReleaseTimer) {
    clearTimeout(vehicle.supportReleaseTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.supportReleaseTimer);
    vehicle.supportReleaseTimer = null;
  }
  if (vehicle.surplusCancellationTimer) {
    clearTimeout(vehicle.surplusCancellationTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.surplusCancellationTimer);
    vehicle.surplusCancellationTimer = null;
  }
  if (vehicle.postTransportCleanupTimer) {
    clearTimeout(vehicle.postTransportCleanupTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.postTransportCleanupTimer);
    vehicle.postTransportCleanupTimer = null;
  }
  vehicle.treatmentDueAt = null;
  vehicle.status8ReadyAt = null;
  vehicle.status8ReadyDelay = null;
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  vehicle.coverageDispatch = null;
  vehicle.pendingSurplusCancellationRequest = null;
  const boundTransport = state.vehicles.find((unit) => unit.id === vehicle.boundTransportVehicleId);
  if (boundTransport?.boundDoctorVehicleId === vehicle.id) boundTransport.boundDoctorVehicleId = null;
  const boundDoctor = state.vehicles.find((unit) => unit.id === vehicle.boundDoctorVehicleId);
  if (boundDoctor?.boundTransportVehicleId === vehicle.id) boundDoctor.boundTransportVehicleId = null;
  vehicle.boundTransportVehicleId = null;
  vehicle.boundDoctorVehicleId = null;
  releasePatientAssignment(vehicle);

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
    logRadio(`${vehicle.name}: Status 6 - Nachbereitung, faehrt zur Wache zum Auffuellen/Putzen.`, "radio");
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
  vehicle.pendingSurplusCancellationRequest = null;
  vehicle.pendingKtwHandoverRequest = null;
  if (oldIncidentId) detachVehicleFromIncident(vehicle.id, oldIncidentId);
  logRadio(`${vehicle.name}: Status 1, einsatzbereit.`, "radio");

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
  const route = await buildRoute(vehicle, destination);
  const startInsideServiceArea = pointInsideServiceArea(vehicle.lat, vehicle.lng);
  const destinationInsideServiceArea = pointInsideServiceArea(destination.lat, destination.lng);
  vehicle.target = { lat: destination.lat, lng: destination.lng };
  vehicle.route = route.points;
  vehicle.routeDistanceKm = route.distanceKm;
  const travelMs = routeSimulationTravelMs(vehicle, route, options.signal);
  const token = makeId();
  vehicle.routeToken = token;
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
    signal: Boolean(options.signal),
    boundaryMonitor: startInsideServiceArea !== destinationInsideServiceArea,
    boundaryInside: startInsideServiceArea
  };
  renderAll();
  vehicle.routeArrivalHandler = () => {
    if (vehicle.routeToken !== token) return;
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
  if (vehicle.type === "RTH") {
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

function routeSpeedKmh(vehicle, signal) {
  const route = vehicle?.routeMeta || null;
  const durationMs = routeTravelDurationMs(vehicle, route, signal);
  const distanceKm = route?.distanceKm || 1;
  return durationMs > 0 ? (distanceKm / durationMs) * 3600000 : 0;
}

function routeSimulationTravelMs(vehicle, route, signal) {
  return Math.max(8000, routeTravelDurationMs(vehicle, route, signal) / state.speed);
}

function routeTravelDurationMs(vehicle, route, signal) {
  if (!route) return 0;
  if (vehicle?.type === "RTH") return Math.max(1, (route.baseDurationMs || (route.distanceKm / 190) * 3600000) / GLOBAL_TRAVEL_SPEED_FACTOR);
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
  if (type === "NEF" || type === "REF") return { factor: signal ? 1.4 : 1 };
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
  if (!vehicle || !patient || !["RTW", "KTW", "RTH"].includes(vehicle.type)) return false;
  if (!patientRequiresTransport(patient)) return false;
  if (vehicle.type === "RTH") return (patient.required || []).some(isDoctorRequirement);
  return (patient.required || []).some((type) => ["RTW", "KTW"].includes(type) && vehicleSatisfiesPatientRequirement(vehicle.type, type, patient));
}

function status8DispatchDelayMinutes(vehicle) {
  if (vehicle.status8ReadyAt) {
    return Math.max(0.1, Math.ceil((vehicle.status8ReadyAt - Date.now()) / simulationDelay(1)));
  }
  return randomInt(2, 15);
}

function askVehicleReadiness(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 8) return;
  if (vehicle.status8ReadyTimer) {
    clearTimeout(vehicle.status8ReadyTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.status8ReadyTimer);
    vehicle.status8ReadyTimer = null;
  }
  if (vehicle.handoverTimer) {
    clearTimeout(vehicle.handoverTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }
  if (Math.random() < 0.125) {
    logRadio(`${vehicle.name}: Ja, einsatzklar.`, "radio");
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
  logRadio(`${vehicle.name}: Nein, brauchen noch ${delay} Minuten.`, "radio");
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
  if (!required.some(isDoctorRequirement) || !patientAmbulatorySelected(patient)) return false;
  return patientHasDispatchedVehicleType(patient, "RTW") || patientHasAssignedDoctorVehicle(patient);
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
  let timer = null;
  const fire = () => {
    state.timeouts = state.timeouts.filter((item) => item !== timer);
    if (state.paused) {
      timer = window.setTimeout(fire, 500);
      state.timeouts.push(timer);
      return;
    }
    handler();
  };
  timer = window.setTimeout(fire, delay);
  state.timeouts.push(timer);
  return timer;
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
    reportBoundaryStatus(vehicle, `Servus, unterwegs zu ${vehicleBoundaryDestinationText(vehicle)}`);
    return;
  }
  reportBoundaryStatus(vehicle, "Wieder im Einsatzgebiet");
}

function reportBoundaryStatus(vehicle, message) {
  if (vehicle.radioStatus === 0) {
    logRadio(`${vehicle.name}: Status 5 - ${message}`, "radio");
    return;
  }
  triggerRadioStatus(vehicle, 5, message);
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
  if (vehicle.routeTimer) {
    clearTimeout(vehicle.routeTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.routeTimer);
  }
  vehicle.routeTimer = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.routeToken = null;
  vehicle.routeArrivalHandler = null;
  vehicle.target = null;
}

function isAlarmable(vehicle) {
  return ([1, 2, 8].includes(vehicle.status)
    || (vehicle.status === 3 && vehicle.routeMeta && !vehicle.routeMeta.signal)
    || (isDoctorVehicle(vehicle.type) && vehicle.status === 7 && !vehicle.accompanyingActive)) && !vehicle.nextIncidentId && !vehicle.coverageDispatch;
}

function turnoutDelayMinutes(vehicle) {
  let delay = randomRange(.5, 2);
  if (vehicle.status === 1) delay = 0;
  if (vehicle.status === 3) delay = .5;
  if (!vehicle.dispatchSignal) delay *= 1.5;
  if (vehicle.type === "RTH") delay *= 2;
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

function nearestHospital(incident) {
  return nearestHospitals(incident)[0];
}

function nearestHospitals(incident, request = incident.transportRequest, options = {}) {
  return state.center.hospitals
    .filter((hospital) => options.includeForeign || !hospital.foreign)
    .map((hospital) => ({
      ...hospital,
      distance: mapDistance(hospital.lat, hospital.lng, incident.lat, incident.lng),
      suitable: hospitalSuitableForIncident(hospital, incident, request)
    }))
    .sort((a, b) => a.distance - b.distance);
}

function hospitalSuitableForIncident(hospital, incident, request = incident.transportRequest) {
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
  const used = new Set();
  return (incident.required || []).filter((requiredType) => {
    const match = assigned.find((vehicle) => !used.has(vehicle.id) && vehicleSatisfiesRequirement(vehicle.type, requiredType));
    if (!match) return true;
    used.add(match.id);
    return false;
  });
}

function isDoctorVehicle(type) {
  return type === "NEF" || type === "RTH";
}

function isDoctorRequirement(type) {
  return type === "NEF" || type === "RTH";
}

function vehicleSatisfiesRequirement(vehicleType, requiredType) {
  if (vehicleType === requiredType) return true;
  if (requiredType === "KTW" && vehicleType === "RTW") return true;
  if (requiredType === "NEF" && vehicleType === "RTH") return true;
  return false;
}

function setSpeed() {
  const oldSpeed = state.speed || 1;
  state.speed = Number(el.speedSelect.value) || 1;
  state.lastClockTick = Date.now();
  rescaleActiveTimers(oldSpeed, state.speed);
}

function rescaleActiveTimers(oldSpeed, newSpeed) {
  if (!oldSpeed || !newSpeed || oldSpeed === newSpeed) return;
  const factor = oldSpeed / newSpeed;
  const now = Date.now();
  state.vehicles.forEach((vehicle) => {
    if (vehicle.routeMeta) {
      const total = Math.max(1, vehicle.routeMeta.endAt - vehicle.routeMeta.startAt);
      const progress = Math.min(1, Math.max(0, (now - vehicle.routeMeta.startAt) / total));
      const remaining = Math.max(0, vehicle.routeMeta.endAt - now) * factor;
      const newTotal = progress >= 1 ? 1 : remaining / Math.max(.001, 1 - progress);
      vehicle.routeMeta.startAt = now - progress * newTotal;
      vehicle.routeMeta.endAt = now + remaining;
      if (vehicle.routeTimer) {
        clearTimeout(vehicle.routeTimer);
        state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.routeTimer);
      }
      if (vehicle.routeArrivalHandler) {
        vehicle.routeTimer = scheduleTimeout(vehicle.routeArrivalHandler, remaining);
      }
    }
    if (vehicle.dispatchTimer && vehicle.pendingDispatchUntil) {
      const remaining = Math.max(0, vehicle.pendingDispatchUntil - now) * factor;
      vehicle.pendingDispatchUntil = now + remaining;
      clearTimeout(vehicle.dispatchTimer);
      state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.dispatchTimer);
      const handler = vehicle.dispatchHandler || (() => startResponse(vehicle.id));
      vehicle.dispatchTimer = scheduleTimeout(() => {
        vehicle.dispatchTimer = null;
        vehicle.dispatchHandler = null;
        handler();
      }, remaining);
    }
    if (vehicle.treatmentTimer && vehicle.treatmentDueAt) {
      const remaining = Math.max(0, vehicle.treatmentDueAt - now) * factor;
      vehicle.treatmentDueAt = now + remaining;
      clearTimeout(vehicle.treatmentTimer);
      state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.treatmentTimer);
      vehicle.treatmentTimer = scheduleTimeout(() => {
        vehicle.treatmentTimer = null;
        vehicle.treatmentDueAt = null;
        transportOrClear(vehicle.id);
      }, remaining);
    }
    if (vehicle.status8ReadyTimer && vehicle.status8ReadyAt) {
      const remaining = Math.max(0, vehicle.status8ReadyAt - now) * factor;
      vehicle.status8ReadyAt = now + remaining;
      clearTimeout(vehicle.status8ReadyTimer);
      state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.status8ReadyTimer);
      vehicle.status8ReadyTimer = scheduleTimeout(() => {
        vehicle.status8ReadyTimer = null;
        vehicle.status8ReadyAt = null;
        vehicle.status8ReadyDelay = null;
        if (vehicle.status === 8 && !vehicle.nextIncidentId) clearVehicle(vehicle.id);
      }, remaining);
    }
  });
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) {
    state.pauseStartedAt = Date.now();
  } else if (state.pauseStartedAt) {
    const pausedMs = Date.now() - state.pauseStartedAt;
    state.vehicles.forEach((vehicle) => {
      if (vehicle.routeMeta) {
        vehicle.routeMeta.startAt += pausedMs;
        vehicle.routeMeta.endAt += pausedMs;
      }
      if (vehicle.pendingDispatchUntil) vehicle.pendingDispatchUntil += pausedMs;
    });
    state.pauseStartedAt = null;
    state.lastClockTick = Date.now();
  }
  el.pauseButton.textContent = state.paused ? "Weiter" : "Pause";
}
