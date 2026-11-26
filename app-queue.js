const DISPATCH_QUEUE_RANK = {
  urgentRadio: 0,
  emergencyCall: 1,
  emergencyDispatch: 2,
  destination: 3,
  transportCall: 4,
  otherDispatch: 5,
  routineRadio: 6,
  acknowledgment: 7
};

function dispatchQueueItems() {
  const items = [];
  const callBusy = el.callDispositionDialog.open || el.incidentDialog.open || el.transportDestinationDialog?.open;
  for (const call of pendingCallQueue()) {
    const number = callTypeTag(call.type);
    items.push({
      key: `call-${call.id}`,
      id: call.id,
      kind: "call",
      priority: call.noticeOnly ? DISPATCH_QUEUE_RANK.acknowledgment : number === "112" ? DISPATCH_QUEUE_RANK.emergencyCall : DISPATCH_QUEUE_RANK.transportCall,
      since: call.receivedAtAbsoluteMinute,
      label: call.noticeOnly ? "19222 · Meldung" : `${number} · ${call.answered ? "Anruf angenommen" : "Anruf wartet"}`,
      detail: [call.callerName, call.noticeOnly ? call.callerText : call.location].filter(Boolean).join(" · "),
      action: call.noticeOnly ? "Quittieren" : call.answered ? "Disponieren" : "Annehmen",
      disabled: Boolean(callBusy)
    });
  }
  for (const vehicle of vehiclesWithRadioAlerts()) {
    const code = vehicle.radioStatus;
    items.push({
      key: `radio-${vehicle.id}`,
      id: vehicle.id,
      kind: code === 0 ? "urgent" : "radio",
      priority: code === 0 ? DISPATCH_QUEUE_RANK.urgentRadio : code === 5 ? DISPATCH_QUEUE_RANK.routineRadio : DISPATCH_QUEUE_RANK.acknowledgment,
      label: code === 0 ? "Status 0 · Dringender Sprechwunsch" : code === 5 ? "Status 5 · Sprechwunsch" : "Status 6 · Quittierung",
      detail: vehicle.shortName || vehicle.name,
      action: code === 6 ? "Quittieren" : "Funk annehmen"
    });
  }
  for (const incident of state.incidents) {
    if (incident.status === "geschlossen") continue;
    const tnaRequestedAt = tna.requestTime(incident);
    if (tnaRequestedAt !== null) {
      items.push({
        key: `tna-${incident.id}`, id: incident.id, kind: "tna",
        priority: DISPATCH_QUEUE_RANK.emergencyDispatch, since: tnaRequestedAt,
        label: "TNA angefordert", detail: incident.keyword, action: "Verbinden", disabled: callBusy
      });
    }
    const noDisposition = !incidentHasDisposition(incident);
    const request = incident.assistanceDecision;
    const openRequest = openReportedAssistanceNeeds(incident);
    if (noDisposition || openRequest.length) {
      const vehicles = noDisposition ? missingVehicleTypesForDispatch(incident) : openRequest.filter((type) => !["FW", "POL"].includes(type));
      const services = noDisposition ? missingExternalServices(incident) : openRequest.filter((type) => ["FW", "POL"].includes(type));
      items.push({
        key: `dispatch-${incident.id}`,
        id: incident.id,
        kind: "dispatch",
        priority: incidentListBucket(incident) === "emergency" ? DISPATCH_QUEUE_RANK.emergencyDispatch : DISPATCH_QUEUE_RANK.otherDispatch,
        since: noDisposition ? incident.createdAtAbsoluteMinute : request.createdAtAbsoluteMinute ?? incident.createdAtAbsoluteMinute,
        label: noDisposition ? "Disposition offen" : "Nachforderung",
        detail: [incident.keyword, vehicles.length || services.length ? formatDisposition(vehicles, services) : incident.location].filter(Boolean).join(" · "),
        action: noDisposition ? "Disponieren" : "Nachalarmieren",
        disabled: Boolean(callBusy)
      });
    }
    if (incident.modAttention?.length) {
      items.push({
        key: `module-${incident.id}`, id: incident.id, modId: incident.modId, kind: "module",
        priority: DISPATCH_QUEUE_RANK.emergencyDispatch, since: incident.createdAtAbsoluteMinute,
        label: incident.keyword, detail: incident.modAttention.join(" · "), action: "Öffnen",
        disabled: Boolean(callBusy)
      });
    }
    if (incident.modClinicTargets > 0) {
      items.push({
        key: `module-clinic-${incident.id}`, id: incident.id, modId: incident.modId, kind: "module",
        priority: DISPATCH_QUEUE_RANK.destination, since: incident.createdAtAbsoluteMinute,
        label: incident.modClinicTargets === 1 ? "Klinikziel offen" : `${incident.modClinicTargets} Klinikziele offen`,
        detail: incident.keyword, action: "Zuweisen", disabled: Boolean(callBusy)
      });
    }
    const requests = activeTransportRequests(incident);
    if (!requests.length) continue;
    items.push({
      key: `destination-${incident.id}`,
      id: incident.id,
      kind: "destination",
      priority: DISPATCH_QUEUE_RANK.destination,
      since: incident.createdAtAbsoluteMinute,
      label: requests.length === 1 ? "Zielklinik offen" : `${requests.length} Zielkliniken offen`,
      detail: [incident.keyword, ...new Set(requests.map((request) => request.requiredDepartment).filter(Boolean))].filter(Boolean).join(" · "),
      action: "Zuweisen",
      disabled: Boolean(el.transportDestinationDialog?.open)
    });
  }
  return items.sort((left, right) => left.priority - right.priority
    || (left.since ?? Number.MAX_SAFE_INTEGER) - (right.since ?? Number.MAX_SAFE_INTEGER));
}

