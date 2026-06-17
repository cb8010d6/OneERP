param(
  [string]$OutputDir = "",
  [string]$PolicyFile = "ops/backup-policy.example.json",
  [string]$ComposeFile = "docker-compose.easy.yml",
  [string]$EncryptionKey = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

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
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($salt)

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
    Where-Object { $_.LastWriteTime -lt $cutoff } |
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
$target = Join-Path $backupRoot $stamp

New-Item -ItemType Directory -Force -Path $target | Out-Null

Push-Location $root
try {
  docker compose -f $ComposeFile exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > (Join-Path $target "postgres.sql")
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL dump failed" }
  docker compose -f $ComposeFile exec -T minio sh -c "tar czf /tmp/minio-data.tgz -C /data ."
  if ($LASTEXITCODE -ne 0) { throw "MinIO archive creation failed" }
  docker compose -f $ComposeFile cp minio:/tmp/minio-data.tgz (Join-Path $target "minio-data.tgz")
  if ($LASTEXITCODE -ne 0) { throw "MinIO archive copy failed" }
  docker compose -f $ComposeFile exec -T minio sh -c "rm -f /tmp/minio-data.tgz" | Out-Null
  if (Test-Path ".env") {
    Copy-Item .env (Join-Path $target ".env.copy")
  }

  $manifest = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    composeFile = $ComposeFile
    postgresIntervalMinutes = [int]$policy.postgresIntervalMinutes
    minioIntervalMinutes = [int]$policy.minioIntervalMinutes
    retentionDays = [int]$policy.retentionDays
    encrypted = ($EncryptionKey -ne "")
    files = @("postgres.sql", "minio-data.tgz", ".env.copy")
  }

  if ($EncryptionKey -ne "") {
    Write-Host "Encrypting backup files..."
    foreach ($file in $manifest.files) {
      $filePath = Join-Path $target $file
      if (Test-Path $filePath) {
        Encrypt-File -FilePath $filePath -Key $EncryptionKey
        $manifest.files[$manifest.files.IndexOf($file)] = "$file.enc"
      }
    }
    Write-Host "Backup encryption completed"
  }

  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $target "backup-manifest.json") -Encoding UTF8

  Remove-ExpiredBackups -BackupRoot $backupRoot -RetentionDays ([int]$policy.retentionDays)

  if ("$($policy.offsiteDir)" -ne "") {
    $offsiteRoot = [string]$policy.offsiteDir
    $offsiteTarget = Join-Path $offsiteRoot $stamp
    New-Item -ItemType Directory -Force -Path $offsiteTarget | Out-Null
    Copy-Item -Path (Join-Path $target "*") -Destination $offsiteTarget -Recurse -Force
    Write-Host "Off-site backup copy written to $offsiteTarget"
  }

  Write-Host "Backup written to $target"
} finally {
  Pop-Location
}
