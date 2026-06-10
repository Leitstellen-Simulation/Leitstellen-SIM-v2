function unitName(id) {
  return state.vehicles.find((unit) => unit.id === id)?.name || id;
}

function clearLogs() {
  el.callLog.innerHTML = "";
  el.radioLog.innerHTML = "";
  el.callActions.innerHTML = "";
}

function logCall(message, kind = "call") {
  appendLog(el.callLog, message, kind);
}

function logRadio(message, kind = "radio") {
  playLoggedStatusTone(message);
  appendLog(el.radioLog, message, kind);
}

function appendLog(container, message, kind) {
  const entry = document.createElement("article");
  entry.className = `log-entry ${kind} ${logToneClass(message)}`;
  const paragraph = document.createElement("p");
  const time = document.createElement("strong");
  time.textContent = timeLabel();
  paragraph.append(time, " ");
  appendLogFormattedText(paragraph, message, kind);
  entry.append(paragraph);
  container.prepend(entry);
}

function appendLogFormattedText(parent, message, kind) {
  const text = String(message);
  const prefix = text.match(/^([^:]+):\s*(.*)$/);
  if (prefix && shouldBoldLogPrefix(prefix[1], kind)) {
    const unit = document.createElement("strong");
    unit.textContent = `${prefix[1]}:`;
    parent.append(unit, " ");
    appendStatusFormattedText(parent, prefix[2]);
    return;
  }
  appendStatusFormattedText(parent, text);
}

function shouldBoldLogPrefix(prefix, kind) {
  if (kind === "call") return false;
  return (state.vehicles || []).some((vehicle) => vehicle.name === prefix || vehicle.shortName === prefix);
}

function appendStatusFormattedText(parent, message) {
  const parts = String(message).split(/(Status\s+\d+)/g);
  parts.forEach((part) => {
    if (!part) return;
    if (/^Status\s+\d+$/.test(part)) {
      const strong = document.createElement("strong");
      strong.textContent = part;
      parent.append(strong);
    } else {
      parent.append(part);
    }
  });
}

function logToneClass(message) {
  if (message.includes("Status 0")) return "radio-critical";
  if (message.includes("Nachforderung")) return "radio-critical";
  if (message.includes("Sprechwunsch") || message.includes("Sprechaufforderung")) return "radio-speech";
  if (/Status\s+[1-8]/.test(message)) return "radio-status";
  if (message.includes("Neuer Einsatz") || message.includes("Neuer Telefonanruf")) return "radio-new";
  return "";
}

function playLoggedStatusTone(message) {
  const match = String(message || "").match(/Status\s+([0-8])/);
  if (!match || typeof playStatusTone !== "function") return;
  playStatusTone(Number(match[1]));
}

function appendTextBlock(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
}

function timeLabel() {
  const displayMinute = Math.floor(state.minute);
  const hours = String(Math.floor(displayMinute / 60)).padStart(2, "0");
  const minutes = String(displayMinute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function distanceToIncident(vehicle, incident) {
  const lat = Number.isFinite(incident.lat) ? incident.lat : state.center.mapCenter[0];
  const lng = Number.isFinite(incident.lng) ? incident.lng : state.center.mapCenter[1];
  return mapDistance(vehicle.lat, vehicle.lng, lat, lng);
}

function distanceToCall(vehicle, call) {
  const lat = Number.isFinite(call.lat) ? call.lat : state.center.mapCenter[0];
  const lng = Number.isFinite(call.lng) ? call.lng : state.center.mapCenter[1];
  return mapDistance(vehicle.lat, vehicle.lng, lat, lng);
}

function mapDistance(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function makeId() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function showDialog(dialog) {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function showFloatingDialog(dialog, options = {}) {
  if (!dialog) return;
  if (dialog.open) return;
  if (typeof dialog.show === "function") dialog.show();
  else dialog.setAttribute("open", "");
  dialog.classList.add("floating-dialog");
  positionFloatingDialog(dialog, options);
}

function positionFloatingDialog(dialog, options = {}) {
  const card = dialog?.querySelector(".modal-card");
  if (!dialog || !card) return;
  const width = Math.min(
    options.width || dialog.dataset.floatingWidth || dialog.getBoundingClientRect().width || 820,
    window.innerWidth - 28
  );
  dialog.style.width = `${Math.max(320, width)}px`;
  card.style.width = "100%";
  card.style.maxWidth = "100%";
  card.style.left = "";
  card.style.top = "";
  card.classList.remove("draggable-modal");

  const anchor = options.anchorSelector || options.anchor
    ? options.anchor || document.querySelector(options.anchorSelector)
    : null;
  const anchorRect = anchor?.getBoundingClientRect() || {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight
  };
  const dialogRect = dialog.getBoundingClientRect();
  const estimatedHeight = Math.min(
    dialogRect.height || card.getBoundingClientRect().height || 520,
    window.innerHeight - 28
  );
  const left = Math.max(14, Math.min(window.innerWidth - width - 14, anchorRect.left + (anchorRect.width - width) / 2));
  const top = Math.max(14, Math.min(window.innerHeight - estimatedHeight - 14, anchorRect.top + (anchorRect.height - estimatedHeight) / 2));
  dialog.style.left = `${left}px`;
  dialog.style.top = `${top}px`;
}

function makeDialogDraggable(dialog) {
  const card = dialog?.querySelector(".modal-card");
  const header = dialog?.querySelector(".modal-header");
  if (!card || !header) return;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  header.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    const rect = card.getBoundingClientRect();
    dragging = true;
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    card.classList.add("draggable-modal");
    card.style.width = `${rect.width}px`;
    card.style.maxWidth = `${rect.width}px`;
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    card.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, event.clientX - offsetX))}px`;
    card.style.top = `${Math.max(8, Math.min(window.innerHeight - 60, event.clientY - offsetY))}px`;
  });
  header.addEventListener("pointerup", () => {
    dragging = false;
  });
  header.addEventListener("pointercancel", () => {
    dragging = false;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