function renderDispatchQueue() {
  const list = el.dispatchQueueList;
  if (!list) return;
  const items = dispatchQueueItems();
  const signature = JSON.stringify(items);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const firstPriorityChanged = list.dataset.firstKey !== (items[0]?.key || "");
  list.dataset.firstKey = items[0]?.key || "";
  const rows = items.map((item) => {
    const row = document.createElement("li");
    row.dataset.kind = item.kind;
    const copy = document.createElement("div");
    copy.title = [item.label, item.detail].filter(Boolean).join(" · ");
    const title = document.createElement("strong");
    title.textContent = item.label;
    const detail = document.createElement("span");
    detail.textContent = item.detail;
    copy.append(title, detail);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.itemKey = item.key;
    button.textContent = item.action;
    button.setAttribute("aria-label", [item.action, item.label, item.detail].filter(Boolean).join(" · "));
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => {
      if (item.kind === "call") {
        if (setActivePendingCall(item.id)) answerCall();
      } else if (item.kind === "destination") {
        openTransportDestinationDialog(item.id);
        renderDispatchQueue();
      } else if (item.kind === "dispatch") {
        openIncidentDialog(item.id);
      } else if (item.kind === "tna") {
        tna.connect(item.id);
      } else if (item.kind === "module") {
        if (item.key.startsWith("module-clinic-")) {
          const incident = state.incidents.find((entry) => entry.id === item.id);
          if (incident) {
            selectIncidentFromMapOrList(incident);
            renderAll();
          }
        }
        appMods.openPanel(item.modId, item.id);
      } else {
        sendSpeechPrompt(item.id);
      }
    });
    row.append(copy, button);
    return row;
  });
  list.replaceChildren(...rows);
  list.hidden = !items.length;
  el.dispatchQueueEmpty.hidden = Boolean(items.length);
  el.dispatchQueueScroll.hidden = items.length < 2;
  if (firstPriorityChanged && !focused) list.scrollLeft = 0;
  const count = items.length === 1 ? "1 offene Aufgabe" : items.length ? `${items.length} offene Aufgaben` : "Keine offenen Aufgaben";
  if (el.dispatchQueueCount.textContent !== String(items.length)) {
    el.dispatchQueueCount.textContent = String(items.length);
    el.dispatchQueueCount.setAttribute("aria-label", count);
  }
  updateDispatchBadge(el.mobileQueueCount, items.length, items[0]?.kind === "urgent");
  if (focused) {
    const buttons = [...list.querySelectorAll("button:not(:disabled)")];
    const next = buttons.find((button) => button.dataset.itemKey === focused.dataset.itemKey) || buttons[0];
    (next || el.dispatchQueue).focus({ preventScroll: true });
  }
}

function scrollDispatchQueue(direction) {
  const list = el.dispatchQueueList;
  list.scrollBy({ left: direction * Math.max(100, list.clientWidth * .85) });
}
