import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "leitstellen-sync-"));
  const bundle = join(root, "bundle");
  const profile = join(root, "profile");
  await mkdir(join(bundle, "maps"), { recursive: true });
  await copyFile(new URL("../server.mjs", import.meta.url), join(bundle, "server.mjs"));
  await copyFile(new URL("../mod-editor.mjs", import.meta.url), join(bundle, "mod-editor.mjs"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { bundle, profile };
}

function map(id, name) {
  return { id, name, stations: [], hospitals: [] };
}

function incident(id, title) {
  return { id, title };
}

async function putBundle(bundle, maps, incidents) {
  await Promise.all([
    ...maps.map((entry) => writeFile(join(bundle, "maps", `${entry.id}.json`), JSON.stringify(entry))),
    writeFile(join(bundle, "incidents-dynamic.json"), JSON.stringify(incidents))
  ]);
}

async function start(t, bundle, profile, port = 0, modsDir = "", bundledModsDir = "") {
  const child = spawn(process.execPath, [join(bundle, "server.mjs")], {
    env: {
      ...process.env, PORT: String(port), DISPATCH_DATA_DIR: profile, DISPATCH_ELECTRON: "1",
      DISPATCH_MODS_DIR: modsDir, DISPATCH_BUNDLED_MODS_DIR: bundledModsDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exit = once(child, "exit");
  let diagnostics = "";
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exit;
  };
  t.after(stop);
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Local server did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DispatchSim running at (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    exit.then(() => {
      clearTimeout(timeout);
      reject(new Error(`Local server exited: ${diagnostics}`));
    }, reject);
  });
  return {
    url,
    stop,
    async request(path, method = "GET", data) {
      const response = await fetch(new URL(path, url), {
        method,
        headers: data === undefined ? {} : { "content-type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data)
      });
      assert.equal(response.status, 200, `${method} ${path}`);
      return response.json();
    }
  };
}

test("startup preserves local edits and deletions, asks for conflicts and remembers choices", async (t) => {
  const { bundle, profile } = await setup(t);
  const ids = ["edit", "untouched", "deleted"];
  await putBundle(bundle, ids.map((id) => map(id, `${id} Map`)), ids.map((id) => incident(id, `${id} Incident`)));
  let app = await start(t, bundle, profile);
  await app.request("/api/maps?summary=1", "POST", map("edit", "Local Map"));
  await app.request("/api/maps?summary=1", "POST", map("custom", "Custom Map"));
  await app.request("/api/maps/deleted", "DELETE");
  const localIncidents = [
    incident("edit", "Local Incident"), incident("untouched", "untouched Incident"), incident("custom", "Custom Incident")
  ];
  await app.request("/api/incidents", "POST", localIncidents);
  assert.deepEqual(JSON.parse(await readFile(join(profile, "incidents-dynamic.json"), "utf8")), localIncidents);
  assert.equal(JSON.parse(await readFile(join(profile, "maps", "edit.json"), "utf8")).name, "Local Map");
  await app.stop();

  app = await start(t, bundle, profile);
  let sync = await app.request("/api/startup-sync");
  assert.deepEqual(sync.mapConflicts, []);
  assert.deepEqual(sync.incidentConflicts, []);
  assert.deepEqual((await app.request("/api/maps")).map(({ id }) => id), ["custom", "edit", "untouched"]);
  assert.deepEqual(await app.request("/api/incidents"), localIncidents);
  await app.stop();

  await putBundle(bundle,
    [...ids, "new"].map((id) => map(id, `${id} Map v2`)),
    [...ids, "new"].map((id) => incident(id, `${id} Incident v2`))
  );
  app = await start(t, bundle, profile);
  sync = await app.request("/api/startup-sync");
  const conflicts = (items) => Object.fromEntries(items.map((item) => [item.id, Boolean(item.localDeleted)]));
  assert.deepEqual(conflicts(sync.mapConflicts), { edit: false, deleted: true });
  assert.deepEqual(conflicts(sync.incidentConflicts), { edit: false, deleted: true });
  assert.equal((await app.request("/api/maps/edit")).name, "Local Map");
  assert.equal((await app.request("/api/maps/untouched")).name, "untouched Map v2");
  assert.equal((await app.request("/api/incidents")).find((item) => item.id === "untouched").title, "untouched Incident v2");
  const decide = (type, id, action) => app.request("/api/startup-sync", "POST", { type, id, action });
  await Promise.all([decide("map", "edit", "beide"), decide("incident", "edit", "lokal")]);
  await Promise.all([decide("map", "deleted", "neu"), decide("incident", "deleted", "neu")]);
  await app.stop();

  app = await start(t, bundle, profile);
  sync = await app.request("/api/startup-sync");
  assert.deepEqual(sync.mapConflicts, []);
  assert.deepEqual(sync.incidentConflicts, []);
  assert.equal((await app.request("/api/maps/edit")).name, "Local Map");
  assert.equal((await app.request("/api/maps/edit-v2")).name, "edit Map v2 v2");
  assert.equal((await app.request("/api/maps/deleted")).name, "deleted Map v2");
  const catalog = await app.request("/api/incidents");
  assert.equal(catalog.find((item) => item.id === "edit").title, "Local Incident");
  assert.equal(catalog.find((item) => item.id === "deleted").title, "deleted Incident v2");
  assert.equal(catalog.find((item) => item.id === "new").title, "new Incident v2");
});

test("Electron falls back to an available port and keeps serving its own profile", async (t) => {
  const { bundle, profile } = await setup(t);
  await putBundle(bundle, [map("test", "Bundle")], []);
  const browser = await start(t, bundle, "");
  const occupiedPort = Number(new URL(browser.url).port);
  const desktop = await start(t, bundle, profile, occupiedPort);
  assert.notEqual(browser.url, desktop.url);
  await desktop.request("/api/maps?summary=1", "POST", map("test", "Desktop Profile"));
  assert.equal((await browser.request("/api/maps/test")).name, "Bundle");
  assert.equal((await desktop.request("/api/maps/test")).name, "Desktop Profile");
});

test("mods are loaded from the configured folder and preferences and data are separate by center", async (t) => {
  const { bundle, profile } = await setup(t);
  const modsDir = join(profile, "Documents", "LSTSIM", "mods");
  const app = await start(t, bundle, profile, 0, modsDir);
  assert.deepEqual(await app.request("/api/mods"), { apiVersion: 1, mods: [], enabledByCenter: {} });

  const manifest = { id: "example", name: "Example", apiVersion: 1, version: "1.0.0" };
  const source = "export default function () {}";
  for (const [id, entry] of [
    ["example", manifest],
    ["incompatible", { ...manifest, id: "incompatible", apiVersion: 2 }],
    ["linked", { ...manifest, id: "linked" }]
  ]) {
    const directory = join(modsDir, id);
    await mkdir(directory);
    await writeFile(join(directory, "manifest.json"), JSON.stringify(entry));
    if (id === "linked") {
      if (process.platform !== "win32") await symlink(join(modsDir, "example", "main.mjs"), join(directory, "main.mjs"), "file");
    }
    else await writeFile(join(directory, "main.mjs"), source);
  }
  assert.deepEqual((await app.request("/api/mods")).mods, [manifest]);
  const entry = await fetch(new URL("/api/mods/example/entry", app.url));
  assert.equal(await entry.text(), source);
  assert.match(entry.headers.get("content-type"), /^text\/plain/);
  assert.equal((await fetch(new URL("/api/mods/linked/entry", app.url))).status, 404);
  assert.equal((await fetch(new URL("/api/mods/incompatible/entry", app.url))).status, 404);
  assert.equal((await fetch(new URL("/api/mods/example/manifest.json", app.url))).status, 404);

  await app.request("/api/mods/preferences", "PUT", { centerId: "ils-a", enabled: ["example"] });
  await app.request("/api/mods/example/data?center=ils-a", "PUT", { value: { count: 4 } });
  assert.deepEqual(await app.request("/api/mods/example/data?center=ils-b"), { value: null });
  await app.stop();

  const restarted = await start(t, bundle, profile, 0, modsDir);
  assert.deepEqual((await restarted.request("/api/mods")).enabledByCenter, { "ils-a": ["example"] });
  assert.deepEqual(await restarted.request("/api/mods/example/data?center=ils-a"), { value: { count: 4 } });
});

test("the MANV catalog can be edited without a mod and stays separate from the normal catalog", async (t) => {
  const { bundle, profile } = await setup(t);
  await putBundle(bundle, [], [incident("same-id", "Normal")]);
  const app = await start(t, bundle, profile);
  const url = new URL("/api/mods/manv/catalog", app.url);
  const empty = await fetch(url);
  const revision = empty.headers.get("etag");
  assert.ok(revision);
  assert.deepEqual(await empty.json(), []);
  const headers = { "content-type": "application/json", "if-match": revision };
  const manv = [{ ...incident("same-id", "MANV"), type: "emergency" }];
  assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(manv) })).status, 200);
  assert.equal((await fetch(url, { method: "POST", headers, body: "[]" })).status, 412);
  assert.deepEqual(await app.request("/api/mods/manv/catalog"), manv);
  assert.deepEqual(await app.request("/api/incidents"), [incident("same-id", "Normal")]);
  assert.deepEqual(JSON.parse(await readFile(join(profile, "mod-catalogs", "manv.json"), "utf8")), manv);
  assert.deepEqual((await app.request("/api/mods")).mods, []);
  assert.equal((await fetch(new URL("/mod-catalogs/manv.json", app.url))).status, 404);
});

