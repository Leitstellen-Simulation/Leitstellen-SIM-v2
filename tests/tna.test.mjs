import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const moduleSource = readFileSync(new URL("../app-tna.js", import.meta.url), "utf8");
const transportSource = readFileSync(new URL("../app-transport.js", import.meta.url), "utf8");

function transportFunction(name) {
  return transportSource.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"))[0];
}

function fixture({ enabled = true, probability = 1, failure = 0, rolls = [], acuity = "stable", count = 1 } = {}) {
  const patient = { id: "pat-1", acuity, required: ["RTW", "NEF"], assignedVehicles: ["rtw"] };
  const rtw = { id: "rtw", type: "RTW", name: "RTW", status: 4, incidentId: "case", patientId: "pat-1" };
  const doctor = { id: "nef", type: "NEF", name: "NEF", status: 2 };
  const patients = [patient, ...Array.from({ length: count - 1 }, () => ({ id: "pat-2", completed: true }))];
  const incident = { id: "case", status: "vor Ort", tnaProbability: probability, patient: { patients }, assigned: ["rtw"] };
  const state = { center: { tnaEnabled: enabled, tnaFailureProbability: failure }, vehicles: [rtw, doctor], incidents: [incident], minute: 12 };
  const radio = [];
  const routes = [];
  const logs = [];
  const removed = [];
  let now = 0;
  let draws = 0;
  const scope = {
    state, Date: { now: () => now }, Math: Object.create(Math),
    simMinuteNow: () => now / 60000,
    isDoctorVehicle: (type) => type === "NEF",
    isDoctorRequirement: (type) => type === "NEF",
    isStabilizerVehicle: () => false,
    patientMissingTypes: (person) => person.required.filter((type) => type === "NEF"),
    patientCanDropDoctorRequirement: () => false,
    normalizeProbability: (value) => value,
    triggerRadioStatus: (vehicle, status, message, { context }) => {
      radio.push(context);
      vehicle.radioContext = context;
      vehicle.radioStatus = status;
    },
    logRadio: (message) => logs.push(message),
    selectIncidentFromMapOrList: () => {},
    maybeRequestAdditionalResources: () => {},
    renderAll: () => {},
    scheduleTreatmentCompletion: () => {},
    pointAtProgress: (route, progress) => ({ lat: progress, lng: 1 }),
    cancelVehicleRoute: (vehicle) => { vehicle.routeMeta = null; },
    driveVehicleTo: (vehicle, destination, options, arrive) => routes.push({ vehicle, destination, options, arrive }),
    arriveAtHospital: () => {},
    arriveAtTransportDestination: () => {},
    startDoctorAccompaniment: () => { doctor.status = 7; },
    clearRadioDisplayTimer: () => {},
    canRemoveAssignedVehicle: (vehicle) => vehicle === doctor && [2, 3].includes(vehicle.status),
    removeAssignedVehicle: (id) => removed.push(id)
  };
  scope.Math.random = () => rolls[draws++] ?? .6;
  const api = runInNewContext(
    [moduleSource, transportFunction("incidentForPatient"), transportFunction("patientEffectiveRequiredTypes"),
      "({ tna, incidentForPatient, patientEffectiveRequiredTypes })"].join("\n"), scope
  );
  return {
    ...api, state, incident, patient, rtw, doctor, radio, routes, logs, removed,
    advance: (time) => { now = time; api.tna.tick(); },
    draws: () => draws
  };
}

function acknowledge(f, context) {
  f.tna.acceptingRadio(f.rtw, context);
  f.rtw.radioStatus = null;
  f.rtw.radioContext = null;
  f.tna.answerRadio(f.rtw, context);
}

