param(
  [string]$Report = "enum-dirty-data-report.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node scripts/enum-dirty-data-report.mjs --report $Report
} finally {
  Pop-Location
}
