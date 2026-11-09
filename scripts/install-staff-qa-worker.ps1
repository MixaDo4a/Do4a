param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TaskName = "Do4a Staff Telegram QA Event Worker"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed the local Staff QA event worker task."
  exit 0
}

$EnvFile = Join-Path $RepoRoot ".env.local"
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Missing .env.local in the safe Staff QA copy." }
$Configured = @{}
foreach ($Line in Get-Content -LiteralPath $EnvFile) {
  if ($Line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $Value = $Matches[2].Trim().Trim('"').Trim("'")
    $Configured[$Matches[1]] = -not [string]::IsNullOrWhiteSpace($Value)
  }
}
$Required = @("STAFF_QA_PREVIEW_URL", "STAFF_QA_PREVIEW_WORKER_TOKEN", "SUPABASE_URL")
$Missing = @($Required | Where-Object { -not $Configured.ContainsKey($_) -or -not $Configured[$_] })
if ((-not $Configured.ContainsKey("SUPABASE_SECRET_KEY") -or -not $Configured["SUPABASE_SECRET_KEY"]) -and
    (-not $Configured.ContainsKey("SUPABASE_SERVICE_ROLE_KEY") -or -not $Configured["SUPABASE_SERVICE_ROLE_KEY"])) {
  $Missing += "SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)"
}
if ($Missing.Count -gt 0) {
  throw "Add the missing names to the ignored .env.local file: $($Missing -join ', '). For SUPABASE_URL, SUPABASE_SECRET_KEY and STAFF_QA_PREVIEW_WORKER_TOKEN use the existing authorized configuration. Never paste secret values into chat or source files."
}

$Node = (Get-Command node -ErrorAction Stop).Source
$NodeVersion = (& $Node --version).Trim().TrimStart('v').Split('.')[0..1] -join '.'
if ([version]$NodeVersion -lt [version]'20.6') { throw "Node.js 20.6 or newer is required; found $NodeVersion." }
$Codex = Get-Command codex -ErrorAction Stop
$Arguments = "--env-file=.env.local scripts/staff-qa-event-worker.mjs"
$Action = New-ScheduledTaskAction -Execute $Node -Argument $Arguments -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$Principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 2) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Starts the local Staff Telegram QA worker at logon; queue work is triggered by Supabase Realtime events, with startup backlog recovery." -Force | Out-Null
Write-Output "Registered the worker at Windows logon. Start it now with: Start-ScheduledTask -TaskName '$TaskName'"
