param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir,
  [string]$ComposeFile = "docker-compose.easy.yml",
  [string]$BackupHelperImage = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$resolved = (Resolve-Path -LiteralPath $BackupDir).Path
$sql = Join-Path $resolved "postgres.sql"
$minio = Join-Path $resolved "minio-data.tgz"
$dbRestorePath = "/tmp/oneerp-restore-$([guid]::NewGuid().ToString('N')).sql"
$sqlCopyAttempted = $false

if (!(Test-Path -LiteralPath $sql -PathType Leaf)) {
  throw "postgres.sql not found in $resolved"
}
if ($BackupHelperImage -eq "") {
  $BackupHelperImage = if ($env:ONEERP_BACKUP_HELPER_IMAGE) {
    $env:ONEERP_BACKUP_HELPER_IMAGE
  } else {
    "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
  }
}

Push-Location $root
try {
  $hasMinio = Test-Path -LiteralPath $minio -PathType Leaf
  if ($hasMinio) {
    $minioContainer = docker compose -f $ComposeFile ps -q minio
    if ($LASTEXITCODE -ne 0) { throw "MinIO container lookup failed" }
    if (-not $minioContainer -or @($minioContainer).Count -ne 1) { throw "Expected one running MinIO container" }
    $minioContainer = $minioContainer.Trim()
    if ($minioContainer -eq "") { throw "MinIO container is not running" }
    # Read the archive with the same helper before changing PostgreSQL.
    docker run --rm --mount "type=bind,source=$resolved,destination=/backup,readonly" $BackupHelperImage tar tzf /backup/minio-data.tgz | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "MinIO archive preflight failed" }
  }

  # Copy bytes directly: a PowerShell text pipeline can change UTF-8 SQL.
  $sqlCopyAttempted = $true
  docker compose -f $ComposeFile cp $sql "db:$dbRestorePath"
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL archive copy failed" }
  docker compose -f $ComposeFile exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$1"' sh $dbRestorePath
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL restore failed" }
  docker compose -f $ComposeFile exec -T db rm -f $dbRestorePath
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL temporary archive cleanup failed" }
  $sqlCopyAttempted = $false

  if ($hasMinio) {
    docker run --rm --volumes-from $minioContainer --mount "type=bind,source=$resolved,destination=/backup,readonly" $BackupHelperImage tar xzf /backup/minio-data.tgz -C /data
    if ($LASTEXITCODE -ne 0) { throw "MinIO archive restore failed" }
  }
  Write-Host "Restore complete."
} finally {
  if ($sqlCopyAttempted) {
    try {
      docker compose -f $ComposeFile exec -T db rm -f $dbRestorePath
      if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove temporary PostgreSQL archive: $dbRestorePath" }
    } catch {
      Write-Warning "Could not remove temporary PostgreSQL archive: $dbRestorePath"
    }
  }
  Pop-Location
}
