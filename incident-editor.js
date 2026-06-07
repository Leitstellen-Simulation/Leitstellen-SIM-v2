const state = {
  incidents: [],
  current: null,
  savedIncidentId: null,
  dirty: false,
  selectedVariantId: null,
  selectedPatientId: null,
  selectedPoiCategories: new Set(),
  selectedDestinationPoiCategories: new Set()
};

const el = Object.fromEntries([
  "search", "type-filter", "count", "list", "new", "save", "duplicate", "delete", "editor-title",
  "id", "title", "category", "type", "weight", "time-windows",
  "caller-name", "caller-text", "location-mode", "location-road-types-row", "poi-category-search", "poi-categories", "poi-selected",
  "poi-select-visible", "poi-clear", "poi-category-count", "poi-ids",
  "destination-mode", "destination-poi-probability-row", "destination-poi-probability",
  "destination-poi-category-search", "destination-poi-categories", "destination-poi-selected",
  "destination-poi-select-visible", "destination-poi-clear", "destination-poi-category-count", "destination-poi-ids",
  "ai-mode", "ai-variations", "ai-prompt", "ai-generate", "ai-status",
  "add-variant", "variant-list", "current-variant-title", "remove-variant",
  "variant-label", "variant-weight", "variant-report", "variant-situation-report", "variant-fw", "variant-pol", "variant-signal", "variant-no-elrd",
  "add-patient", "patient-list", "patient-label", "patient-options", "patient-condition-report", "departments",
  "patient-acuity", "patient-signal", "patient-no-transport", "patient-no-transport-text", "patient-doctor-required",
  "patient-reanimation-case", "patient-fw", "patient-pol", "save-patient", "remove-patient"
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#ie-${id}`)]));

init();

async function init() {
  await loadIncidents();
  bindEvents();
  renderDepartmentChecks(el.departments);
  if (state.incidents.length) editIncident(state.incidents[0]);
  else newIncident();
  renderList();
}

function bindEvents() {
  el.search.addEventListener("input", renderList);
  el.type_filter.addEventListener("change", renderList);
  el.new.addEventListener("click", newIncident);
  el.save.addEventListener("click", saveIncident);
  el.duplicate.addEventListener("click", duplicateIncident);
  el.delete.addEventListener("click", deleteCurrentIncident);
  el.location_mode.addEventListener("change", updateLocationPoiControls);
  document.querySelectorAll("input[name='ie-location-road-types']").forEach((input) => input.addEventListener("change", markDirty));
  el.destination_mode.addEventListener("change", updateDestinationPoiControls);
  el.destination_poi_probability.addEventListener("input", updateDestinationPoiControls);
  el.poi_category_search.addEventListener("input", () => renderPoiCategorySelect());
  el.poi_select_visible.addEventListener("click", selectVisiblePoiCategories);
  el.poi_clear.addEventListener("click", clearPoiCategories);
  el.destination_poi_category_search.addEventListener("input", () => renderDestinationPoiCategorySelect());
  el.destination_poi_select_visible.addEventListener("click", selectVisibleDestinationPoiCategories);
  el.destination_poi_clear.addEventListener("click", clearDestinationPoiCategories);
  el.ai_generate.addEventListener("click", generateAiIncident);
  el.add_variant.addEventListener("click", addVariant);
  el.remove_variant.addEventListener("click", removeSelectedVariant);
  el.save_patient.addEventListener("click", syncSelectedPatient);
  el.remove_patient.addEventListener("click", removeSelectedPatient);
  el.add_patient.addEventListener("click", addPatient);
  document.addEventListener("input", markDirtyFromEditor);
  document.addEventListener("change", markDirtyFromEditor);
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function loadIncidents() {
  try {
    const response = await fetch("/api/incidents");
    const data = response.ok ? await response.json() : [];
    state.incidents = Array.isArray(data) ? data.map(toDynamicIncident) : [];
  } catch {
    state.incidents = [];
  }
}

function newIncident() {
  if (!confirmDiscardUnsavedChanges()) return;
  state.current = createEmptyIncident();
  state.savedIncidentId = null;
  state.selectedVariantId = state.current.variants[0].id;
  state.selectedPatientId = state.current.variants[0].patients[0].id;
  fillFormFromCurrent();
  markClean();
  renderEverything();
}

function createEmptyIncident() {
  return {
    schemaVersion: 2,
    id: `dyn-${Date.now()}`,
    category: "Sonstiges",
    title: "Neuer Einsatz",
    keyword: "Neuer Einsatz",
    type: "emergency",
    weight: 1,
    timeWindows: [],
    call: {
      callerName: "Anrufer",
      callerText: "",
      locationMode: "random",
      poiCategories: [],
      poiIds: [],
      destinationMode: "none",
      destinationPoiProbability: 0,
      destinationPoiCategories: [],
      destinationPoiIds: []
    },
    variants: [createEmptyVariant()]
  };
}

function createEmptyVariant() {
  return {
    id: `var-${Date.now()}-${randomToken()}`,
    label: "Neue Variante",
    weight: 1,
    report: "",
    situationReport: "",
    requiredServices: [],
    signal: false,
    noElrd: false,
    patients: [createEmptyPatient()]
  };
}

function createEmptyPatient() {
  return {
    id: `pat-${Date.now()}-${randomToken()}`,
    label: "Pat 1",
    options: [{ probability: 1, vehicles: ["RTW"] }],
    requiredDepartmentKeys: ["internal"],
    conditionReport: "",
    transportSignalProbability: 0,
    noTransportProbability: 0,
    noTransportText: "Ambulante Versorgung ausreichend, kein Transport.",
    requiresDoctorAccompaniment: false,
    reanimationCase: false,
    needsFW: false,
    needsPOL: false
  };
}

function editIncident(incident) {
  state.current = toDynamicIncident(incident);
  state.savedIncidentId = state.current.id || null;
  state.selectedVariantId = state.current.variants[0]?.id || null;
  state.selectedPatientId = selectedVariant()?.patients?.[0]?.id || null;
  fillFormFromCurrent();
  markClean();
  renderEverything();
}

function fillFormFromCurrent() {
  const incident = state.current || createEmptyIncident();
  const call = incident.call || {};
  el.editor_title.textContent = incident.title || "Neuer Einsatz";
  el.id.value = incident.id || "";
  el.title.value = incident.title || "";
  el.category.value = incident.category || "Sonstiges";
  el.type.value = incident.type || "emergency";
  el.weight.value = formatWeight(incident.weight);
  el.time_windows.value = formatTimeWindows(incident.timeWindows || []);
  el.caller_name.value = call.callerName || "Anrufer";
  el.caller_text.value = call.callerText || "";
  el.location_mode.value = call.locationMode || "random";
  setSelectedLocationRoadTypes(call.locationRoadTypes || (call.locationMode === "road" ? ["urban", "rural", "motorway"] : []));
  setSelectedPoiCategories(call.poiCategories || []);
  el.poi_ids.value = (call.poiIds || []).join(", ");
  el.destination_mode.value = call.destinationMode || "none";
  el.destination_poi_probability.value = Math.round((Number(call.destinationPoiProbability) || 0) * 100);
  setSelectedDestinationPoiCategories(call.destinationPoiCategories || []);
  el.destination_poi_ids.value = (call.destinationPoiIds || []).join(", ");
  updateLocationPoiControls();
  updateDestinationPoiControls();
}

function collectFormIntoCurrent() {
  if (!state.current) state.current = createEmptyIncident();
  syncSelectedVariant();
  syncSelectedPatient({ silent: true });
  const title = el.title.value.trim() || "Neuer Einsatz";
  state.current.schemaVersion = 2;
  state.current.id = makeId(el.id.value || title || Date.now());
  state.current.title = title;
  state.current.keyword = title;
  state.current.category = el.category.value;
  state.current.type = el.type.value;
  state.current.weight = parseWeight(el.weight.value);
  state.current.timeWindows = parseTimeWindows(el.time_windows.value);
  state.current.call = {
    callerName: el.caller_name.value.trim() || "Anrufer",
    callerText: el.caller_text.value.trim(),
    locationMode: el.location_mode.value,
    locationRoadTypes: selectedLocationRoadTypes(),
    poiCategories: selectedPoiCategories(),
    poiIds: splitList(el.poi_ids.value),
    destinationMode: el.destination_mode.value,
    destinationPoiProbability: el.destination_mode.value === "poi" ? 1 : clampPercent(el.destination_poi_probability.value),
    destinationPoiCategories: selectedDestinationPoiCategories(),
    destinationPoiIds: splitList(el.destination_poi_ids.value)
  };
  return state.current;
}

async function saveIncident() {
  const incident = collectFormIntoCurrent();
  const index = state.incidents.findIndex((item) => item.id === (state.savedIncidentId || incident.id));
  if (index >= 0) state.incidents[index] = structuredCloneSafe(incident);
  else state.incidents.unshift(structuredCloneSafe(incident));
  await fetch("/api/incidents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.incidents)
  });
  state.savedIncidentId = incident.id;
  editIncident(incident);
  markClean();
  setAiStatus("Gespeichert.", "ok");
}

function duplicateIncident() {
  const source = collectFormIntoCurrent();
  const copy = structuredCloneSafe(source);
  copy.id = makeId(`${copy.id || copy.title}-kopie-${Date.now()}`);
  copy.title = `${copy.title || "Einsatz"} Kopie`;
  copy.keyword = copy.title;
  state.current = copy;
  state.savedIncidentId = null;
  fillFormFromCurrent();
  markDirty();
  renderEverything();
}

async function deleteCurrentIncident() {
  const current = state.current;
  if (!current?.id) return;
  const existingIndex = state.incidents.findIndex((incident) => incident.id === (state.savedIncidentId || current.id));
  const title = current.title || current.keyword || "diesen Einsatz";
  if (existingIndex < 0) {
    if (!confirm("Dieser Einsatz ist noch nicht gespeichert. Verwerfen?")) return;
    markClean();
    if (state.incidents.length) editIncident(state.incidents[0]);
    else newIncident();
    return;
  }
  if (!confirm(`Einsatz "${title}" wirklich löschen?`)) return;
  state.incidents.splice(existingIndex, 1);
  await fetch("/api/incidents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.incidents)
  });
  setAiStatus("Gelöscht.", "ok");
  markClean();
  if (state.incidents.length) editIncident(state.incidents[Math.max(0, existingIndex - 1)]);
  else newIncident();
}

function markDirtyFromEditor(event) {
  if (!event.target?.closest?.(".dynamic-main-panel, .dynamic-variant-panel")) return;
  markDirty();
}

function markDirty() {
  state.dirty = true;
  updateDirtyIndicator();
}

function markClean() {
  state.dirty = false;
  updateDirtyIndicator();
}

function updateDirtyIndicator() {
  if (!el.editor_title) return;
  const title = state.current?.title || "Neuer Einsatz";
  el.editor_title.textContent = `${state.dirty ? "* " : ""}${title}`;
  el.save.classList.toggle("attention-save", Boolean(state.dirty));
}

function confirmDiscardUnsavedChanges() {
  if (!state.dirty) return true;
  return confirm("Es gibt ungespeicherte Änderungen. Wirklich verwerfen?");
}

function renderEverything() {
  renderList();
  renderVariantList();
  fillVariantEditor();
  renderPatientList();
  fillPatientEditor();
}

function renderList() {
  const query = normalizeSearch(el.search.value);
  const typeFilter = el.type_filter.value;
  const filtered = state.incidents.filter((incident) => {
    const text = normalizeSearch(`${incident.title || ""} ${incident.keyword || ""} ${incident.category || ""}`);
    return (!query || text.includes(query)) && (!typeFilter || incident.type === typeFilter);
  });
  el.count.textContent = `${filtered.length} / ${state.incidents.length} Einsätze`;
  el.list.innerHTML = "";
  filtered.forEach((incident) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `dynamic-incident-row ${state.current?.id === incident.id ? "active" : ""}`;
    const variants = Array.isArray(incident.variants) ? incident.variants.length : 0;
    const patients = (incident.variants || []).reduce((sum, variant) => sum + (variant.patients || []).length, 0);
    row.innerHTML = `
      <strong>${escapeHtml(incident.title || incident.keyword || "Einsatz")}</strong>
      <span>${escapeHtml(incident.category || incident.type || "")} | ${escapeHtml(incident.type || "")}</span>
      <small>${variants} Varianten | ${patients} Patientenprofile | Faktor ${escapeHtml(formatWeight(incident.weight))}</small>
    `;
    row.addEventListener("click", () => {
      if (!confirmDiscardUnsavedChanges()) return;
      editIncident(incident);
    });
    el.list.append(row);
  });
}

