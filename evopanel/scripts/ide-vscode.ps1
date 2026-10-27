# GoGo IDE Workbench - VSCode engine launcher (openvscode-server via Docker)
# Usage: powershell -ExecutionPolicy Bypass -File ide-vscode.ps1
# Requires: Docker Desktop (or Docker Engine) running on this machine.
# NOTE: this file must stay pure ASCII (PS 5.1 reads system ANSI; see verify-ps1-ascii.ps1).

$ErrorActionPreference = "Stop"

$CONTAINER = "gogo-ide-vscode"
# CN-friendly registry mirror first; fall back to Docker Hub.
$IMAGE = "docker.m.daocloud.io/gitpod/openvscode-server:latest"
$FALLBACK_IMAGE = "gitpod/openvscode-server:latest"
$HOST_PORT = 18080
$CONTAINER_PORT = 3000
$WORKSPACE = "D:/Myproject"
$URL = "http://127.0.0.1:$HOST_PORT/"

Write-Host "== GoGo IDE engine launcher ==" -ForegroundColor Cyan

# 1. Docker presence
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  Write-Host "[ERROR] Docker not found. Install Docker Desktop and start it first." -ForegroundColor Red
  exit 1
}

# 2. Port conflict check (ignore Docker's own listeners)
$portBusy = Get-NetTCPConnection -LocalPort $HOST_PORT -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
  $procId = $portBusy[0].OwningProcess
  $procName = ""
  try { $procName = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $procName = "unknown" }
  if ($procName -notmatch "docker") {
    Write-Host "[ERROR] Port $HOST_PORT is occupied by $procName (PID $procId). Free the port or change HOST_PORT in this script." -ForegroundColor Red
    exit 1
  }
}

# 3. Existing container?
$existing = docker ps -a --filter "name=^/$CONTAINER$" --format "{{.Names}}|{{.Status}}" | Select-Object -First 1
if ($existing) {
  $parts = $existing -split '\|'
  $status = if ($parts.Count -gt 1) { $parts[1] } else { "" }
  if ($status -like "Up*") {
    Write-Host "[OK] Container already running: $existing" -ForegroundColor Green
    Write-Host "     Open: $URL" -ForegroundColor Green
    exit 0
  }
  Write-Host "[INFO] Container exists but is stopped. Starting..." -ForegroundColor Yellow
  docker start $CONTAINER
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to start container." -ForegroundColor Red
    exit 1
  }
  Write-Host "[OK] Container started." -ForegroundColor Green
  Write-Host "     Open: $URL" -ForegroundColor Green
  exit 0
}

# 4. First run: pull image and create container
Write-Host "[INFO] First run: pulling $IMAGE (may take 1-2 min)..." -ForegroundColor Yellow
docker pull $IMAGE
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Image pull failed. Check network / Docker registry access." -ForegroundColor Red
  exit 1
}

Write-Host "[INFO] Creating and starting container..." -ForegroundColor Yellow
docker run -d --name $CONTAINER --restart unless-stopped -p "${HOST_PORT}:${CONTAINER_PORT}" -v "${WORKSPACE}:/home/workspace" $IMAGE --without-connection-token
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Container creation failed. Run: docker logs $CONTAINER" -ForegroundColor Red
  exit 1
}

# Disable workspace-trust dialog so the IDE iframe opens the folder directly.
$SETTINGS_FILE = "$env:TEMP\gogo-ide-machine-settings.json"
Set-Content -Path $SETTINGS_FILE -Value '{"security.workspace.trust.enabled": false}' -Encoding Ascii
docker exec $CONTAINER mkdir -p /home/.openvscode-server/data/Machine
docker cp $SETTINGS_FILE "${CONTAINER}:/home/.openvscode-server/data/Machine/settings.json"
docker restart $CONTAINER

Write-Host "[OK] Engine started." -ForegroundColor Green
Write-Host "     Open: ${URL}?folder=/home/workspace" -ForegroundColor Green
Write-Host "     Workspace mount: $WORKSPACE" -ForegroundColor Green
