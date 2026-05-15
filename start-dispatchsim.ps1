$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$port = 4173
$url = "http://127.0.0.1:$port/index.html"
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if (-not $listener) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $root
  Start-Sleep -Seconds 1
}

Start-Process $url
