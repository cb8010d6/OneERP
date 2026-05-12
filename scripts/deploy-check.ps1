param(
  [string]$ComposeFile = "docker-compose.ha-lite.yml",
  [string]$EnvFile = ".env",
  [string]$ApiUrl = "",
  [string]$WebUrl = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $script:results.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail }) | Out-Null
  $mark = if ($Passed) { "PASS" } else { "FAIL" }
  Write-Host "[$mark] $Name - $Detail"
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

function Test-Http {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

Push-Location $root
try {
  $envPath = Join-Path $root $EnvFile
  $envMap = Read-Env -Path $envPath
  $apiPort = [string]$envMap["API_PORT"]
  if ($apiPort -eq "") { $apiPort = "8000" }
  $webPort = [string]$envMap["WEB_PORT"]
  if ($webPort -eq "") { $webPort = "3000" }
  if ($ApiUrl -eq "") { $ApiUrl = "http://localhost:$apiPort/api/health" }
  if ($WebUrl -eq "") { $WebUrl = "http://localhost:$webPort/" }

  docker version | Out-Null
  Add-Result "docker" ($LASTEXITCODE -eq 0) "Docker CLI is available"

  docker compose -f $ComposeFile config | Out-Null
  Add-Result "compose-config" ($LASTEXITCODE -eq 0) "$ComposeFile is valid"

  Add-Result "env-file" (Test-Path $envPath) "$EnvFile exists"

  foreach ($name in @("POSTGRES_PASSWORD", "JWT_SECRET", "MINIO_SECRET_KEY", "INIT_ADMIN_PASSWORD")) {
    $value = [string]$envMap[$name]
    $strong = $value.Length -ge 16 -and $value -notlike "CHANGE_ME*"
    Add-Result "secret-$name" $strong "length=$($value.Length)"
  }

  $ps = docker compose -f $ComposeFile ps --format json
  if ($LASTEXITCODE -eq 0 -and "$ps" -ne "") {
    Add-Result "compose-ps" $true "services reported by docker compose"
  } else {
    Add-Result "compose-ps" $false "no services reported; start the stack first"
  }

  Add-Result "api-health" (Test-Http -Url $ApiUrl) $ApiUrl
  Add-Result "web-root" (Test-Http -Url $WebUrl) $WebUrl

  $failed = @($results | Where-Object { -not $_.passed })
  $report = [ordered]@{
    checkedAt = (Get-Date).ToString("o")
    composeFile = $ComposeFile
    apiUrl = $ApiUrl
    webUrl = $WebUrl
    results = $results
  }
  $report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $root "deploy-check-report.json") -Encoding UTF8
  if ($failed.Count -gt 0) {
    throw "$($failed.Count) deploy check(s) failed. See deploy-check-report.json"
  }
} finally {
  Pop-Location
}
