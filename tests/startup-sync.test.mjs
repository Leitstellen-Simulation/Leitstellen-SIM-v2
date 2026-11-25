import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "leitstellen-sync-"));
  const bundle = join(root, "bundle");
  const profile = join(root, "profile");
  await mkdir(join(bundle, "maps"), { recursive: true });
  await copyFile(new URL("../server.mjs", import.meta.url), join(bundle, "server.mjs"));
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

async function start(t, bundle, profile, port = 0) {
  const child = spawn(process.execPath, [join(bundle, "server.mjs")], {
    env: { ...process.env, PORT: String(port), DISPATCH_DATA_DIR: profile, DISPATCH_ELECTRON: "1" },
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
