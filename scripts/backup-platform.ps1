[CmdletBinding()]
param([string]$Destination)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $repositoryRoot "services\platform-api\data"
$stateFile = Join-Path $repositoryRoot "artifacts\dev-logs\local-services.json"
$backupRoot = if ([string]::IsNullOrWhiteSpace($Destination)) { Join-Path $repositoryRoot "backups" } else { $Destination }

if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $running = @($state.processes | Where-Object { Get-Process -Id $_.id -ErrorAction SilentlyContinue })
    if ($running.Count -gt 0) {
        throw "Stop the local platform before backup so the database and uploaded files remain consistent."
    }
}

if (-not (Test-Path -LiteralPath $dataDirectory)) {
    throw "Platform data directory was not found: $dataDirectory"
}


$lockPath = Join-Path $dataDirectory "platform.lock"
try {
    $platformLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
}
catch {
    throw "The platform is running or another backup is active. Stop it before backup."
}

try {
$resolvedBackupRoot = [System.IO.Path]::GetFullPath($backupRoot)
$resolvedDataDirectory = (Resolve-Path -LiteralPath $dataDirectory).Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
if ($resolvedBackupRoot.Equals($resolvedDataDirectory, [StringComparison]::OrdinalIgnoreCase) -or
    $resolvedBackupRoot.StartsWith($resolvedDataDirectory + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The backup destination cannot be inside the platform data directory."
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Path $resolvedBackupRoot -Force | Out-Null
$archive = Join-Path $resolvedBackupRoot "lifewood-platform-data-$stamp.zip"
$sourceItems = @(Get-ChildItem -LiteralPath $dataDirectory -Force | Where-Object { $_.Name -ne "platform.lock" } | Select-Object -ExpandProperty FullName)
if ($sourceItems.Count -eq 0) { throw "Platform data directory is empty." }
Compress-Archive -Path $sourceItems -DestinationPath $archive -CompressionLevel Optimal

$result = Get-Item -LiteralPath $archive
if ($result.Length -le 0) { throw "Backup archive is empty." }
Write-Host "Backup created: $($result.FullName)" -ForegroundColor Green
Write-Host "Keep this archive private: it contains accounts, uploaded materials, final deliveries, and data-protection keys."
}
finally {
    $platformLock.Dispose()
}
