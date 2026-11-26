import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const definition = (source, name) => source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"))[0];

test("RD 0 promotes at centers without a local REF but keeps an off-duty REF in the fleet", () => {
  const state = {};
  const app = read("app.js");
  const keyword = { label: "RD 0 Sonstige - Hilfeleistung akut", required: ["REF"], signal: true };
  const api = runInNewContext(
    ["hasConfiguredLocalRef", "keywordForCenter", "isManvOnlyVehicleType", "requiredVehiclesForCenter",
      "dispositionKeywords", "findDispositionKeyword", "normalizeRequiredVehicles"].map((name) => definition(app, name)).join("\n")
      + "\n({ hasConfiguredLocalRef, findDispositionKeyword, requiredVehiclesForCenter })",
    { state, rdKeywords: [keyword] }
  );
  state.hasLocalRef = api.hasConfiguredLocalRef([{ type: "REF", foreign: false, status: 6 }]);
  assert.equal(api.findDispositionKeyword(keyword.label), keyword);
  state.hasLocalRef = api.hasConfiguredLocalRef([{ type: "REF", foreign: true, status: 2 }]);
  const converted = api.findDispositionKeyword(keyword.label);
  assert.equal(converted.label, "RD 1 Sonstige - Hilfeleistung akut");
  assert.equal(converted.required.join(), "RTW");
  assert.equal(api.requiredVehiclesForCenter(["REF", "NEF"]).join(), "RTW,NEF");
  assert.deepEqual(keyword.required, ["REF"]);
});

test("an alarmed KTW suppresses early dispatch prompts until an actual report comes in", () => {
  const incident = { id: "case", assigned: [], type: "transport", keyword: "KTP", createdAtAbsoluteMinute: 0 };
  const state = { incidents: [incident], supportGroupStates: {} };
  const queue = runInNewContext(
    ["openReportedAssistanceNeeds", "incidentHasDisposition"].map((name) => definition(read("app-transport.js"), name)).join("\n") + "\n"
      + read("app-queue.js") + "\ndispatchQueueItems",
    {
      state,
      el: { callDispositionDialog: {}, incidentDialog: {} },
      pendingCallQueue: () => [],
      vehiclesWithRadioAlerts: () => [],
      tna: { requestTime: () => null },
      activeTransportRequests: () => [],
      missingVehicleTypesForDispatch: () => ["RTW"],
      missingExternalServices: () => [],
      incidentListBucket: () => "transport",
      formatDisposition: (types) => types.join(", ")
    }
  );
  assert.equal(queue()[0].label, "Disposition offen");
  state.supportGroupStates.seg = { incidentId: incident.id };
  assert.equal(queue().length, 0);
  state.supportGroupStates.seg.incidentId = null;
  assert.equal(queue()[0].label, "Disposition offen");
  incident.assigned = ["ktw"];
  assert.equal(queue().length, 0);
  incident.assistanceDecision = { missing: ["RTW"], createdAtAbsoluteMinute: 0 };
  assert.equal(queue().length, 0, "A reported need cannot surface before the first arrival");
  incident.firstUnitOnSceneAtMinute = 0;
  incident.assistanceDecision = null;
  assert.equal(queue().length, 0, "Arrival by itself is not a request");
  incident.assistanceDecision = { missing: ["RTW"], createdAtAbsoluteMinute: 1 };
  assert.equal(queue()[0].label, "Nachforderung");
  assert.match(queue()[0].detail, /RTW/);
  Object.assign(incident, { assistanceDecision: null, modId: "manv", modAttention: ["1 RTW"], modClinicTargets: 2 });
  assert.equal(queue().find(({ key }) => key === "module-clinic-case").label, "2 Klinikziele offen");
  assert.equal(queue().find(({ key }) => key === "module-case").detail, "1 RTW");
  incident.modClinicTargets = 0;
  assert.equal(queue().some(({ key }) => key === "module-clinic-case"), false);
});

