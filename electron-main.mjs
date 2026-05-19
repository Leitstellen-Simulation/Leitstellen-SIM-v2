import { app, BrowserWindow, dialog } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let mainWindow;

async function createWindow() {
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

  await waitForServer("http://127.0.0.1:4173/index.html");
  await mainWindow.loadURL("http://127.0.0.1:4173/index.html");
}

function waitForServer(url, timeoutMs = 10000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Server ist noch nicht bereit.
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error("Server konnte nicht gestartet werden."));
        return;
      }

      setTimeout(check, 250);
    };

    check();
  });
}

app.whenReady().then(startApp);

async function startApp() {
  process.env.PORT = "4173";
  process.env.DISPATCH_ELECTRON = "1";
  process.env.DISPATCH_DATA_DIR = app.getPath("userData");

  try {
    await import("./server.mjs");
    await createWindow();
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
