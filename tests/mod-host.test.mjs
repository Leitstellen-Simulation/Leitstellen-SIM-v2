import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { normalizeModEditorSchema } from "../mod-editor.mjs";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const definition = (source, name, indent = "") =>
  source.match(new RegExp(`^${indent}function ${name}\\([\\s\\S]*?^${indent}}`, "m"))[0];
const app = read("app.js");
const transport = read("app-transport.js");
const mods = read("app-mods.js");
const noOp = () => {};

test("mod timers made during pause keep their remaining simulation seconds on speed change", () => {
  let now = 1200;
  const state = { paused: true, pauseStartedAt: 1000, timeouts: [] };
  const api = runInNewContext(
    ["scheduleTimeout", "armScheduledTimeout", "rescaleScheduledTimeouts", "shiftScheduledTimeouts"]
      .map((name) => definition(transport, name)).join("\n")
      + "\n({ scheduleTimeout, rescaleScheduledTimeouts, shiftScheduledTimeouts })",
    { state, Date: { now: () => now }, window: { clearTimeout: noOp, setTimeout: () => 1 } }
  );
  const timer = api.scheduleTimeout(noOp, 30000);
  now = 1300;
  api.rescaleScheduledTimeouts(0.5);
  now = 2000;
  api.shiftScheduledTimeouts(1000, 1000);
  assert.equal(timer.dueAt - now, 15000);
});

