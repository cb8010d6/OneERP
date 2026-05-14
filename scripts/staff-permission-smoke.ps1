param(
  [string]$EnvFile = ".env",
  [string]$ApiBaseUrl = "",
  [string]$Email = "",
  [string]$Password = "",
  [string]$Report = "staff-permission-smoke-report.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$argsList = @(
  (Join-Path $PSScriptRoot "staff-permission-smoke.mjs"),
  "--env-file", $EnvFile,
  "--report", $Report
)

if ($ApiBaseUrl -ne "") { $argsList += @("--api-base-url", $ApiBaseUrl) }
if ($Email -ne "") { $argsList += @("--email", $Email) }
if ($Password -ne "") { $argsList += @("--password", $Password) }

Push-Location $root
try {
  node @argsList
  if ($LASTEXITCODE -ne 0) {
    throw "staff permission smoke failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