test("an installed mod seeds its separate catalog and a local empty catalog takes precedence", async (t) => {
  const { bundle, profile } = await setup(t);
  const modFolder = join(bundle, "mods", "manv");
  await mkdir(modFolder, { recursive: true });
  await Promise.all(["manifest.json", "main.mjs", "scenarios.json"].map((file) =>
    copyFile(new URL(`../mods/manv/${file}`, import.meta.url), join(modFolder, file))));
  await putBundle(bundle, [], [incident("normal", "Normaler Einsatz")]);
  const app = await start(t, bundle, profile);
  const { mods } = await app.request("/api/mods");
  assert.ok(mods.find((mod) => mod.id === "manv")?.scenarioResources.some((rule) => rule.field === "sanel"));
  const [exercise, bus] = await app.request("/api/mods/manv/catalog");
  assert.equal(exercise.id, "test-schule-manv40");
  assert.equal(bus.id, "test-busunfall-manv8");
  assert.equal(bus.weight, 0);
  assert.equal(bus.modData.count, 8);
  const regular = await app.request("/api/incidents");
  assert.deepEqual(regular.map((entry) => entry.id), ["normal"]);
  await app.request("/api/mods/manv/catalog", "POST", []);
  assert.deepEqual(await app.request("/api/mods/manv/catalog"), []);
});

