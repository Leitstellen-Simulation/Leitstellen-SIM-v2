function runModFrame() {
  window.addEventListener("message", async (message) => {
    if (message.source !== parent || !message.ports[0]) return;
    const port = message.ports[0];
    const listeners = new Set();
    const pending = new Map();
    let sequence = 0;
    port.onmessage = ({ data }) => {
      if (data.type === "reply") {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error));
        else request.resolve(data.result);
      } else if (data.type === "event") {
        for (const listener of listeners) {
          Promise.resolve().then(() => listener(data.event, data.payload)).catch(console.error);
        }
      }
    };
    const api = Object.freeze({
      version: 1,
      root: document.getElementById("mod-root"),
      onEvent(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      command(name, args = {}) {
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          try {
            port.postMessage({ type: "command", id, name, args });
            pending.set(id, { resolve, reject });
          } catch (error) {
            reject(error);
          }
        });
      }
    });
    const entry = URL.createObjectURL(new Blob([message.data], { type: "text/javascript" }));
    try {
      const module = await import(entry);
      if (typeof module.default !== "function") throw new Error("main.mjs braucht eine Standard-Exportfunktion.");
      await module.default(api);
      port.postMessage({ type: "ready" });
    } catch (error) {
      port.postMessage({ type: "error", error: String(error?.message || error).slice(0, 250) });
    } finally {
      URL.revokeObjectURL(entry);
    }
  }, { once: true });
}

