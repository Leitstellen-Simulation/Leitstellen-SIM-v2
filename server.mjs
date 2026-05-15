import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4173);
const root = dirname(fileURLToPath(import.meta.url));
const mapsDir = join(root, "maps");
const incidentsFile = join(root, "incidents-data.json");
const maxBodyBytes = 2_000_000;
const adminPassword = process.env.DISPATCH_ADMIN_PASSWORD || "XXX112XXX";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/maps")) {
      await handleMapsApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/api/incidents")) {
      await handleIncidentsApi(request, response);
      return;
    }
    if (url.pathname === "/api/admin-login") {
      await handleAdminLogin(request, response);
      return;
    }
    await serveStaticFile(request, response, url);
  } catch (error) {
    console.error(error);
    sendJson(response, { error: "internal server error" }, 500);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`DispatchSim running at http://127.0.0.1:${port}/`);
  if (!process.env.DISPATCH_ADMIN_PASSWORD) {
    console.log("Admin password uses the development default. Set DISPATCH_ADMIN_PASSWORD to override it.");
  }
});

async function serveStaticFile(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeContentPath(requestedPath);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

async function handleMapsApi(request, response, url) {
  await mkdir(mapsDir, { recursive: true });
  const id = url.pathname.split("/").filter(Boolean)[2];
  if (request.method === "GET" && !id) {
    const maps = await readSavedMaps();
    sendJson(response, maps.map((map) => ({
      id: map.id,
      name: map.name,
      stations: Array.isArray(map.stations) ? map.stations.length : 0,
      hospitals: Array.isArray(map.hospitals) ? map.hospitals.length : 0
    })));
    return;
  }
  if (request.method === "GET" && id) {
    const file = mapFilePath(id);
    if (!file || !existsSync(file)) return notFound(response);
    const map = await readJsonFile(file);
    if (!isValidMap(map)) return sendJson(response, { error: "invalid map file" }, 500);
    sendJson(response, map);
    return;
  }
  if (request.method === "POST") {
    const map = await readJsonBody(request, response, {});
    if (!map) return;
    map.id = safeId(map.id || map.name || `map-${Date.now()}`);
    if (!isValidMap(map)) return sendJson(response, { error: "invalid map payload" }, 400);
    await writeJsonFile(mapFilePath(map.id), map);
    sendJson(response, map);
    return;
  }
  if (request.method === "DELETE" && id) {
    const file = mapFilePath(id);
    if (file && existsSync(file)) await unlink(file);
    sendJson(response, { ok: true });
    return;
  }
  notFound(response);
}

async function handleIncidentsApi(request, response) {
  if (request.method === "GET") {
    if (!existsSync(incidentsFile)) return sendJson(response, []);
    const incidents = await readJsonFile(incidentsFile);
    sendJson(response, Array.isArray(incidents) ? incidents : []);
    return;
  }
  if (request.method === "POST") {
    const incidents = await readJsonBody(request, response, []);
    if (!incidents) return;
    if (!Array.isArray(incidents)) return sendJson(response, { error: "invalid incidents payload" }, 400);
    await writeJsonFile(incidentsFile, incidents);
    sendJson(response, incidents);
    return;
  }
  notFound(response);
}

async function handleAdminLogin(request, response) {
  if (request.method !== "POST") {
    sendJson(response, { error: "method not allowed" }, 405);
    return;
  }
  const body = await readJsonBody(request, response, {});
  if (!body) return;
  sendJson(response, { ok: body.password === adminPassword });
}

async function readSavedMaps() {
  const files = (await readdir(mapsDir)).filter((file) => file.endsWith(".json")).sort();
  const maps = [];
  for (const file of files) {
    try {
      const map = await readJsonFile(join(mapsDir, file));
      if (isValidMap(map)) maps.push(map);
    } catch (error) {
      console.warn(`Skipping invalid map file ${file}: ${error.message}`);
    }
  }
  return maps;
}

async function readJsonBody(request, response, fallback) {
  try {
    const body = await readBody(request);
    return parseJson(body || JSON.stringify(fallback));
  } catch (error) {
    const status = error.code === "BODY_TOO_LARGE" ? 413 : 400;
    sendJson(response, { error: error.message || "invalid request body" }, status);
    return null;
  }
}

async function readJsonFile(filePath) {
  return parseJson(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

function parseJson(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
        const error = new Error("request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, data, status = 200) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  sendJson(response, { error: "not found" }, 404);
}

function safeContentPath(requestedPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    return null;
  }
  const filePath = resolve(join(root, decoded.replace(/^[/\\]+/, "")));
  return isInsideRoot(filePath, root) ? filePath : null;
}

function mapFilePath(id) {
  const filePath = resolve(join(mapsDir, `${safeId(id)}.json`));
  return isInsideRoot(filePath, mapsDir) ? filePath : null;
}

function isInsideRoot(filePath, baseDir) {
  const rel = relative(baseDir, filePath);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`${sep}`) && !resolve(rel).startsWith(".."));
}

function isValidMap(map) {
  return Boolean(map && typeof map === "object" && map.id && map.name && Array.isArray(map.stations) && Array.isArray(map.hospitals));
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `map-${Date.now()}`;
}
