import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chooseHospital, createManv, mortality, spreadPatients } from "../mods/manv/main.mjs";

const [exercise] = JSON.parse(readFileSync(new URL("../mods/manv/scenarios.json", import.meta.url), "utf8"));

test("the school exercise uses the requested baseline and never enters the automatic pool", () => {
  const { categories } = spreadPatients(exercise.modData, () => .5);
  assert.deepEqual(Object.fromEntries(["red", "yellow", "green"].map((key) =>
    [key, categories.filter((entry) => entry === key).length])), { red: 14, yellow: 10, green: 16 });
  assert.equal(exercise.weight, 0);
  assert.deepEqual(exercise.requiredServices, ["FW", "POL"]);
});

test("variable starts stay within the count and category limits", () => {
  for (const draw of [0, .13, .5, .98, 1 - Number.EPSILON]) {
    for (const data of [exercise.modData, { count: 250, mix: { red: 100 } }, { count: 1, mix: { green: 100 } }]) {
      const { categories, mix } = spreadPatients(data, () => draw);
      assert.ok(categories.length >= Math.ceil(data.count * .85));
      assert.ok(categories.length <= Math.min(250, Math.floor(data.count * 1.15)));
      assert.ok(Math.abs(mix.reduce((a, b) => a + b, 0) - 100) < 1e-8);
      for (const [i, key] of ["red", "yellow", "green"].entries()) {
        assert.ok(Math.abs(mix[i] - (data.mix[key] || 0)) <= 5 + 1e-8);
      }
    }
  }
});

test("mortality ramps from 1% and is capped at 10% for red and 20% for blue", () => {
  assert.equal(mortality(1, "red"), .01);
  assert.ok(mortality(25, "red") < .05);
  assert.ok(Math.abs(mortality(100, "red") - .1) < 1e-8);
  assert.ok(Math.abs(mortality(100, "blue") - .2) < 1e-8);
});

const unit = (id, type) => ({ id, type, name: id, incidentId: "incident", status: 4 });
const clinic = (id, lat, departments, options = {}) => ({
  id, name: id, lat, lng: 2, departments, available: true, ...options
});

function fixture(data, random = () => .5, config = {}) {
  const events = [];
  const snapshot = {
    second: 0, vehicles: [], hospitals: [clinic("near", 1, ["trauma", "internal", "pediatrics"])],
    incidents: [{ id: "incident", lat: 1, lng: 2, scenario: { data } }]
  };
  const engine = createManv(async (name, args) => {
    events.push([name, args]);
    const vehicle = snapshot.vehicles.find((entry) => entry.id === args.vehicleId);
    if (name === "vehicle.role") vehicle.role = args.role;
    if (name === "patient.assign") vehicle.patientId = args.patientId;
    if (name === "patient.complete") {
      const carrier = snapshot.vehicles.find((entry) => entry.patientId === args.patientId);
      if (carrier) carrier.patientId = null;
    }
    if (name === "transport.start") {
      vehicle.status = 7;
      if (args.escortVehicleId) snapshot.vehicles.find((entry) => entry.id === args.escortVehicleId).status = 7;
    }
    return true;
  }, { random });
  const scene = engine.create(snapshot.incidents[0], 0, config);
  return { engine, snapshot, scene, events, advance: (seconds) => {
    snapshot.second += seconds;
    return engine.update(scene, structuredClone(snapshot));
  } };
}

test("leadership frees the first RTW and NEF for screening, red can start before medical screening, and the case closes after handover", async () => {
  const { engine, snapshot, scene, advance, events } = fixture({ count: 1, mix: { red: 100 } });
  const [patient] = scene.patients;
  patient.category = "red";
  patient.doctorNeeded = false;
  await advance(0);
  assert.equal(events.some(([name]) => name === "incident.patientCount"), false);
  snapshot.vehicles = [unit("rtw1", "RTW"), unit("nef1", "NEF")];
  await advance(0);
  assert.equal(snapshot.vehicles[0].role, "scene");
  assert.equal(snapshot.vehicles[1].role, "medical");
  snapshot.vehicles.push(unit("lead", "ELRD"));
  await advance(0);
  assert.equal(scene.screen.vehicleId, "rtw1");
  await advance(29);
  assert.equal(patient.prescreen, null);
  assert.deepEqual(events.filter(([name]) => name === "incident.patientCount").map(([, order]) => order.count), [1]);
  await advance(1);
  assert.equal(patient.prescreen, "red");
  assert.equal(patient.phase, "preparing");
  assert.equal(patient.doctorScreen, null);
  snapshot.vehicles.push(unit("lna", "LNA"));
  await advance(0);
  assert.equal(scene.physician.vehicleId, "nef1");
  await advance(59);
  assert.equal(patient.doctorScreen, null);
  await advance(1);
  assert.equal(patient.doctorScreen, "red");
  await advance(patient.readyAt - snapshot.second);
  assert.equal(patient.phase, "ready");
  await advance(299);
  assert.equal(patient.phase, "ready");
  await advance(1);
  assert.equal(patient.phase, "driving");
  assert.equal(events.filter(([name]) => name === "transport.start").length, 1);
  await engine.event("transport.arrived", { incidentId: scene.id, patientId: patient.id, hospitalId: "near" });
  assert.equal(patient.phase, "handover");
  snapshot.vehicles[0].status = 1;
  await engine.event("transport.handover", { incidentId: scene.id, patientId: patient.id, hospitalId: "near" });
  await advance(0);
  assert.equal(scene.closed, true);
});

