param(
  [string]$PolicyFile = "ops/backup-policy.example.json",
  [string]$TaskName = "OneERP Backup",
  [string]$ComposeFile = "docker-compose.ha-lite.yml"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$policyPath = Join-Path $root $PolicyFile
$policy = Get-Content $policyPath -Raw | ConvertFrom-Json
$interval = [int]$policy.postgresIntervalMinutes

if ($interval -lt 5) {
  throw "postgresIntervalMinutes must be at least 5"
}

$scriptPath = Join-Path $root "scripts\backup.ps1"
$argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -PolicyFile `"$PolicyFile`" -ComposeFile `"$ComposeFile`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $interval) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "OneERP PostgreSQL/MinIO backup according to $PolicyFile" -Force | Out-Null
Write-Host "Installed Windows scheduled backup task '$TaskName' every $interval minutes."