function connectAndTransport(f) {
  assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), true);
  assert.equal(f.tna.covers(f.patient), false);
  assert.equal(f.tna.onScene(f.incident), false);
  acknowledge(f, "tna-request");
  f.tna.connect(f.incident.id);
  assert.equal(f.tna.onScene(f.incident), false);
  f.advance(22_000);
  assert.equal(f.tna.covers(f.patient), true);
  assert.equal(f.tna.onScene(f.incident), true);
  f.rtw.status = 7;
  f.patient.transporting = true;
  f.rtw.routeMeta = { startAt: 22_000, endAt: 322_000, destination: { label: "Klinik" }, phase: "hospital" };
  f.tna.startTransport(f.incident, f.rtw);
  assert.equal(f.tna.onScene(f.incident), false);
}

test("disabled, zero probability, CPR and multiple patients preserve physical demand without a draw", () => {
  for (const options of [{ enabled: false }, { probability: 0 }, { acuity: "reanimation" }, { count: 2 }]) {
    const f = fixture(options);
    assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), false);
    assert.equal(f.draws(), 0);
    assert.equal(f.patientEffectiveRequiredTypes(f.patient).join(), "RTW,NEF");
  }
  const legacyCpr = fixture();
  legacyCpr.patient.reanimationCase = true;
  assert.equal(legacyCpr.tna.requestAtScene(legacyCpr.rtw, legacyCpr.incident, legacyCpr.patient), false);
  assert.equal(legacyCpr.draws(), 0);
  const manv = fixture();
  manv.incident.modId = "manv";
  assert.equal(manv.tna.requestAtScene(manv.rtw, manv.incident, manv.patient), false);
  assert.equal(manv.draws(), 0);
});

test("every new catalog variant defines a TNA share and only eligible doctor cases have a positive share", () => {
  const catalog = JSON.parse(readFileSync(new URL("../incidents-dynamic.json", import.meta.url), "utf8"));
  const newIncidents = catalog.filter(({ id }) => /^erg-2026-\d{3}$/.test(id));
  assert.equal(newIncidents.length, 100);
  let positive = 0;
  for (const { variants } of newIncidents) {
    for (const { id, patients, tnaProbability } of variants) {
      const [patient] = patients;
      const eligible = patients.length === 1 && patient.acuity !== "reanimation" && !patient.reanimationCase
        && !patient.requiresDoctorAccompaniment && patient.options.some(({ probability, vehicles }) =>
          probability > 0 && vehicles.some((type) => ["NEF", "VEF", "RTH"].includes(type)));
      assert.ok(Number.isFinite(tnaProbability) && tnaProbability >= 0 && tnaProbability <= 1, id);
      assert.equal(tnaProbability > 0, eligible, id);
      if (tnaProbability > 0) positive++;
    }
  }
  assert.equal(positive, 30);
});

test("only the assigned RTW at the scene can request TNA", () => {
  for (const type of ["KTW", "ITW", "NEF", "RTH", "REF", "HVO", "FR", "ELRD"]) {
    const f = fixture();
    f.rtw.type = type;
    assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), false, type);
    assert.equal(f.draws(), 0, type);
  }
  const f = fixture();
  f.rtw.status = 3;
  assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), false);
  f.rtw.status = 4;
  assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), true);
});

test("the TNA share is drawn only after the patient's resource roll has produced a doctor requirement", () => {
  const options = [{ probability: .85, vehicles: ["RTW"] }, { probability: .15, vehicles: ["RTW", "NEF"] }];
  const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const resolveSource = appSource.match(/^function resolvePatientRequirement\([\s\S]*?^}/m)[0];
  let resourceRoll = .84;
  const resolve = runInNewContext(resolveSource + "\nresolvePatientRequirement", {
    Math: { random: () => resourceRoll },
    normalizeRequiredVehicles: (types) => types
  });
  const noDoctor = fixture({ probability: .90, rolls: [0] });
  noDoctor.patient.required = resolve(options);
  assert.equal(noDoctor.tna.requestAtScene(noDoctor.rtw, noDoctor.incident, noDoctor.patient), false);
  assert.equal(noDoctor.draws(), 0);

  resourceRoll = .86;
  const doctor = fixture({ probability: .90, rolls: [.89, .9] });
  doctor.patient.required = resolve(options);
  assert.equal(doctor.tna.requestAtScene(doctor.rtw, doctor.incident, doctor.patient), true);
  const physical = fixture({ probability: .90, rolls: [.90] });
  physical.patient.required = resolve(options);
  assert.equal(physical.tna.requestAtScene(physical.rtw, physical.incident, physical.patient), false);
  assert.equal(physical.draws(), 1);
});

