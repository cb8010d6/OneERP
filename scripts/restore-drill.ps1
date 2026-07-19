param(
  [string]$BackupDir = "",
  [string]$ComposeFile = "docker-compose.ha-lite.yml",
  [string]$ComposeOverrideFile = "",
  [string]$ProjectName = "",
  [string]$ReportPath = "restore-drill-report.json",
  [string]$BackupHelperImage = "",
  [int]$DrillApiPort = 18001,
  [int]$DrillWebPort = 13001,
  [int]$RpoTargetMinutes = 15,
  [int]$RtoTargetMinutes = 60,
  [switch]$KeepProject
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startedAt = Get-Date
$checks = New-Object System.Collections.Generic.List[object]
$defaultBackupHelperImage = "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
$drillEnv = ""
$composeBaseArgs = @()
$dbRestorePath = "/tmp/oneerp-restore.sql"
$dbStarted = $false
$failure = $null
$rpoAgeMinutes = $null

if ($BackupHelperImage -eq "") {
  $BackupHelperImage = if ($env:ONEERP_BACKUP_HELPER_IMAGE) {
    $env:ONEERP_BACKUP_HELPER_IMAGE
  } else {
    $defaultBackupHelperImage
  }
}

function Add-Check {
  param([string]$Name, [string]$Status, [string]$Detail)
  $script:checks.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail }) | Out-Null
  Write-Host "[$Status] $Name - $Detail"
}

function Read-EnvFile {
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

function Set-EnvValue {
  param([string]$Path, [string]$Key, [string]$Value)
  $lines = if (Test-Path $Path) { @(Get-Content $Path) } else { @() }
  $found = $false
  $next = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Key))=") {
      $found = $true
      "$Key=$Value"
    } else {
      $line
    }
  }
  if (-not $found) {
    $next += "$Key=$Value"
  }
  $next | Set-Content -Path $Path -Encoding UTF8
}

