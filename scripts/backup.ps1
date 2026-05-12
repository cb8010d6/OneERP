param(
  [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $root $OutputDir
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $backupRoot $stamp

New-Item -ItemType Directory -Force -Path $target | Out-Null

Push-Location $root
try {
  docker compose -f docker-compose.easy.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > (Join-Path $target "postgres.sql")
  docker compose -f docker-compose.easy.yml exec -T minio sh -c "cd /data && tar czf - ." > (Join-Path $target "minio-data.tgz")
  Copy-Item .env (Join-Path $target ".env.copy")
  Write-Host "Backup written to $target"
} finally {
  Pop-Location
}
