const tna = (() => {
  const sessions = new WeakMap();
  const transportEscalationProbability = .05;
  const activeAtScene = new Set(["radio", "requested", "connecting", "on-scene"]);

  function physicalDoctor(incident) {
    return state.vehicles.find((unit) => incident.assigned.includes(unit.id) && isDoctorVehicle(unit.type)
      && (unit.nextIncidentId === incident.id || (unit.incidentId === incident.id && [3, 4, 7].includes(unit.status))));
  }

  function requestAtScene(vehicle, incident, patient) {
    if ((state.center.tnaEnabled !== true && !incident.tnaTest) || !incident.tnaProbability || sessions.has(incident)) return false;
    if (vehicle.type !== "RTW" || vehicle.status !== 4 || incident.patient.patients.length !== 1
      || !patient || vehicle.patientId !== patient.id || patient.completed || patient.transporting
      || patient.acuity === "reanimation" || patient.requiresDoctorAccompaniment
      || physicalDoctor(incident) || incident.assistanceDecision?.missing?.some(isDoctorRequirement)
      || !patientMissingTypes(patient).some(isDoctorRequirement)) return false;
    const session = { vehicleId: vehicle.id, patientId: patient.id, phase: "ended", since: simMinuteNow() };
    sessions.set(incident, session);
    if (!incident.tnaTest && Math.random() >= incident.tnaProbability) return false;
    const fails = incident.tnaTest?.failure ?? (Math.random() < normalizeProbability(state.center.tnaFailureProbability ?? .05, .05));
    if (fails) {
      session.reason = "TNA-System am RTW ausgefallen";
      return false;
    }
    session.phase = "radio";
    notify(vehicle, session, "tna-request", "Telenotarzt zur Unterstützung anfordern.");
    return true;
  }

  function notify(vehicle, session, context, message) {
    if (session.acceptingRadio || (vehicle.radioStatus === 0 && !["response-start", "boundary"].includes(vehicle.radioContext))) return;
    triggerRadioStatus(vehicle, 0, message, { context });
  }

  function acceptingRadio(vehicle, context) {
    if (!context?.startsWith("tna-")) return;
    const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
    const session = sessions.get(incident);
    if (session?.vehicleId === vehicle.id) session.acceptingRadio = true;
  }

  function answerRadio(vehicle, context) {
    const incident = state.incidents.find((item) => item.id === vehicle.incidentId);
    const session = sessions.get(incident);
    if (!session || session.vehicleId !== vehicle.id || incident.status === "geschlossen") return;
    session.acceptingRadio = false;
    if (context === "tna-request" && session.phase === "radio" && vehicle.status === 4) {
      session.phase = "requested";
      session.since = simMinuteNow();
      logRadio(`${vehicle.name}: Telenotarzt zur Unterstützung anfordern.`, "warn", incident.id);
      selectIncidentFromMapOrList(incident);
      maybeRequestAdditionalResources(vehicle, incident);
    } else if (context === "tna-physical" && session.phase === "physical" && vehicle.status === 7) {
      session.physicalReported = true;
      logRadio(`${vehicle.name}: ${session.reason}. Physischen Notarzt nachfordern.`, "warn", incident.id);
      selectIncidentFromMapOrList(incident);
      publishPhysicalNeed(incident, session);
    }
    renderAll();
  }

  function connect(incidentId) {
    const incident = state.incidents.find((item) => item.id === incidentId);
    const session = sessions.get(incident);
    if (session?.phase !== "requested" || incident.status === "geschlossen") return;
    session.phase = "connecting";
    session.connectedAt = simMinuteNow() + .35;
    selectIncidentFromMapOrList(incident);
    logRadio("TNA-Verbindung angefordert.", "radio", incident.id);
    renderAll();
  }

  function covers(patient) {
    if (patient.acuity === "reanimation" || patient.requiresDoctorAccompaniment) return false;
    const incident = incidentForPatient(patient);
    const session = sessions.get(incident);
    return session?.patientId === patient.id && ["on-scene", "transport"].includes(session.phase);
  }

  function startTransport(incident, vehicle) {
    const session = sessions.get(incident);
    if (session?.phase !== "on-scene" || session.vehicleId !== vehicle.id) return;
    session.phase = "transport";
    session.escalate = incident.tnaTest?.escalation ?? (Math.random() < transportEscalationProbability);
    logRadio(`${vehicle.name}: Transport wird durch den TNA begleitet.`, "radio", incident.id);
  }

  function doctorOnScene(incident, vehicle) {
    const session = sessions.get(incident);
    if (!session || !activeAtScene.has(session.phase) || !isDoctorVehicle(vehicle.type)
      || vehicle.patientId !== session.patientId) return;
    if (session.phase === "on-scene") logRadio(`TNA übergibt an ${vehicle.name}.`, "radio", incident.id);
    end(incident);
  }

  function startPhysicalRequest(session, reason) {
    session.phase = "physical";
    session.reason = reason;
    session.physicalReported = false;
    session.acceptingRadio = false;
  }

  function onReanimation(incident, patient) {
    const session = sessions.get(incident);
    if (session?.patientId !== patient.id || session.phase === "ended") return false;
    if (patient.transporting && session.phase !== "handover") {
      const reason = "Verschlechterung zur Reanimation";
      if (session.phase === "physical") {
        session.reason = reason;
        if (incident.assistanceDecision) incident.assistanceDecision.reason = reason;
      } else {
        startPhysicalRequest(session, reason);
      }
      return true;
    }
    end(incident);
    session.reason = "Verschlechterung zur Reanimation";
    return false;
  }

  function physicalMissing(incident) {
    const session = sessions.get(incident);
    return session?.phase === "physical" && !physicalDoctor(incident) ? ["NEF"] : [];
  }

  function publishPhysicalNeed(incident, session) {
    if (!physicalMissing(incident).length || incident.assistanceDecision?.missing.includes("NEF")) return;
    const reporter = state.vehicles.find((unit) => unit.id === session.vehicleId);
    incident.assistanceDecision = {
      vehicleId: session.vehicleId, vehicleType: reporter?.type || "RTW",
      missing: [...(incident.assistanceDecision?.missing || []), "NEF"], reason: session.reason,
      createdAtMinute: state.minute, createdAtAbsoluteMinute: simMinuteNow()
    };
    incident.assistanceRequested = true;
    return true;
  }

  function routeProgress(route) {
    return Math.max(0, Math.min(1, (Date.now() - route.startAt) / Math.max(1, route.endAt - route.startAt)));
  }

  function routeDoctor(incident, doctor) {
    const session = sessions.get(incident);
    if (session?.phase !== "physical" || !isDoctorVehicle(doctor.type)) return false;
    if (session.doctorId && session.doctorId !== doctor.id) return false;
    session.doctorId = doctor.id;
    beginRendezvous(incident, session);
    return true;
  }

  function beginRendezvous(incident, session) {
    if (session.meeting || !session.doctorId) return;
    const doctor = state.vehicles.find((unit) => unit.id === session.doctorId);
    const rtw = state.vehicles.find((unit) => unit.id === session.vehicleId);
    if (doctor?.incidentId !== incident.id || doctor.status !== 3 || rtw?.status !== 7 || !rtw.routeMeta) return;
    const route = rtw.routeMeta;
    const progress = routeProgress(route) + (1 - routeProgress(route)) * .35;
    const point = pointAtProgress(route, progress);
    if (!point) return;
    const meeting = { route, progress, point: { ...point, label: "TNA-Treffpunkt" }, doctorArrived: false, rtwArrived: false };
    session.meeting = meeting;
    cancelVehicleRoute(doctor);
    doctor.statusText = "auf Anfahrt zum TNA-Treffpunkt";
    logRadio(`${doctor.name}: fährt zum Treffpunkt mit ${rtw.name}.`, "radio", incident.id);
    driveVehicleTo(doctor, meeting.point, { signal: true, phase: "rendezvous" }, () => {
      if (session.meeting !== meeting || session.phase !== "physical") return;
      cancelVehicleRoute(doctor);
      Object.assign(doctor, point, { statusText: "wartet am TNA-Treffpunkt" });
      meeting.doctorArrived = true;
      advanceRendezvous(incident, session, rtw);
      renderAll();
    });
  }

  function resumeTransport(rtw, route) {
    const destination = route.destination;
    const phase = route.phase || (destination.type === "destination" ? "destination" : "hospital");
    rtw.statusText = `Transport zu ${destination.label}`;
    const arrival = phase === "destination" ? arriveAtTransportDestination : arriveAtHospital;
    driveVehicleTo(rtw, destination, { signal: route.signal, phase }, () => arrival(rtw.id));
  }

  function advanceRendezvous(incident, session, rtw) {
    const meeting = session.meeting;
    if (!meeting) return;
    if (rtw.routeMeta === meeting.route && routeProgress(meeting.route) >= meeting.progress) {
      cancelVehicleRoute(rtw);
      rtw.lat = meeting.point.lat;
      rtw.lng = meeting.point.lng;
      rtw.statusText = "wartet am TNA-Treffpunkt";
      meeting.rtwArrived = true;
    }
    if (!meeting.rtwArrived || !meeting.doctorArrived) return;
    const doctor = state.vehicles.find((unit) => unit.id === session.doctorId);
    const patient = incident.patient.patients.find((item) => item.id === session.patientId);
    if (!doctor || !patient || doctor.incidentId !== incident.id || doctor.status !== 3) return;
    session.meeting = null;
    session.phase = "handover";
    doctor.patientId = patient.id;
    if (!patient.assignedVehicles.includes(doctor.id)) patient.assignedVehicles.push(doctor.id);
    logRadio(`TNA übergibt an ${doctor.name}.`, "radio", incident.id);
    startDoctorAccompaniment(doctor, rtw, incident, meeting.route.destination, true, meeting.route.phase);
    resumeTransport(rtw, meeting.route);
  }

  function destinationChanging(incident) {
    const session = sessions.get(incident);
    if (!session?.meeting) return;
    const doctor = state.vehicles.find((unit) => unit.id === session.doctorId);
    if (doctor?.status === 3 && doctor.incidentId === incident.id) {
      cancelVehicleRoute(doctor);
      doctor.statusText = "wartet auf neuen TNA-Treffpunkt";
    }
    const signal = session.meeting.route.signal;
    session.meeting = null;
    return signal;
  }

  function end(incident) {
    const session = sessions.get(incident);
    if (!session || session.phase === "ended") return;
    const phase = session.phase;
    session.phase = "ended";
    session.meeting = null;
    const rtw = state.vehicles.find((unit) => unit.id === session.vehicleId);
    if (rtw?.radioContext?.startsWith("tna-")) {
      clearRadioDisplayTimer(rtw);
      rtw.radioStatus = null;
      rtw.radioContext = null;
      rtw.pendingRadioMessage = "";
      rtw.awaitingSpeechPrompt = false;
    }
    if (phase !== "physical") return;
    for (const id of [...incident.assigned]) {
      const doctor = state.vehicles.find((unit) => unit.id === id);
      if (doctor && isDoctorVehicle(doctor.type) && canRemoveAssignedVehicle(doctor, incident)) {
        removeAssignedVehicle(doctor.id, incident.id);
      }
    }
  }

  function tick() {
    for (const incident of state.incidents) {
      const session = sessions.get(incident);
      if (!session || session.phase === "ended") continue;
      const rtw = state.vehicles.find((unit) => unit.id === session.vehicleId && unit.incidentId === incident.id);
      const patient = incident.patient?.patients?.find((item) => item.id === session.patientId);
      if (!rtw || !patient || incident.status === "geschlossen" || patient.completed) {
        end(incident);
        continue;
      }
      if (activeAtScene.has(session.phase)) {
        const doctor = physicalDoctor(incident);
        if (doctor?.status === 4 || (doctor && session.phase !== "on-scene")) {
          if (session.phase === "on-scene") logRadio(`TNA übergibt an ${doctor.name}.`, "radio", incident.id);
          end(incident);
        } else if (session.phase === "radio") {
          notify(rtw, session, "tna-request", "Telenotarzt zur Unterstützung anfordern.");
        } else if (session.phase === "connecting" && simMinuteNow() >= session.connectedAt) {
          session.phase = "on-scene";
          logRadio("Telenotarzt verbunden, übernimmt die Unterstützung vor Ort.", "radio", incident.id);
          scheduleTreatmentCompletion(rtw, incident);
        }
      } else if (session.phase === "transport" && session.escalate && rtw.routeMeta && routeProgress(rtw.routeMeta) >= .35) {
        startPhysicalRequest(session, "Telenotärztliche Transportbegleitung reicht nicht aus");
      }
      if (session.phase !== "physical") continue;
      if (!session.physicalReported) notify(rtw, session, "tna-physical", session.reason);
      else publishPhysicalNeed(incident, session);
      if (session.doctorId && !state.vehicles.some((unit) => unit.id === session.doctorId && unit.incidentId === incident.id && unit.status === 3)) {
        if (session.meeting?.rtwArrived) resumeTransport(rtw, session.meeting.route);
        session.doctorId = null;
        session.meeting = null;
      }
      const doctor = physicalDoctor(incident);
      if (doctor?.status === 3 && doctor.incidentId === incident.id && !session.doctorId) routeDoctor(incident, doctor);
      beginRendezvous(incident, session);
      advanceRendezvous(incident, session, rtw);
    }
  }

  return {
    requestAtScene, acceptingRadio, answerRadio, connect, covers, startTransport, doctorOnScene, routeDoctor, onReanimation,
    destinationChanging, end, tick, physicalMissing,
    reason: (incident) => sessions.get(incident)?.reason,
    onScene: (incident) => sessions.get(incident)?.phase === "on-scene",
    waitingAtScene: (incident) => ["radio", "requested", "connecting"].includes(sessions.get(incident)?.phase),
    requestTime: (incident) => sessions.get(incident)?.phase === "requested" ? sessions.get(incident).since : null,
    status: (incident) => ({
      requested: "TNA angefordert", connecting: "TNA wird verbunden", "on-scene": "TNA unterstützt vor Ort",
      transport: "TNA begleitet Transport", physical: "Wartet auf physischen Notarzt", handover: "An physischen Notarzt übergeben"
    })[sessions.get(incident)?.phase]
  };
})();
