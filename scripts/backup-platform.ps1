[CmdletBinding()]
param([string]$Destination, [string]$DataDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) { [IO.Path]::GetFullPath($DataDirectory) }
    elseif (-not [string]::IsNullOrWhiteSpace($env:Lifewood__DataDirectory)) { [IO.Path]::GetFullPath($env:Lifewood__DataDirectory) }
    elseif (Test-Path -LiteralPath (Join-Path $repositoryRoot "server")) { Join-Path $repositoryRoot "data" }
    else { Join-Path $repositoryRoot "services\platform-api\data" }
$backupRoot = if ([string]::IsNullOrWhiteSpace($Destination)) { Join-Path $repositoryRoot "backups" } else { $Destination }

if (-not (Test-Path -LiteralPath $dataDirectory)) {
    throw "Platform data directory was not found: $dataDirectory"
}

$dataItem = Get-Item -LiteralPath $dataDirectory -Force
if (($dataItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "The data directory cannot be a junction or symbolic link." }

function Assert-NoReparsePoints([string]$Path) {
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "The data directory contains a junction or symbolic link: $($item.FullName)"
        }
        if ($item.PSIsContainer) {
            foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $pending.Push($child.FullName) }
        }
    }
}


$lockPath = Join-Path $dataDirectory "platform.lock"
try {
    $platformLock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
}
catch {
    throw "The platform is running or another backup is active. Stop it before backup."
}

try {
Assert-NoReparsePoints $dataDirectory
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
Compress-Archive -LiteralPath $sourceItems -DestinationPath $archive -CompressionLevel Optimal

$result = Get-Item -LiteralPath $archive
if ($result.Length -le 0) { throw "Backup archive is empty." }
Write-Host "Backup created: $($result.FullName)" -ForegroundColor Green
Write-Host "Keep this archive private: it contains accounts, uploaded materials, final deliveries, and data-protection keys."
}
finally {
    $platformLock.Dispose()
}
