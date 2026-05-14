param(
  [string]$BackupDir = "",
  [string]$ComposeFile = "docker-compose.ha-lite.yml",
  [string]$ProjectName = "",
  [string]$ReportPath = "restore-drill-report.json",
  [switch]$KeepProject
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startedAt = Get-Date
$checks = New-Object System.Collections.Generic.List[object]

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

function Invoke-DbScalar {
  param([string]$Sql, [string]$PgUser, [string]$PgDb)
  $value = docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile exec -T db psql -U $PgUser -d $PgDb -tAc $Sql
  if ($LASTEXITCODE -ne 0) {
    throw "SQL failed: $Sql"
  }
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

Push-Location $root
try {
  if ($BackupDir -eq "") {
    $latest = Get-ChildItem -Path (Join-Path $root "backups") -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $latest) { throw "No backup directory found under backups/" }
    $BackupDir = $latest.FullName
  }
  $resolvedBackup = Resolve-Path $BackupDir
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
  Set-EnvValue -Path $drillEnv -Key "API_PORT" -Value "18000"
  Set-EnvValue -Path $drillEnv -Key "WEB_PORT" -Value "13000"
  Set-EnvValue -Path $drillEnv -Key "CORS_ORIGINS" -Value "http://localhost:13000"

  $envMap = Read-EnvFile -Path $drillEnv
  $pgUser = [string]$envMap["POSTGRES_USER"]
  if ($pgUser -eq "") { $pgUser = "oneerp" }
  $pgDb = [string]$envMap["POSTGRES_DB"]
  if ($pgDb -eq "") { $pgDb = "oneerp" }

  docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile up -d --build db redis minio migrate | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Temporary stack startup failed" }
  Add-Check "temp-stack" "passed" $ProjectName

  Get-Content $sql | docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile exec -T db psql -U $pgUser -d $pgDb | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL restore failed" }
  Add-Check "postgres-restore" "passed" $sql

  if (Test-Path $minio) {
    docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile cp $minio minio:/tmp/minio-data.tgz
    if ($LASTEXITCODE -ne 0) { throw "MinIO archive copy failed" }
    docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile exec -T minio sh -c "cd /data && tar xzf /tmp/minio-data.tgz && rm -f /tmp/minio-data.tgz" | Out-Null
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

  docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile up -d api | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Temporary API startup failed" }

  Add-Check "api-health" ($(if (Test-Http -Url "http://localhost:18000/api/health") { "passed" } else { "failed" })) "http://localhost:18000/api/health"

  $email = [string]$envMap["INIT_ADMIN_EMAIL"]
  $password = [string]$envMap["INIT_ADMIN_PASSWORD"]
  if ($email -ne "" -and $password -ne "") {
    try {
      $body = @{ email = $email; password = $password } | ConvertTo-Json
      $login = Invoke-WebRequest -Uri "http://localhost:18000/api/auth/login" -Method Post -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
      Add-Check "admin-login" ($(if ($login.StatusCode -eq 200) { "passed" } else { "failed" })) $email
    } catch {
      Add-Check "admin-login" "failed" "Login failed for $email. If the admin password was changed after initialization, update the drill credential source."
    }
  } else {
    Add-Check "admin-login" "skipped" "INIT_ADMIN_EMAIL or INIT_ADMIN_PASSWORD missing"
  }
} finally {
  $endedAt = Get-Date
  $failed = @($checks | Where-Object { $_.status -eq "failed" })
  $report = [ordered]@{
    startedAt = $startedAt.ToString("o")
    endedAt = $endedAt.ToString("o")
    durationSeconds = [int]($endedAt - $startedAt).TotalSeconds
    backupDir = "$BackupDir"
    projectName = "$ProjectName"
    rpoTargetMinutes = 15
    rtoTargetMinutes = 60
    status = $(if ($failed.Count -eq 0) { "passed" } else { "failed" })
    checks = $checks
  }
  $report | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $root $ReportPath) -Encoding UTF8
  if (-not $KeepProject -and $ProjectName -ne "") {
    docker compose -p $ProjectName --env-file $drillEnv -f $ComposeFile down -v | Out-Null
  }
  Pop-Location
}

if (@($checks | Where-Object { $_.status -eq "failed" }).Count -gt 0) {
  throw "Restore drill failed. See $ReportPath"
}
