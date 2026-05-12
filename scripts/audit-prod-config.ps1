param(
  [string]$ComposeFile = "docker-compose.ha-lite.yml",
  [string]$EnvFile = ".env"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$findings = New-Object System.Collections.Generic.List[object]

function Add-Finding {
  param([string]$Severity, [string]$Name, [string]$Detail)
  $script:findings.Add([pscustomobject]@{ severity = $Severity; name = $Name; detail = $Detail }) | Out-Null
  Write-Host "[$Severity] $Name - $Detail"
}

function Read-Env {
  param([string]$Path)
  $map = @{}
  if (Test-Path $Path) {
    Get-Content $Path | ForEach-Object {
      if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
      $parts = $_ -split '=', 2
      $map[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
  return $map
}

$envPath = Join-Path $root $EnvFile
$composePath = Join-Path $root $ComposeFile
$envMap = Read-Env -Path $envPath

foreach ($key in @("POSTGRES_PASSWORD", "JWT_SECRET", "MINIO_SECRET_KEY", "INIT_ADMIN_PASSWORD")) {
  $value = [string]$envMap[$key]
  if ($value.Length -lt 16 -or $value -like "CHANGE_ME*") {
    Add-Finding "P0" "weak-$key" "$key must be unique, non-placeholder, and at least 16 characters"
  }
}

if ([string]$envMap["INIT_ADMIN_PASSWORD"] -eq "admin" -or [string]$envMap["INIT_ADMIN_EMAIL"] -eq "admin@oneerp.local") {
  Add-Finding "P0" "default-admin" "Change the initial admin email/password after first login"
}

$cors = [string]$envMap["CORS_ORIGINS"]
if ($cors -eq "" -or $cors -match '\*' -or $cors -match 'localhost') {
  Add-Finding "P1" "cors-origins" "Use real trusted origins for production CORS_ORIGINS"
}

if (Test-Path $composePath) {
  $composeText = Get-Content $composePath -Raw
  foreach ($port in @("5432", "6379", "9000", "9001")) {
    if ($composeText -match ":\s*$port`"" -or $composeText -match "${port}:$port") {
      Add-Finding "P0" "public-port-$port" "Do not expose DB/Redis/MinIO ports in production"
    }
  }
}

$report = [ordered]@{
  auditedAt = (Get-Date).ToString("o")
  composeFile = $ComposeFile
  envFile = $EnvFile
  findings = $findings
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $root "prod-config-audit.json") -Encoding UTF8

$p0 = @($findings | Where-Object { $_.severity -eq "P0" })
if ($p0.Count -gt 0) {
  throw "$($p0.Count) P0 production config finding(s). See prod-config-audit.json"
}
