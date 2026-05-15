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

echo Starte DispatchSim Server...
start "DispatchSim Server" /min cmd /k "cd /d ""%~dp0"" && node server.mjs"

timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173/index.html"
