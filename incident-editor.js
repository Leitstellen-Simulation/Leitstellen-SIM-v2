const state = {
  incidents: [],
  editingId: null,
  editingPatientId: null,
  patients: []
};

const el = Object.fromEntries([
  "category", "title", "type", "caller-text", "report", "location-mode", "poi-category-search",
  "poi-categories", "poi-ids", "fw", "pol", "patient-options", "departments", "patient-signal",
  "patient-no-transport", "patient-no-transport-text", "patient-doctor-required", "patient-fw", "patient-pol", "add-patient",
  "patient-list", "new", "save", "list", "count"
].map((id) => [id.replaceAll("-", "_"), document.querySelector(`#ie-${id}`)]));

init();

async function init() {
  await loadIncidents();
  renderPoiCategorySelect();
  renderDepartmentChecks(el.departments);
  el.add_patient.addEventListener("click", addPatient);
  el.save.addEventListener("click", saveIncident);
  el.new.addEventListener("click", clearForm);
  el.poi_category_search.addEventListener("input", () => renderPoiCategorySelect());
  renderPatients();
  renderList();
}

async function loadIncidents() {
  try {
    const response = await fetch("/api/incidents");
    state.incidents = response.ok ? await response.json() : [];
  } catch {
    state.incidents = [];
  }
}

function addPatient() {
  const patient = {
    id: state.editingPatientId || `pat-${Date.now()}`,
    label: "",
    options: parseOptions(el.patient_options.value),
    requiredDepartmentKeys: selectedDepartments(el.departments),
    transportSignalProbability: clampPercent(el.patient_signal.value),
    noTransportProbability: clampPercent(el.patient_no_transport.value),
    noTransportText: el.patient_no_transport_text.value.trim() || "Ambulante Versorgung ausreichend, kein Transport.",
    requiresDoctorAccompaniment: el.patient_doctor_required.checked,
    needsFW: el.patient_fw.checked,
    needsPOL: el.patient_pol.checked
  };

  if (state.editingPatientId) {
    const index = state.patients.findIndex((item) => item.id === state.editingPatientId);
    if (index >= 0) state.patients[index] = patient;
  } else {
    state.patients.push(patient);
  }

  renumberPatients();
  clearPatientForm();
  renderPatients();
}

function parseOptions(value) {
  const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return [{ probability: 1, vehicles: ["RTW"] }];
  return parts.map((part) => {
    const [probability, vehicles] = part.includes(":") ? part.split(":") : ["1", part];
    return {
      probability: Number(probability.replace(",", ".")) || 1,
      vehicles: vehicles.split("+").map((item) => item.trim().toUpperCase()).filter(Boolean)
    };
  });
}

async function saveIncident() {
  if (!state.patients.length) addPatient();
  renumberPatients();
  const id = state.editingId || makeId(el.title.value || Date.now());
  const title = el.title.value.trim() || "Neuer Einsatz";
  const incident = {
    id,
    category: el.category.value,
    title,
    type: el.type.value,
    keyword: title,
    variants: [{
      callerName: "Anrufer",
      callerText: el.caller_text.value.trim(),
      locationMode: el.location_mode.value,
      poiCategories: selectedPoiCategories(),
      poiIds: splitList(el.poi_ids.value),
      requiredServices: [el.fw.checked ? "FW" : null, el.pol.checked ? "POL" : null].filter(Boolean),
      report: state.patients.length > 1 ? "" : el.report.value.trim(),
      situationReport: state.patients.length > 1 ? el.report.value.trim() : "",
      patients: state.patients
    }]
  };
  const index = state.incidents.findIndex((item) => item.id === id);
  if (index >= 0) state.incidents[index] = incident;
  else state.incidents.push(incident);
  await fetch("/api/incidents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state.incidents)
  });
  clearForm();
  renderList();
}

function editIncident(incident) {
  const variant = incident.variants?.[0] || {};
  state.editingId = incident.id;
  state.editingPatientId = null;
  el.category.value = incident.category || "Sonstiges";
  el.title.value = incident.title || "";
  el.type.value = incident.type || "emergency";
  el.caller_text.value = variant.callerText || "";
  el.report.value = variant.situationReport || variant.report || "";
  el.location_mode.value = variant.locationMode || "random";
  renderPoiCategorySelect(variant.poiCategories || []);
  el.poi_ids.value = (variant.poiIds || []).join(", ");
  el.fw.checked = (variant.requiredServices || []).includes("FW");
  el.pol.checked = (variant.requiredServices || []).includes("POL");
  state.patients = (variant.patients || []).map((patient) => ({ ...patient }));
  renumberPatients();
  clearPatientForm();
  renderPatients();
}

function clearForm() {
  state.editingId = null;
  state.editingPatientId = null;
  el.title.value = "";
  el.caller_text.value = "";
  el.report.value = "";
  el.poi_category_search.value = "";
  renderPoiCategorySelect([]);
  el.poi_ids.value = "";
  el.fw.checked = false;
  el.pol.checked = false;
  state.patients = [];
  clearPatientForm();
  renderPatients();
}