function renderVariantList() {
  el.variant_list.innerHTML = "";
  (state.current?.variants || []).forEach((variant, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `variant-chip ${variant.id === state.selectedVariantId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(variant.label || `Variante ${index + 1}`)}</strong>
      <span>Gewicht ${escapeHtml(formatWeight(variant.weight))} | ${(variant.patients || []).length} Pat</span>
    `;
    button.addEventListener("click", () => selectVariant(variant.id));
    el.variant_list.append(button);
  });
}

function selectVariant(variantId) {
  syncSelectedVariant();
  syncSelectedPatient({ silent: true });
  state.selectedVariantId = variantId;
  state.selectedPatientId = selectedVariant()?.patients?.[0]?.id || null;
  renderEverything();
}

function addVariant() {
  syncSelectedVariant();
  const variant = createEmptyVariant();
  variant.label = `Variante ${(state.current?.variants || []).length + 1}`;
  state.current.variants.push(variant);
  state.selectedVariantId = variant.id;
  state.selectedPatientId = variant.patients[0].id;
  markDirty();
  renderEverything();
}

function removeSelectedVariant() {
  if (!state.current?.variants?.length || state.current.variants.length <= 1) return;
  state.current.variants = state.current.variants.filter((variant) => variant.id !== state.selectedVariantId);
  state.selectedVariantId = state.current.variants[0]?.id || null;
  state.selectedPatientId = selectedVariant()?.patients?.[0]?.id || null;
  markDirty();
  renderEverything();
}

