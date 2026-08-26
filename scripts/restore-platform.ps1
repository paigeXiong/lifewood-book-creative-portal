[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [string]$DataDirectory,
    [switch]$Replace
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$target = if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) { [IO.Path]::GetFullPath($DataDirectory) }
    elseif (-not [string]::IsNullOrWhiteSpace($env:Lifewood__DataDirectory)) { [IO.Path]::GetFullPath($env:Lifewood__DataDirectory) }
    elseif (Test-Path -LiteralPath (Join-Path $repositoryRoot "api")) { Join-Path $repositoryRoot "api\data" }
    else { Join-Path $repositoryRoot "services\platform-api\data" }
$source = (Resolve-Path -LiteralPath $Archive).Path
if ([IO.Path]::GetExtension($source) -ne ".zip") { throw "Choose a .zip backup created by backup-platform.ps1." }

function Assert-SafeDataTarget([string]$Path, [bool]$RequirePlatformDatabase) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $driveRoot = [IO.Path]::GetPathRoot($full).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $blocked = @($driveRoot, [IO.Path]::GetFullPath($repositoryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar))
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $blocked += [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd([IO.Path]::DirectorySeparatorChar) }
    if ($blocked | Where-Object { $full.Equals($_, [StringComparison]::OrdinalIgnoreCase) }) { throw "Refusing to restore over a drive, workspace, or user-profile root: $full" }
    if ($RequirePlatformDatabase -and -not (Test-Path -LiteralPath (Join-Path $full 'platform.db') -PathType Leaf)) { throw "The replacement target is not a platform data directory because platform.db is missing: $full" }
    if (-not (Test-Path -LiteralPath $full)) { return }
    $pending = [Collections.Generic.Stack[string]]::new(); $pending.Push($full)
    while ($pending.Count -gt 0) {
        $current = $pending.Pop(); $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "The data directory contains a junction or symbolic link: $($item.FullName)" }
        if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { $pending.Push($child.FullName) } }
    }
}

Assert-SafeDataTarget $target ($Replace -and (Test-Path -LiteralPath $target))

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($source)
try {
    if ($zip.Entries.Count -eq 0) { throw "The backup archive is empty." }
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($name)) {
            throw "The backup contains an unsafe path: $name"
        }
    }
}
finally { $zip.Dispose() }

if (Test-Path -LiteralPath $target) {
    $lockPath = Join-Path $target "platform.lock"
    try { $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw "The platform is running. Stop it before restoring data." }
    $lock.Dispose()
    if ((Get-ChildItem -LiteralPath $target -Force | Where-Object Name -ne 'platform.lock') -and -not $Replace) {
        throw "The data directory is not empty. Re-run with -Replace to create a safety backup and replace it."
    }
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-restore-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
    Expand-Archive -LiteralPath $source -DestinationPath $tempRoot
    if (-not (Test-Path -LiteralPath (Join-Path $tempRoot 'platform.db'))) { throw "The archive does not contain platform.db at its root." }
    if ($Replace -and (Test-Path -LiteralPath $target)) {
        & (Join-Path $PSScriptRoot 'backup-platform.ps1') -DataDirectory $target
        if (-not $?) { throw "The safety backup failed; restore was cancelled." }
        Assert-SafeDataTarget $target $true
        Remove-Item -LiteralPath $target -Recurse -Force
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Get-ChildItem -LiteralPath $tempRoot -Force | Copy-Item -Destination $target -Recurse -Force
    Write-Host "Restore completed: $target" -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
