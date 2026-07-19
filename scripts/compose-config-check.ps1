$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location $root
try {
  node scripts/compose-config-check.mjs
} finally {
  Pop-Location
}