test("Electron loads bundled MANV on clean profiles, honors compatible local updates and preserves saved catalogs", async (t) => {
  const { bundle, profile } = await setup(t);
  const bundledMods = join(bundle, "builtin-mods");
  const localMods = join(profile, "Documents", "LSTSIM", "mods");
  const bundledManv = join(bundledMods, "manv");
  await mkdir(bundledManv, { recursive: true });
  await Promise.all(["manifest.json", "main.mjs", "scenarios.json"].map((file) =>
    copyFile(new URL(`../mods/manv/${file}`, import.meta.url), join(bundledManv, file))));
  await putBundle(bundle, [], []);
  const app = await start(t, bundle, profile, 0, localMods, bundledMods);
  const manifest = JSON.parse(await readFile(join(bundledManv, "manifest.json"), "utf8"));
  const activeVersion = async () => (await app.request("/api/mods")).mods.find(({ id }) => id === "manv")?.version;
  const entry = async () => (await fetch(new URL("/api/mods/manv/entry", app.url))).text();
  assert.equal(await activeVersion(), manifest.version);
  assert.match(await entry(), /function startManv/);
  assert.deepEqual((await app.request("/api/mods/manv/catalog"))
    .filter(({ weight }) => weight > 0).map(({ modData }) => modData.count), [12, 25, 40]);

  const localManv = join(localMods, "manv");
  await mkdir(localManv);
  const writeLocalManifest = (version, apiVersion = manifest.apiVersion) =>
    writeFile(join(localManv, "manifest.json"), JSON.stringify({ ...manifest, version, apiVersion }));
  const localEntry = "export default function localManv() {}";
  await writeFile(join(localManv, "main.mjs"), localEntry);
  await writeLocalManifest("1.0.0");
  assert.equal(await activeVersion(), manifest.version);
  assert.match(await entry(), /function startManv/);
  await writeLocalManifest(manifest.version);
  assert.equal(await entry(), localEntry);
  await writeLocalManifest("99.0.0");
  assert.equal(await activeVersion(), "99.0.0");
  await app.request("/api/mods/manv/catalog", "POST", []);
  await writeLocalManifest("99.0.0", 999);
  assert.equal(await activeVersion(), manifest.version);
  assert.deepEqual(await app.request("/api/mods/manv/catalog"), []);
});
