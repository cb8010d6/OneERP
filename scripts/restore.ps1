param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir,
  [string]$ComposeFile = "docker-compose.easy.yml"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$resolved = Resolve-Path $BackupDir
$sql = Join-Path $resolved "postgres.sql"
$minio = Join-Path $resolved "minio-data.tgz"

if (!(Test-Path $sql)) {
  throw "postgres.sql not found in $resolved"
}

Push-Location $root
try {
  Get-Content $sql | docker compose -f $ComposeFile exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL restore failed" }
  if (Test-Path $minio) {
    docker compose -f $ComposeFile cp $minio minio:/tmp/minio-data.tgz
    if ($LASTEXITCODE -ne 0) { throw "MinIO archive copy failed" }
    docker compose -f $ComposeFile exec -T minio sh -c "cd /data && tar xzf /tmp/minio-data.tgz && rm -f /tmp/minio-data.tgz"
    if ($LASTEXITCODE -ne 0) { throw "MinIO archive restore failed" }
  }
  Write-Host "Restore complete."
} finally {
  Pop-Location
}
