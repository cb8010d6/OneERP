param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir
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
  Get-Content $sql | docker compose -f docker-compose.easy.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
  if (Test-Path $minio) {
    Get-Content $minio -AsByteStream | docker compose -f docker-compose.easy.yml exec -T minio sh -c "cd /data && tar xzf -"
  }
  Write-Host "Restore complete."
} finally {
  Pop-Location
}
