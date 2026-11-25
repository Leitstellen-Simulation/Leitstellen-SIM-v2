import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app-transport.js", import.meta.url), "utf8");
const definitions = [
  "transportOrClear", "isAutomaticTransport", "transportPatientHasNoClinicTarget", "transportPoiDestinationForPatient",
  "patientForVehicle", "beginTransport", "nearestSuitableHospital", "nearestHospitals", "hospitalSuitableForIncident",
  "requiredDepartmentKeysForTransport"
].map((name) => source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"))[0]).join("\n");

function transportFixture({ department = "none", hospitals = [], poi = null, fixedDestination = null, mode = "poi" } = {}) {
  const patient = { id: "pat-2", requiredDepartmentKeys: [department] };
  const incident = {
    id: "incident", type: "transport", keyword: "RD KTP - Heimfahrt", lat: 0, lng: 0,
    patient: { destinationMode: mode, fixedDestination, patients: [{ id: "pat-1", requiredDepartmentKeys: ["cardiology"] }, patient] },
    transportRequest: { id: "other-request", vehicleId: "other", patientId: "pat-1" }
  };
  const vehicle = { id: "unit", incidentId: incident.id, patientId: patient.id, type: "RTW", status: 4 };
  const actions = [];
  const pass = () => true;
  const noOp = () => {};
  const run = runInNewContext(definitions + "\ntransportOrClear", {
    state: { incidents: [incident], vehicles: [vehicle], center: { hospitals } },
    hasPersistentSpeechRequest: () => false,
    patientTreatmentProgress: () => 1,
    currentTreatmentCap: () => ({ cap: 1 }),
    patientRequiresTransport: pass,
    patientReadyForTransport: pass,
    scheduleSupportReleaseAfterCareComplete: noOp,
    patientReport: noOp,
    patientOutcome: noOp,
    missingExternalServices: () => [],
    handleRthTransportReadiness: () => false,
    handleElrdTransportWait: () => false,
    vehicleCanTransportPatient: pass,
    isTransportVehicle: pass,
    normalizeDepartmentKey: (key) => key,
    mapDistance: (lat, lng, originLat, originLng) => Math.hypot(lat - originLat, lng - originLng),
    hospitalIsUnavailable: (hospital) => hospital.unavailable,
    randomPoiTransportDestination: () => poi,
    randomHomeDestinationNear: () => ({ id: "random-home" }),
    beginTransportToDestination: (_incidentId, destination) => actions.push(destination.id),
    requestTransportDestination: () => actions.push("manual"),
    logRadio: noOp,
    markPatientTransportStarted: noOp,
    clearTransportRequest: (_incident, requestId) => assert.equal(requestId, undefined),
    releaseNonRequiredDoctors: noOp,
    tna: { startTransport: noOp },
    scheduleSecondaryTransfer: () => actions.push("secondary"),
    renderAll: noOp,
    transportUsesSignal: () => false,
    maybeDoctorAccompaniesTransport: noOp,
    releaseSupportVehiclesAfterHandover: noOp,
    releaseElrdIfNoPatientsAtScene: noOp,
    driveVehicleTo: (_vehicle, hospital) => actions.push(hospital.id)
  });
  run(vehicle.id);
  return { actions, patient };
}

test("a stable patient can go back to the POI, a patient needing a clinic goes to the suitable hospital", () => {
  const poi = { id: "nursing-home", type: "destination" };
  assert.deepEqual(transportFixture({ poi }).actions, ["nursing-home"]);

  const hospitals = [
    { id: "origin", lat: 0, lng: 0, departments: ["trauma"] },
    { id: "wrong-specialty", lat: 1, lng: 0, departments: ["cardiology"] },
    { id: "unavailable", lat: 2, lng: 0, departments: ["trauma"], unavailable: true },
    { id: "suitable", lat: 3, lng: 0, departments: ["trauma"] }
  ];
  const result = transportFixture({ department: "trauma", hospitals, poi, fixedDestination: poi });
  assert.deepEqual(result.actions, ["suitable"]);
  assert.equal(result.patient.destinationDecision, undefined);
});

test("missing automatic targets fall back to a manual assignment", () => {
  const internal = { id: "internal-clinic", lat: 1, lng: 0, departments: ["internal"] };
  assert.deepEqual(transportFixture({ department: "radiotherapy", hospitals: [internal] }).actions, ["manual"]);
  assert.deepEqual(transportFixture().actions, ["manual"]);
  assert.deepEqual(transportFixture({ mode: "home" }).actions, ["random-home"]);
});
