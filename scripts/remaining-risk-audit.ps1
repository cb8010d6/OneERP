param(
  [string]$Report = "remaining-risk-audit-report.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node scripts/remaining-risk-audit.mjs --report $Report
} finally {
  Pop-Location
}