function fillVariantEditor() {
  const variant = selectedVariant();
  el.current_variant_title.textContent = variant?.label || "Keine Variante";
  el.variant_label.value = variant?.label || "";
  el.variant_weight.value = formatWeight(variant?.weight ?? 1);
  el.variant_report.value = variant?.report || "";
  el.variant_situation_report.value = variant?.situationReport || "";
  el.variant_fw.checked = (variant?.requiredServices || []).includes("FW");
  el.variant_pol.checked = (variant?.requiredServices || []).includes("POL");
  el.variant_signal.checked = Boolean(variant?.signal);
  el.variant_no_elrd.checked = Boolean(variant?.noElrd);
}

function syncSelectedVariant() {
  const variant = selectedVariant();
  if (!variant) return;
  variant.label = el.variant_label.value.trim() || variant.label || "Variante";
  variant.weight = parseWeight(el.variant_weight.value);
  variant.report = el.variant_report.value.trim();
  variant.situationReport = el.variant_situation_report.value.trim();
  variant.requiredServices = [el.variant_fw.checked ? "FW" : null, el.variant_pol.checked ? "POL" : null].filter(Boolean);
  variant.signal = el.variant_signal.checked;
  variant.noElrd = el.variant_no_elrd.checked;
}

function renderPatientList() {
  el.patient_list.innerHTML = "";
  const patients = selectedVariant()?.patients || [];
  patients.forEach((patient, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `patient-chip ${patient.id === state.selectedPatientId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(patient.label || `Pat ${index + 1}`)}</strong>
      <span>${escapeHtml(optionSummary(patient.options))} | ${escapeHtml(departmentLabels(patient.requiredDepartmentKeys || [patient.requiredDepartmentKey]))}</span>
    `;
    button.addEventListener("click", () => selectPatient(patient.id));
    el.patient_list.append(button);
  });
}