test("hospital holds remain effective until the final incident releases the hospital", () => {
  const hospital = { id: "clinic", unavailable: true };
  const state = { center: { hospitals: [hospital] } };
  const notices = [];
  const timers = [];
  const api = runInNewContext(
    "const hospitalHolds = new Map();" + ["hasHospitalHold", "isHospitalReadyFromHold", "holdHospital", "releaseHospitalHolds"]
      .map((name) => definition(mods, name, "  ")).join("\n")
      + "\n" + definition(app, "hospitalIsUnavailable")
      + "\nconst appMods = { isHospitalReadyFromHold };"
      + "\n({ holdHospital, releaseHospitalHolds, hasHospitalHold, hospitalIsUnavailable })",
    {
      state, incidentEvent: noOp, renderAll: noOp, simulationDelay: (minutes) => minutes * 60000,
      queueHospitalAvailabilityNotice: (_, unavailable) => notices.push(unavailable),
      scheduleTimeout: (callback, delay) => {
        const timer = { callback, delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      cancelScheduledTimeout: (timer) => { timer.cancelled = true; }
    }
  );
  assert.equal(api.holdHospital({ id: "inc-a" }, hospital, 60), true);
  assert.equal(api.holdHospital({ id: "inc-b" }, hospital, 120), true);
  assert.equal(api.holdHospital({ id: "inc-a" }, hospital, 0), false);
  assert.equal(api.hospitalIsUnavailable(hospital), true);
  assert.equal(api.hasHospitalHold(hospital.id), true);
  assert.equal(timers[0].delay, 60000);
  timers[0].callback();
  assert.equal(api.hospitalIsUnavailable(hospital), false);
  assert.equal(api.releaseHospitalHolds("inc-a"), true);
  assert.equal(api.hospitalIsUnavailable(hospital), false);
  assert.equal(api.releaseHospitalHolds("inc-b"), true);
  assert.equal(timers[1].cancelled, true);
  assert.equal(api.hospitalIsUnavailable(hospital), true);
  assert.deepEqual(notices, [false, true]);
  assert.equal(hospital.unavailable, true);
});

test("a mod transport retains its escort until handover and retargeting preserves the other orders", () => {
  const patient = { id: "pat-a" };
  const other = { id: "other-request", vehicleId: "other", patientId: "pat-b" };
  const incident = { id: "incident", modId: "probe", patient: { patients: [patient] }, transportRequests: [other], transportRequest: other };
  const carrier = { id: "rtw", status: 4, incidentId: incident.id, patientId: patient.id, lat: 0, lng: 0 };
  const escort = { id: "nef", status: 4, type: "NEF", incidentId: incident.id, lat: 0, lng: 0 };
  const hospitals = [{ id: "clinic-a", label: "A", lat: 1, lng: 2 }, { id: "clinic-b", label: "B", lat: 3, lng: 4 }];
  const state = { vehicles: [carrier, escort], incidents: [incident], center: { hospitals } };
  const events = [];
  const cleared = [];
  let handover;
  let sequence = 0;
  const api = runInNewContext(
    ["beginTransport", "bindModTransportEscort", "arriveAtModTransportHospital", "patientForVehicle",
      "markPatientTransportStarted", "completeTransportedPatient", "clearTransportRequest"]
      .map((name) => definition(transport, name)).join("\n")
      + "\n" + definition(read("app-render.js"), "changeTransportDestination")
      + "\n({ beginTransport, arriveAtModTransportHospital, changeTransportDestination })",
    {
      state, makeId: () => `request-${++sequence}`, logRadio: noOp, renderAll: noOp,
      patientReadyForTransport: () => true, hospitalSuitableForIncident: () => true,
      transportUsesSignal: () => true, cancelVehicleRoute: (unit) => { unit.routeMeta = null; },
      holdBoundDoctorForDestinationChange: noOp, handoverMinutes: () => 4, simulationDelay: (minutes) => minutes * 60000,
      simMinuteNow: () => 50,
      appMods: { incidentEvent: (event, _, payload) => events.push([event, payload]) },
      driveVehicleTo: (unit, hospital, opts) => {
        unit.target = hospital;
        unit.routeMeta = { signal: opts.signal };
      },
      scheduleTimeout: (callback) => { handover = callback; return { callback }; },
      clearVehicle: (id) => cleared.push(id)
    }
  );
  assert.equal(api.beginTransport(incident.id, "clinic-a", carrier.id, null, { transportId: "order", escort }), true);
  assert.equal(carrier.status, 7);
  assert.equal(escort.status, 7);
  assert.equal(escort.modEscortTransportId, "order");
  const change = api.changeTransportDestination(carrier.id);
  assert.equal(api.changeTransportDestination(carrier.id), change);
  assert.equal(incident.transportRequests[0], other);
  assert.equal(api.beginTransport(incident.id, "clinic-b", carrier.id, change), true);
  assert.equal(carrier.modTransportOrder.id, "order");
  assert.equal(carrier.target.id, "clinic-b");
  assert.equal(incident.transportRequests.length, 1);
  assert.equal(incident.transportRequests[0], other);
  api.arriveAtModTransportHospital(carrier, incident);
  assert.equal(carrier.status, 8);
  assert.equal(escort.status, 8);
  assert.equal(patient.transporting, true);
  assert.deepEqual(cleared, []);
  handover();
  assert.equal(patient.completed, true);
  assert.equal(escort.modEscortTransportId, null);
  assert.deepEqual(cleared, ["nef", "rtw"]);
  assert.deepEqual(events.map(([name]) => name),
    ["transport.started", "transport.destinationRequested", "transport.retargeted", "transport.arrived", "transport.handover"]);
  assert.equal(events.at(-1)[1].hospitalId, "clinic-b");
});

test("editor schemas keep valid fields declarative and reject unknown controls", () => {
  const schema = normalizeModEditorSchema({
    scenario: [
      { key: "patients", label: "Patientenzahl", type: "number", min: 1, default: 10 },
      { key: "categories", label: "Anteile", type: "weights", total: 100, options: [{ label: "A", value: "a" }], default: { a: 100 } },
      { key: "patients", label: "Duplicate", type: "text" },
      { key: "execute", label: "Code", type: "script" }
    ],
    map: [{ key: "quota", label: "Quote", type: "weights", source: "hospitals", total: 100 }]
  });
  assert.deepEqual(schema.scenario.map((entry) => entry.key), ["patients", "categories"]);
  assert.equal(schema.scenario[1].total, 100);
  assert.equal(schema.map[0].source, "hospitals");
});

test("SEG components use one availability roll and bind their full complement to the selected incident", () => {
  const mapClient = read("map-client.js");
  const componentRules = mapClient.slice(mapClient.indexOf("const SUPPORT_COMPONENT_LABELS"), mapClient.indexOf("function isForeignMapPoint"));
  const code = componentRules
    + ["supportGroupLockRemainingMinutes", "supportGroupCanAlarm", "incidentHasDisposition", "reopenIncidentWithoutDisposition",
      "logDispatchAlarm", "alarmSupportGroup"]
      .map((name) => definition(transport, name)).join("\n")
    + "\n({ alarmSupportGroup, supportGroupKind, supportGroupUnits, supportGroupDisplayName, supportGroupResponseWindow })";
  const group = { id: "test-seg", label: "SEG Transport Stadt", availabilityProbability: .8, maxResponseMinutes: 12,
    units: [{ id: "old-rtw", type: "RTW" }, { id: "ktw-one", type: "KTW" }] };
  for (const random of [.4, .9]) {
    const dispatch = { status: "bereit", pending: 0, activeVehicleIds: [] };
    const incident = { id: "incident", keyword: "MANV", status: "offen", modId: "manv" };
    const state = { center: { supportGroups: [group] }, incidents: [incident], vehicles: [], supportGroupStates: { [group.id]: dispatch } };
    const appointments = [];
    const assigned = [];
    const radio = [];
    let draws = 0;
    const api = runInNewContext(code, {
      state, SUPPORT_GROUP_LOCKOUT_MINUTES: 45, supportGroupState: () => dispatch,
      Math: Object.create(Math, { random: { value: () => { draws++; return random; } } }),
      normalizeProbability: (probability) => probability,
      randomRange: (min) => min, simMinuteNow: () => 100, simulationDelay: (min) => min,
      logRadio: (...args) => radio.push(args), renderAll: noOp, appMods: { incidentEvent: noOp },
      scheduleTimeout: (callback, delay) => appointments.push({ callback, delay }),
      createSupportGroupVehicle: (_, unit) => ({ id: unit.id, type: unit.type }),
      assignVehicle: (id, incidentId) => assigned.push([id, incidentId])
    });
    assert.equal(api.supportGroupKind(group), "transport");
    assert.equal(api.supportGroupDisplayName(group), "SEG-Transport Stadt");
    assert.equal(api.supportGroupResponseWindow({}).max, 15);
    assert.equal(api.supportGroupResponseWindow({ maxResponseMinutes: 100 }).max, 90);
    assert.deepEqual(Array.from(api.supportGroupUnits({ kind: "treatment" }), (unit) => unit.type), ["GW-SAN"]);
    assert.equal(api.alarmSupportGroup(group.id), false);
    assert.equal(api.alarmSupportGroup(group.id, incident.id), true);
    assert.equal(incident.status, "alarmiert");
    assert.equal(api.alarmSupportGroup(group.id, incident.id), false);
    assert.equal(draws, 1);
    assert.equal(radio.some(([, level]) => level === "urgent"), false);
    assert.deepEqual(appointments.map(({ delay }) => delay), random < .8 ? [5, 5] : [12]);
    appointments.forEach(({ callback }) => callback());
    if (random < .8) {
      assert.deepEqual(state.vehicles.map((unit) => unit.type), ["KTW", "KTW"]);
      assert.deepEqual(assigned.map(([, incidentId]) => incidentId), [incident.id, incident.id]);
      assert.equal(dispatch.incidentId, incident.id);
    } else {
      assert.equal(state.vehicles.length, 0);
      assert.equal(dispatch.incidentId, null);
      assert.equal(incident.status, "offen");
      assert.equal(dispatch.lockedUntilAbsoluteMinute, 145);
      assert.deepEqual(radio.filter(([, level]) => level === "urgent"),
        [["SEG-Transport Stadt: nach 12 min nicht ausgerückt. 45 min nicht verfügbar.", "urgent", incident.id]]);
    }
  }
});

test("five vehicles alarmed together produce one incident-linked entry and keep turnout failures visible", () => {
  const transportCode = ["alarmIncidentResources", "logDispatchAlarm", "alarmSupportGroup", "reopenIncidentWithoutDisposition",
    "incidentHasDisposition", "supportGroupCanAlarm", "supportGroupLockRemainingMinutes"]
    .map((name) => definition(transport, name)).join("\n");
  const cases = [
    { direct: ["RTW 1", "RTW 2"], keyword: "RD 5", expected: null },
    { direct: ["RTW 1", "RTW 2", "RTW 3"], keyword: "RD 5", expected: "Sammelalarm · 5 Fahrzeuge alarmiert · RD 5" },
    { direct: ["RTW 1", "RTW 2", "RTW 3"], keyword: "RD MANV 16-25", expected: "MANV-Alarm · 5 Fahrzeuge alarmiert · RD MANV 16-25" }
  ];
  for (const { direct, keyword, expected } of cases) {
    const incident = { id: "case", keyword, status: "offen", assigned: [] };
    const groups = [{ id: "seg", label: "SEG eins" }, { id: "failed", label: "SEG zwei", availabilityProbability: 0 }];
    const supportGroupStates = Object.fromEntries(groups.map(({ id }) => [id, { pending: 0, activeVehicleIds: [] }]));
    const radio = [];
    const timers = [];
    const api = runInNewContext(transportCode + "\n({ alarmIncidentResources, logDispatchAlarm })", {
      state: { center: { supportGroups: groups }, incidents: [incident], supportGroupStates, vehicles: [] },
      logRadio: (...entry) => radio.push(entry), SUPPORT_GROUP_LOCKOUT_MINUTES: 45, simMinuteNow: () => 0,
      supportGroupState: (id) => supportGroupStates[id], supportGroupUnits: () => [{ id: "KTW 1" }, { id: "KTW 2" }],
      supportGroupResponseWindow: () => ({ min: 3, max: 5 }), supportGroupKind: () => "transport",
      supportGroupDisplayName: ({ label }) => label, createSupportGroupVehicle: (_, unit) => unit,
      normalizeProbability: (value) => value, Math: Object.create(Math, { random: { value: () => .4 } }),
      scheduleTimeout: (callback) => timers.push(callback), randomRange: (min) => min, simulationDelay: (minutes) => minutes,
      renderAll: noOp, assignVehicle: (id, incidentId, batch) => api.logDispatchAlarm(incidentId, id, "radio", batch)
    });
    api.alarmIncidentResources(incident, direct, ["seg", "not-available"]);
    const messages = radio.filter(([message]) => !message.includes("fehlgeschlagen")).map(([message]) => message);
    assert.deepEqual(messages, expected ? [expected] : [...direct, `SEG eins: alarmiert zu ${keyword}.`]);
    timers.splice(0).forEach((callback) => callback());
    assert.deepEqual(radio.filter(([message]) => message.startsWith("KTW")).map(([message]) => message),
      expected ? [] : ["KTW 1", "KTW 2"]);
    assert.ok(radio.every(([, , incidentId]) => incidentId === incident.id));

    api.alarmIncidentResources(incident, direct, ["failed"]);
    timers.forEach((callback) => callback());
    assert.ok(radio.some(([message, kind]) => kind === "urgent" && message.includes("SEG zwei: nach 5 min nicht ausgerückt.")));
  }
});

test("only status 3 is sent on departure for MANV or when more than ten vehicles are assigned", () => {
  const code = definition(read("map-client.js"), "normalizeStatus3Radio")
    + "\n" + definition(transport, "responseStartRadioMode") + "\nresponseStartRadioMode";
  const mode = runInNewContext(code);
  assert.equal(mode({ assigned: Array(10) }, true), "0");
  assert.equal(mode({ assigned: Array(10) }, false), "5");
  assert.equal(mode({ assigned: Array(1), modId: "manv" }, true), "none");
  assert.equal(mode({ assigned: Array(1), keyword: "RD MANV 16-25" }, false), "none");
  assert.equal(mode({ assigned: Array(11) }, true), "none");
  assert.equal(mode({ assigned: Array(11) }, false), "none");
  assert.equal(mode({ assigned: Array(2) }, true, { signal: "5" }), "5");
});

test("vehicle marker offsets keep dense markers apart and inside the map", () => {
  const offset = runInNewContext(definition(read("app-render.js"), "vehicleMarkerOffset") + "\nvehicleMarkerOffset");
  const occupied = [{ x: 170, y: 90, width: 36, height: 36 }];
  const mapSize = { x: 350, y: 260 };
  for (let index = 0; index < 5; index++) {
    const original = { x: 170, y: 90 };
    const delta = offset(original, mapSize, occupied, 80, 34);
    const current = occupied.at(-1);
    assert.equal(current.x, original.x + delta.x);
    assert.ok(current.x >= 44 && current.x <= mapSize.x - 44);
    assert.ok(current.y >= 21 && current.y <= mapSize.y - 21);
    assert.ok(occupied.slice(0, -1).every((entry) => Math.abs(entry.x - current.x) >= (entry.width + 80) / 2 + 4
      || Math.abs(entry.y - current.y) >= (entry.height + 34) / 2 + 4));
  }
  const edge = offset({ x: 2, y: 2 }, mapSize, [], 80, 34);
  assert.equal(edge.x, 42);
  assert.equal(edge.y, 19);
});

test("standing down a transport component leaves its hospital handover running", () => {
  const vehicle = { id: "ktw", status: 8, supportGroupId: "seg", incidentId: "incident", handoverTimer: {} };
  const timer = vehicle.handoverTimer;
  const recall = runInNewContext(definition(transport, "recallSupportGroupVehicle") + "\nrecallSupportGroupVehicle",
    { state: { vehicles: [vehicle] } });
  recall(vehicle.id);
  assert.equal(vehicle.status, 8);
  assert.equal(vehicle.incidentId, "incident");
  assert.equal(vehicle.handoverTimer, timer);
});

test("the host keeps MANV out of the shift menu even for legacy manifests and only opens incident panels", () => {
  const api = runInNewContext(
    ["usesIncidentPanel", "canOpenPanel", "panelName"].map((name) => definition(mods, name, "  ")).join("\n")
    + "\n({ usesIncidentPanel, canOpenPanel, panelName })"
  );
  const legacy = { id: "manv", name: "MANV-Leitstelle" };
  const incidents = [
    { id: "a", modId: "manv" }, { id: "b", modId: "manv" }, { id: "c" }, { id: "d", modId: "other" }
  ];
  assert.equal(api.usesIncidentPanel(legacy), true);
  assert.equal(api.panelName(legacy), "MANV-Übersicht");
  assert.equal(api.canOpenPanel(legacy, null, incidents), false);
  assert.equal(api.canOpenPanel(legacy, "a", incidents), true);
  assert.equal(api.canOpenPanel(legacy, "b", incidents), true);
  assert.equal(api.canOpenPanel(legacy, "c", incidents), false);
  assert.equal(api.canOpenPanel(legacy, "d", incidents), false);
  assert.equal(api.canOpenPanel({ id: "other" }, null, incidents), true);
});

test("standalone components keep their pin and grouped components follow the dedicated station", () => {
  const locate = runInNewContext(definition(read("map-client.js"), "supportGroupLocation") + "\nsupportGroupLocation");
  const station = { id: "seg-wache", label: "SEG-Wache", lat: 49, lng: 12 };
  const legacy = { id: "rw", label: "Rettungswache", lat: 48, lng: 11 };
  const map = { mapCenter: [47, 10], stations: [legacy], supportStations: [station] };
  const independent = { id: "allein", label: "SEG-Transport", lat: 49.1, lng: 12.1 };
  const grouped = { ...independent, supportStationId: station.id };
  assert.equal(locate(map, independent).lat, 49.1);
  assert.equal(locate(map, { ...independent, stationId: legacy.id }).lat, 48);
  assert.equal(locate(map, grouped, { stationId: legacy.id }).lat, 49);
  station.lat = 49.2;
  assert.equal(locate(map, grouped).lat, 49.2);
});

test("the Regensburg test station supplies five transport components, treatment and UG SanEL", () => {
  const map = JSON.parse(read("maps/ils-regensburg-testversion-stadt-regensburg.json"));
  const station = map.supportStations.find(({ id }) => id === "seg-wache-uebung-regensburg");
  const groups = map.supportGroups.filter((group) => group.supportStationId === station.id);
  assert.deepEqual(groups.map((group) => group.kind), ["transport", "transport", "transport", "transport", "transport", "treatment", "sanel"]);
  assert.deepEqual(groups.map((group) => group.units.map((unit) => unit.type)), [
    ["KTW", "KTW"], ["KTW", "KTW"], ["KTW", "KTW"], ["KTW", "KTW"], ["KTW", "KTW"], ["GW-SAN"], ["UG-SANEL"]
  ]);
  assert.equal(new Set(groups.flatMap((group) => group.units.map((unit) => unit.id))).size, 12);
  assert.equal(map.stations.some((entry) => entry.units?.some((unit) => unit.type === "UG-SANEL")), false);
});

test("legacy standalone components get individual stations while linked components remain in place", () => {
  const client = read("map-client.js");
  const migrate = runInNewContext(["supportGroupLocation", "attachLegacySupportGroups"]
    .map((name) => definition(client, name)).join("\n") + "\nattachLegacySupportGroups");
  const map = { mapCenter: [49, 12], stations: [], supportStations: [{ id: "existing" }],
    supportGroups: [{ id: "linked", supportStationId: "existing" }, { id: "single", lat: 49.1, lng: 12.1 }] };
  migrate(map);
  migrate(map);
  assert.deepEqual(map.supportGroups.map((entry) => entry.supportStationId), ["existing", "seg-wache-single"]);
  assert.deepEqual(map.supportStations.map(({ lat, lng }) => [lat, lng]), [[undefined, undefined], [49.1, 12.1]]);
});

test("LNA and OrgL appear in the fleet list only in status 3", () => {
  const visible = runInNewContext(definition(read("app-render.js"), "vehicleVisibleInFleet") + "\nvehicleVisibleInFleet");
  for (const type of ["LNA", "ORGL"]) {
    assert.deepEqual([1, 2, 3, 4, 6, 7, 8].filter((status) => visible({ type, status })), [3]);
  }
  assert.equal(visible({ type: "RTW", status: 2 }), true);
});

test("individual UGRD turnout varies around the nominal time, with the ordinary fallback for older maps", () => {
  let draw = 0;
  const delay = runInNewContext(["configuredUgrdTurnoutMinutes", "turnoutDelayMinutes"]
    .map((name) => definition(transport, name)).join("\n") + "\nturnoutDelayMinutes", {
      randomFloat: (min, max) => min + draw * (max - min),
      randomRange: () => 1, isAirMedicalVehicle: () => false, isStabilizerVehicle: () => false
    });
  const vehicle = { type: "RTW", status: 2, ugrdTurnoutMinutes: 8, dispatchSignal: false };
  assert.equal(delay(vehicle), 4);
  draw = .5;
  assert.equal(delay(vehicle), 8);
  draw = 1;
  assert.equal(delay(vehicle), 12);
  assert.equal(delay({ ...vehicle, ugrdTurnoutMinutes: 0.1 }), 0.15);
  assert.equal(delay({ ...vehicle, ugrdTurnoutMinutes: 0 }), 0);
  assert.equal(delay({ type: "RTW", status: 1, ugrdTurnoutMinutes: 8 }), 0);
  assert.equal(delay({ type: "RTW", status: 2, dispatchSignal: false }), 1.5);
});
