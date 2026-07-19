param(
  [string]$EnvFile = ".env",
  [string]$ApiBaseUrl = "",
  [string]$WebBaseUrl = "",
  [string]$Email = "",
  [string]$Password = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param([string]$Name, [bool]$Passed, [string]$Detail)
  $script:results.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail }) | Out-Null
  $mark = if ($Passed) { "PASS" } else { "FAIL" }
  Write-Host "[$mark] $Name - $Detail"
}

function Read-Env {
  param([string]$Path)
  $map = @{}
  if (Test-Path $Path) {
    Get-Content $Path | ForEach-Object {
      if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
      $parts = $_ -split '=', 2
      $map[$parts[0].Trim()] = $parts[1].Trim().Trim('"')
    }
  }
  return $map
}

function Test-Get {
  param(
    [string]$Name,
    [string]$Url,
    [hashtable]$Headers = @{}
  )
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 15
    Add-Result $Name ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) "$($response.StatusCode) $Url"
  } catch {
    Add-Result $Name $false "$Url - $($_.Exception.Message)"
  }
}

Push-Location $root
try {
  $envMap = Read-Env -Path (Join-Path $root $EnvFile)
  $apiPort = [string]$envMap["API_PORT"]
  if ($apiPort -eq "") { $apiPort = "8000" }
  $webPort = [string]$envMap["WEB_PORT"]
  if ($webPort -eq "") { $webPort = "3000" }

  if ($ApiBaseUrl -eq "" -and $env:API_BASE_URL -ne "") { $ApiBaseUrl = $env:API_BASE_URL }
  if ($WebBaseUrl -eq "" -and $env:WEB_BASE_URL -ne "") { $WebBaseUrl = $env:WEB_BASE_URL }
  if ($ApiBaseUrl -eq "") { $ApiBaseUrl = "http://localhost:$apiPort/api" }
  if ($WebBaseUrl -eq "") { $WebBaseUrl = "http://localhost:$webPort" }
  $ApiBaseUrl = $ApiBaseUrl.TrimEnd("/")
  $WebBaseUrl = $WebBaseUrl.TrimEnd("/")

  if ($Email -eq "") { $Email = [string]$envMap["INIT_ADMIN_EMAIL"] }
  if ($Password -eq "") { $Password = [string]$envMap["INIT_ADMIN_PASSWORD"] }

  Test-Get "api-health" "$ApiBaseUrl/health"
  Test-Get "web-login" "$WebBaseUrl/login"
  Test-Get "web-dashboard" "$WebBaseUrl/dashboard"

  $token = ""
  $companyId = ""
  try {
    $body = @{ email = $Email; password = $Password } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/auth/login" -Body $body -ContentType "application/json" -TimeoutSec 15
    $token = [string]$login.accessToken
    if ($login.companies -and $login.companies.Count -gt 0) {
      $companyId = [string]$login.companies[0].id
    }
    Add-Result "api-login" ($token -ne "" -and $companyId -ne "") "user=$Email company=$companyId"
  } catch {
    Add-Result "api-login" $false "$($_.Exception.Message)"
  }

  if ($token -ne "" -and $companyId -ne "") {
    $headers = @{
      Authorization = "Bearer $token"
      "x-company-id" = $companyId
    }

    Test-Get "api-dashboard-stats" "$ApiBaseUrl/dashboard/stats" $headers
    Test-Get "api-orders" "$ApiBaseUrl/orders" $headers
    Test-Get "api-metadata-order" "$ApiBaseUrl/v1/metadata/order" $headers
    Test-Get "api-resource-order" "$ApiBaseUrl/v1/resource/order?page=1&limit=20&searchFields=orderNo%2Cstatus&include=%7B%22partner%22%3Atrue%2C%22taxCode%22%3Atrue%7D" $headers
    Test-Get "api-inventory-ledger" "$ApiBaseUrl/inventory/realtime-ledger" $headers
    Test-Get "api-metadata-invoice" "$ApiBaseUrl/v1/metadata/invoice" $headers
    Test-Get "api-resource-invoice" "$ApiBaseUrl/v1/resource/invoice?page=1&limit=20&searchFields=invoiceNo%2Cstatus&include=%7B%22order%22%3Atrue%2C%22taxCode%22%3Atrue%7D" $headers
  }

  $failed = @($results | Where-Object { -not $_.passed })
  $report = [ordered]@{
    checkedAt = (Get-Date).ToString("o")
    apiBaseUrl = $ApiBaseUrl
    webBaseUrl = $WebBaseUrl
    envFile = $EnvFile
    results = $results
  }
  $report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $root "prod-smoke-report.json") -Encoding UTF8
  if ($failed.Count -gt 0) {
    throw "$($failed.Count) production smoke check(s) failed. See prod-smoke-report.json"
  }
} finally {
  Pop-Location
}