function selectPatient(patientId) {
  syncSelectedPatient({ silent: true });
  state.selectedPatientId = patientId;
  renderPatientList();
  fillPatientEditor();
}

function addPatient() {
  syncSelectedPatient({ silent: true });
  const variant = selectedVariant();
  if (!variant) return;
  const patient = createEmptyPatient();
  patient.label = `Pat ${(variant.patients || []).length + 1}`;
  variant.patients ||= [];
  variant.patients.push(patient);
  state.selectedPatientId = patient.id;
  markDirty();
  renderEverything();
}

function removeSelectedPatient() {
  const variant = selectedVariant();
  if (!variant?.patients?.length || variant.patients.length <= 1) return;
  variant.patients = variant.patients.filter((patient) => patient.id !== state.selectedPatientId);
  state.selectedPatientId = variant.patients[0]?.id || null;
  markDirty();
  renderEverything();
}

function fillPatientEditor() {
  const patient = selectedPatient();
  el.patient_label.value = patient?.label || "";
  el.patient_options.value = formatOptions(patient?.options || []);
  el.patient_acuity.value = patient?.acuity || "stable";
  el.patient_condition_report.value = patient?.conditionReport || "";
  renderDepartmentChecks(el.departments, patient?.requiredDepartmentKeys || [patient?.requiredDepartmentKey || "internal"]);
  el.patient_signal.value = Math.round((Number(patient?.transportSignalProbability) || 0) * 100);
  el.patient_no_transport.value = Math.round((Number(patient?.noTransportProbability) || 0) * 100);
  el.patient_no_transport_text.value = patient?.noTransportText || "";
  el.patient_doctor_required.checked = Boolean(patient?.requiresDoctorAccompaniment);
  el.patient_reanimation_case.checked = Boolean(patient?.reanimationCase);
  el.patient_fw.checked = Boolean(patient?.needsFW);
  el.patient_pol.checked = Boolean(patient?.needsPOL);
}

function syncSelectedPatient(options = {}) {
  const patient = selectedPatient();
  if (!patient) return;
  patient.label = el.patient_label.value.trim() || patient.label || "Pat";
  patient.options = parseOptions(el.patient_options.value);
  patient.acuity = el.patient_acuity.value;
  patient.conditionReport = el.patient_condition_report.value.trim();
  patient.requiredDepartmentKeys = selectedDepartments(el.departments);
  patient.transportSignalProbability = clampPercent(el.patient_signal.value);
  patient.noTransportProbability = clampPercent(el.patient_no_transport.value);
  patient.noTransportText = el.patient_no_transport_text.value.trim() || "Ambulante Versorgung ausreichend, kein Transport.";
  patient.requiresDoctorAccompaniment = el.patient_doctor_required.checked;
  patient.reanimationCase = el.patient_reanimation_case.checked;
  patient.needsFW = el.patient_fw.checked;
  patient.needsPOL = el.patient_pol.checked;
  if (!options.silent) {
    renderPatientList();
  }
}