test("surplus vehicles automatically report free after a delay and are kept if needed again", () => {
  const transport = read("app-transport.js");
  const ktw = { id: "ktw", status: 4, incidentId: "event", type: "KTW" };
  const incident = { id: "event", assigned: [ktw.id], firstUnitOnSceneAtMinute: 0, patient: { patients: [{}] } };
  const timers = [];
  const radio = [];
  let needed = false;
  const vm = runInNewContext(
    ["scheduleSurplusVehicleClearances", "vehicleIsSurplus", "requestVehicleClearance"]
      .map((name) => definition(transport, name)).join("\n") + "\nscheduleSurplusVehicleClearances",
    {
      state: { vehicles: [ktw] }, vehicleClearBlockReason: () => "", incidentRequiresElrd: () => false,
      patientsNeedVehicleType: () => needed, vehicleStillRequiredForAssignedPatient: () => false,
      canRemoveAssignedVehicle: () => false, renderAll: () => {}, markSurplusRequirementsResolved: () => {},
      randomRange: (low, high) => (low + high) / 2, simulationDelay: (minutes) => minutes,
      scheduleTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
      cancelScheduledTimeout: () => {}, triggerRadioStatus: (...args) => radio.push(args)
    }
  );
  vm(incident);
  vm(incident);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 9);
  needed = true;
  timers[0].callback();
  assert.deepEqual(radio, []);
  needed = false;
  vm(incident);
  timers[1].callback();
  assert.equal(radio[0][0], ktw);
  assert.equal(radio[0][1], 5);
  assert.equal(radio[0][3].displayMinutes, 1);
});
test("assistance reasons use authored findings, runtime escalation and a resource-specific fallback", () => {
  const patient = { required: ["RTW", "NEF"], conditionReport: "Der Patient wird zunehmend kreislaufinstabil." };
  const incident = { patient: { patients: [patient] } };
  const vehicle = { type: "KTW" };
  const app = read("app-transport.js");
  const api = runInNewContext(
    ["assistanceRequestReason", "assistanceRadioText"].map((name) => definition(app, name)).join("\n")
      + "\n({ assistanceRequestReason, assistanceRadioText })",
    {
      patientMissingTypes: (entry) => entry.required,
      isDoctorRequirement: (type) => type === "NEF",
      ROAD_TRANSPORT_REQUIREMENT_TYPES: ["RTW", "KTW", "ITW"],
      tna: { reason: (item) => item.tnaFailure }
    }
  );
  assert.match(api.assistanceRequestReason(vehicle, incident, ["RTW", "NEF"]), /kreislaufinstabil/);
  incident.patient.assistanceReason = "Weitere Versorgung nach deutlicher Verschlechterung.";
  const authored = api.assistanceRequestReason(vehicle, incident, ["RTW"]);
  assert.equal(authored, "Weitere Versorgung nach deutlicher Verschlechterung");
  assert.equal(api.assistanceRadioText(["RTW"], authored, incident.patient.assistanceReason), "Nachforderung: RTW.");
  patient.acuity = "reanimation";
  incident.tnaFailure = "TNA-System am RTW ausgefallen";
  assert.match(api.assistanceRequestReason(vehicle, incident, ["NEF"]), /Reanimation läuft.*TNA-System/);
  patient.acuity = "stable";
  patient.conditionReport = "";
  incident.patient.assistanceReason = "";
  assert.match(api.assistanceRequestReason(vehicle, incident, ["RTW"]), /KTW .* nicht übernehmen/);
});

