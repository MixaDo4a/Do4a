Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$npmCmd = 'C:\Program Files\nodejs\npm.cmd'
$logDir = Join-Path $repoRoot 'logs'
$outLog = Join-Path $logDir 'dev.out.log'
$errLog = Join-Path $logDir 'dev.err.log'

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

if (-not (Test-Path $npmCmd)) {
  throw "npm.cmd not found at $npmCmd"
}

Set-Location $repoRoot

while ($true) {
  & $npmCmd run dev *> $outLog 2> $errLog
  Start-Sleep -Seconds 3
}
