@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte Node.js installieren oder die App ueber Codex mit "node server.mjs" starten.
  pause
  exit /b 1
)

echo Pruefe DispatchSim Server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4173/' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if errorlevel 1 (
  echo Starte DispatchSim Server...
  start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4173/index.html'"
  echo.
  echo Server laeuft in diesem Fenster. Mit Strg+C beenden.
  echo.
  node server.mjs
) else (
  echo DispatchSim Server laeuft bereits auf Port 4173.
  echo Der Server laeuft schon in einem anderen Prozess/Fenster.
  netstat -ano | findstr ":4173"
  start "" "http://127.0.0.1:4173/index.html"
  echo.
  echo Dieses Fenster kann geschlossen werden. Zum Stoppen den oben angezeigten Prozess beenden.
  pause
)
