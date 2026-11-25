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
    ["hasConfiguredLocalRef", "keywordForCenter", "requiredVehiclesForCenter",
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
  const queue = runInNewContext(
    definition(read("app-transport.js"), "openReportedAssistanceNeeds") + "\n"
      + read("app-queue.js") + "\ndispatchQueueItems",
    {
      state: { incidents: [incident] },
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
