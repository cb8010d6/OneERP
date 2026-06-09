param(
  [switch]$Rebuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
$templatePath = Join-Path $root ".env.quickstart"
$requiredEnvKeys = @(
  "POSTGRES_PASSWORD",
  "JWT_SECRET",
  "MINIO_SECRET_KEY",
  "INIT_ADMIN_EMAIL",
  "INIT_ADMIN_PASSWORD",
  "CORS_ORIGINS"
)

function New-Secret([int]$bytes = 24) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  [Convert]::ToBase64String($buffer).TrimEnd("=") -replace "\+", "A" -replace "/", "B"
}

function Read-EnvFile([string]$Path) {
  $map = @{}
  if (!(Test-Path $Path)) {
    return $map
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    $map[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
  }
  return $map
}

function Assert-RequiredEnv([string]$Path) {
  $envMap = Read-EnvFile $Path
  $missing = @()
  foreach ($key in $requiredEnvKeys) {
    $value = [string]$envMap[$key]
    if ($value.Trim() -eq "" -or $value -like "CHANGE_ME*") {
      $missing += $key
    }
  }

  if ($missing.Count -gt 0) {
    $list = $missing -join ", "
    throw ".env is missing required deployment values: $list. Fill them in .env, or remove .env and rerun scripts/quickstart.ps1 to generate local quickstart values."
  }
}

if (!(Test-Path $envPath)) {
  if (!(Test-Path $templatePath)) {
    throw ".env.quickstart not found"
  }

  $content = Get-Content $templatePath -Raw
  $content = $content.Replace("CHANGE_ME_DATABASE_PASSWORD", (New-Secret 18))
  $content = $content.Replace("CHANGE_ME_JWT_SECRET", (New-Secret 48))
  $content = $content.Replace("CHANGE_ME_MINIO_SECRET", (New-Secret 24))
  $content = $content.Replace("CHANGE_ME_ADMIN_PASSWORD", (New-Secret 18))
  Set-Content -Path $envPath -Value $content -Encoding UTF8
  Write-Host "Created .env with generated secrets."
  Write-Host "Admin email: admin@oneerp.local"
  Write-Host "Admin password is in .env as INIT_ADMIN_PASSWORD."
} else {
  Write-Host ".env already exists; keeping current values."
}

Assert-RequiredEnv $envPath
Write-Host ".env required deployment values are present."

$composeArgs = @("compose", "-f", "docker-compose.easy.yml", "up", "-d")
if ($Rebuild) {
  $composeArgs += "--build"
}

Push-Location $root
try {
  docker @composeArgs
  Write-Host ""
  Write-Host "OneERP is starting."
  Write-Host "Web: http://localhost:3000"
  Write-Host "API: http://localhost:8000/api/docs"
  Write-Host "Check status: docker compose -f docker-compose.easy.yml ps"
} finally {
  Pop-Location
}
