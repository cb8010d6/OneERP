param(
  [string]$ComposeFile = "",
  [string]$EnvFile = "",
  [string]$ApiUrl = "",
  [string]$WebUrl = "",
  [int]$TimeoutSeconds = -1,
  [int]$PollIntervalSeconds = -1
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$results = New-Object System.Collections.Generic.List[object]
$script:ComposeServices = @()
$script:InspectFormat = '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}'

if ($ComposeFile -eq "") { $ComposeFile = if (-not [string]::IsNullOrEmpty($env:COMPOSE_FILE)) { $env:COMPOSE_FILE } else { "docker-compose.ha-lite.yml" } }
if ($EnvFile -eq "") { $EnvFile = if (-not [string]::IsNullOrEmpty($env:ENV_FILE)) { $env:ENV_FILE } else { ".env" } }
function ConvertTo-BoundedSeconds {
  param([string]$Value, [int]$Default, [int]$Maximum)
  if ($Value -notmatch '^\d+$') { return $Default }
  $normalized = $Value.TrimStart('0')
  if ($normalized -eq "") { return 0 }
  if ($normalized.Length -gt 3) { return $Maximum }
  $parsed = [int]$normalized
  if ($parsed -gt $Maximum) { return $Maximum }
  return $parsed
}

if ($TimeoutSeconds -lt 0) { $TimeoutSeconds = ConvertTo-BoundedSeconds $env:DEPLOY_CHECK_TIMEOUT_SECONDS 60 900 }
if ($PollIntervalSeconds -lt 0) { $PollIntervalSeconds = ConvertTo-BoundedSeconds $env:DEPLOY_CHECK_POLL_SECONDS 3 60 }
if ($TimeoutSeconds -gt 900) { $TimeoutSeconds = 900 }
if ($PollIntervalSeconds -gt 60) { $PollIntervalSeconds = 60 }
if ($PollIntervalSeconds -lt 1) { $PollIntervalSeconds = 1 }

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

function Invoke-Compose {
  param([string[]]$ComposeArgs)
  $baseArgs = @()
  if ($EnvFile -ne "" -and (Test-Path $envPath)) { $baseArgs += @("--env-file", $envPath) }
  $baseArgs += @("-f", $composePath)
  $output = @(& docker compose @baseArgs @ComposeArgs 2>$null)
  $exitCode = $LASTEXITCODE
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine) }
}

function Invoke-Docker {
  param([string[]]$DockerArgs)
  $output = @(& docker @DockerArgs 2>$null)
  $exitCode = $LASTEXITCODE
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join [Environment]::NewLine) }
}

function Test-Http {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch { return $false }
}

