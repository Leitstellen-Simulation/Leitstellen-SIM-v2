import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app-transport.js", import.meta.url), "utf8");
const definition = (name) => source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"))[0];

test("a REF situation report stays available and requests RTW and NEF on the first J", () => {
  const ref = { id: "ref", name: "REF", type: "REF", status: 4, incidentId: "case" };
  const incident = { id: "case", status: "vor Ort", patient: { patientCount: 1 } };
  const timers = [];
  const logs = [];
  let simMinute = 19;
  const state = { vehicles: [ref], incidents: [incident], minute: simMinute };
  const missing = ["RTW", "NEF"];
  const api = runInNewContext(
    ["hasPersistentSpeechRequest", "triggerRadioStatus", "maybeSendSituationReport", "assistanceRadioText",
      "sendSpeechPrompt", "completeSpeechPromptResponse"].map(definition).join("\n")
      + "\n({ triggerRadioStatus, maybeSendSituationReport, sendSpeechPrompt })",
    {
      state,
      tna: { acceptingRadio() {}, reason() {} },
      missingVehicleTypesForDispatch: () => missing,
      assistanceSituationText: () => "Patient untersucht.",
      maybeRequestAdditionalResources: () => {
        incident.assistanceDecision = { missing, reason: "Akute Kreislaufprobleme nach Sturz" };
        return missing;
      },
      isDoctorRequirement: (type) => type === "NEF",
      radioIncidentId: () => incident.id,
      relatedIncidentForVehicle: () => incident,
      radioReturnStatusText: () => "am Einsatzort",
      restoreRadioStatusText() {},
      clearRadioDisplayTimer() {},
      renderAll() {},
      renderRadioAlerts() {},
      selectIncidentFromMapOrList() {},
      transportOrClear() {},
      scheduleTimeout: (callback, delay) => timers.push({ callback, delay }),
      simulationDelay: (minutes) => minutes * 60000,
      randomRange: () => 6,
      logRadio: (message) => logs.push(message)
    }
  );
  api.maybeSendSituationReport(ref, incident);
  assert.equal(ref.radioStatus, 0);
  assert.equal(timers.length, 0);
  simMinute += 30;
  state.minute = simMinute;
  assert.equal(api.triggerRadioStatus(ref, 5, "Routinemeldung"), false);
  assert.equal(ref.radioStatus, 0);
  api.sendSpeechPrompt(ref.id);
  assert.equal(timers[0].delay, 6000);
  timers[0].callback();
  assert.deepEqual(incident.assistanceDecision.missing, missing);
  assert.equal(logs.filter((line) => line.includes("Nachforderung: RTW, NEF")).length, 1);
  assert.match(logs.at(-1), /Lage: Patient untersucht\. Nachforderung: RTW, NEF · Akute Kreislaufprobleme nach Sturz\./);
  assert.equal(ref.radioStatus, null);
});

test("a scene request replaces an unanswered departure request with a distinct log entry", () => {
  const vehicle = { id: "rtw", name: "RTW", status: 3, incidentId: "case" };
  const scheduled = [];
  const logs = [];
  const trigger = runInNewContext([definition("hasPersistentSpeechRequest"), definition("triggerRadioStatus"),
    "triggerRadioStatus"].join("\n"), {
    clearRadioDisplayTimer: (unit) => { unit.radioDisplayTimer = null; },
    radioReturnStatusText() {}, radioIncidentId() {},
    logRadio: (message) => logs.push(message),
    simulationDelay: (minutes) => minutes, renderRadioAlerts() {},
    scheduleTimeout: (_callback, delay) => scheduled.push(delay)
  });
  assert.equal(trigger(vehicle, 0, "Status 3", { context: "response-start" }), true);
  assert.deepEqual(scheduled, [5]);
  vehicle.status = 4;
  vehicle.pendingSituationReport = { incidentId: "case" };
  assert.equal(trigger(vehicle, 0, "Lagemeldung"), true);
  assert.equal(vehicle.radioContext, null);
  assert.equal(vehicle.pendingRadioMessage, "Lagemeldung");
  assert.equal(vehicle.radioDisplayTimer, null);
  assert.deepEqual(scheduled, [5]);
  assert.deepEqual(logs, [
    "RTW: Status 0 - dringender Sprechwunsch (Ausrücken)",
    "RTW: Status 0 - dringender Sprechwunsch (Einsatzstelle)"
  ]);
});