async function generateAiIncident() {
  if (!confirmDiscardUnsavedChanges()) return;
  const prompt = el.ai_prompt.value.trim();
  if (prompt.length < 8) {
    setAiStatus("Bitte erst eine Beschreibung eingeben.", "error");
    return;
  }
  el.ai_generate.disabled = true;
  setAiStatus("KI generiert Einsatz...", "pending");
  try {
    const mode = el.ai_mode.value;
    const variationCount = Math.max(1, Math.min(6, Math.round(Number(el.ai_variations.value) || 1)));
    const response = await fetch("/api/generate-incident", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, mode, variationCount })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "KI-Generierung fehlgeschlagen.");
    const generated = Array.isArray(data.incidents) && data.incidents.length ? data.incidents : [data.incident].filter(Boolean);
    const dynamic = combineGeneratedIncidents(generated, prompt, mode);
    editIncident(dynamic);
    markDirty();
    setAiStatus(`${dynamic.variants.length} Variante(n) übernommen. Bitte prüfen und speichern.`, "ok");
  } catch (error) {
    setAiStatus(error.message || "KI-Generierung fehlgeschlagen.", "error");
  } finally {
    el.ai_generate.disabled = false;
  }
}

function combineGeneratedIncidents(incidents, prompt, mode) {
  const dynamicItems = incidents.map(toDynamicIncident).filter(Boolean);
  const base = dynamicItems[0] || createEmptyIncident();
  const variants = dynamicItems.flatMap((incident) => (incident.variants || []).map((variant) => ({
    incident,
    variant
  })));
  base.id = makeId(base.id || `ki-${prompt}-${Date.now()}`);
  base.type = mode;
  const usedLabels = new Set();
  base.variants = variants.length ? variants.map(({ incident, variant }, index) => ({
    ...variant,
    id: `var-${index + 1}-${randomToken()}`,
    label: uniqueGeneratedVariantLabel(variant.label || incident.title, index, usedLabels)
  })) : [createEmptyVariant()];
  return base;
}

function uniqueGeneratedVariantLabel(label, index, usedLabels) {
  const trimmed = String(label || "").trim();
  const generic = !trimmed || /^(variante|variation)\s*\d+$/i.test(trimmed);
  const baseLabel = generic ? `Variation ${index + 1}` : trimmed;
  let candidate = baseLabel;
  let suffix = 2;
  while (usedLabels.has(candidate.toLowerCase())) {
    candidate = `${baseLabel} (${suffix})`;
    suffix += 1;
  }
  usedLabels.add(candidate.toLowerCase());
  return candidate;
}

function setAiStatus(message, tone = "neutral") {
  el.ai_status.textContent = message;
  el.ai_status.className = `inline-hint ai-status ai-status-${tone}`;
}

function selectedVariant() {
  return (state.current?.variants || []).find((variant) => variant.id === state.selectedVariantId) || state.current?.variants?.[0] || null;
}

function selectedPatient() {
  return (selectedVariant()?.patients || []).find((patient) => patient.id === state.selectedPatientId) || selectedVariant()?.patients?.[0] || null;
}

function toDynamicIncident(input) {
  if (!input || typeof input !== "object") return createEmptyIncident();
  if (Number(input.schemaVersion) >= 2 || input.call) return sanitizeDynamicIncident(input);
  return legacyIncidentToDynamic(input);
}

function sanitizeDynamicIncident(input) {
  const incident = structuredCloneSafe(input);
  incident.schemaVersion = 2;
  incident.id ||= makeId(incident.title || incident.keyword || Date.now());
  incident.title ||= incident.keyword || "Einsatz";
  incident.keyword ||= incident.title;
  incident.category ||= "Sonstiges";
  incident.type ||= "emergency";
  incident.weight = parseWeight(incident.weight);
  incident.timeWindows = normalizeTimeWindowsArray(incident.timeWindows || []);
  incident.call = {
    callerName: incident.call?.callerName || "Anrufer",
    callerText: incident.call?.callerText || incident.callerText || "",
    locationMode: incident.call?.locationMode || "random",
    locationRoadTypes: listValue(incident.call?.locationRoadTypes),
    poiCategories: listValue(incident.call?.poiCategories),
    poiIds: listValue(incident.call?.poiIds),
    destinationMode: incident.call?.destinationMode || "none",
    destinationPoiProbability: clampRuntimeProbability(incident.call?.destinationPoiProbability),
    destinationPoiCategories: listValue(incident.call?.destinationPoiCategories),
    destinationPoiIds: listValue(incident.call?.destinationPoiIds)
  };
  incident.variants = Array.isArray(incident.variants) && incident.variants.length
    ? incident.variants.map((variant, index) => sanitizeVariant(variant, index))
    : [createEmptyVariant()];
  return incident;
}

