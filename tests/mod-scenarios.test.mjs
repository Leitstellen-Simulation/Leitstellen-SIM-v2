import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mod-scenarios.js", import.meta.url), "utf8");
const { createModScenarioSchedule, selectShiftMods } = runInNewContext(
  source + "\n({ createModScenarioSchedule, selectShiftMods })"
);

test("each six-hour block draws once and the previous day's blocks do not repeat", () => {
  const draws = [0.24, 0.5, 0.26, 0.26, 0.2, 0.25];
  const due = createModScenarioSchedule({ enabled: true, chanceByBlock: [25, 50, 0, 0] }, 0, () => draws.shift());
  assert.deepEqual([...due(179)], []);
  assert.deepEqual([...due(180)], [180]);
  assert.deepEqual([...due(180)], []);
  assert.deepEqual([...due(1439)], [453]);
  assert.deepEqual([...due(1530)], [1530]);
  assert.equal(draws.length, 0);
});

test("a shift skips events that landed before it started and disabled schedules do not roll", () => {
  const due = createModScenarioSchedule({ enabled: true, chanceByBlock: [100, 0, 0, 0] }, 123, () => 0);
  assert.deepEqual([...due(124)], []);
  assert.deepEqual([...due(359)], []);
  const disabled = createModScenarioSchedule({ enabled: false, chanceByBlock: [100, 0, 0, 0] }, 0, () => assert.fail("disabled"));
  assert.deepEqual([...disabled(500)], []);
});

test("MANV requires manual activation in the map and an installed compatible mod", () => {
  const manv = { id: "manv", name: "MANV", scenarioCatalog: true };
  const regular = { id: "other" };
  assert.deepEqual([...selectShiftMods([manv, regular], ["manv", "other"], {}).selected], [regular]);
  const configured = { manv: { enabled: true, chanceByBlock: [100, 100, 100, 100] } };
  assert.deepEqual([...selectShiftMods([manv], [], configured).selected], [manv]);
  const missing = selectShiftMods([regular], ["other"], configured);
  assert.deepEqual([...missing.selected], [regular]);
  assert.equal(missing.unavailable[0].id, "manv");
});
