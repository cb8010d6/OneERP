param(
  [string]$Output = "enum-dirty-data-scan.sql"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node scripts/enum-dirty-data-sql.mjs --output $Output
} finally {
  Pop-Location
}