function legacyIncidentToDynamic(input) {
  const variants = Array.isArray(input.variants) && input.variants.length ? input.variants : [input];
  const first = variants[0] || {};
  return sanitizeDynamicIncident({
    schemaVersion: 2,
    id: input.id || makeId(input.title || input.keyword || Date.now()),
    category: input.category || "Sonstiges",
    title: input.title || input.keyword || "Einsatz",
    keyword: input.keyword || input.title || "Einsatz",
    type: input.type || first.type || "emergency",
    weight: input.weight ?? 1,
    timeWindows: input.timeWindows || first.timeWindows || [],
    call: {
      callerName: first.callerName || input.callerName || "Anrufer",
      callerText: first.callerText || input.callerText || "",
      locationMode: first.locationMode || input.locationMode || "random",
      locationRoadTypes: first.locationRoadTypes || input.locationRoadTypes || [],
      poiCategories: first.poiCategories || input.poiCategories || [],
      poiIds: first.poiIds || input.poiIds || [],
      destinationMode: first.destinationMode || input.destinationMode || "none",
      destinationPoiProbability: first.destinationPoiProbability || input.destinationPoiProbability || 0,
      destinationPoiCategories: first.destinationPoiCategories || input.destinationPoiCategories || [],
      destinationPoiIds: first.destinationPoiIds || input.destinationPoiIds || []
    },
    variants: variants.map((variant, index) => ({
      id: variant.id || `var-${index + 1}`,
      label: variant.label || variant.keyword || `Variante ${index + 1}`,
      weight: variant.weight ?? 1,
      report: variant.report || "",
      situationReport: variant.situationReport || "",
      requiredServices: variant.requiredServices || [],
      signal: Boolean(variant.signal),
      noElrd: Boolean(variant.noElrd),
      patients: variant.patients || []
    }))
  });
}

function sanitizeVariant(variant, index) {
  return {
    id: variant.id || `var-${index + 1}-${randomToken()}`,
    label: variant.label || variant.title || variant.keyword || `Variante ${index + 1}`,
    weight: parseWeight(variant.weight),
    report: variant.report || "",
    situationReport: variant.situationReport || "",
    requiredServices: listValue(variant.requiredServices).filter((item) => ["FW", "POL"].includes(item)),
    signal: Boolean(variant.signal),
    noElrd: Boolean(variant.noElrd),
    patients: Array.isArray(variant.patients) && variant.patients.length
      ? variant.patients.map((patient, patientIndex) => sanitizePatient(patient, patientIndex))
      : [createEmptyPatient()]
  };
}

function sanitizePatient(patient, index) {
  return {
    id: patient.id || `pat-${index + 1}-${randomToken()}`,
    label: patient.label || `Pat ${index + 1}`,
    options: normalizeOptions(patient.options || patient.required || patient.vehicles),
    acuity: patient.acuity || "stable",
    requiredDepartmentKeys: listValue(patient.requiredDepartmentKeys || patient.requiredDepartmentKey || ["internal"]),
    conditionReport: patient.conditionReport || patient.patientCondition || patient.report || "",
    transportSignalProbability: clampRuntimeProbability(patient.transportSignalProbability),
    noTransportProbability: clampRuntimeProbability(patient.noTransportProbability),
    noTransportText: patient.noTransportText || "Ambulante Versorgung ausreichend, kein Transport.",
    requiresDoctorAccompaniment: Boolean(patient.requiresDoctorAccompaniment),
    reanimationCase: Boolean(patient.reanimationCase),
    needsFW: Boolean(patient.needsFW),
    needsPOL: Boolean(patient.needsPOL),
    recommendedVehicles: listValue(patient.recommendedVehicles).map((item) => item.toUpperCase()).filter((item) => ["HVO", "FR"].includes(item))
  };
}

function renderDepartmentChecks(container, selected = []) {
  const selectedSet = new Set(selected.filter(Boolean));
  container.innerHTML = "";
  (window.departmentCatalog || []).forEach((department) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(department.key)}"> ${escapeHtml(department.label)}`;
    const input = label.querySelector("input");
    input.checked = selectedSet.has(department.key) || (!selected.length && department.key === "internal");
    container.append(label);
  });
}