function Test-ComposeConfig {
  $config = Invoke-Compose -ComposeArgs @("config")
  $services = Invoke-Compose -ComposeArgs @("config", "--services")
  if ($services.ExitCode -eq 0) {
    $script:ComposeServices = @($services.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  }
  return [pscustomobject]@{
    ConfigPassed = ($config.ExitCode -eq 0)
    ServicesPassed = ($services.ExitCode -eq 0 -and $script:ComposeServices.Count -gt 0)
  }
}

function Test-ComposeService {
  param([string]$Service, [string]$Mode)
  if ($script:ComposeServices -notcontains $Service) {
    return [pscustomobject]@{ State = "failed"; Detail = "service is not defined in selected Compose configuration" }
  }

  $psResult = Invoke-Compose -ComposeArgs @("ps", "--all", "-q", $Service)
  if ($psResult.ExitCode -ne 0) { return [pscustomobject]@{ State = "failed"; Detail = "docker compose ps failed" } }
  $ids = @($psResult.Output -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
  if ($ids.Count -eq 0) { return [pscustomobject]@{ State = "pending"; Detail = "container is not present yet" } }

  $state = "ready"
  $detail = "running and healthy"
  foreach ($id in $ids) {
    $inspect = Invoke-Docker -DockerArgs @("inspect", "--format", $script:InspectFormat, $id)
    if ($inspect.ExitCode -ne 0) { return [pscustomobject]@{ State = "failed"; Detail = "container state inspection failed" } }
    $parts = @($inspect.Output.Trim() -split '\|', 3)
    if ($parts.Count -ne 3) { return [pscustomobject]@{ State = "failed"; Detail = "container state inspection returned invalid fields" } }
    $status = $parts[0]
    $health = $parts[1]
    $exitCode = $parts[2]

    if ($Mode -eq "migration") {
      if ($status -eq "exited" -and $exitCode -eq "0") { continue }
      if ($status -eq "running" -or $status -eq "created") {
        if ($state -ne "failed") { $state = "pending" }
        $detail = "migration status=$status"
        continue
      }
      return [pscustomobject]@{ State = "failed"; Detail = "migration status=$status exitCode=$exitCode" }
    }

    if ($status -eq "running") {
      if ($health -eq "healthy" -or $health -eq "none") { continue }
      if ($health -eq "starting") {
        if ($state -ne "failed") { $state = "pending" }
        $detail = "container health is starting"
        continue
      }
      if ($health -eq "unhealthy") { return [pscustomobject]@{ State = "failed"; Detail = "container health is unhealthy" } }
      return [pscustomobject]@{ State = "failed"; Detail = "container health state is $health" }
    }
    if ($status -eq "created") {
      if ($state -ne "failed") { $state = "pending" }
      $detail = "container has not started yet"
      continue
    }
    return [pscustomobject]@{ State = "failed"; Detail = "container status=$status" }
  }
  return [pscustomobject]@{ State = $state; Detail = $detail }
}

function Test-ComposeRuntime {
  $services = @("api", "web", "db", "redis", "minio")
  if ($script:ComposeServices -contains "migrate") { $services += "migrate" }
  $modeByService = @{ migrate = "migration" }
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $latest = @{}
  $timedOut = $false

  while ($true) {
    $pending = $false
    $failed = $false
    foreach ($service in $services) {
      $mode = if ($modeByService.ContainsKey($service)) { $modeByService[$service] } else { "runtime" }
      $probe = Test-ComposeService -Service $service -Mode $mode
      $latest[$service] = $probe
      if ($probe.State -eq "pending") { $pending = $true }
      if ($probe.State -eq "failed") { $failed = $true }
    }
    if ($failed -or -not $pending) { break }
    if ([DateTime]::UtcNow -ge $deadline) { $timedOut = $true; break }
    Start-Sleep -Seconds $PollIntervalSeconds
  }

  $passed = $true
  foreach ($service in $services) {
    $probe = $latest[$service]
    if ($probe.State -eq "ready") {
      Add-Result "runtime-$service" $true $probe.Detail
    } else {
      $passed = $false
      $detail = $probe.Detail
      if ($probe.State -eq "pending" -and $timedOut) { $detail = "timed out waiting: $detail" }
      elseif ($probe.State -eq "pending") { $detail = "not ready: $detail" }
      Add-Result "runtime-$service" $false $detail
    }
  }
  return $passed
}

Push-Location $root
try {
  $envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $root $EnvFile }
  $composePath = if ([System.IO.Path]::IsPathRooted($ComposeFile)) { $ComposeFile } else { Join-Path $root $ComposeFile }
  $envMap = Read-Env -Path $envPath
  $apiPort = [string]$envMap["API_PORT"]
  if ($apiPort -eq "") { $apiPort = "8000" }
  $webPort = [string]$envMap["WEB_PORT"]
  if ($webPort -eq "") { $webPort = "3000" }
  if ($ApiUrl -eq "" -and -not [string]::IsNullOrEmpty($env:API_BASE_URL)) {
    $ApiUrl = $env:API_BASE_URL
    if ($ApiUrl -notmatch '/api/health$') { $ApiUrl = "$($ApiUrl.TrimEnd('/'))/health" }
  }
  if ($WebUrl -eq "" -and -not [string]::IsNullOrEmpty($env:WEB_BASE_URL)) { $WebUrl = $env:WEB_BASE_URL }
  if ($ApiUrl -eq "") { $ApiUrl = "http://localhost:$apiPort/api/health" }
  if ($WebUrl -eq "") { $WebUrl = "http://localhost:$webPort/" }

  $docker = Invoke-Docker -DockerArgs @("version")
  Add-Result "docker" ($docker.ExitCode -eq 0) "Docker CLI is available"

  $config = Test-ComposeConfig
  Add-Result "compose-config" $config.ConfigPassed "$ComposeFile is valid"
  Add-Result "compose-services" $config.ServicesPassed "Compose service names are available"
  Add-Result "env-file" (Test-Path $envPath) "$EnvFile exists"

  foreach ($name in @("POSTGRES_PASSWORD", "JWT_SECRET", "MINIO_SECRET_KEY", "INIT_ADMIN_PASSWORD")) {
    $value = [string]$envMap[$name]
    $strong = $value.Length -ge 16 -and $value -notlike "CHANGE_ME*"
    Add-Result "secret-$name" $strong "length=$($value.Length)"
  }

  Add-Result "compose-ps" (Test-ComposeRuntime) "required services are present and ready; migration exits successfully when declared"
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
  if ($failed.Count -gt 0) { throw "$($failed.Count) deploy check(s) failed. See deploy-check-report.json" }
} finally {
  Pop-Location
}
