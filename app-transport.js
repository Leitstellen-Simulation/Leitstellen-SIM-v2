function assignVehicle(vehicleId, incidentId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!vehicle || !incident || !isAlarmable(vehicle) || incident.assigned.includes(vehicle.id)) return;

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
    logRadio(`${vehicle.name}: Gebietsabsicherung aufgehoben, übernimmt Einsatz.`, "radio");
  }

  const delayMinutes = vehicle.status === 8 ? randomInt(2, 15) : turnoutDelayMinutes(vehicle);
  vehicle.nextIncidentId = incident.id;
  vehicle.previousIncidentId = vehicle.incidentId;
  vehicle.pendingDispatchUntil = Date.now() + simulationDelay(delayMinutes);
  vehicle.pendingDispatchDelay = delayMinutes;
  vehicle.dispatchSignal = Boolean(incident.signal);
  vehicle.statusText = vehicle.status === 8
    ? `Folgeeinsatz möglich in ca. ${delayMinutes} min`
    : `alarmiert, rückt in ca. ${delayMinutes} min aus`;

  if (vehicle.handoverTimer) {
    clearTimeout(vehicle.handoverTimer);
    state.timeouts = state.timeouts.filter((timer) => timer !== vehicle.handoverTimer);
    vehicle.handoverTimer = null;
  }

  incident.assigned.push(vehicle.id);
  incident.status = hasRequiredVehicles(incident) ? "alarmiert" : "in Bearbeitung";
  logRadio(`${vehicle.name}: Einsatzauftrag erhalten, Ausrücken in ca. ${delayMinutes} Minute(n).`, vehicle.status === 8 ? "warn" : "radio");
  playPagerTone();
  if (Math.random() < .015) triggerRadioStatus(vehicle, 0, "Notrufsignal ausgelöst, Rückfrage läuft.");
  renderAll();
  vehicle.dispatchTimer = scheduleTimeout(() => startResponse(vehicle.id), simulationDelay(delayMinutes));
}