function New-RandomHex {
  param([int]$ByteCount)

  $bytes = New-Object byte[] $ByteCount
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($bytes)
  $random.Dispose()
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function Invoke-Compose {
  param(
    [string[]]$Arguments,
    [string]$InputText = "",
    [switch]$PipeInput,
    [switch]$AllowFailure
  )

  if ($PipeInput) {
    $output = $InputText | & docker @($script:composeBaseArgs + $Arguments)
  } else {
    $output = & docker @($script:composeBaseArgs + $Arguments)
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "Docker Compose command failed with exit code ${exitCode}: $($Arguments -join ' ')"
  }
  return $output
}

function Invoke-DbScalar {
  param([string]$Sql, [string]$PgUser, [string]$PgDb)
  $value = Invoke-Compose -Arguments @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", $PgUser, "-d", $PgDb, "-tA") -InputText $Sql -PipeInput
  return [string]$value.Trim()
}

function Test-Http {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-ForHttp {
  param(
    [string]$Url,
    [int]$Attempts = 60,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
    if (Test-Http -Url $Url) {
      return $true
    }
    Start-Sleep -Seconds $DelaySeconds
  }
  return $false
}

Push-Location $root
try {
  if ($BackupDir -eq "") {
    $latest = Get-ChildItem -Path (Join-Path $root "backups") -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { throw "No backup directory found under backups/" }
    $BackupDir = $latest.FullName
  }
  $resolvedBackup = [string](Resolve-Path $BackupDir)
  $sql = Join-Path $resolvedBackup "postgres.sql"
  $minio = Join-Path $resolvedBackup "minio-data.tgz"
  if (!(Test-Path $sql)) { throw "postgres.sql not found in $resolvedBackup" }

  if ($ProjectName -eq "") {
    $ProjectName = "oneerp_drill_$($startedAt.ToString('yyyyMMddHHmmss'))"
  }

  $workDir = Join-Path $root ".restore-drill"
  New-Item -ItemType Directory -Force -Path $workDir | Out-Null
  $drillEnv = Join-Path $workDir "$ProjectName.env"
  $sourceEnv = Join-Path $resolvedBackup ".env.copy"
  if (!(Test-Path $sourceEnv)) { $sourceEnv = Join-Path $root ".env" }
  if (!(Test-Path $sourceEnv)) { throw "No .env.copy in backup and no root .env found" }
  Copy-Item $sourceEnv $drillEnv -Force
  Set-EnvValue -Path $drillEnv -Key "API_PORT" -Value "$DrillApiPort"
  Set-EnvValue -Path $drillEnv -Key "WEB_PORT" -Value "$DrillWebPort"
  Set-EnvValue -Path $drillEnv -Key "CORS_ORIGINS" -Value "http://localhost:$DrillWebPort"
  Set-EnvValue -Path $drillEnv -Key "POSTGRES_PASSWORD" -Value (New-RandomHex -ByteCount 24)
  Set-EnvValue -Path $drillEnv -Key "JWT_SECRET" -Value (New-RandomHex -ByteCount 32)
  Set-EnvValue -Path $drillEnv -Key "MINIO_ACCESS_KEY" -Value "drill$(New-RandomHex -ByteCount 6)"
  Set-EnvValue -Path $drillEnv -Key "MINIO_SECRET_KEY" -Value (New-RandomHex -ByteCount 24)

  $composeBaseArgs = @("compose", "-p", $ProjectName, "--env-file", $drillEnv, "-f", $ComposeFile)
  if ($ComposeOverrideFile -ne "") {
    $composeBaseArgs += @("-f", $ComposeOverrideFile)
  }

  $envMap = Read-EnvFile -Path $drillEnv
  $pgUser = [string]$envMap["POSTGRES_USER"]
  if ($pgUser -eq "") { $pgUser = "oneerp" }
  $pgDb = [string]$envMap["POSTGRES_DB"]
  if ($pgDb -eq "") { $pgDb = "oneerp" }

  Invoke-Compose -Arguments @("up", "-d", "--build", "--wait", "--wait-timeout", "120", "db", "redis", "minio") | Out-Host
  $dbStarted = $true
  Add-Check "temp-stack" "passed" $ProjectName

  Invoke-Compose -Arguments @("cp", $sql, "db:$dbRestorePath") | Out-Null
  Invoke-Compose -Arguments @("exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", $pgUser, "-d", $pgDb, "-f", $dbRestorePath) | Out-Null
  Invoke-Compose -Arguments @("exec", "-T", "db", "rm", "-f", $dbRestorePath) | Out-Null
  Add-Check "postgres-restore" "passed" $sql

  if (Test-Path $minio) {
    $minioContainer = [string](Invoke-Compose -Arguments @("ps", "-q", "minio"))
    if ($minioContainer.Trim() -eq "") { throw "MinIO drill container is not running" }
    docker run --rm --volumes-from $minioContainer.Trim() --mount "type=bind,source=$resolvedBackup,destination=/backup,readonly" $BackupHelperImage tar xzf /backup/minio-data.tgz -C /data
    if ($LASTEXITCODE -ne 0) { throw "MinIO restore failed" }
    Add-Check "minio-restore" "passed" $minio
  } else {
    Add-Check "minio-restore" "skipped" "minio-data.tgz not found"
  }

  $companyCount = [int](Invoke-DbScalar -Sql 'select count(*) from "Company";' -PgUser $pgUser -PgDb $pgDb)
  Add-Check "company" ($(if ($companyCount -gt 0) { "passed" } else { "failed" })) "$companyCount company row(s)"

  $userCount = [int](Invoke-DbScalar -Sql 'select count(*) from "User" where "isActive" = true;' -PgUser $pgUser -PgDb $pgDb)
  Add-Check "admin-user" ($(if ($userCount -gt 0) { "passed" } else { "failed" })) "$userCount active user row(s)"

  $taxCount = [int](Invoke-DbScalar -Sql 'select count(*) from "TaxCode" where "isDefault" = true and active = true;' -PgUser $pgUser -PgDb $pgDb)
  Add-Check "default-tax-code" ($(if ($taxCount -gt 0) { "passed" } else { "failed" })) "$taxCount default tax code row(s)"

  $journalCount = [int](Invoke-DbScalar -Sql 'select count(*) from "Journal" where type = ''GENERAL'' and "isActive" = true;' -PgUser $pgUser -PgDb $pgDb)
  Add-Check "default-general-journal" ($(if ($journalCount -gt 0) { "passed" } else { "failed" })) "$journalCount general journal row(s)"

  Invoke-Compose -Arguments @("up", "-d", "api") | Out-Host

  $apiBaseUrl = "http://127.0.0.1:$DrillApiPort/api"
  $healthUrl = "$apiBaseUrl/health"
  Add-Check "api-health" ($(if (Wait-ForHttp -Url $healthUrl) { "passed" } else { "failed" })) $healthUrl

  $email = [string]$envMap["INIT_ADMIN_EMAIL"]
  $password = [string]$envMap["INIT_ADMIN_PASSWORD"]
  if ($email -ne "" -and $password -ne "") {
    try {
      $body = @{ email = $email; password = $password } | ConvertTo-Json
      $login = Invoke-WebRequest -Uri "$apiBaseUrl/auth/login" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
      Add-Check "admin-login" ($(if ($login.StatusCode -eq 200) { "passed" } else { "failed" })) $email
    } catch {
      Add-Check "admin-login" "failed" "Login failed for $email. If the admin password was changed after initialization, update the drill credential source."
    }
  } else {
    Add-Check "admin-login" "skipped" "INIT_ADMIN_EMAIL or INIT_ADMIN_PASSWORD missing"
  }

  $rpoAgeMinutes = [int][Math]::Floor(((Get-Date).ToUniversalTime() - (Get-Item $sql).LastWriteTimeUtc).TotalMinutes)
  if ($rpoAgeMinutes -lt 0) { $rpoAgeMinutes = 0 }
  Add-Check "rpo-age" ($(if ($rpoAgeMinutes -le $RpoTargetMinutes) { "passed" } else { "failed" })) "$rpoAgeMinutes minute(s)"

  $durationSeconds = [int]((Get-Date) - $startedAt).TotalSeconds
  Add-Check "rto-duration" ($(if ($durationSeconds -le ($RtoTargetMinutes * 60)) { "passed" } else { "failed" })) "$durationSeconds second(s)"
} catch {
  $failure = $_
  Add-Check "restore-drill" "failed" $_.Exception.Message
} finally {
  $endedAt = Get-Date
  $failed = @($checks | Where-Object { $_.status -eq "failed" })
  $resolvedReportPath = if ([System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath } else { Join-Path $root $ReportPath }
  $reportDir = Split-Path -Parent $resolvedReportPath
  if ($reportDir -ne "") { New-Item -ItemType Directory -Force -Path $reportDir | Out-Null }
  $report = [ordered]@{
    startedAt = $startedAt.ToString("o")
    endedAt = $endedAt.ToString("o")
    durationSeconds = [int]($endedAt - $startedAt).TotalSeconds
    backupDir = "$resolvedBackup"
    projectName = "$ProjectName"
    composeFile = $ComposeFile
    composeOverrideFile = $ComposeOverrideFile
    rpoTargetMinutes = $RpoTargetMinutes
    rpoAgeMinutes = $rpoAgeMinutes
    rtoTargetMinutes = $RtoTargetMinutes
    status = $(if ($failed.Count -eq 0) { "passed" } else { "failed" })
    checks = $checks
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -Path $resolvedReportPath -Encoding UTF8
  if ($dbStarted -and $composeBaseArgs.Count -gt 0) {
    Invoke-Compose -Arguments @("exec", "-T", "db", "rm", "-f", $dbRestorePath) -AllowFailure | Out-Null
  }
  if (-not $KeepProject) {
    if ($ProjectName -ne "" -and $composeBaseArgs.Count -gt 0) {
      Invoke-Compose -Arguments @("down", "-v") -AllowFailure | Out-Null
    }
    if ($drillEnv -ne "" -and (Test-Path $drillEnv)) {
      Remove-Item -LiteralPath $drillEnv -Force
    }
  }
  Pop-Location
}

if ($null -ne $failure -or @($checks | Where-Object { $_.status -eq "failed" }).Count -gt 0) {
  throw "Restore drill failed. See $ReportPath"
}