function selectedDepartments(container) {
  return [...container.querySelectorAll("input:checked")].map((input) => input.value);
}

function setSelectedPoiCategories(selected = []) {
  state.selectedPoiCategories = new Set((selected || []).filter(Boolean));
  renderPoiCategorySelect();
}

function renderPoiCategorySelect() {
  renderPoiSelect({
    queryInput: el.poi_category_search,
    container: el.poi_categories,
    selectedContainer: el.poi_selected,
    count: el.poi_category_count,
    selectedSet: state.selectedPoiCategories
  });
}

function selectedPoiCategories() {
  return [...state.selectedPoiCategories];
}

function selectVisiblePoiCategories() {
  el.poi_categories.querySelectorAll("input[type='checkbox']").forEach((input) => state.selectedPoiCategories.add(input.value));
  markDirty();
  renderPoiCategorySelect();
}

function clearPoiCategories() {
  state.selectedPoiCategories.clear();
  markDirty();
  renderPoiCategorySelect();
}

function setSelectedDestinationPoiCategories(selected = []) {
  state.selectedDestinationPoiCategories = new Set((selected || []).filter(Boolean));
  renderDestinationPoiCategorySelect();
}

function renderDestinationPoiCategorySelect() {
  renderPoiSelect({
    queryInput: el.destination_poi_category_search,
    container: el.destination_poi_categories,
    selectedContainer: el.destination_poi_selected,
    count: el.destination_poi_category_count,
    selectedSet: state.selectedDestinationPoiCategories
  });
}

function selectedDestinationPoiCategories() {
  return [...state.selectedDestinationPoiCategories];
}

function selectVisibleDestinationPoiCategories() {
  el.destination_poi_categories.querySelectorAll("input[type='checkbox']").forEach((input) => state.selectedDestinationPoiCategories.add(input.value));
  markDirty();
  renderDestinationPoiCategorySelect();
}

function clearDestinationPoiCategories() {
  state.selectedDestinationPoiCategories.clear();
  markDirty();
  renderDestinationPoiCategorySelect();
}

function renderPoiSelect({ queryInput, container, selectedContainer, count, selectedSet }) {
  const query = normalizeSearch(queryInput?.value || "");
  container.innerHTML = "";
  const matches = (window.poiCategoryCatalog || [])
    .filter((category) => !query || normalizeSearch(`${category.id || category.key} ${category.label}`).includes(query));
  matches.slice(0, 80).forEach((category) => {
    const value = category.id || category.key;
    const label = document.createElement("label");
    label.className = "poi-select-chip";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(value)}"><span>${escapeHtml(category.label)}</span>`;
    const input = label.querySelector("input");
    input.checked = selectedSet.has(value);
    input.addEventListener("change", () => {
      if (input.checked) selectedSet.add(value);
      else selectedSet.delete(value);
      markDirty();
      renderPoiCategorySelect();
      renderDestinationPoiCategorySelect();
    });
    container.append(label);
  });
  count.textContent = `${matches.length} Treffer${matches.length > 80 ? " - Suche eingrenzen" : ""}`;
  selectedContainer.innerHTML = "";
  if (!selectedSet.size) {
    selectedContainer.textContent = "Keine Kategorien ausgewählt.";
    return;
  }
  [...selectedSet].forEach((value) => {
    const category = (window.poiCategoryCatalog || []).find((item) => (item.id || item.key) === value);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "selected-chip";
    chip.textContent = `${category?.label || value} x`;
    chip.addEventListener("click", () => {
      selectedSet.delete(value);
      markDirty();
      renderPoiCategorySelect();
      renderDestinationPoiCategorySelect();
    });
    selectedContainer.append(chip);
  });
}

function updateDestinationPoiControls() {
  const isFixedPoiTarget = el.destination_mode.value === "poi";
  const isHomeTarget = el.destination_mode.value === "home";
  el.destination_poi_probability.disabled = isFixedPoiTarget || isHomeTarget;
  el.destination_poi_probability.value = isFixedPoiTarget ? 100 : (isHomeTarget ? 0 : (el.destination_poi_probability.value || 0));
  el.destination_poi_probability_row.classList.toggle("disabled-field", isFixedPoiTarget || isHomeTarget);
  const probability = clampPercent(el.destination_poi_probability.value);
  const showPoiTargetControls = isFixedPoiTarget || (!isHomeTarget && probability > 0);
  setHidden(el.destination_poi_category_search?.closest(".multi-select-box"), !showPoiTargetControls);
  setHidden(el.destination_poi_ids?.closest("label"), !showPoiTargetControls);
}