test("technical failure supplies the physical request reason without repeating the draw", () => {
  const f = fixture({ failure: 1, rolls: [0, 0] });
  assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), false);
  assert.equal(f.tna.reason(f.incident), "TNA-System am RTW ausgefallen");
  assert.equal(f.tna.requestAtScene(f.rtw, f.incident, f.patient), false);
  assert.equal(f.draws(), 2);
});

test("local test presets override TNA only for the prepared incident", () => {
  const f = fixture({ enabled: false });
  f.incident.tnaTest = { failure: false, escalation: true };
  connectAndTransport(f);
  f.advance(130_000);
  assert.deepEqual(f.radio, ["tna-request", "tna-physical"]);
  assert.equal(f.draws(), 0);
  assert.equal(f.state.center.tnaEnabled, false);

  const failure = fixture({ enabled: false });
  failure.incident.tnaTest = { failure: true };
  assert.equal(failure.tna.requestAtScene(failure.rtw, failure.incident, failure.patient), false);
  assert.equal(failure.tna.reason(failure.incident), "TNA-System am RTW ausgefallen");
  assert.equal(failure.draws(), 0);

  const cpr = fixture({ enabled: false, acuity: "reanimation" });
  cpr.incident.tnaTest = { failure: false };
  assert.equal(cpr.tna.requestAtScene(cpr.rtw, cpr.incident, cpr.patient), false);
});

test("a running consultation cannot cover CPR and leaves the escalation reason", () => {
  const f = fixture();
  f.tna.requestAtScene(f.rtw, f.incident, f.patient);
  acknowledge(f, "tna-request");
  f.tna.connect(f.incident.id);
  f.advance(22_000);
  assert.equal(f.tna.covers(f.patient), true);
  f.patient.acuity = "reanimation";
  f.patient.rthTransportMode = "rth-transport";
  assert.equal(f.tna.onReanimation(f.incident, f.patient), false);
  assert.equal(f.patientEffectiveRequiredTypes(f.patient).join(), "RTW,NEF");
  assert.equal(f.tna.reason(f.incident), "Verschlechterung zur Reanimation");
});

test("the transport draws once and binds the physical doctor at the rendezvous", () => {
  const f = fixture({ rolls: [.1, .5, .04] });
  connectAndTransport(f);
  f.tna.startTransport(f.incident, f.rtw);
  f.advance(130_000);
  assert.deepEqual(f.radio, ["tna-request", "tna-physical"]);
  acknowledge(f, "tna-physical");
  assert.equal(f.incident.assistanceDecision.missing.join(), "NEF");
  f.doctor.status = 3;
  f.doctor.incidentId = f.incident.id;
  f.incident.assigned.push(f.doctor.id);
  assert.equal(f.tna.routeDoctor(f.incident, f.doctor), true);
  assert.equal(f.routes[0].options.phase, "rendezvous");
  f.routes[0].arrive();
  f.advance(225_000);
  assert.equal(f.doctor.patientId, f.patient.id);
  assert.equal(f.doctor.status, 7);
  assert.equal(f.routes[1].destination.label, "Klinik");
  assert.equal(f.draws(), 3);
});