test("an ambulance without an escort requires confirmation and can lose the patient before departure", async () => {
  for (const draw of [.04, .5]) {
    const { engine, snapshot, scene, events } = fixture({ count: 1 }, () => draw);
    const [patient] = scene.patients;
    const rtw = unit("rtw", "RTW");
    snapshot.vehicles = [rtw];
    Object.assign(patient, { category: "red", phase: "ready", doctorNeeded: true, hospitalId: "near",
      departments: ["trauma"], vehicleId: "rtw", registered: true, prescreen: "red" });
    const start = (override) => engine.startTransport(scene, patient, snapshot.hospitals, snapshot.vehicles, override);
    assert.equal(await start(false), false);
    assert.equal(await start(true), draw >= .1);
    assert.equal(patient.phase, draw < .1 ? "dead" : "driving");
    await assert.rejects(start(true));
    assert.equal(events.filter(([event]) => ["transport.start", "patient.complete"].includes(event)).length, 1);
  }
});

test("clinics honor the pediatric specialty, availability, relative quota and reserved assignments", () => {
  const patient = { departments: ["trauma", "pediatrics"] };
  const scene = { lat: 1, lng: 2, patients: [patient, { hospitalId: "b", phase: "driving" }] };
  const hospitals = [clinic("a", 1, ["trauma"]), clinic("b", 2, ["trauma", "pediatrics"]),
    clinic("c", 3, ["trauma", "pediatrics"]), clinic("d", 1, ["trauma", "pediatrics"], { available: false })];
  assert.equal(chooseHospital(scene, patient, hospitals).id, "b");
  assert.equal(chooseHospital(scene, patient, hospitals, { b: 50, c: 50 }).id, "c");
  assert.equal(chooseHospital(scene, patient, hospitals, { a: 100 }), undefined);
});

test("clinic automation is enabled per incident with complete quotas and both leaders on site", async () => {
  const { engine, snapshot, scene, advance, events } = fixture({ count: 1 }, () => .5,
    { automaticQuotas: true, quotas: { near: 100 } });
  const [patient] = scene.patients;
  Object.assign(patient, { phase: "ready", category: "yellow", prescreen: "yellow", doctorScreen: "yellow",
    readyAt: 0, departments: ["trauma"], vehicleId: "carrier" });
  scene.firstUnit = scene.firstRtw = "carrier";
  snapshot.hospitals.push(clinic("quota", 2, ["trauma"]));
  snapshot.vehicles = [{ ...unit("carrier", "RTW"), patientId: patient.id }, unit("lna", "LNA")];
  scene.clinicQuotas.quota = 100;
  await assert.rejects(engine.setClinicAutomation(scene, snapshot, true), /LNA und OrgL/);
  snapshot.vehicles.push(unit("orgl", "ORGL"));
  await advance(0);
  assert.equal(patient.hospitalId, null);
  scene.clinicQuotas.quota = 90;
  await assert.rejects(engine.setClinicAutomation(scene, snapshot, true), /100 %/);
  scene.clinicQuotas.quota = 100;
  await engine.setClinicAutomation(scene, snapshot, true);
  assert.equal(scene.clinicAutomation, true);
  await advance(0);
  assert.equal(patient.hospitalId, "quota");
  assert.equal(events.find(([name]) => name === "transport.start")[1].hospitalId, "quota");
  snapshot.vehicles.find(({ type }) => type === "LNA").status = 1;
  await advance(0);
  assert.equal(scene.clinicAutomation, false);
  assert.equal(patient.hospitalId, "quota");
  snapshot.vehicles.find(({ type }) => type === "LNA").status = 4;
  await advance(0);
  assert.equal(scene.clinicAutomation, false);
  const independent = engine.create({ ...snapshot.incidents[0], id: "other" }, snapshot.second, scene.config);
  assert.equal(independent.clinicAutomation, false);
  assert.deepEqual(Object.keys(independent.clinicQuotas), []);
});

