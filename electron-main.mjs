import { app, BrowserWindow, dialog } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let mainWindow;

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  await mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(startApp);
}

async function startApp() {
  process.env.PORT = "4173";
  process.env.DISPATCH_ELECTRON = "1";
  process.env.DISPATCH_DATA_DIR = app.getPath("userData");
  process.env.DISPATCH_MODS_DIR = join(app.getPath("documents"), "LSTSIM", "mods");
  process.env.DISPATCH_BUNDLED_MODS_DIR = app.isPackaged
    ? join(process.resourcesPath, "builtin-mods")
    : join(app.getAppPath(), "mods");

  try {
    const { serverPort } = await import("./server.mjs");
    await createWindow(serverPort);
  } catch (error) {
    showStartupError(error);
    app.quit();
  }
}

function showStartupError(error) {
  const logPath = writeStartupLog("Startup failed", error);
  dialog.showErrorBox(
    "Leitstellen-SIM konnte nicht starten",
    `Der lokale Server konnte nicht gestartet werden.\n\nDetails wurden gespeichert unter:\n${logPath || "keine Logdatei verfuegbar"}`
  );
}

function writeStartupLog(message, error) {
  try {
    const dataDir = app.getPath("userData");
    mkdirSync(dataDir, { recursive: true });
    const logPath = join(dataDir, "startup.log");
    const detail = error?.stack || error?.message || String(error || "");
    appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n${detail}\n\n`, "utf8");
    return logPath;
  } catch {
    return null;
  }
}

process.on("uncaughtException", (error) => {
  writeStartupLog("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  writeStartupLog("Unhandled rejection", error);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
