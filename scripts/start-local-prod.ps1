param(
  [switch]$Build,
  [int]$ApiPort = 18000,
  [int]$WebPort = 30055,
  [int]$DbPort = 15432
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$scratch = Join-Path $root "scratch"

function Stop-OneErpNode {
  $escapedRoot = [Regex]::Escape($root)
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -match $escapedRoot } |
    ForEach-Object {
      Write-Host "Stopping OneERP Node process $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  Get-NetTCPConnection -LocalPort $ApiPort, $WebPort -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -gt 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      Write-Host "Stopping process on OneERP port: $_"
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
}

if (!(Test-Path $scratch)) {
  New-Item -ItemType Directory -Path $scratch | Out-Null
}

Push-Location $root
try {
  Stop-OneErpNode
  Start-Sleep -Seconds 2

  $env:DB_PORT = [string]$DbPort
  docker compose up -d db redis minio

  if ($Build) {
    $env:DATABASE_URL = "postgresql://eip_user:eip_password@localhost:$DbPort/eip_db"
    $env:NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:$ApiPort/api"
    $env:API_BASE_URL = "http://127.0.0.1:$ApiPort/api"
    npm --prefix apps/api run prisma:generate
    npm run build
  }

  $standaloneWebDir = Join-Path $root "apps/web/.next/standalone/apps/web"
  $standaloneStaticDir = Join-Path $standaloneWebDir ".next/static"
  $sourceStaticDir = Join-Path $root "apps/web/.next/static"
  if (!(Test-Path $sourceStaticDir)) {
    throw "Next static assets not found. Run scripts/start-local-prod.ps1 -Build first."
  }
  if (Test-Path $standaloneStaticDir) {
    Remove-Item -LiteralPath $standaloneStaticDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $standaloneStaticDir) -Force | Out-Null
  Copy-Item -Path $sourceStaticDir -Destination $standaloneStaticDir -Recurse -Force

  $sourcePublicDir = Join-Path $root "apps/web/public"
  $standalonePublicDir = Join-Path $standaloneWebDir "public"
  if (Test-Path $sourcePublicDir) {
    if (Test-Path $standalonePublicDir) {
      Remove-Item -LiteralPath $standalonePublicDir -Recurse -Force
    }
    Copy-Item -Path $sourcePublicDir -Destination $standalonePublicDir -Recurse -Force
  }

  $apiCommand = @"
`$env:DATABASE_URL='postgresql://eip_user:eip_password@localhost:$DbPort/eip_db'
`$env:JWT_SECRET='EIP_SECRET_KEY_SUPER_SECURE'
`$env:PORT='$ApiPort'
`$env:CORS_ORIGINS='http://localhost:$WebPort,http://127.0.0.1:$WebPort'
`$env:REDIS_HOST='localhost'
`$env:REDIS_PORT='16379'
`$env:MINIO_ENDPOINT='localhost'
`$env:MINIO_PORT='9000'
`$env:MINIO_ACCESS_KEY='minio_admin'
`$env:MINIO_SECRET_KEY='minio_password'
`$env:AI_WRITE_ENABLED='false'
node apps/api/dist/src/main *> scratch/api-prod.log
"@

  $webCommand = @"
`$env:PORT='$WebPort'
`$env:NEXT_PUBLIC_API_BASE_URL='http://127.0.0.1:$ApiPort/api'
`$env:API_BASE_URL='http://127.0.0.1:$ApiPort/api'
`$env:NODE_OPTIONS='--max-old-space-size=1024'
node apps/web/.next/standalone/apps/web/server.js *> scratch/web-prod.log
"@

  Start-Process -FilePath powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $apiCommand
  ) -WorkingDirectory $root -WindowStyle Hidden

  Start-Process -FilePath powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    $webCommand
  ) -WorkingDirectory $root -WindowStyle Hidden

  Start-Sleep -Seconds 10

  Write-Host "API: http://127.0.0.1:$ApiPort/api"
  Write-Host "Web: http://localhost:$WebPort"
  Get-NetTCPConnection -LocalPort $ApiPort, $WebPort -ErrorAction SilentlyContinue |
    Select-Object LocalPort, State, OwningProcess
} finally {
  Pop-Location
}
