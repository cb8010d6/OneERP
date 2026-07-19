param(
  [string]$EnvFile = ".env",
  [string]$ApiBaseUrl = "",
  [string]$Email = "",
  [string]$Password = "",
  [string]$Report = "business-acceptance-report.json"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$argsList = @(
  (Join-Path $PSScriptRoot "business-acceptance.mjs"),
  "--env-file", $EnvFile,
  "--report", $Report
)

if ($ApiBaseUrl -ne "") {
  $argsList += @("--api-base-url", $ApiBaseUrl)
}
if ($Email -ne "") {
  $argsList += @("--email", $Email)
}
if ($Password -ne "") {
  $argsList += @("--password", $Password)
}

Push-Location $root
try {
  node @argsList
  if ($LASTEXITCODE -ne 0) {
    throw "business acceptance failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}