function updateLocationPoiControls() {
  const showPoiControls = el.location_mode.value === "poi";
  setHidden(el.location_road_types_row, el.location_mode.value !== "road");
  setHidden(el.poi_category_search?.closest(".multi-select-box"), !showPoiControls);
  setHidden(el.poi_ids?.closest("label"), !showPoiControls);
}

function selectedLocationRoadTypes() {
  if (el.location_mode.value !== "road") return [];
  const selected = [...document.querySelectorAll("input[name='ie-location-road-types']:checked")].map((input) => input.value);
  return selected.length ? selected : ["urban", "rural", "motorway"];
}

function setSelectedLocationRoadTypes(values = []) {
  const selected = new Set((Array.isArray(values) ? values : String(values || "").split(/[,;|]/))
    .map((value) => String(value).trim()).filter(Boolean));
  document.querySelectorAll("input[name='ie-location-road-types']").forEach((input) => {
    input.checked = selected.has(input.value);
  });
}

function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

function parseOptions(value, allowEmpty = false) {
  const text = Array.isArray(value) ? "" : String(value || "").trim();
  if (!text) return allowEmpty ? [] : [{ probability: 1, vehicles: ["RTW"] }];
  return text.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const [probabilityText, vehiclesText] = part.includes(":") ? part.split(":") : ["1", part];
    return {
      probability: parseWeight(probabilityText),
      vehicles: vehiclesText.split("+").map((item) => item.trim().toUpperCase()).filter(Boolean)
    };
  }).filter((option) => option.vehicles.length);
}

function normalizeOptions(value, allowEmpty = false) {
  if (Array.isArray(value) && value.length && value[0]?.vehicles) {
    return value.map((option) => ({
      probability: parseWeight(option.probability ?? 1),
      vehicles: listValue(option.vehicles).map((item) => item.toUpperCase()).filter(Boolean)
    })).filter((option) => option.vehicles.length);
  }
  if (Array.isArray(value) && value.length) {
    return [{ probability: 1, vehicles: value.map((item) => String(item).toUpperCase()) }];
  }
  if (typeof value === "string") return parseOptions(value, allowEmpty);
  return allowEmpty ? [] : [{ probability: 1, vehicles: ["RTW"] }];
}

function formatOptions(options = []) {
  return (options || []).map((option) => `${formatWeight(option.probability ?? 1)}:${(option.vehicles || []).join("+")}`).join(";");
}

function optionSummary(options = []) {
  return (options || []).map((option) => (option.vehicles || []).join("+")).filter(Boolean).join(" / ") || "keine";
}

function departmentLabels(keys) {
  const catalog = window.departmentCatalog || [];
  return (keys || []).map((key) => catalog.find((item) => item.key === key)?.label || key).join(" / ") || "kein Klinikziel";
}

function splitList(value) {
  return String(value || "").split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function listValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return splitList(value);
}

function parseTimeWindows(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [start, end] = part.split("-").map((item) => item.trim());
      return normalizeTimeWindow(start, end);
    })
    .filter(Boolean);
}

function normalizeTimeWindowsArray(value) {
  if (typeof value === "string") return parseTimeWindows(value);
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") {
      const [start, end] = item.split("-").map((part) => part.trim());
      return normalizeTimeWindow(start, end);
    }
    return normalizeTimeWindow(item?.start, item?.end);
  }).filter(Boolean);
}

function normalizeTimeWindow(start, end) {
  const startMinute = parseTimeToMinute(start);
  const endMinute = parseTimeToMinute(end);
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute === endMinute) return null;
  return { start: minuteToTimeLabel(startMinute), end: minuteToTimeLabel(endMinute) };
}

function parseTimeToMinute(value) {
  const text = String(value || "").trim();
  if (!text) return NaN;
  const [hourText, minuteText = "0"] = text.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NaN;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return NaN;
  return ((hour % 24) * 60) + minute;
}

function minuteToTimeLabel(minute) {
  const normalized = ((Math.round(minute) % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const part = normalized % 60;
  return part ? `${hour}:${String(part).padStart(2, "0")}` : String(hour);
}

function formatTimeWindows(windows = []) {
  return (windows || []).map((window) => `${window.start}-${window.end}`).join("; ");
}

function clampPercent(value) {
  const percent = Number(String(value ?? "").replace("%", "").replace(",", "."));
  return Math.max(0, Math.min(1, (Number.isFinite(percent) ? percent : 0) / 100));
}

function clampRuntimeProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

function parseWeight(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : 1;
}

function formatWeight(value) {
  const weight = parseWeight(value ?? 1);
  return Number.isInteger(weight) ? String(weight) : String(Number(weight.toFixed(2)));
}

function makeId(value) {
  return String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `incident-${Date.now()}`;
}

function randomToken() {
  return Math.random().toString(36).slice(2, 7);
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
