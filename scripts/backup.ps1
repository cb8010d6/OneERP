param(
  [string]$OutputDir = "",
  [string]$PolicyFile = "ops/backup-policy.example.json",
  [string]$ComposeFile = "docker-compose.easy.yml",
  [string]$EncryptionKey = "",
  [string]$BackupHelperImage = "",
  [switch]$RequireEncryption
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$defaultBackupHelperImage = "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"

if ($EncryptionKey -eq "" -and $env:ONEERP_BACKUP_ENCRYPTION_KEY) {
  $EncryptionKey = $env:ONEERP_BACKUP_ENCRYPTION_KEY
}
if ($BackupHelperImage -eq "") {
  $BackupHelperImage = if ($env:ONEERP_BACKUP_HELPER_IMAGE) {
    $env:ONEERP_BACKUP_HELPER_IMAGE
  } else {
    $defaultBackupHelperImage
  }
}

$envRequire = $env:ONEERP_BACKUP_REQUIRE_ENCRYPTION
if ($envRequire -eq "true" -or $envRequire -eq "1") {
  $RequireEncryption = $true
}

if ($RequireEncryption -and $EncryptionKey -eq "") {
  Write-Error "Encryption is required but -EncryptionKey was not provided. Set -EncryptionKey or ONEERP_BACKUP_REQUIRE_ENCRYPTION=true with ONEERP_BACKUP_ENCRYPTION_KEY."
  exit 1
}

function Encrypt-File {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if ($Key -eq "") {
    return $FilePath
  }

  $encryptedPath = "$FilePath.enc"
  $bytes = [System.IO.File]::ReadAllBytes($FilePath)

  $salt = New-Object byte[] 16
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $random.GetBytes($salt)
  $random.Dispose()

  $deriveBytes = New-Object System.Security.Cryptography.Rfc2898DeriveBytes(
    [System.Text.Encoding]::UTF8.GetBytes($Key),
    $salt,
    100000,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
  )
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $deriveBytes.GetBytes(32)
  $aes.GenerateIV()
  $deriveBytes.Dispose()

  $encryptor = $aes.CreateEncryptor()
  $encrypted = $encryptor.TransformFinalBlock($bytes, 0, $bytes.Length)

  $output = New-Object byte[] ($salt.Length + $aes.IV.Length + $encrypted.Length)
  [System.Array]::Copy($salt, 0, $output, 0, $salt.Length)
  [System.Array]::Copy($aes.IV, 0, $output, $salt.Length, $aes.IV.Length)
  [System.Array]::Copy($encrypted, 0, $output, $salt.Length + $aes.IV.Length, $encrypted.Length)

  [System.IO.File]::WriteAllBytes($encryptedPath, $output)
  $aes.Dispose()
  Remove-Item -LiteralPath $FilePath -Force
  return $encryptedPath
}
function Read-BackupPolicy {
  param([string]$Path)

  $defaults = [ordered]@{
    postgresIntervalMinutes = 15
    minioIntervalMinutes = 60
    retentionDays = 14
    backupDir = "backups"
    offsiteDir = ""
  }

  $resolvedPath = Join-Path $root $Path
  if (Test-Path $resolvedPath) {
    $policy = Get-Content $resolvedPath -Raw | ConvertFrom-Json
    foreach ($key in @($defaults.Keys)) {
      if ($null -ne $policy.$key -and "$($policy.$key)" -ne "") {
        $defaults[$key] = $policy.$key
      }
    }
  }

  return [pscustomobject]$defaults
}

function Remove-ExpiredBackups {
  param(
    [string]$BackupRoot,
    [int]$RetentionDays
  )

  if (!(Test-Path $BackupRoot)) {
    return
  }

  $cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
  Get-ChildItem -Path $BackupRoot -Directory |
    Where-Object { $_.Name -notlike ".incomplete-*" -and $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force
      Write-Host "Removed expired backup $($_.FullName)"
    }
}

$policy = Read-BackupPolicy -Path $PolicyFile
if ($OutputDir -eq "") {
  $OutputDir = [string]$policy.backupDir
}

$backupRoot = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $root $OutputDir }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$finalTarget = Join-Path $backupRoot $stamp
$target = Join-Path $backupRoot ".incomplete-$stamp"
$dbTempPath = "/tmp/oneerp-backup-$stamp.sql"
$dbTempCreated = $false
$published = $false

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
if ((Test-Path $target) -or (Test-Path $finalTarget)) {
  throw "Backup target already exists for timestamp $stamp"
}
New-Item -ItemType Directory -Path $target | Out-Null

Push-Location $root
try {
  docker compose -f $ComposeFile exec -T db sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" --clean --if-exists --no-owner --no-privileges > $dbTempPath"
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL dump failed" }
  $dbTempCreated = $true
  docker compose -f $ComposeFile cp "db:$dbTempPath" (Join-Path $target "postgres.sql")
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL dump copy failed" }

  $minioContainer = [string](docker compose -f $ComposeFile ps -q minio)
  if ($LASTEXITCODE -ne 0 -or $minioContainer.Trim() -eq "") {
    throw "MinIO container is not running"
  }
  $targetMount = (Convert-Path $target)
  docker run --rm --volumes-from $minioContainer.Trim() --mount "type=bind,source=$targetMount,destination=/backup" $BackupHelperImage tar czf /backup/minio-data.tgz -C /data .
  if ($LASTEXITCODE -ne 0) { throw "MinIO archive creation failed" }

  $files = [System.Collections.Generic.List[string]]::new()
  $files.Add("postgres.sql")
  $files.Add("minio-data.tgz")
  if (Test-Path ".env") {
    Copy-Item .env (Join-Path $target ".env.copy")
    $files.Add(".env.copy")
  }

  $manifest = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    composeFile = $ComposeFile
    postgresIntervalMinutes = [int]$policy.postgresIntervalMinutes
    minioIntervalMinutes = [int]$policy.minioIntervalMinutes
    retentionDays = [int]$policy.retentionDays
    encrypted = ($EncryptionKey -ne "")
    files = @($files)
  }

  if ($EncryptionKey -ne "") {
    Write-Host "Encrypting backup files..."
    $encryptedFiles = [System.Collections.Generic.List[string]]::new()
    foreach ($file in @($manifest.files)) {
      $filePath = Join-Path $target $file
      if (Test-Path $filePath) {
        $encryptedFiles.Add((Split-Path -Leaf (Encrypt-File -FilePath $filePath -Key $EncryptionKey)))
      }
    }
    $manifest.files = @($encryptedFiles)
    Write-Host "Backup encryption completed"
  }

  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $target "backup-manifest.json") -Encoding UTF8

  Move-Item -LiteralPath $target -Destination $finalTarget
  $published = $true

  Remove-ExpiredBackups -BackupRoot $backupRoot -RetentionDays ([int]$policy.retentionDays)

  if ("$($policy.offsiteDir)" -ne "") {
    $offsiteRoot = [string]$policy.offsiteDir
    $offsiteTarget = Join-Path $offsiteRoot $stamp
    New-Item -ItemType Directory -Force -Path $offsiteTarget | Out-Null
    Copy-Item -Path (Join-Path $finalTarget "*") -Destination $offsiteTarget -Recurse -Force
    Write-Host "Off-site backup copy written to $offsiteTarget"
  }

  Write-Host "Backup written to $finalTarget"
} finally {
  if ($dbTempCreated) {
    docker compose -f $ComposeFile exec -T db rm -f $dbTempPath 2>$null | Out-Null
  }
  if (-not $published -and (Test-Path $target)) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
  Pop-Location
}
