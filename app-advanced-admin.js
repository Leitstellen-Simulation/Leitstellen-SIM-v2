function canUseAdvancedAdmin() {
  return state.adminMode && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

function initAdvancedAdmin() {
  const dialog = document.querySelector("#test-incident-dialog");
  const form = document.querySelector("#test-incident-form");
  const preset = document.querySelector("#test-incident-preset");
  const patientCount = document.querySelector("#test-patient-count");
  const patientList = document.querySelector("#test-incident-patients");
  const place = document.querySelector("#test-incident-location");
  const hint = document.querySelector("#test-incident-hint");
  const error = document.querySelector("#test-incident-error");
  const modScenarios = document.querySelector("#test-mod-scenarios");
  const modes = {
    manual: { patients: [{ required: ["RTW"] }] },
    tna: { patients: [{ required: ["RTW", "NEF"] }], tnaTest: { failure: false, escalation: false } },
    "tna-failure": { patients: [{ required: ["RTW", "NEF"] }], tnaTest: { failure: true } },
    "tna-escalation": { patients: [{ required: ["RTW", "NEF"] }], tnaTest: { failure: false, escalation: true } },
    cpr: { patients: [{ required: ["RTW", "NEF"], acuity: "reanimation" }] },
    multi: { patients: [{ required: ["RTW", "NEF"] }, { required: ["RTW"] }, { required: ["KTW"] }] }
  };
  let position;

  function addPatient(index, patient = { required: ["RTW"] }) {
    const entry = document.createElement("fieldset");
    entry.className = "test-patient";
    const required = ["RTW", "KTW", "NEF", "RTH", "ITW", "ITH", "REF", "HVO", "FR"];
    entry.innerHTML = `
      <legend>Patient ${index + 1}</legend>
      <div class="test-patient-settings">
        <label>Zustand
          <select name="acuity">
            <option value="stable">Stabil</option>
            <option value="potential-critical">Potenziell kritisch</option>
            <option value="critical">Kritisch</option>
            <option value="reanimation">Reanimation</option>
          </select>
        </label>
        <label>Klinikfachrichtung
          <select name="department">${window.departmentCatalog.map((department) =>
            `<option value="${escapeHtml(department.key)}">${escapeHtml(department.label)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="test-incident-options" role="group" aria-label="Fahrzeuge für Patient ${index + 1}">
        ${required.map((type) => `<label class="check-row"><input name="vehicle" type="checkbox" value="${type}" ${patient.required.includes(type) ? "checked" : ""}>${type === "HVO" ? "HvO" : type}</label>`).join("")}
      </div>
      <div class="test-incident-options">
        <label class="check-row"><input name="transport" type="checkbox" checked> Transport</label>
        <label class="check-row"><input name="physical" type="checkbox"> Physischer NA zwingend</label>
      </div>`;
    entry.querySelector('[name="acuity"]').value = patient.acuity || "stable";
    entry.querySelector('[name="department"]').value = "internal";
    patientList.append(entry);
  }

  function applyPreset() {
    const mode = modes[preset.value];
    patientCount.value = mode.patients.length;
    patientList.replaceChildren();
    mode.patients.forEach((patient, index) => addPatient(index, patient));
    hint.hidden = !mode.tnaTest;
    hint.textContent = mode.tnaTest
      ? "TNA ist für diesen Testfall aktiv. Alarmiere zunächst nur einen RTW. TNA setzt genau einen Patienten mit Notarztbedarf ohne Reanimation voraus."
      : "";
    error.hidden = true;
  }

  document.querySelector("#advanced-admin-button").addEventListener("click", () => {
    if (!canUseAdvancedAdmin() || dialog.open || el.incidentDialog.open) return;
    form.reset();
    const cursor = state.mapReady ? state.map.getCenter() : null;
    position = cursor || { lat: state.center.mapCenter[0], lng: state.center.mapCenter[1] };
    place.value = `Kartenmitte · ${defaultLocationLabel()}`;
    applyPreset();
    const scenarios = appMods.adminTestScenarios();
    modScenarios.replaceChildren(...scenarios.map(({ label, start }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${label} · 112-Anruf auslösen`;
      button.addEventListener("click", () => {
        try {
          start();
          dialog.close();
        } catch (failure) {
          error.textContent = failure.message;
          error.hidden = false;
        }
      });
      return button;
    }));
    modScenarios.hidden = !scenarios.length;
    el.shiftMenu.open = false;
    showDialog(dialog);
  });
  document.querySelector("#close-test-incident").addEventListener("click", () => dialog.close());
  preset.addEventListener("change", applyPreset);
  patientCount.addEventListener("input", () => {
    if (!patientCount.validity.valid) return;
    const count = patientCount.valueAsNumber;
    while (patientList.children.length > count) patientList.lastElementChild.remove();
    while (patientList.children.length < count) addPatient(patientList.children.length);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canUseAdvancedAdmin()) return;
    const patients = [...patientList.children].map((entry, index) => {
      const acuity = entry.querySelector('[name="acuity"]').value;
      const vehicles = [...entry.querySelectorAll('[name="vehicle"]:checked')].map((node) => node.value);
      const reanimation = acuity === "reanimation";
      return {
        id: `pat-${index + 1}`,
        label: `Pat ${index + 1}`,
        acuity,
        reanimationCase: reanimation,
        required: reanimation ? ["RTW", "NEF"] : vehicles.filter((type) => !isStabilizerVehicle(type)),
        recommendedVehicles: vehicles.filter(isStabilizerVehicle),
        requiredDepartmentKey: entry.querySelector('[name="department"]').value,
        requiresDoctorAccompaniment: reanimation || entry.querySelector('[name="physical"]').checked,
        transportNeeded: reanimation || entry.querySelector('[name="transport"]').checked
      };
    });
    const missingVehicle = patients.find((patient) => !patient.required.length);
    if (missingVehicle) {
      error.textContent = `${missingVehicle.label}: Bitte mindestens ein benötigtes Fahrzeug auswählen.`;
      error.hidden = false;
      return;
    }
    const options = new FormData(form);
    const tnaTest = modes[preset.value].tnaTest || null;
    const draft = {
      id: makeId(),
      type: "emergency",
      keyword: "Testeinsatz",
      location: place.value.trim() || defaultLocationLabel(),
      lat: position.lat,
      lng: position.lng,
      signal: options.has("signal"),
      noElrd: options.has("noElrd"),
      requiredServices: ["FW", "POL"].filter((service) => options.has(service.toLowerCase())),
      patients,
      required: aggregateRequiredVehicles(patients),
      isTestIncident: true,
      tnaTest,
      tnaProbability: tnaTest ? 1 : 0
    };
    dialog.close();
    openIncidentDialog(draft);
  });
}
