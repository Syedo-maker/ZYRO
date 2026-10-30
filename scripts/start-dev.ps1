<#
.SYNOPSIS
  Starts ZYRO on this machine for development: Redis, the API, the web app, the recommendation
  service (product suggestions and voice notes) and the Stripe webhook forwarder. Then it checks
  that everything answers and prints the links.

.DESCRIPTION
  PostgreSQL and MongoDB are Windows services and start with the machine; the script only checks
  them. Anything already running is left alone, so it is safe to run twice. Each service runs in
  the background and writes to its own log in <tools>\logs.

  Keys are read from backend\.env and handed to the services as environment variables: they are
  never printed, written to a log, or put on a command line.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
  powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -Stop
#>
param(
  # Where the portable Redis, the recommendation model cache and the logs live (outside the repo).
  [string]$ToolsDir = (Join-Path (Split-Path $PSScriptRoot -Parent | Split-Path -Parent) 'tools'),
  # Skip the Stripe forwarder (card payments then stay "pending" locally).
  [switch]$NoStripe,
  # Stop everything this script starts.
  [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Reco = Join-Path $Root 'recommendation-service'
$Logs = Join-Path $ToolsDir 'logs'
$StripeEvents = 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted'

function Test-Port([int]$Port) {
  [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# Through cmd, so "process not found" (a child that already exited) is not an error in PowerShell 5.1.
function Stop-Tree([int]$ProcessId) {
  cmd /c "taskkill /PID $ProcessId /T /F >nul 2>&1"
}

# The process listening on a port, walked up to the top of the tree this script started
# (cmd -> npm -> node), so stopping it leaves no watcher behind to restart it.
function Get-ServiceRoot([int]$Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $conn) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)"
  while ($proc) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)"
    if (-not $parent -or $parent.Name -notmatch '^(node|cmd|npm)') { break }
    $proc = $parent
  }
  $proc.ProcessId
}

if ($Stop) {
  foreach ($port in 5173, 5000, 8001) {
    $id = Get-ServiceRoot $port
    if ($id) { Stop-Tree $id; Write-Host "stopped the service on port $port" }
  }
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'stripe(\.exe)?"?\s+listen' } | ForEach-Object { Stop-Tree $_.ProcessId }
  Write-Host 'stopped the Stripe forwarder (if it was running)'
  if (Test-Port 6379) { cmd /c "`"$(Join-Path $ToolsDir 'redis\redis-cli.exe')`" shutdown nosave >nul 2>&1"; Write-Host 'stopped Redis' }
  return
}

New-Item -ItemType Directory -Force $Logs | Out-Null

# One value from backend\.env, without printing it.
$envLines = Get-Content (Join-Path $Backend '.env')
function Get-EnvValue([string]$Name) {
  $line = $envLines | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  ($line -replace "^$Name=", '').Trim().Trim('"')
}

# Starts a command in the background with its output in a log, unless its port is already taken.
function Start-Background([string]$Name, [int]$Port, [string]$Dir, [string]$Command) {
  if ($Port -and (Test-Port $Port)) { Write-Host "$Name is already running"; return }
  $log = Join-Path $Logs "$Name.log"
  Start-Process cmd -ArgumentList '/c', "$Command > `"$log`" 2>&1" -WorkingDirectory $Dir -WindowStyle Hidden | Out-Null
  Write-Host "starting $Name (log: $log)"
}

# The databases: Windows services, started with the machine.
foreach ($svc in @(@{ Name = 'PostgreSQL'; Port = 5432 }, @{ Name = 'MongoDB'; Port = 27017 })) {
  if (-not (Test-Port $svc.Port)) { Write-Warning "$($svc.Name) is not running on port $($svc.Port). Start its Windows service first." }
}

# Redis (the portable build; nothing is saved to disk).
if (Test-Port 6379) { Write-Host 'Redis is already running' }
else {
  Start-Process (Join-Path $ToolsDir 'redis\redis-server.exe') -ArgumentList '--bind', '127.0.0.1', '--port', '6379', '--save', '""', '--appendonly', 'no' -WorkingDirectory $ToolsDir -WindowStyle Hidden | Out-Null
  Write-Host 'starting Redis'
}

Start-Background 'backend' 5000 $Backend 'npm run dev'
Start-Background 'frontend' 5173 $Frontend 'npm run dev'

# The recommendation service, with speech to text on for voice notes. Its token is the backend's.
if (Test-Port 8001) { Write-Host 'recommendation service is already running' }
else {
  $env:RECOMMENDATION_SERVICE_TOKEN = Get-EnvValue 'RECOMMENDATION_SERVICE_TOKEN'
  $env:RECO_MODEL_CACHE = Join-Path $ToolsDir 'reco-model-cache'
  $env:HF_HUB_OFFLINE = '1'
  $env:WHISPER_ENABLED = 'true'
  $env:WHISPER_MODEL = 'base'
  Start-Background 'recommendation' 0 $Reco '.venv\Scripts\python.exe -m uvicorn app.asgi:app --host 127.0.0.1 --port 8001'
  Remove-Item Env:RECOMMENDATION_SERVICE_TOKEN
}

# The Stripe forwarder: local card payments only become orders while it runs. The Stripe CLI reads
# its key from STRIPE_API_KEY, so the key stays off the command line.
if (-not $NoStripe) {
  if (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'stripe(\.exe)?"?\s+listen' }) { Write-Host 'Stripe forwarder is already running' }
  else {
    $env:STRIPE_API_KEY = Get-EnvValue 'STRIPE_SECRET_KEY'
    if ($env:STRIPE_API_KEY) { Start-Background 'stripe' 0 $Root "npx --yes @stripe/cli listen --events $StripeEvents --forward-to localhost:5000/api/v1/webhooks/stripe" }
    else { Write-Warning 'No STRIPE_SECRET_KEY in backend\.env: card payments are skipped.' }
    Remove-Item Env:STRIPE_API_KEY -ErrorAction SilentlyContinue
  }
}

# Wait until everything answers (the first start can take a minute).
Write-Host "`nwaiting for the services to answer..."
$checks = [ordered]@{
  'web app        http://localhost:5173' = 'http://localhost:5173/'
  'API            http://localhost:5000' = 'http://localhost:5000/ready'
  'recommendation http://127.0.0.1:8001' = 'http://127.0.0.1:8001/health'
}
$deadline = (Get-Date).AddMinutes(3)
$status = @{}
do {
  foreach ($k in $checks.Keys) {
    if ($status[$k]) { continue }
    try { $status[$k] = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $checks[$k]).StatusCode -eq 200 } catch { }
  }
  if (($status.Values | Where-Object { $_ }).Count -eq $checks.Count) { break }
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)

Write-Host ''
foreach ($k in $checks.Keys) { Write-Host ('{0}  {1}' -f $(if ($status[$k]) { 'OK  ' } else { 'DOWN' }), $k) }
if (($status.Values | Where-Object { $_ }).Count -ne $checks.Count) {
  Write-Warning "Something did not start. Its log is in $Logs."
  exit 1
}

Write-Host "`nZYRO is running:"
Write-Host '  Home page           http://localhost:5173'
Write-Host '  Admin and AI tools  http://localhost:5173/login'
Write-Host '  Register            http://localhost:5173/pos'
Write-Host '  Shop directory      http://localhost:5173/shop  (each shop has the AI assistant: the chat button, bottom right)'
Write-Host "`nStop everything with: powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1 -Stop"