test("mod-owned incidents use the explicit dispatch requirements and assignments", () => {
  const source = read("app-transport.js");
  const api = runInNewContext(
    ["missingVehicleTypesForDispatch", "incidentRequiresElrd", "patientForVehicle"]
      .map((name) => definition(source, name)).join("\n")
      + "\n({ missingVehicleTypesForDispatch, incidentRequiresElrd, patientForVehicle })",
    { missingVehicleTypes: (incident) => incident.required }
  );
  const patients = [{ id: "one" }, { id: "two" }];
  const incident = { modId: "example", required: ["RTW"], patient: { patients } };

  assert.deepEqual(api.missingVehicleTypesForDispatch(incident), ["RTW"]);
  assert.equal(api.incidentRequiresElrd(incident), false);
  assert.equal(api.patientForVehicle({}, incident), null);
  assert.equal(api.patientForVehicle({ patientId: "two" }, incident), patients[1]);
  delete incident.modId;
  assert.equal(api.incidentRequiresElrd(incident), true);
  assert.equal(api.patientForVehicle({}, incident), patients[0]);
});

test("only RD 4, RD 5 and MANV allow UGRD in automatic disposition with the ABeK group defaults", () => {
  const app = read("app.js");
  const el = { incidentKeyword: { value: "" } };
  const state = { manvAvailable: true };
  const api = runInNewContext("const window = {};" + read("keywords.js") + "\nconst { rdKeywords } = window;\n"
    + ["automaticDispositionPolicy", "dispositionDefaults", "findDispositionKeyword", "dispositionKeywords",
      "keywordForCenter", "requiredVehiclesForCenter", "normalizeRequiredVehicles", "isManvOnlyVehicleType"]
      .map((name) => definition(app, name)).join("\n")
    + "\n({ automaticDispositionPolicy, dispositionDefaults, rdKeywords })", { el, state });
  const policyFor = (source, label, transportCount) => api.automaticDispositionPolicy(source, label, transportCount, true);
  const rd4 = api.rdKeywords.find(({ label }) => label.startsWith("RD 4 "));
  const rd5 = api.rdKeywords.find(({ label }) => label.startsWith("RD 5 "));
  assert.deepEqual([rd4, rd5].map(({ required }) => [required.filter((type) => type === "RTW").length,
    required.filter((type) => type === "NEF").length]), [[4, 1], [5, 3]]);
  assert.equal(policyFor(null, "RD 3").allowUgrd, false);
  assert.equal(policyFor({ keyword: rd4.label }, "").allowUgrd, false);
  assert.equal(policyFor(null, rd4.label).allowUgrd, true);
  assert.equal(policyFor(null, rd4.label).components.transport, undefined);
  assert.equal(policyFor(null, rd5.label).allowUgrd, true);
  assert.equal(policyFor(null, rd5.label).components.transport, 1);
  assert.equal(policyFor(null, rd5.label).components.sanel, 1);
  assert.deepEqual(Object.entries(api.automaticDispositionPolicy(null, rd5.label, undefined, false).components), [["transport", 1]]);
  const manv = ["10-15", "16-25", "26-50", "51-100", "ab 100"];
  assert.deepEqual(manv.map((tier) => {
    const { transport, treatment } = policyFor(null, `RD MANV ${tier}`).components;
    return [transport, treatment];
  }), [[1, 0], [2, 1], [5, 2], [10, 3], [18, 3]]);
  assert.equal(policyFor(null, "RD MANV 26-50", 0).components.transport, 0);
  assert.deepEqual(Object.entries(api.automaticDispositionPolicy(null, "RD MANV 26-50", undefined, false).components), [["transport", 5]]);
  const school = { modId: "manv", keyword: "MANV-Schulübung", required: ["RTW", "RTW", "NEF", "NEF"],
    requiredServices: ["POL"], modScenario: { data: { count: 40, segTransport: 5, segTreatmentCount: 1, ug: false } } };
  const policy = policyFor(school, "", 9);
  assert.deepEqual([policy.components.transport, policy.components.treatment, policy.components.sanel], [5, 1, 0]);
  el.incidentKeyword.value = school.keyword;
  assert.equal(api.dispositionDefaults(school).required.join(), "RTW,RTW,NEF,NEF");
  el.incidentKeyword.value = rd5.label;
  assert.equal(api.dispositionDefaults(school).required.join(), rd5.required.join());
  assert.ok(api.dispositionDefaults(school).requiredServices.includes("POL"));
  assert.equal(policyFor(school, rd5.label, 9).components.transport, 1);
  assert.equal(policyFor(school, rd5.label, 9).components.sanel, 1);
  el.incidentKeyword.value = "RD MANV 26-50";
  assert.equal(api.dispositionDefaults(school).required.filter((type) => type === "RTW").length, 25);
});