test("blue patients retain accrued risk and become red after surviving preparation", async () => {
  const { snapshot, scene, advance } = fixture({ count: 1 });
  const [patient] = scene.patients;
  Object.assign(patient, { category: "blue", phase: "preparing", doctorScreen: "blue", prescreen: "red",
    vehicleId: "carrier", readyAt: 60, riskMinutes: 30 });
  snapshot.vehicles = [{ ...unit("carrier", "RTW"), patientId: patient.id }];
  await advance(60);
  assert.equal(patient.riskMinutes, 31);
  assert.equal(patient.category, "red");
  assert.equal(patient.doctorScreen, "blue");
  assert.equal(patient.phase, "ready");
  await advance(300);
  assert.equal(patient.riskMinutes, 31);
});

test("clinic alarm requests a readiness delay between 15 and 30 minutes for every hospital once", async () => {
  const { engine, scene, snapshot, events } = fixture({ count: 1 });
  snapshot.hospitals.push(clinic("signed-off", 2, ["internal"], { available: false }));
  await engine.alarmClinics(scene, snapshot.hospitals);
  await engine.alarmClinics(scene, snapshot.hospitals);
  const alarms = events.filter(([name]) => name === "hospital.hold");
  assert.equal(alarms.length, snapshot.hospitals.length);
  assert.deepEqual(alarms.map(([, order]) => order.hospitalId), ["near", "signed-off"]);
  assert.ok(alarms.every(([, order]) => order.readyAfterSeconds >= 900 && order.readyAfterSeconds <= 1800));
});

test("MANV radio reports and clearance work after arrival, with surplus vehicles retained until prescreening", async () => {
  const { advance, snapshot, scene, events } = fixture({ count: 1, mix: { red: 100 } });
  const [patient] = scene.patients;
  patient.category = "red";
  patient.doctorNeeded = false;
  snapshot.vehicles = [unit("spare", "KTW"), unit("rtw", "RTW"), unit("elrd", "ELRD")];
  await advance(0);
  assert.ok(events.some(([name, args]) => name === "vehicle.report" && args.code === 0));
  assert.equal(events.some(([name]) => name === "vehicle.release"), false);
  await advance(30);
  assert.equal(patient.phase, "preparing");
  assert.equal(events.some(([name]) => name === "vehicle.release"), false);
  const spareReleaseAt = scene.surplusReleaseAt.get("spare");
  assert.equal(spareReleaseAt - snapshot.second, 9 * 60);
  await advance(patient.readyAt - snapshot.second);
  assert.ok(events.some(([name, args]) => name === "vehicle.report" && args.code === 5 && args.openPanel && args.vehicleId === "elrd"));
  await advance(spareReleaseAt - snapshot.second - 1);
  assert.equal(events.some(([name]) => name === "vehicle.release"), false);
  await advance(1);
  assert.ok(events.some(([name, args]) => name === "vehicle.release" && args.vehicleId === "spare" && args.automatic));
});

test("clinic requests are bundled, routed through incident leadership, and reminded at most every ten minutes", async () => {
  const { advance, snapshot, scene, events } = fixture({ count: 2 });
  scene.firstUnit = scene.firstRtw = "rtw";
  for (const [index, patient] of scene.patients.entries()) {
    const id = `ktw-${index}`;
    Object.assign(patient, { category: "green", prescreen: "green", doctorScreen: "green", phase: "ready", vehicleId: id });
    snapshot.vehicles.push({ ...unit(id, "KTW"), patientId: patient.id });
  }
  snapshot.vehicles.push(unit("rtw", "RTW"));
  const reports = () => events.filter(([name, args]) => name === "vehicle.report" && args.openPanel).map(([, args]) => args);
  await advance(0);
  assert.equal(scene.openClinicTargets, 2);
  assert.equal(reports()[0].vehicleId, "rtw");
  assert.match(reports()[0].message, /für 2 transportbereite Fahrzeuge/);
  snapshot.vehicles.push(unit("elrd", "ELRD"));
  await advance(599);
  assert.equal(reports().length, 1);
  await advance(1);
  assert.equal(reports().at(-1).vehicleId, "elrd");
  snapshot.vehicles.push(unit("orgl", "ORGL"));
  await advance(600);
  assert.equal(reports().at(-1).vehicleId, "orgl");
  snapshot.vehicles.push(unit("ug", "UG-SANEL"));
  await advance(600);
  assert.equal(reports().length, 4);
  assert.equal(reports().at(-1).vehicleId, "ug");
  assert.match(reports().at(-1).message, /^Hier SanEL/);

  scene.patients.forEach((patient) => { patient.waitingForClinicSince = scene.clock + 60; });
  await advance(600);
  assert.equal(reports().length, 4);
  await advance(60);
  assert.equal(reports().length, 5);
});

