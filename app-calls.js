function processCallRates() {
  if (state.testMode) {
    state.lastCallRateMinute = Math.floor(state.minute);
    return;
  }
  const currentMinute = Math.floor(state.minute);
  let previous = state.lastCallRateMinute ?? currentMinute;
  if (currentMinute < previous) previous -= 1440;
  const steps = Math.min(60, currentMinute - previous);
  for (let index = 0; index < steps; index += 1) {
    const minute = (previous + index + 1 + 1440) % 1440;
    const events = callEventsForMinute(minute);
    if (events.scheduled && typeof createScheduledIncidentFromRate === "function") {
      createScheduledIncidentFromRate();
    }
    if (events.callType) {
      receiveCall(events.callType);
    }
    if (events.scheduled || events.callType) {
      break;
    }
  }
  state.lastCallRateMinute = currentMinute;
}

function callTypeForMinute(minute) {
  return callEventsForMinute(minute).callType;
}

function callEventsForMinute(minute) {
  const hour = Math.floor(minute / 60);
  const rate = normalizedCallRates(state.center.callRates)[hour];
  const rolls = [
    ["emergency", rate.emergency],
    ["transport", rate.transport]
  ].filter(([, value]) => Math.random() < Math.max(0, Number(value) || 0) / 60);
  return {
    callType: rolls.length ? rolls.sort((a, b) => b[1] - a[1])[0][0] : null,
    scheduled: Math.random() < Math.max(0, Number(rate.scheduled) || 0) / 60
  };
}

function receiveCall(forcedType = null) {
  if (forcedType === "scheduled") {
    if (typeof createScheduledIncidentFromRate === "function") createScheduledIncidentFromRate();
    return;
  }
  const templates = availableCallTemplates();
  if (!templates.length) {
    logCall("Kein Einsatzkatalog geladen. Bitte Einsatzeditor oder incidents-data.json pruefen.", "warn");
    return;
  }
  let templateIndex = weightedCallTemplateIndex(forcedType);
  if (templateIndex < 0) {
    logCall("Kein passender Telefon-Einsatz im Katalog gefunden.", "warn");
    return;
  }
  if (templates.length > 1 && templateIndex === state.lastCallTemplateIndex) {
    templateIndex = (templateIndex + randomInt(1, templates.length - 1)) % templates.length;
  }
  state.lastCallTemplateIndex = templateIndex;
  const template = resolveTemplateLocation(normalizeIncidentTemplate(templates[templateIndex]));
  const call = {
    ...template,
    id: makeId(),
    receivedAtMinute: state.minute,
    receivedAtAbsoluteMinute: state.absoluteMinute,
    answered: false,
    location: template.location || defaultLocationLabel(),
    lat: Number.isFinite(template.lat) ? template.lat : state.center.mapCenter[0],
    lng: Number.isFinite(template.lng) ? template.lng : state.center.mapCenter[1]
  };
  keepCallInsideCoverage(call);
  updateCallAddressFromNearestSource(call);
  queueIncomingCall(call);
  reverseGeocodeCall(call);
}

function queueIncomingCall(call, options = {}) {
  if (!call) return;
  call.id ||= makeId();
  call.receivedAtMinute ??= state.minute;
  call.receivedAtAbsoluteMinute ??= state.absoluteMinute;
  call.answered ??= false;
  const queue = pendingCallQueue();
  if (!queue.some((item) => item.id === call.id)) queue.push(call);
  if (!state.pendingCall) state.pendingCall = call;
  playPhoneRing();
  logCall(options.message || `Neuer Telefonanruf${queue.length > 1 ? ` (${queue.length} wartend)` : ""}.`, "warn");
  updateCallControls();
}

function pendingCallQueue() {
  if (!Array.isArray(state.pendingCalls)) state.pendingCalls = [];
  if (state.pendingCall && !state.pendingCalls.some((call) => call.id === state.pendingCall.id)) {
    state.pendingCalls.unshift(state.pendingCall);
  }
  return state.pendingCalls;
}