function triggerRadioStatus(vehicle, code, message) {
  vehicle.radioStatus = code;
  vehicle.radioMessage = code === 0 ? "Sprechwunsch" : message;
  vehicle.awaitingSpeechPrompt = code === 5;
  if (code === 0) vehicle.awaitingSpeechPrompt = true;
  logRadio(`${vehicle.name}: Status ${code}${code === 0 ? " - Sprechwunsch" : ` - ${message}`}`, code === 0 ? "warn" : "radio");
  if (code !== 0 && code !== 5) {
    scheduleTimeout(() => {
      if (vehicle.radioStatus === code) {
        vehicle.radioStatus = null;
        vehicle.radioMessage = "";
        vehicle.awaitingSpeechPrompt = false;
        renderVehicles();
        renderRadioAlerts();
      }
    }, simulationDelay(.5));
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
  const relatedIncident = relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (vehicle.radioStatus === 5 || vehicle.radioStatus === 0) {
    const radioStatus = vehicle.radioStatus;
    logRadio(`${vehicle.name}: Sprechaufforderung J gesendet.`, radioStatus === 0 ? "warn" : "radio");
    vehicle.radioStatus = null;
    vehicle.radioMessage = "";
    vehicle.awaitingSpeechPrompt = false;
    vehicle.waitingForSpeechPrompt = false;
    renderAll();
    renderRadioAlerts();
    scheduleTimeout(() => completeSpeechPromptResponse(vehicle.id, {
      radioStatus,
      pendingTransportRequest,
      pendingClearRequest,
      pendingAssistanceRequest,
      pendingSituationReport,
      pendingKtwHandoverRequest,
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
    relatedIncidentId: relatedIncident?.id || null
  });
}

function completeSpeechPromptResponse(vehicleId, context) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const pendingTransportRequest = context.pendingTransportRequest;
  const pendingClearRequest = context.pendingClearRequest;
  const pendingAssistanceRequest = context.pendingAssistanceRequest;
  const pendingSituationReport = context.pendingSituationReport;
  const pendingKtwHandoverRequest = context.pendingKtwHandoverRequest;
  const relatedIncident = state.incidents.find((incident) => incident.id === context.relatedIncidentId) || relatedIncidentForVehicle(vehicle, pendingTransportRequest, pendingAssistanceRequest);
  if (vehicle.radioStatus === 5) {
    if (pendingClearRequest) {
      releasePatientAssignment(vehicle);
      logRadio(`${vehicle.name}: ${pendingClearRequest.reason || "nicht benötigt"}, meldet frei.`, "radio");
    } else if (vehicle.status === 3 && isCoverageRun(vehicle)) {
      confirmCoverageRun(vehicle);
    } else if (vehicle.status === 3 || vehicle.nextIncidentId) {
      logRadio(`${vehicle.name}: unterwegs zu ${vehicleDestinationText(vehicle, relatedIncident)}.`, "radio");
    }
  } else if (context.radioStatus === 5) {
    if (pendingClearRequest) {
      releasePatientAssignment(vehicle);
      logRadio(`${vehicle.name}: ${pendingClearRequest.reason || "nicht benötigt"}, meldet frei.`, "radio");
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
    }
  } else if (context.radioStatus === 0 && pendingSituationReport) {
    logRadio(`${vehicle.name}: Sprechaufforderung J gesendet. Lage: ${pendingSituationReport.text}`, "warn");
    const incident = state.incidents.find((item) => item.id === pendingSituationReport.incidentId);
    if (incident) {
      incident.patient.report = pendingSituationReport.text;
      incident.patient.situationReported = true;
      incident.status = "Lage gemeldet";
      state.selectedIncidentId = incident.id;
      maybeRequestAdditionalResources(vehicle, incident);
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
  vehicle.radioMessage = "";
  vehicle.awaitingSpeechPrompt = false;
  vehicle.waitingForSpeechPrompt = false;
  vehicle.pendingAssistanceRequest = null;
  vehicle.pendingSituationReport = null;
  vehicle.pendingClearRequest = null;
  vehicle.pendingKtwHandoverRequest = null;
  vehicle.supportOnly = false;
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
  vehicle.patientId = null;
  vehicle.incidentId = incident.id;
  vehicle.nextIncidentId = null;
  vehicle.previousIncidentId = null;
  vehicle.pendingDispatchUntil = null;
  vehicle.pendingDispatchDelay = null;
  vehicle.dispatchTimer = null;
  if (vehicle.radioStatus === 5) {
    vehicle.radioMessage = "Sprechwunsch offen";
  }
  triggerRadioStatus(vehicle, 5, `Status 3, Anfahrt ${incident.keyword}. Fahrzeug rückt aus.`);
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
  scheduleSurplusRelease(incident.id);
  scheduleTreatmentCompletion(vehicle, incident);
}

function releaseSupportDoctorsReadyForHandover(incident) {
  (incident.patient?.patients || []).forEach((patient) => {
    if (!patientHasTransportUnitAtScene(patient) || patientTreatmentProgress(patient, incident) < 0.8) return;
    (patient.assignedVehicles || [])
      .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
      .filter((vehicle) => vehicle && ["NEF", "RTH"].includes(vehicle.type) && vehicle.status === 4 && vehicle.supportOnly)
      .forEach((vehicle) => requestVehicleClearance(vehicle, incident, "Patient an Transportfahrzeug übergeben"));
  });
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
    transportOrClear(vehicle.id);
  }, simulationDelay(remaining));
}

function remainingTreatmentMinutes(patient, incident) {
  const progress = patientTreatmentProgress(patient, incident);
  const cap = currentTreatmentCap(patient, incident).cap;
  return Math.max(0, treatmentMinutes(incident) * (cap - progress));
}

function scheduleSurplusRelease(incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) return;
  surplusVehiclesAtScene(incident).forEach((vehicle) => {
    if (vehicle.surplusTimer) return;
    const delay = randomInt(3, 12);
    vehicle.surplusTimer = scheduleTimeout(() => {
      vehicle.surplusTimer = null;
      const currentIncident = state.incidents.find((item) => item.id === incidentId);
      if (!currentIncident || vehicle.status !== 4 || vehicle.incidentId !== incidentId) return;
      const stillSurplus = surplusVehiclesAtScene(currentIncident).some((unit) => unit.id === vehicle.id);
      if (!stillSurplus) return;
      requestVehicleClearance(vehicle, currentIncident, "an der Einsatzstelle nicht benötigt");
    }, simulationDelay(delay));
  });
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

function assignVehicleToPatient(vehicle, incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length || vehicle.patientId) return;
  let preferred = vehicle.type === "KTW"
    ? patients.find((patient) => patient.awaitingKtwHandover && !patient.completed && !patient.transporting)
    : null;
  preferred ??= patients
    .filter((patient) => patientMissingTypes(patient).some((type) => vehicleSatisfiesRequirement(vehicle.type, type)))
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
  const canContribute = (patient.required || []).some((type) => vehicleSatisfiesRequirement(vehicle.type, type));
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
  return required.includes("RTW") || required.includes("NEF") || required.includes("RTH");
}

function refCanFirstRespond(patient) {
  const required = patient?.required || [];
  if (required.includes("REF")) return true;
  return required.includes("RTW") || required.includes("NEF");
}

function patientRequiresOnlyRef(patient) {
  const required = patient?.required || [];
  return required.length > 0 && required.every((type) => type === "REF");
}

function patientHasRequiredTransportUnitAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .some((vehicle) => vehicle && vehicle.status === 4 && (patient.required || []).some((type) => ["RTW", "KTW"].includes(type) && vehicleSatisfiesRequirement(vehicle.type, type)));
}