test("without MANV, only ordinary UGRD vehicles and both SEG transport KTW remain available", () => {
  const state = { manvAvailable: false };
  const app = read("app.js");
  const api = runInNewContext(read("map-client.js") + "\n" +
    ["isManvOnlyVehicleType", "supportGroupsWithoutManv", "requiredVehiclesForCenter", "normalizeRequiredVehicles"]
      .map((name) => definition(app, name)).join("\n")
    + "\n({ supportGroupsWithoutManv, supportGroupUnits, requiredVehiclesForCenter })", { state });
  const groups = [
    { id: "transport", kind: "transport", units: [{ type: "KTW", name: "KTW 1" }, { type: "KTW", name: "KTW 2" }] },
    { id: "treatment", kind: "treatment" },
    { id: "sanel", kind: "sanel" },
    { id: "mixed", units: [{ type: "RTW" }, { type: "lna" }, { type: "GW-SAN" }] },
    { id: "leadership", units: [{ type: "ORGL" }] }
  ];
  const [transportGroup, mixedGroup] = api.supportGroupsWithoutManv(groups);
  assert.deepEqual(Array.from(api.supportGroupsWithoutManv(groups), ({ id }) => id), ["transport", "mixed"]);
  assert.equal(transportGroup, groups[0]);
  assert.deepEqual(Array.from(api.supportGroupUnits(transportGroup), ({ type }) => type), ["KTW", "KTW"]);
  assert.equal(mixedGroup.units.map(({ type }) => type).join(), "RTW");
  assert.equal(groups[3].units.length, 3);
  const required = ["RTW", "ELRD", "OrgL", "LNA", "UG-SANEL", "GW-SAN"];
  assert.equal(api.requiredVehiclesForCenter(required).join(), "RTW,ELRD");
  state.manvAvailable = true;
  assert.equal(api.requiredVehiclesForCenter(required).join(), "RTW,ELRD,ORGL,LNA,UG-SANEL,GW-SAN");
});

test("automatic vehicle selection compares free foreign vehicles and excludes UGRD outside major incidents", () => {
  const state = { vehicles: [
    { id: "component-unit", type: "RTW", status: 1, supportGroupId: "seg", distance: .1 },
    { id: "ugrd", type: "RTW", status: 2, ugrdAvailabilityProbability: .8, distance: .2 },
    { id: "foreign-unavailable", type: "RTW", foreign: true, status: 6, distance: .3 },
    { id: "foreign-free", type: "RTW", foreign: true, status: 2, distance: .4 },
    { id: "local", type: "RTW", status: 2, distance: .5 }
  ] };
  const nearest = runInNewContext(["automaticDispositionVehicle", "foreignVehicleAvailableForDisposition", "nearestFreeVehicleOfTypes"]
    .map((name) => definition(read("app-render.js"), name)).join("\n") + "\nnearestFreeVehicleOfTypes", {
    state, isAlarmable: (vehicle) => [1, 2].includes(vehicle.status) && !vehicle.nextIncidentId,
    distanceToCall: (vehicle) => vehicle.distance
  });
  assert.equal(nearest({}, ["RTW"], new Set()).id, "foreign-free");
  assert.equal(nearest({}, ["RTW"], new Set(), { allowUgrd: true }).id, "ugrd");
  state.vehicles.find((vehicle) => vehicle.id === "foreign-free").nextIncidentId = "assigned";
  assert.equal(nearest({}, ["RTW"], new Set()).id, "local");
});