function activePendingCall() {
  const queue = pendingCallQueue();
  if (state.pendingCall && queue.some((call) => call.id === state.pendingCall.id)) return state.pendingCall;
  state.pendingCall = queue[0] || null;
  return state.pendingCall;
}

function setActivePendingCall(callId) {
  const call = pendingCallQueue().find((item) => item.id === callId) || null;
  state.pendingCall = call;
  updateCallControls();
  return call;
}

function removePendingCall(callId) {
  const queue = pendingCallQueue();
  const index = queue.findIndex((call) => call.id === callId);
  const removed = index >= 0 ? queue.splice(index, 1)[0] : null;
  if (state.pendingCall?.id === callId) state.pendingCall = queue[0] || null;
  updateCallControls();
  return removed;
}

function completePendingCall(callId) {
  return removePendingCall(callId);
}

function updateCallControls() {
  const queue = pendingCallQueue();
  const active = activePendingCall();
  const busy = el.callDispositionDialog?.open || el.incidentDialog?.open;
  el.answerButton.disabled = !active || busy;
  el.forwardButton.disabled = !active || busy;
  el.answerButton.classList.toggle("pending-call-alert", queue.length > 0 && !busy);
  renderPendingCallActions();
}

function answerCall() {
  const call = activePendingCall();
  if (!call) return;
  call.answered = true;
  call.answeredAtMinute ??= state.minute;
  if (!call.callLogShown) {
    logCall(`${call.callerName}: ${call.callerText}`, "call");
    logCall(`Einsatzort genannt: ${call.location}.`, "call");
    call.callLogShown = true;
  }
  renderCallDisposition();
  showDialog(el.callDispositionDialog);
  updateCallControls();
}

function renderCallDisposition() {
  const call = activePendingCall();
  if (!call) return;
  const tag = callTypeTag(call.type);
  el.callDispositionText.innerHTML = `
    <section class="call-disposition-summary">
      <span class="call-type">${escapeHtml(tag)}</span>
      <h3>${escapeHtml(call.callerName || "Anrufer")}</h3>
      <p class="call-location">${escapeHtml(call.location || defaultLocationLabel())}</p>
      <p>${escapeHtml(call.callerText || "")}</p>
    </section>
  `;
}

function handleCallDispositionClosed() {
  if (!activePendingCall() || el.incidentDialog.open) return;
  updateCallControls();
}

function renderPendingCallActions() {
  if (!el.callActions) return;
  const queue = pendingCallQueue();
  const active = activePendingCall();
  el.callActions.innerHTML = "";
  if (!queue.length) {
    const empty = document.createElement("span");
    empty.className = "call-queue-empty";
    empty.textContent = state.testMode
      ? "Testbetrieb aktiv: automatische Anrufe pausiert. Nutze Neuer Anruf."
      : "Keine wartenden Anrufe.";
    el.callActions.append(empty);
    return;
  }

  const summary = document.createElement("strong");
  summary.className = "call-queue-summary";
  summary.textContent = queue.length === 1 ? "1 Anruf wartet" : `${queue.length} Anrufe warten`;
  el.callActions.append(summary);

  queue.forEach((call, index) => {
    const item = document.createElement("div");
    item.className = `call-queue-item${call.id === active?.id ? " active" : ""}`;
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "call-queue-select";
    selectButton.innerHTML = `
      <strong>${index + 1}. ${escapeHtml(callTypeTag(call.type))} ${escapeHtml(call.callerName || "Anrufer")}</strong>
      <span>${escapeHtml(call.location || defaultLocationLabel())}</span>
    `;
    selectButton.addEventListener("click", () => {
      setActivePendingCall(call.id);
      if (call.answered) {
        renderCallDisposition();
        showDialog(el.callDispositionDialog);
        updateCallControls();
      }
    });

    const answerButton = document.createElement("button");
    answerButton.type = "button";
    answerButton.className = "call-queue-answer";
    if (!call.answered) answerButton.classList.add("pending-call-alert");
    answerButton.textContent = call.answered ? "Disponieren" : "Annehmen";
    answerButton.addEventListener("click", () => {
      setActivePendingCall(call.id);
      answerCall();
    });

    const rejectButton = document.createElement("button");
    rejectButton.type = "button";
    rejectButton.textContent = "Ablehnen";
    rejectButton.addEventListener("click", () => rejectPendingCall(call.id));

    const mapButton = document.createElement("button");
    mapButton.type = "button";
    mapButton.textContent = "Karte";
    mapButton.addEventListener("click", () => {
      setActivePendingCall(call.id);
      showPendingCallOnMap();
    });

    item.append(selectButton, answerButton, rejectButton, mapButton);
    el.callActions.append(item);
  });
}