const appMods = (() => {
  const active = new Map();
  const hospitalHolds = new Map();
  let manifests = [];
  let preferences = {};
  let discovery;
  let inShift = false;
  let lastMinute = null;
  const config = document.querySelector("#mods-config");
  const choices = document.querySelector("#mods-choices");
  const status = document.querySelector("#mods-config-status");
  const center = document.querySelector("#center-select");
  const menu = document.querySelector("#mods-menu");
  const dialog = document.querySelector("#mod-dialog");
  const title = document.querySelector("#mod-dialog-title");
  const frames = document.querySelector("#mod-frames");
  document.querySelector("#mod-dialog-close").addEventListener("click", () => dialog.close());
  center.addEventListener("change", () => { status.textContent = ""; renderChoices(); });

  async function discover() {
    discovery ??= fetch("/api/mods", { cache: "no-store", signal: AbortSignal.timeout(3000) }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (data.apiVersion !== 1 || !Array.isArray(data.mods)) return;
      manifests = data.mods;
      preferences = data.enabledByCenter || {};
      renderChoices();
    }).catch(console.warn);
    await discovery;
  }

  function enabledFor(centerId) {
    return Array.isArray(preferences[centerId]) ? preferences[centerId] : [];
  }

  function renderChoices() {
    const available = manifests.filter((mod) => !mod.scenarioCatalog);
    config.hidden = !available.length;
    const centerId = center.value;
    choices.replaceChildren(...available.map((mod) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = enabledFor(centerId).includes(mod.id);
      checkbox.addEventListener("change", async () => {
        const before = enabledFor(centerId);
        const enabled = checkbox.checked ? [...new Set([...before, mod.id])] : before.filter((id) => id !== mod.id);
        preferences[centerId] = enabled;
        status.textContent = "";
        try {
          const response = await fetch("/api/mods/preferences", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ centerId, enabled })
          });
          if (!response.ok) throw new Error("Speichern fehlgeschlagen");
        } catch {
          if (preferences[centerId] === enabled) preferences[centerId] = before;
          if (center.value === centerId) {
            status.textContent = "Mod-Auswahl konnte nicht gespeichert werden.";
            renderChoices();
          }
        }
      });
      label.append(checkbox, document.createTextNode(mod.name));
      return label;
    }));
  }

  function loadFrame(mod) {
    const frame = document.createElement("iframe");
    frame.title = mod.name;
    frame.hidden = true;
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = `<!doctype html><html lang="de"><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-mod-runtime' blob:; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">
      <main id="mod-root"></main><script nonce="mod-runtime">(${runModFrame.toString()})();<\/script></html>`;
    return new Promise((resolve, reject) => {
      const { port1, port2 } = new MessageChannel();
      const runtime = { ...mod, frame, port: port1, timers: new Map() };
      const fail = (error) => {
        clearTimeout(timer);
        port1.close();
        frame.remove();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error("Start hat zu lange gedauert.")), 4000);
      port1.onmessage = async ({ data }) => {
        if (data?.type === "ready") {
          clearTimeout(timer);
          resolve(runtime);
        } else if (data?.type === "error") {
          fail(new Error(data.error));
        } else if (data?.type === "command" && Number.isSafeInteger(data.id)) {
          let reply;
          try {
            reply = { result: await command(runtime, data.name, data.args) };
          } catch (error) {
            reply = { error: String(error?.message || error) };
          }
          port1.postMessage({ type: "reply", id: data.id, ...reply });
        }
      };
      frame.addEventListener("load", async () => {
        try {
          const response = await fetch(`/api/mods/${mod.id}/entry`, { signal: AbortSignal.timeout(3000) });
          if (!response.ok) throw new Error("main.mjs konnte nicht geladen werden.");
          if (frame.isConnected) frame.contentWindow.postMessage(await response.text(), "*", [port2]);
        } catch (error) {
          fail(error);
        }
      }, { once: true });
      frames.append(frame);
    });
  }

  function usesIncidentPanel(mod) {
    return mod.id === "manv" || mod.incidentPanelOnly === true;
  }

  function canOpenPanel(mod, incidentId, incidents) {
    return !usesIncidentPanel(mod) || incidents.some((incident) =>
      incident.id === incidentId && incident.modId === mod.id);
  }

  function panelName(mod) {
    return mod?.id === "manv" ? "MANV-Übersicht" : mod?.name;
  }

  async function start(centerId) {
    await discover();
    const { selected, unavailable } = selectShiftMods(manifests, enabledFor(centerId), state.center.modScenarios || {});
    const warnings = unavailable
      .map((mod) => `${mod.name} ist für diese ILS aktiviert, aber der Mod fehlt oder ist inkompatibel. Mod-Einsätze bleiben aus.`);
    const results = await Promise.allSettled(selected.map(async (mod) => {
      const [runtime, catalog] = await Promise.all([loadFrame(mod), loadScenarioCatalog(mod)]);
      runtime.catalog = catalog;
      return runtime;
    }));
    results.forEach((result, index) => {
      const mod = selected[index];
      if (result.status === "rejected") {
        warnings.push(`${mod.name} konnte nicht gestartet werden: ${result.reason.message}`);
        return;
      }
      if (mod.scenarioCatalog && result.value.catalog === null) {
        warnings.push(`${mod.name}: Der Mod-Katalog konnte nicht geladen werden. Die automatischen Mod-Einsätze bleiben aus.`);
      }
      active.set(mod.id, result.value);
      if (usesIncidentPanel(mod)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = mod.name;
      button.addEventListener("click", () => openPanel(mod.id));
      menu.append(button);
    });
    menu.hidden = !menu.childElementCount;
    return warnings;
  }

  async function loadScenarioCatalog(mod) {
    if (!mod.scenarioCatalog) return [];
    try {
      const response = await fetch(modScenarioCatalogUrl(mod.id), { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const catalog = await response.json();
      return Array.isArray(catalog) ? catalog.filter((entry) => entry?.id && ["emergency", "transport"].includes(entry.type)) : null;
    } catch {
      return null;
    }
  }

  function begin() {
    inShift = true;
    lastMinute = Math.floor(state.absoluteMinute);
    for (const runtime of active.values()) {
      if (runtime.catalog?.length) {
        runtime.takeDue = createModScenarioSchedule(state.center.modScenarios?.[runtime.id], lastMinute);
      }
    }
    emit("shift.started", { centerId: state.center.id, minute: state.absoluteMinute });
    dispatchScheduledScenarios(lastMinute);
  }

  function stop() {
    inShift = false;
    for (const entry of hospitalHolds.values()) {
      for (const timeout of entry.leases.values()) if (timeout) cancelScheduledTimeout(timeout);
    }
    hospitalHolds.clear();
    for (const runtime of active.values()) {
      for (const { timeout } of runtime.timers.values()) cancelScheduledTimeout(timeout);
      runtime.timers.clear();
      runtime.port.close();
    }
    active.clear();
    if (dialog.open) dialog.close();
    frames.replaceChildren();
    menu.replaceChildren();
    menu.hidden = true;
  }

  function openPanel(id, incidentId = null) {
    const runtime = active.get(id);
    if (!runtime || !canOpenPanel(runtime, incidentId, state.incidents)) return;
    for (const mod of active.values()) mod.frame.hidden = mod !== runtime;
    title.textContent = panelName(runtime);
    if (!dialog.open) showDialog(dialog);
    emit("panel.opened", { incidentId }, id);
  }

  function panelLabel(id) {
    const name = panelName(active.get(id));
    return name ? `${name} öffnen` : "Mod-Ansicht öffnen";
  }

  function adminTestScenarios() {
    if (!inShift || !canUseAdvancedAdmin()) return [];
    return [...active.values()].flatMap((runtime) => (runtime.catalog || [])
      .filter((template) => incidentTemplateWeight(template) === 0)
      .map((template) => ({ label: template.title || template.keyword, start: () => {
        if (!inShift || !canUseAdvancedAdmin() || active.get(runtime.id) !== runtime) throw new Error("Der Mod ist in dieser Schicht nicht aktiv.");
        return queueCatalogScenario(runtime, template);
      } })));
  }

  function emit(event, payload, modId = null) {
    if (!inShift || !active.size) return;
    for (const [id, runtime] of active) {
      if (!modId || id === modId) runtime.port.postMessage({ type: "event", event, payload });
    }
  }

  function tick() {
    if (!active.size) return;
    const minute = Math.floor(state.absoluteMinute);
    if (minute === lastMinute) return;
    lastMinute = minute;
    emit("clock.minute", { minute });
    dispatchScheduledScenarios(minute);
  }

  function dispatchScheduledScenarios(minute) {
    for (const runtime of active.values()) {
      for (const scheduled of runtime.takeDue?.(minute) || []) {
        if (state.testMode) continue;
        const template = weightedChoice(runtime.catalog.filter((entry) =>
          incidentTemplateWeight(entry) > 0 && templateAvailableAtMinute(entry, scheduled)));
        if (!template) continue;
        try {
          queueCatalogScenario(runtime, template);
        } catch (error) {
          logCall(`${runtime.name}: Mod-Einsatz konnte nicht gestartet werden (${error.message}).`, "warn");
        }
      }
    }
  }

  function incidentEvent(event, incident, payload = {}) {
    if (incident?.modId) emit(event, { incidentId: incident.id, ...payload }, incident.modId);
  }

  function hasHospitalHold(hospitalId) {
    return hospitalHolds.has(hospitalId);
  }

  function isHospitalReadyFromHold(hospitalId) {
    return hospitalHolds.get(hospitalId)?.ready === true;
  }

  function holdHospital(incident, hospital, seconds) {
    const entry = hospitalHolds.get(hospital.id) || { leases: new Map(), ready: false };
    if (entry.leases.has(incident.id)) return false;
    hospitalHolds.set(hospital.id, entry);
    const ready = () => {
      const wasUnavailable = hospitalIsUnavailable(hospital);
      entry.leases.set(incident.id, null);
      entry.ready = true;
      incidentEvent("hospital.ready", incident, { hospitalId: hospital.id });
      if (wasUnavailable) queueHospitalAvailabilityNotice(hospital, false);
      renderAll();
    };
    if (seconds > 0 && !entry.ready) entry.leases.set(incident.id, scheduleTimeout(ready, simulationDelay(seconds / 60)));
    else ready();
    return true;
  }

  function releaseHospitalHolds(incidentId, hospitalId = null) {
    let removed = false;
    for (const hospital of state.center.hospitals) {
      if (hospitalId !== null && hospital.id !== hospitalId) continue;
      const entry = hospitalHolds.get(hospital.id);
      if (!entry?.leases.has(incidentId)) continue;
      const wasUnavailable = hospitalIsUnavailable(hospital);
      const timeout = entry.leases.get(incidentId);
      if (timeout) cancelScheduledTimeout(timeout);
      entry.leases.delete(incidentId);
      if (!entry.leases.size) hospitalHolds.delete(hospital.id);
      if (wasUnavailable !== hospitalIsUnavailable(hospital)) queueHospitalAvailabilityNotice(hospital, true);
      removed = true;
    }
    return removed;
  }

  function describeVehicle(vehicle) {
    return { id: vehicle.id, name: vehicle.name, type: vehicle.type, status: vehicle.status,
      statusText: vehicle.statusText,
      incidentId: vehicle.incidentId || vehicle.nextIncidentId || null, patientId: vehicle.patientId || null,
      nextIncidentId: vehicle.nextIncidentId || null,
      queued: Boolean(vehicle.nextIncidentId),
      supportGroupId: vehicle.supportGroupId || null, role: vehicle.modRole?.name || null,
      clearPending: Boolean(vehicle.pendingClearRequest),
      radioBusy: Boolean(vehicle.radioStatus || vehicle.pendingClearRequest || ["mod-report", "mod-clinic"].includes(vehicle.radioContext)),
      clinicCall: vehicle.radioStatus === 5 && vehicle.radioContext === "mod-clinic",
      transportId: vehicle.modTransportOrder?.id ?? vehicle.modEscortTransportId ?? null, lat: vehicle.lat, lng: vehicle.lng,
      available: [1, 2].includes(vehicle.status) && isAlarmable(vehicle) };
  }

  function simulationSecond() {
    const now = state.paused ? state.pauseStartedAt : Date.now();
    return state.absoluteMinute * 60 + Math.max(0, (now ?? state.lastClockTick) - state.lastClockTick) * state.speed / 1000;
  }

  function snapshot(modId) {
    return {
      centerId: state.center.id,
      mapCenter: state.center.mapCenter,
      centerConfig: normalizeModScenarioConfig(state.center.modScenarios?.[modId]),
      minute: state.absoluteMinute,
      paused: state.paused,
      second: simulationSecond(),
      vehicles: state.vehicles.map(describeVehicle),
      hospitals: state.center.hospitals.map((hospital) => ({
        id: hospital.id, name: hospital.label, departments: hospital.departments || [], available: !hospitalIsUnavailable(hospital),
        held: hasHospitalHold(hospital.id), pediatricOnly: Boolean(hospital.pediatricOnly),
        lat: hospital.lat, lng: hospital.lng, foreign: Boolean(hospital.foreign)
      })),
      groups: (state.center.supportGroups || []).map((group) => {
        const dispatch = state.supportGroupStates[group.id];
        return { id: group.id, name: supportGroupDisplayName(group), kind: supportGroupKind(group), status: dispatch?.status || "bereit",
          incidentId: dispatch?.incidentId || null, pending: dispatch?.pending || 0,
          vehicles: dispatch?.activeVehicleIds || [], vehicleTypes: supportGroupUnits(group).map((unit) => unit.type) };
      }),
      incidents: state.incidents.filter((incident) => incident.modId === modId).map((incident) => ({
        id: incident.id, keyword: incident.keyword, scenarioId: incident.modScenarioId, scenario: incident.modScenario,
        status: incident.status, lat: incident.lat, lng: incident.lng, location: incident.location,
        assigned: incident.assigned, required: incident.required, services: incident.services,
        transports: incident.assigned.map((id) => state.vehicles.find((unit) => unit.id === id))
          .filter((unit) => unit?.incidentId === incident.id && unit.modTransportOrder)
          .map((unit) => ({ ...unit.modTransportOrder, vehicleId: unit.id, status: unit.status })),
        patients: incident.patient.patients.map((patient) => ({
          id: patient.id, label: patient.label,
          assigned: patient.assignedVehicles, transporting: Boolean(patient.transporting), completed: Boolean(patient.completed)
        }))
      }))
    };
  }

  const cleanText = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

  function vehicleTypes(types) {
    if (!Array.isArray(types) || types.length > 100 || !types.every((type) => typeof type === "string"
        && /^(RTW|KTW|NEF|VEF|REF|ITW|RTH|ITH|ELRD|LNA|ORGL|UG-SANEL|GW-SAN|HVO|FR)$/.test(type))) {
      throw new Error("Ungültige Fahrzeugtypen.");
    }
    return types;
  }

  function queueCall(modId, args) {
    const keyword = cleanText(args.keyword, 150);
    const callerText = cleanText(args.callerText, 2000);
    if (!keyword || !callerText || !validId(args.scenarioId)) throw new Error("Stichwort, Anruftext und Szenario-ID sind erforderlich.");
    const [lat, lng] = args.lat === undefined && args.lng === undefined ? state.center.mapCenter : [args.lat, args.lng];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !pointInsideServiceArea(lat, lng)) {
      throw new Error("Einsatzort liegt außerhalb des Einsatzgebiets.");
    }
    const id = makeId();
    queueIncomingCall({ id, keyword, callerText, callerName: cleanText(args.callerName, 80) || "Anrufer",
      type: args.type === "transport" ? "transport" : "emergency", required: vehicleTypes(args.required ?? []),
      signal: args.signal === true, lat, lng,
      location: cleanText(args.location, 200) || `${args.lat === undefined ? "Kartenmitte" : "Einsatzort"} · ${defaultLocationLabel()}`,
      modId, modScenarioId: args.scenarioId });
    return id;
  }

  function queueCatalogScenario(runtime, template) {
    const call = callFromIncidentTemplate(template, { modId: runtime.id, modScenarioId: template.id });
    const locationLabel = cleanText(template.call?.locationLabel, 120);
    if (runtime.scenarioResources?.length) {
      const rules = runtime.scenarioResources;
      const controlled = new Set(rules.flatMap((rule) => rule.types));
      call.required = [
        ...(Array.isArray(call.required) ? call.required.filter((type) => !controlled.has(type)) : []),
        ...rules.filter((rule) => !rule.field || template.modData?.[rule.field] !== false).flatMap((rule) => rule.types)
      ];
    }
    if (!call.callerText?.trim()) throw new Error("Anruftext fehlt.");
    call.modScenario = {
      id: template.id, title: template.title, variantId: call.variantId, variantLabel: call.variantLabel,
      report: call.report, situationReport: call.situationReport, assistanceReason: call.assistanceReason,
      patients: call.patients || [], data: template.modData ?? null
    };
    keepCallInsideCoverage(call);
    if (locationLabel) call.location = locationLabel;
    else updateCallAddressFromNearestSource(call);
    queueIncomingCall(call);
    if (!locationLabel) void reverseGeocodeCall(call);
    return call.id;
  }

  function preparePatient(incident, args, existing) {
    const departments = args.departments ?? existing?.requiredDepartmentKeys ?? ["internal"];
    if (!Array.isArray(departments) || !departments.length || departments.length > 12
        || !departments.every((key) => (window.departmentCatalog || []).some((entry) => entry.key === key))) {
      throw new Error("Ungültige Fachrichtungen.");
    }
    const [patient] = normalizePatients({ patients: [{
      id: args.patientId, label: cleanText(args.label, 90) || existing?.label || `Patient ${incident.patient.patients.length + 1}`,
      required: vehicleTypes(args.required ?? existing?.required ?? ["RTW"]), requiredDepartmentKeys: departments,
      conditionReport: args.report === undefined ? existing?.conditionReport || "" : cleanText(args.report, 500),
      transportNeeded: (args.transportNeeded ?? existing?.transportNeeded) !== false
    }] }, "internal");
    return patient;
  }

  async function command(runtime, name, args = {}) {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Ungültige Parameter.");
    if (name === "state.get") return snapshot(runtime.id);
    if (!inShift || active.get(runtime.id) !== runtime) throw new Error("Mod ist noch nicht in einer laufenden Schicht aktiv.");
    if (name === "storage.get" || name === "storage.set") {
      const url = `/api/mods/${runtime.id}/data?center=${encodeURIComponent(state.center.id)}`;
      const response = await fetch(url, name === "storage.get" ? { cache: "no-store" } : {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: args.value })
      });
      if (!response.ok) throw new Error("Mod-Daten konnten nicht gelesen oder gespeichert werden.");
      return (await response.json()).value;
    }
    if (name === "call.queue") return queueCall(runtime.id, args);
    if (name === "scenario.list") return runtime.catalog || [];
    if (name === "call.queueScenario") {
      const template = runtime.catalog?.find((entry) => entry.id === args.scenarioId);
      if (!template) throw new Error("Szenario ist im Mod-Katalog nicht verfügbar.");
      return queueCatalogScenario(runtime, template);
    }
    const incident = state.incidents.find((item) => item.id === args.incidentId && item.modId === runtime.id);
    if (name === "clock.after") {
      if (!validId(args.timerId) || !Number.isFinite(args.seconds) || args.seconds <= 0 || args.seconds > 86400
          || runtime.timers.size >= 500 || runtime.timers.has(args.timerId)
          || (args.incidentId != null && (!incident || incident.status === "geschlossen"))) {
        throw new Error("Ungültiger Mod-Termin.");
      }
      const timeout = scheduleTimeout(() => {
        runtime.timers.delete(args.timerId);
        if (!incident || incident.status !== "geschlossen") {
          emit("clock.timer", { timerId: args.timerId, incidentId: incident?.id ?? null, second: simulationSecond() }, runtime.id);
        }
      }, simulationDelay(args.seconds / 60));
      runtime.timers.set(args.timerId, { timeout, incidentId: incident?.id });
      return args.timerId;
    }
    if (name === "clock.cancel") {
      const timer = runtime.timers.get(args.timerId);
      if (!timer) return false;
      cancelScheduledTimeout(timer.timeout);
      return runtime.timers.delete(args.timerId);
    }
    if (!incident || incident.status === "geschlossen") throw new Error("Kein offener Einsatz dieses Mods.");
    const vehicle = state.vehicles.find((item) => item.id === args.vehicleId);
    const atScene = vehicle?.incidentId === incident.id && vehicle.status === 4;
    const patient = incident.patient.patients.find((item) => item.id === args.patientId);
    const vehicleHasTransportRequest = Boolean(vehicle?.pendingTransportRequest)
      || Boolean(vehicle && activeTransportRequests(incident).some((request) => request.vehicleId === vehicle.id));
    let result = true;
    switch (name) {
      case "incident.disposition":
        if (dialog.open) dialog.close();
        openIncidentDialog(incident, { showSupportGroups: args.supportGroups === true });
        return true;
      case "incident.requirements":
        incident.required = incident.patient.requiredVehicles = requiredVehiclesForCenter(vehicleTypes(args.required));
        break;
      case "incident.patientCount":
        if (!Number.isInteger(args.count) || args.count < 0 || args.count > 250) throw new Error("Ungültige Patientenzahl.");
        incident.reportedPatientCount = args.count;
        renderIncidents();
        return true;
      case "incident.attention": {
        if (!Array.isArray(args.items) || args.items.length > 12 || args.items.some((item) => typeof item !== "string")) {
          throw new Error("Ungültiger Handlungsbedarf.");
        }
        if (args.openClinicTargets !== undefined
            && (!Number.isInteger(args.openClinicTargets) || args.openClinicTargets < 0 || args.openClinicTargets > 250)) {
          throw new Error("Ungültige Anzahl offener Klinikziele.");
        }
        incident.modAttention = args.items.map((item) => cleanText(item, 120)).filter(Boolean);
        if (args.openClinicTargets !== undefined) incident.modClinicTargets = args.openClinicTargets;
        if (args.openClinicTargets === 0) {
          for (const unit of state.vehicles) {
            if (unit.incidentId === incident.id && unit.radioContext === "mod-clinic" && unit.radioStatus === 5) expireRadioDisplay(unit.id, 5);
          }
        }
        renderDispatchQueue();
        renderIncidents();
        return true;
      }
      case "incident.close":
        if (incidentHasOpenPatients(incident) || state.vehicles.some((unit) => unit.incidentId === incident.id
            && (unit.status === 7 || unit.modTransportOrder || unit.modEscortTransportId))) {
          throw new Error("Patienten oder Fahrzeugaufträge sind noch offen.");
        }
        {
          const pending = state.vehicles.filter((unit) => canRemoveAssignedVehicle(unit, incident));
          if (pending.length && args.cancelPendingResponses !== true) throw new Error("Fahrzeugaufträge sind noch offen.");
          for (const unit of pending) {
            if (!unit.supportGroupId || state.supportGroupStates[unit.supportGroupId]?.incidentId !== incident.id) {
              removeAssignedVehicle(unit.id, incident.id, { refreshDialog: false });
            }
          }
        }
        incident.modCloseApproved = true;
        closeIncidentIfAllPatientsDone(incident);
        releaseHospitalHolds(incident.id);
        for (const [id, timer] of runtime.timers) {
          if (timer.incidentId !== incident.id) continue;
          cancelScheduledTimeout(timer.timeout);
          runtime.timers.delete(id);
        }
        break;
      case "patient.add":
        if (!validId(args.patientId) || patient || incident.patient.patients.length >= 250) {
          throw new Error("Patienten-ID ist ungültig oder bereits belegt.");
        }
        incident.patient.patients.push(preparePatient(incident, args));
        incident.patient.patientCount = incident.patient.patients.length;
        incident.patient.status = "in Behandlung";
        result = args.patientId;
        break;
      case "patient.update": {
        if (!patient || patient.completed || patient.transporting || patient.pendingTransportVehicleId) {
          throw new Error("Patient kann nicht geändert werden.");
        }
        const update = preparePatient(incident, args, patient);
        for (const field of ["label", "required", "requiredDepartment", "requiredDepartmentKey", "requiredDepartmentKeys", "conditionReport", "transportNeeded"]) {
          patient[field] = update[field];
        }
        break;
      }
      case "patient.assign":
        if (!atScene || vehicle.modRole || vehicle.pendingClearRequest || !patient || patient.completed || patient.transporting || vehicleHasTransportRequest) {
          throw new Error("Patient oder Fahrzeug ist nicht verfügbar.");
        }
        if (args.carrier === true && (!isTransportVehicle(vehicle.type) || !patientRequiresTransport(patient))) {
          throw new Error("Das Fahrzeug kann keinen Transport übernehmen.");
        }
        releasePatientAssignment(vehicle);
        vehicle.patientId = patient.id;
        patient.assignedVehicles.push(vehicle.id);
        if (args.carrier === true) patient.modCarrierId = vehicle.id;
        break;
      case "patient.complete":
        if (!patient || patient.completed || patient.transporting || patient.pendingTransportVehicleId) {
          throw new Error("Patient kann nicht abgeschlossen werden.");
        }
        finishPatientWithoutTransport(incident, patient, null, cleanText(args.reason, 300) || "Versorgung abgeschlossen", {
          deferClearance: args.deferClearance === true
        });
        break;
      case "vehicle.alarm":
        if (!vehicle || ![1, 2].includes(vehicle.status) || !isAlarmable(vehicle)) {
          throw new Error("Fahrzeug ist nicht verfügbar.");
        }
        assignVehicle(vehicle.id, incident.id);
        return vehicle.nextIncidentId === incident.id;
      case "vehicle.role":
        if (!atScene || vehicle.patientId || vehicleHasTransportRequest || vehicle.pendingClearRequest
            || (args.role !== null && !validId(args.role))) throw new Error("Fahrzeug ist für diese Rolle nicht verfügbar.");
        vehicle.modRole = args.role === null ? null : { incidentId: incident.id, name: args.role };
        break;
      case "vehicle.release":
        if (!atScene || vehicleHasTransportRequest) throw new Error("Fahrzeug kann nicht freigegeben werden.");
        if (vehicle.radioStatus || vehicle.pendingClearRequest) return false;
        vehicle.modRole = null;
        releasePatientAssignment(vehicle);
        requestVehicleClearance(vehicle, incident, cleanText(args.reason, 300) || "Auftrag abgeschlossen", {
          automatic: args.automatic === true
        });
        return Boolean(vehicle.pendingClearRequest);
      case "hospital.hold": {
        const hospital = state.center.hospitals.find((entry) => entry.id === args.hospitalId);
        if (!hospital || !Number.isFinite(args.readyAfterSeconds) || args.readyAfterSeconds < 0 || args.readyAfterSeconds > 86400) {
          throw new Error("Ungültige Klinikfreigabe.");
        }
        result = holdHospital(incident, hospital, args.readyAfterSeconds);
        break;
      }
      case "hospital.release":
        if (args.hospitalId != null && !state.center.hospitals.some((entry) => entry.id === args.hospitalId)) throw new Error("Unbekannte Klinik.");
        result = releaseHospitalHolds(incident.id, args.hospitalId ?? null);
        break;
      case "group.alarm":
        if (!alarmSupportGroup(args.groupId, incident.id)) throw new Error("Gruppe ist nicht verfügbar.");
        return true;
      case "group.release":
        if (state.supportGroupStates[args.groupId]?.incidentId !== incident.id) throw new Error("Gruppe ist diesem Einsatz nicht zugeteilt.");
        standDownSupportGroup(args.groupId, incident.id);
        return true;
      case "radio.log": {
        const message = cleanText(args.message, 500);
        if (!message) throw new Error("Funktext fehlt.");
        logRadio(message, ["urgent", "warn"].includes(args.level) ? args.level : "radio", incident.id);
        return true;
      }
      case "vehicle.report": {
        const message = cleanText(args.message, 500);
        if (!atScene || !message || ![0, 5].includes(args.code) || (args.openPanel === true && args.code !== 5)) {
          throw new Error("Ungültiger Sprechwunsch.");
        }
        if (vehicle.radioStatus || ["mod-report", "mod-clinic"].includes(vehicle.radioContext)
            || vehicle.pendingClearRequest || vehicle.pendingTransportRequest || vehicle.modTransportOrder) return false;
        return triggerRadioStatus(vehicle, args.code, message, {
          context: args.openPanel === true ? "mod-clinic" : "mod-report", ignoreCooldown: true
        });
      }
      case "transport.request":
      case "transport.start": {
        if (!atScene || vehicle.modRole || !patient || vehicle.patientId !== patient.id || patient.completed || patient.transporting
            || !vehicleCanTransportPatient(vehicle, patient)) throw new Error("Patient und Transportfahrzeug passen nicht zusammen.");
        const pending = state.vehicles.some((unit) => unit.pendingTransportRequest?.incidentId === incident.id
          && unit.pendingTransportRequest?.patientId === patient.id);
        if (vehicleHasTransportRequest || pending || activeTransportRequests(incident).some((request) => request.patientId === patient.id)) {
          throw new Error("Es besteht bereits eine Transportanforderung.");
        }
        const supersedesClinicCall = name === "transport.start" && vehicle.radioStatus === 5 && vehicle.radioContext === "mod-clinic";
        if ((vehicle.radioStatus && !supersedesClinicCall) || vehicle.pendingClearRequest) throw new Error("Fahrzeug hat einen offenen Funkauftrag.");
        const hospital = name === "transport.start" ? state.center.hospitals.find((entry) => entry.id === args.hospitalId) : null;
        if (name === "transport.start" && (!hospital || !hospitalSuitableForIncident(hospital, incident, { patientId: patient.id }))) {
          throw new Error("Keine geeignete aufnahmebereite Klinik.");
        }
        if (args.transportId !== undefined && (!hospital || !validId(args.transportId) || incident.modTransportIds?.has(args.transportId))) {
          throw new Error("Transport-ID ist ungültig oder bereits belegt.");
        }
        const escort = args.escortVehicleId == null ? null : state.vehicles.find((unit) => unit.id === args.escortVehicleId);
        if (args.escortVehicleId != null && (!hospital || !escort || escort === vehicle || !isDoctorVehicle(escort.type)
            || escort.status !== 4 || escort.incidentId !== incident.id || escort.modRole || escort.radioStatus
            || escort.pendingClearRequest || escort.pendingTransportRequest
            || activeTransportRequests(incident).some((request) => request.vehicleId === escort.id)
            || (escort.patientId && escort.patientId !== patient.id))) {
          throw new Error("Begleitfahrzeug ist nicht verfügbar.");
        }
        if (supersedesClinicCall) expireRadioDisplay(vehicle.id, 5);
        patient.modTransportApproved = true;
        patient.forceTransportSignal = args.signal === true;
        if (hospital) return Boolean(beginTransport(incident.id, hospital.id, vehicle.id, null, { transportId: args.transportId, escort }));
        else requestTransportDestination(vehicle, incident);
        return true;
      }
      case "transport.retarget": {
        const hospital = state.center.hospitals.find((entry) => entry.id === args.hospitalId);
        const order = vehicle?.modTransportOrder;
        if (!order || order.id !== args.transportId || vehicle.incidentId !== incident.id || vehicle.status !== 7
            || !hospital || !hospitalSuitableForIncident(hospital, incident, { patientId: order.patientId })) {
          throw new Error("Transportauftrag oder neue Zielklinik ist nicht verfügbar.");
        }
        const requestId = changeTransportDestination(vehicle.id);
        return Boolean(requestId && beginTransport(incident.id, hospital.id, vehicle.id, requestId));
      }
      default:
        throw new Error("Unbekannter Mod-Befehl.");
    }
    renderAll();
    return result;
  }

  return {
    discover, renderChoices, start, begin, stop, isActive: (id) => active.has(id), openPanel, panelLabel,
    adminTestScenarios, emit, tick, incidentEvent, hasHospitalHold, isHospitalReadyFromHold
  };
})();