test("medical triage can downgrade or upgrade the prescreen result", async () => {
  for (const [category, draw, result] of [["red", .15, "yellow"], ["yellow", .15, "green"], ["green", .95, "yellow"], ["yellow", .95, "red"]]) {
    const { scene, snapshot, advance } = fixture({ count: 1 });
    const [patient] = scene.patients;
    Object.assign(patient, { category, prescreen: category });
    scene.firstUnit = scene.firstDoctor = "nef";
    scene.draw = () => draw;
    scene.physician = { vehicleId: "nef", patientId: patient.id, due: 60 };
    snapshot.vehicles = [{ ...unit("nef", "NEF"), role: "doctor" }];
    await advance(60);
    assert.equal(patient.prescreen, category);
    assert.equal(patient.doctorScreen, result);
  }
});

test("RTH prioritizes red and blue, then yellow before green, and provides its own escort", async () => {
  const { engine, scene, snapshot, advance, events } = fixture({ count: 4 });
  const [green, blue, yellow, red] = scene.patients;
  for (const [patient, category] of [[green, "green"], [blue, "blue"], [yellow, "yellow"], [red, "red"]]) {
    Object.assign(patient, { category, doctorScreen: category, prescreen: category,
      departments: ["trauma"], doctorNeeded: category === "red" });
  }
  scene.firstUnit = "rth-1";
  snapshot.vehicles = Array.from({ length: 4 }, (_, index) => unit(`rth-${index + 1}`, "RTH"));
  await advance(0);
  const assignments = events.filter(([name]) => name === "patient.assign");
  assert.deepEqual(assignments.map(([, { patientId }]) => patientId), [red.id, blue.id, yellow.id, green.id]);
  Object.assign(red, { phase: "ready", hospitalId: "near" });
  assert.equal(await engine.startTransport(scene, red, snapshot.hospitals, snapshot.vehicles), true);
  assert.equal(events.find(([name]) => name === "transport.start")[1].escortVehicleId, null);
});

test("replacement KTW rolls the specified risk once during preparation", async () => {
  for (const [category, draw, dies] of [["red", .149, true], ["red", .15, false], ["yellow", .074, true], ["yellow", .075, false]]) {
    const { engine, scene, snapshot, advance, events } = fixture({ count: 1 });
    const [patient] = scene.patients;
    Object.assign(patient, { category, doctorScreen: category, prescreen: category, yellowType: "RTW", doctorNeeded: false });
    scene.firstUnit = "ktw";
    scene.draw = () => draw;
    snapshot.vehicles = [unit("ktw", "KTW")];
    await engine.assignKtw(scene, patient, "ktw", snapshot);
    assert.equal(patient.phase, "preparing");
    assert.equal(events.find(([name]) => name === "patient.assign")[1].carrier, true);
    scene.draw = () => .99;
    await advance(patient.readyAt);
    assert.equal(patient.phase, dies ? "dead" : "ready");
  }
});

test("MANV closes with every patient accounted for regardless of absent leadership or pending responses", async () => {
  const { advance, scene, snapshot, events } = fixture({ count: 1, ug: true });
  scene.patients[0].phase = "dead";
  snapshot.vehicles = [unit("late", "RTW"), { ...unit("arriving", "RTW"), status: 3 }];
  await advance(0);
  assert.equal(scene.closed, true);
  assert.equal(events.find(([name]) => name === "incident.close")[1].cancelPendingResponses, true);
});

test("MANV resource shortfalls account for helicopters and pending SEG transports", async () => {
  const { scene, snapshot, advance } = fixture({ count: 5, elrd: false, sanel: false, ug: true });
  const [redWithDoctor, , ...green] = scene.patients;
  for (const patient of scene.patients) {
    const category = green.includes(patient) ? "green" : "red";
    Object.assign(patient, { category, prescreen: category, doctorScreen: category, doctorNeeded: patient === redWithDoctor });
  }
  scene.firstUnit = "first";
  scene.known = true;
  snapshot.vehicles = [{ ...unit("rth", "RTH"), status: 3 }];
  snapshot.groups = [{ status: "alarmed", incidentId: scene.id, pending: 2, vehicles: [], vehicleTypes: ["KTW", "KTW"] }];
  await advance(0);
  assert.deepEqual(scene.attention, ["UG SanEL", "1 RTW", "1 KTW"]);
  snapshot.vehicles = [];
  await advance(0);
  assert.deepEqual(scene.attention, ["UG SanEL", "2 RTW", "1 KTW", "1 NEF"]);
});