function rejectPendingCall(callId = state.pendingCall?.id) {
  if (typeof callId !== "string") callId = state.pendingCall?.id;
  const wasActive = state.pendingCall?.id === callId;
  const call = callId ? removePendingCall(callId) : null;
  if (!call) return;
  logCall("Anruf abgelehnt.", "warn");
  if (wasActive && el.callDispositionDialog.open) el.callDispositionDialog.close();
  updateCallControls();
}

function referPendingCall(service) {
  const call = activePendingCall();
  if (!call) return;
  const labels = { FW: "Feuerwehr", POL: "Polizei", AEND: "Aerztlichen Notdienst" };
  logCall(`Anruf an ${labels[service] || service} verwiesen.`, "warn");
  removePendingCall(call.id);
  el.callDispositionDialog.close();
  updateCallControls();
}

function forwardCall() {
  const call = activePendingCall();
  if (!call) return;
  logCall("Anruf beendet oder weitergeleitet.", "warn");
  removePendingCall(call.id);
  if (el.callDispositionDialog.open) el.callDispositionDialog.close();
  updateCallControls();
}

function weightedCallTemplateIndex(forcedType = null) {
  const roll = Math.random();
  const wantedType = forcedType || (roll < .75 ? "emergency" : "transport");
  const templates = availableCallTemplates();
  if (!templates.length) return -1;
  const candidates = templates
    .map((template, index) => ({ template, index }))
    .filter((item) => item.template.type === wantedType);
  const fallback = templates
    .map((template, index) => ({ template, index }))
    .filter((item) => item.template.type !== "scheduled");
  const pool = candidates.length ? candidates : fallback;
  if (!pool.length) return -1;
  return pool[Math.floor(Math.random() * pool.length)].index;
}

function availableCallTemplates() {
  const catalog = Array.isArray(state.incidentCatalog) ? state.incidentCatalog : [];
  return catalog.filter((template) => templateAvailableAtMinute(template, state.minute));
}

function templateAvailableAtMinute(template, minute) {
  const windows = templateTimeWindows(template);
  if (!windows.length) return true;
  const current = Math.floor(minute) % 1440;
  return windows.some((window) => timeWindowContainsMinute(window, current));
}

function templateTimeWindows(template) {
  const raw = template?.timeWindows || template?.variants?.[0]?.timeWindows || [];
  if (typeof raw === "string") return parseRuntimeTimeWindows(raw);
  if (!Array.isArray(raw)) return [];
  return raw.map((window) => {
    if (typeof window === "string") return parseRuntimeTimeWindow(window);
    return normalizeRuntimeTimeWindow(window?.start, window?.end);
  }).filter(Boolean);
}

function parseRuntimeTimeWindows(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((part) => parseRuntimeTimeWindow(part))
    .filter(Boolean);
}

function parseRuntimeTimeWindow(value) {
  const [start, end] = String(value || "").split("-").map((item) => item.trim());
  return normalizeRuntimeTimeWindow(start, end);
}

function normalizeRuntimeTimeWindow(start, end) {
  const startMinute = runtimeTimeToMinute(start);
  const endMinute = runtimeTimeToMinute(end);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute === endMinute) return null;
  return { startMinute, endMinute };
}

function runtimeTimeToMinute(value) {
  const [hourText, minuteText = "0"] = String(value || "").trim().split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return NaN;
  return ((hour % 24) * 60) + minute;
}

function timeWindowContainsMinute(window, minute) {
  if (window.startMinute < window.endMinute) return minute >= window.startMinute && minute < window.endMinute;
  return minute >= window.startMinute || minute < window.endMinute;
}