function clearPatientForm() {
  state.editingPatientId = null;
  el.patient_options.value = "";
  el.patient_signal.value = 0;
  el.patient_no_transport.value = 0;
  el.patient_no_transport_text.value = "";
  el.patient_doctor_required.checked = false;
  el.patient_fw.checked = false;
  el.patient_pol.checked = false;
  renderDepartmentChecks(el.departments);
  el.add_patient.textContent = "Patient hinzufügen";
}

function renderPatients() {
  el.patient_list.innerHTML = "";
  if (!state.patients.length) {
    el.patient_list.textContent = "Noch keine Patienten angelegt.";
    return;
  }
  state.patients.forEach((patient) => {
    const row = document.createElement("article");
    row.className = "unit-row";
    const options = (patient.options || []).map((option) => `${option.probability}: ${(option.vehicles || []).join("+")}`).join("; ");
    const signal = Math.round((patient.transportSignalProbability || 0) * 100);
    const noTransport = Math.round((patient.noTransportProbability || 0) * 100);
    const departments = departmentLabels(patient.requiredDepartmentKeys || [patient.requiredDepartmentKey]);
    const doctorRequired = patient.requiresDoctorAccompaniment ? " | NA zwingend" : "";
    row.innerHTML = `<div><strong>${escapeHtml(patient.label)}</strong><span>${escapeHtml(options)} | ${escapeHtml(departments)} | SoSi ${signal}% | ambulant ${noTransport}%${doctorRequired}</span></div>`;

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Bearbeiten";
    editButton.addEventListener("click", () => editPatient(patient.id));

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Entfernen";
    removeButton.addEventListener("click", () => {
      state.patients = state.patients.filter((item) => item.id !== patient.id);
      renumberPatients();
      renderPatients();
    });
    row.append(editButton, removeButton);
    el.patient_list.append(row);
  });
}

function editPatient(patientId) {
  const patient = state.patients.find((item) => item.id === patientId);
  if (!patient) return;
  state.editingPatientId = patient.id;
  el.patient_options.value = (patient.options || []).map((option) => `${option.probability}:${(option.vehicles || []).join("+")}`).join(";");
  renderDepartmentChecks(el.departments, patient.requiredDepartmentKeys || [patient.requiredDepartmentKey]);
  el.patient_signal.value = Math.round((patient.transportSignalProbability || 0) * 100);
  el.patient_no_transport.value = Math.round((patient.noTransportProbability || 0) * 100);
  el.patient_no_transport_text.value = patient.noTransportText || "";
  el.patient_doctor_required.checked = Boolean(patient.requiresDoctorAccompaniment);
  el.patient_fw.checked = Boolean(patient.needsFW);
  el.patient_pol.checked = Boolean(patient.needsPOL);
  el.add_patient.textContent = "Patient speichern";
}

function renumberPatients() {
  state.patients.forEach((patient, index) => {
    patient.id ||= `pat-${index + 1}`;
    patient.label = `Pat ${index + 1}`;
  });
}

function renderDepartmentChecks(container, selected = []) {
  const selectedSet = new Set(selected);
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

function renderPoiCategorySelect(selected = selectedPoiCategories()) {
  const selectedSet = new Set(selected);
  const query = normalizeSearch(el.poi_category_search?.value || "");
  el.poi_categories.innerHTML = "";
  (window.poiCategoryCatalog || [])
    .filter((category) => !query || normalizeSearch(`${category.id || category.key} ${category.label}`).includes(query))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id || category.key;
      option.textContent = category.label;
      option.selected = selectedSet.has(option.value);
      el.poi_categories.append(option);
    });
}

function selectedPoiCategories() {
  return [...el.poi_categories.selectedOptions].map((option) => option.value);
}

function departmentLabels(keys) {
  const catalog = window.departmentCatalog || [];
  return (keys || []).map((key) => catalog.find((item) => item.key === key)?.label || key).join(" / ") || "kein Klinikziel";
}

function renderList() {
  el.count.textContent = `${state.incidents.length} Einsätze`;
  el.list.innerHTML = "";
  state.incidents.forEach((incident) => {
    const row = document.createElement("article");
    row.className = "incident-card";
    row.innerHTML = `<h3>${escapeHtml(incident.title || incident.keyword)}</h3><p>${escapeHtml(incident.category || incident.type)}</p>`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Bearbeiten";
    button.addEventListener("click", () => editIncident(incident));
    row.append(button);
    el.list.append(row);
  });
}

function makeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `incident-${Date.now()}`;
}

function splitList(value) {
  return String(value || "").split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function clampPercent(value) {
  return Math.max(0, Math.min(1, (Number(value) || 0) / 100));
}

function normalizeSearch(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