test("five percent boundary and route change never introduce another roll", () => {
  const f = fixture({ rolls: [.1, .5, .05] });
  connectAndTransport(f);
  f.tna.destinationChanging(f.incident);
  f.rtw.routeMeta = { ...f.rtw.routeMeta, endAt: 370_000 };
  f.advance(220_000);
  assert.deepEqual(f.radio, ["tna-request"]);
  assert.equal(f.draws(), 3);
});

test("clinical destination arrival clears the rendezvous and any assigned doctor en route", () => {
  const f = fixture({ rolls: [.1, .5, 0] });
  connectAndTransport(f);
  f.advance(130_000);
  acknowledge(f, "tna-physical");
  f.doctor.status = 3;
  f.doctor.incidentId = f.incident.id;
  f.incident.assigned.push(f.doctor.id);
  f.tna.routeDoctor(f.incident, f.doctor);
  f.tna.end(f.incident);
  f.routes[0].arrive();
  assert.deepEqual(f.removed, ["nef"]);
  assert.equal(f.routes.length, 1);
});

test("identical patient IDs in simultaneous cases resolve to their own case", () => {
  const f = fixture();
  f.state.incidents.unshift({ id: "another", patient: { patients: [{ ...f.patient }] } });
  assert.equal(f.incidentForPatient(f.patient), f.incident);
});

test("deterioration adds the newly required physician to an existing assistance decision", () => {
  const patient = { acuity: "reanimation", assignedVehicles: ["rtw"] };
  const incident = { id: "case", assistanceDecision: { missing: ["ELRD"], vehicleId: "rtw" } };
  const request = runInNewContext(
    transportFunction("requestReanimationResourcesAfterDeterioration") + "\nrequestReanimationResourcesAfterDeterioration",
    { patientMissingTypes: () => ["NEF"], currentAssistanceMissingForDispatch: () => ["ELRD", "NEF"] }
  );
  request(patient, incident);
  assert.equal(incident.assistanceDecision.missing.join(), "ELRD,NEF");
  assert.equal(incident.assistanceDecision.vehicleId, "rtw");
  assert.match(incident.assistanceDecision.reason, /Reanimation/);
});

test("ELRD waits for all patients and is released after an open radio exchange", () => {
  const patients = [{ transporting: true }, { transporting: false }];
  const incident = { id: "case", assigned: ["elrd"], patient: { patients } };
  const elrd = { id: "elrd", type: "ELRD", status: 4, incidentId: incident.id, radioStatus: 5 };
  const released = [];
  const release = runInNewContext(
    [transportFunction("incidentHasPatientAtScene"), transportFunction("releaseElrdIfNoPatientsAtScene"),
      "releaseElrdIfNoPatientsAtScene"].join("\n"),
    { state: { vehicles: [elrd] }, requestVehicleClearance: (unit) => released.push(unit.id) }
  );
  elrd.radioStatus = null;
  release(incident);
  assert.deepEqual(released, []);
  patients[1].completed = true;
  elrd.radioStatus = 5;
  release(incident);
  assert.deepEqual(released, []);
  elrd.radioStatus = null;
  release(incident);
  assert.deepEqual(released, ["elrd"]);
});

test("ending a surplus physician assignment only affects the patient assigned to that physician", () => {
  const patients = [
    { id: "pat-1", required: ["NEF"], assignedVehicles: ["nef"] },
    { id: "pat-2", required: ["NEF"], assignedVehicles: [] }
  ];
  const doctor = { id: "nef", status: 4, type: "NEF", patientId: "pat-1" };
  const resolve = runInNewContext(
    transportFunction("markSurplusRequirementsResolved") + "\nmarkSurplusRequirementsResolved",
    { state: { vehicles: [doctor] }, isDoctorVehicle: (type) => type === "NEF",
      isDoctorRequirement: (type) => type === "NEF", patientHasTransportUnitAtScene: () => true }
  );
  resolve({ patient: { patients } }, { vehicleIds: [doctor.id] });
  assert.equal(patients[0].doctorCareCompleted, true);
  assert.equal(patients[1].doctorCareCompleted, undefined);
});