function patientNeedsTransportUnit(patient) {
  return patient?.transportNeeded !== false && (patient.required || []).some((type) => ["RTW", "KTW", "RTH"].includes(type));
}

function patientNeedsMoreVehicles(patient) {
  return patientMissingTypes(patient).length > 0;
}

function patientMissingTypes(patient) {
  const assigned = (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .filter(Boolean);
  const used = new Set();
  return (patient.required || []).filter((requiredType) => {
    const match = assigned.find((vehicle) => !used.has(vehicle.id) && vehicleSatisfiesRequirement(vehicle.type, requiredType));
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
  const counts = incident.required.reduce((sum, type) => {
    sum[type] = (sum[type] || 0) + 1;
    return sum;
  }, {});
  return `Benötigt: ${Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(", ")}.`;
}

function maybeRequestAdditionalResources(vehicle, incident) {
  if ((incident.patient?.patientCount || 1) > 1 && !incident.patient?.situationReported) return;
  clearResolvedAssistanceNeeds(incident);
  if (incident.assistanceRequested) return;
  const missing = missingVehicleTypesForDispatch(incident);
  const missingServices = missingExternalServices(incident, "dispatch");
  const needsDoctor = missing.some(isDoctorRequirement);
  const needsSceneTransport = ["NEF", "RTH", "REF"].includes(vehicle.type) && missing.some((type) => ["RTW", "KTW"].includes(type));
  const needsTransport = vehicle.type === "KTW" && (missing.includes("RTW") || missing.includes("NEF"));
  const refNeedsTransport = vehicle.type === "REF" && (missing.includes("RTW") || missing.includes("KTW"));
  if (![...missing, ...missingServices].length) return;
  if (!needsDoctor && !needsSceneTransport && !needsTransport && !refNeedsTransport && !missingServices.length) return;
  vehicle.pendingAssistanceRequest = {
    incidentId: incident.id,
    missing: [...missing, ...missingServices]
  };
  triggerRadioStatus(vehicle, 0, `Nachforderung erforderlich: ${[...missing, ...missingServices].join(", ") || "Transportmittel"}.`);
  incident.status = "Nachforderung offen";
  incident.assistanceRequested = true;
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
  if (!rtw && patientRequiresRoadTransportWithRth(patient)) {
    if (vehicle.id === rth.id) {
      maybeRequestAdditionalResources(vehicle, incident);
      vehicle.statusText = "wartet auf RTW für Transportentscheidung";
      renderAll();
      return true;
    }
    return false;
  }

  patient.rthTransportMode ||= chooseRthTransportMode(patient);
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
    rth.handoverTimer = scheduleTimeout(() => clearVehicle(rth.id), simulationDelay(10));
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

  incident.patient.status = "versorgt";
  incident.patient.readyForTransport = true;
  incident.patient.report = patientReport(incident);
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
  if (outcome) {
    finishPatientWithoutTransport(incident, assignedPatient, vehicle, outcome);
    return;
  }
  if (assignedPatient && patientRequiresOnlyRef(assignedPatient)) {
    finishPatientWithoutTransport(incident, assignedPatient, vehicle, "Ambulante Versorgung durch REF abgeschlossen, kein Transport.");
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
  if (fixedHospital || isAutomaticTransport(incident)) {
    beginTransport(incident.id, fixedHospital?.id || nearestHospital(incident)?.id, vehicle.id);
    return;
  }

  requestTransportDestination(vehicle, incident);
}

function ktwForHandoverAtScene(patient) {
  return (patient.assignedVehicles || [])
    .map((id) => state.vehicles.find((vehicle) => vehicle.id === id))
    .find((vehicle) => vehicle?.type === "KTW" && vehicle.status === 4);
}

function patientReport(incident) {
  const patient = incident.patient;
  if (patient.report) return patient.report;
  if (patient.pendingReport) return patient.pendingReport;
  if (incident.type === "transport") {
    return `Patient transportbereit, benötigt ${patient.requiredDepartment}.`;
  }
  const stateText = patient.condition === "kritisch" ? "kritisch, aber transportfähig" : "stabil nach Erstversorgung";
  return `${stateText}; benötigt ${patient.requiredDepartment}.`;
}

function patientOutcome(incident, patient = null) {
  if (incident.type === "transport") return null;
  if (patient && Math.random() < (Number(patient.noTransportProbability) || 0)) {
    return patient.noTransportText || "Ambulante Versorgung ausreichend, kein Transport.";
  }
  if (incident.patient.noTransportLikely && Math.random() < .8) return "Ambulante Einschätzung ausreichend, kein Transport.";
  const keyword = incident.keyword || "";
  if (keyword.includes("Kreislaufstillstand") && Math.random() < .22) return "Tod festgestellt, kein Transport.";
  if (incident.patient.condition === "stabil" && Math.random() < .08) return "Keine rettungsdienstliche Transportindikation.";
  return null;
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

function requestTransportDestination(vehicle, incident) {
  incident.status = "wartet auf Zielklinik";
  vehicle.pendingTransportRequest = {
    id: makeId(),
    incidentId: incident.id,
    report: incident.patient.report,
    requiredDepartment: patientForVehicle(vehicle, incident)?.requiredDepartment || incident.patient.requiredDepartment,
    patientId: vehicle.patientId || patientForVehicle(vehicle, incident)?.id || null
  };
  vehicle.statusText = "Status 5: Sprechwunsch";
  triggerRadioStatus(vehicle, 5, "Sprechwunsch zur Patientenrückmeldung.");
  renderAll();
}

function activateTransportRequest(vehicle, incidentId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident || !vehicle.pendingTransportRequest) return;
  const request = {
    id: vehicle.pendingTransportRequest.id || makeId(),
    vehicleId: vehicle.id,
    report: vehicle.pendingTransportRequest.report,
    requiredDepartment: vehicle.pendingTransportRequest.requiredDepartment,
    patientId: vehicle.pendingTransportRequest.patientId
  };
  incident.transportRequests = (incident.transportRequests || []).filter((item) => item.vehicleId !== vehicle.id);
  incident.transportRequests.push(request);
  incident.transportRequest = incident.transportRequests[0] || null;
  vehicle.pendingTransportRequest = null;
  vehicle.statusText = "wartet auf Transportziel";
  logRadio(`${vehicle.name}: Rückmeldung: ${request.report}`, "radio");
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
  driveVehicleTo(vehicle, hospital, { signal, phase: "hospital" }, () => arriveAtHospital(vehicle.id));
}

function beginTransportToDestination(incidentId, destination, vehicleId) {
  const incident = state.incidents.find((item) => item.id === incidentId);
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!incident || !vehicle || vehicle.status !== 4) return;
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
  incident.assigned.forEach((id) => {
    if (id === transportingVehicleId) return;
    const vehicle = state.vehicles.find((unit) => unit.id === id);
    if (vehicle && isDoctorVehicle(vehicle.type) && vehicle.status === 4) {
      requestVehicleClearance(vehicle, incident, "Notarzt nicht erforderlich");
    }
  });
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

function completeTransportedPatient(vehicle, incident) {
  const patient = patientForVehicle(vehicle, incident);
  if (!patient) return;
  if (patient.transportVehicleId && patient.transportVehicleId !== vehicle.id) return;
  patient.transporting = false;
  patient.completed = true;
  patient.completedAtMinute = state.minute;
}

function incidentHasOpenPatients(incident) {
  const patients = incident.patient?.patients || [];
  if (!patients.length) return false;
  return patients.some((patient) => patient.transportNeeded !== false && !patient.completed);
}

function closeIncidentIfAllPatientsDone(incident) {
  if (!incident || incidentHasOpenPatients(incident)) return false;
  if (incident.status === "geschlossen") return true;
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
    return missing.some((type) => vehicleSatisfiesRequirement(vehicle.type, type))
      || (["NEF", "RTH"].includes(vehicle.type) && patientNeedsTransportUnit(patient) && patientTreatmentProgress(patient, incident) < 0.8)
      || !(patient.assignedVehicles || []).length;
  });
  if (!next) return false;
  releasePatientAssignment(vehicle);
  next.assignedVehicles = next.assignedVehicles || [];
  if (!next.assignedVehicles.includes(vehicle.id)) next.assignedVehicles.push(vehicle.id);
  next.treatmentStartedAt ??= state.minute;
  vehicle.patientId = next.id;
  vehicle.supportOnly = ["NEF", "RTH"].includes(vehicle.type) && !next.required?.some((type) => vehicleSatisfiesRequirement(vehicle.type, type));
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
  vehicle.handoverTimer = scheduleTimeout(() => clearVehicle(vehicle.id), simulationDelay(handoverMinutes()));
}

function scheduleSecondaryTransfer(sourceIncident, hospital) {
  if (Math.random() > .75) return;
  const delayMinutes = randomInt(15, 60);
  scheduleTimeout(() => {
    const transfer = buildSecondaryTransferCall(sourceIncident, hospital);
    if (!state.pendingCall) {
      state.pendingCall = transfer;
      el.answerButton.disabled = false;
      el.forwardButton.disabled = false;
      logCall("Neuer Telefonanruf.", "warn");
      logCall(`${transfer.callerName}: ${transfer.callerText}`, "call");
    } else {
      createIncident(transfer);
    }
    logRadio(`Folgetransport wegen ungeeigneter Zielklinik angelegt: ${hospital.label}.`, "warn");
    renderAll();
  }, simulationDelay(delayMinutes));
}

function buildSecondaryTransferCall(sourceIncident, hospital) {
  const critical = sourceIncident.patient?.condition === "kritisch" || sourceIncident.required.includes("NEF");
  const keyword = critical ? "RD 2 Verlegung - Notfalltransport mit NA" : sourceIncident.type === "transport" ? "RD KTP - Verlegung" : "RD 1 Verlegung - Notfalltransport mit RTW";
  const defaults = keywordDefaults[keyword] || { type: "transport", required: critical ? ["RTW", "NEF"] : ["RTW"], signal: critical };
  return {
    id: makeId(),
    type: defaults.type,
    keyword,
    callerName: `${hospital.label} Aufnahme`,
    callerText: `Patient aus ${sourceIncident.keyword} benoetigt Verlegung, da die erforderliche Fachabteilung (${sourceIncident.patient?.requiredDepartment || "Fachrichtung"}) nicht verfuegbar ist.`,
    location: hospital.label,
    lat: hospital.lat,
    lng: hospital.lng,
    required: defaults.required,
    requiredDepartmentKey: sourceIncident.patient?.requiredDepartmentKey || "emergency",
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
  logRadio(`${service}: an der Einsatzstelle eingetroffen.`, "radio");
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
    logRadio(`${service}: an der Einsatzstelle eingetroffen.`, "radio");
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
  vehicle.handoverTimer = scheduleTimeout(() => clearVehicle(vehicle.id), simulationDelay(handoverMinutes()));
}

function clearVehicle(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle) return;
  const oldStatus = vehicle.status;
  const oldIncidentId = vehicle.incidentId;
  const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  cancelVehicleRoute(vehicle);
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  const boundTransport = state.vehicles.find((unit) => unit.id === vehicle.boundTransportVehicleId);
  if (boundTransport?.boundDoctorVehicleId === vehicle.id) boundTransport.boundDoctorVehicleId = null;
  const boundDoctor = state.vehicles.find((unit) => unit.id === vehicle.boundDoctorVehicleId);
  if (boundDoctor?.boundTransportVehicleId === vehicle.id) boundDoctor.boundTransportVehicleId = null;
  vehicle.boundTransportVehicleId = null;
  vehicle.boundDoctorVehicleId = null;
  releasePatientAssignment(vehicle);

  vehicle.status = 1;
  vehicle.statusText = "frei über Funk";
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

function returnToStation(vehicleId) {
  const vehicle = state.vehicles.find((unit) => unit.id === vehicleId);
  if (!vehicle || vehicle.status !== 1) return;
  const station = state.center.stations.find((item) => item.id === vehicle.stationId);
  if (!station) return;
  vehicle.status = 2;
  vehicle.statusText = "auf Wache";
  vehicle.lat = station.lat;
  vehicle.lng = station.lng;
  vehicle.target = null;
  vehicle.route = null;
  vehicle.routeMeta = null;
  vehicle.incidentId = null;
  vehicle.coveragePointId = null;
  vehicle.coveragePoint = null;
  renderAll();
}

async function driveVehicleTo(vehicle, destination, options, onArrival) {
  const route = await buildRoute(vehicle, destination);
  vehicle.target = { lat: destination.lat, lng: destination.lng };
  vehicle.route = route.points;
  vehicle.routeDistanceKm = route.distanceKm;
  const speedKmh = routeSpeedKmh(vehicle, options.signal);
  const travelMs = Math.max(8000, (route.distanceKm / speedKmh) * 3600000 / state.speed);
  const token = makeId();
  vehicle.routeToken = token;
  vehicle.routeMeta = {
    token,
    startAt: Date.now(),
    endAt: Date.now() + travelMs,
    points: route.points,
    cumulative: routeCumulative(route.points),
    distanceKm: route.distanceKm,
    destination,
    signal: Boolean(options.signal)
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
  const fallback = {
    distanceKm: Math.max(.2, fallbackDistance),
    points: [[vehicle.lat, vehicle.lng], [destination.lat, destination.lng]]
  };
  if (vehicle.type === "RTH") {
    return {
      distanceKm: Math.max(.2, directDistance),
      points: [[vehicle.lat, vehicle.lng], [destination.lat, destination.lng]]
    };
  }

  if (!window.fetch) return fallback;

  const url = `https://router.project-osrm.org/route/v1/driving/${vehicle.lng},${vehicle.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  try {
    const response = await fetch(url);
    if (!response.ok) return fallback;
    const data = await response.json();
    const route = data.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return fallback;
    return {
      distanceKm: Math.max(.2, route.distance / 1000),
      points: route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
    };
  } catch {
    return fallback;
  }
}

function routeSpeedKmh(vehicle, signal) {
  if (vehicle?.type === "RTH") return 200;
  const normalCitySpeed = 38;
  return signal ? normalCitySpeed * 1.3 : normalCitySpeed;
}

function treatmentMinutes(incident) {
  if (incident.required.some(isDoctorRequirement)) return 18;
  if (incident.type === "transport") return 6;
  return 12;
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
    changed = true;
  });
  if (changed) renderMap();
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
    || (isDoctorVehicle(vehicle.type) && vehicle.status === 7 && !vehicle.accompanyingActive)) && !vehicle.nextIncidentId;
}

function turnoutDelayMinutes(vehicle) {
  let delay = randomRange(.5, 2);
  if (vehicle.status === 1) delay = 0;
  if (vehicle.status === 3) delay = .5;
  return vehicle.type === "RTH" ? delay * 2 : delay;
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

function nearestHospitals(incident, request = incident.transportRequest) {
  return state.center.hospitals
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
      vehicle.dispatchTimer = scheduleTimeout(() => startResponse(vehicle.id), remaining);
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
