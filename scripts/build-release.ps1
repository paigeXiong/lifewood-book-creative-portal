[CmdletBinding()]
param(
    [string]$Runtime = "win-x64",
    [string]$OutputDirectory,
    [string]$ApiPublishDirectory,
    [switch]$SkipFrontendBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = Join-Path $repositoryRoot "artifacts"
$releaseRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { Join-Path $artifactsRoot "release" } else { [IO.Path]::GetFullPath($OutputDirectory) }
$stagingRoot = Join-Path $artifactsRoot "release-staging"
$archive = $null
$hash = $null

# Capture source provenance before this script runs build tools. CI may provide a
# clean-checkout snapshot captured before earlier verification steps ran.
$currentRevision = (& git -C $repositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentRevision)) { throw "A Git revision is required for a reproducible release." }
$revision = if ([string]::IsNullOrWhiteSpace($env:RELEASE_SOURCE_REVISION)) { $currentRevision } else { $env:RELEASE_SOURCE_REVISION.Trim() }
if ($revision -ne $currentRevision) { throw "RELEASE_SOURCE_REVISION does not match the checked-out Git revision." }
if ([string]::IsNullOrWhiteSpace($env:RELEASE_SOURCE_STATE)) {
    $statusLines = @(& git -C $repositoryRoot status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) { throw "Git status is required to determine release provenance." }
    $sourceState = if ($statusLines.Count -eq 0) { "clean" } else { "dirty" }
}
else {
    $sourceState = $env:RELEASE_SOURCE_STATE.Trim().ToLowerInvariant()
    if ($sourceState -notin @("clean", "dirty")) { throw "RELEASE_SOURCE_STATE must be clean or dirty." }
}
$epochText = if ([string]::IsNullOrWhiteSpace($env:SOURCE_DATE_EPOCH)) { (& git -C $repositoryRoot show -s --format=%ct HEAD).Trim() } else { $env:SOURCE_DATE_EPOCH.Trim() }
$epoch = 0L
if (-not [long]::TryParse($epochText, [ref]$epoch)) { throw "SOURCE_DATE_EPOCH must be a Unix timestamp." }
$releaseTimestamp = [DateTimeOffset]::FromUnixTimeSeconds($epoch).ToUniversalTime()
if ($releaseTimestamp.Year -lt 1980) { $releaseTimestamp = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero) }

function Assert-WorkspaceArtifactPath([string]$Path) {
    $resolvedArtifacts = [IO.Path]::GetFullPath($artifactsRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    if (-not $resolvedPath.StartsWith($resolvedArtifacts + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release working paths must stay inside $resolvedArtifacts"
    }
}

function Assert-NoReparsePoints([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($Path))
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Release cleanup refuses to traverse a junction or symbolic link: $($item.FullName)"
        }
        if (-not $item.PSIsContainer) { continue }
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Release cleanup refuses to traverse a junction or symbolic link: $($child.FullName)"
            }
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}

function Assert-PathNotReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Release refuses to use a junction or symbolic link: $($item.FullName)"
    }
}

function Get-StableRelativeFiles([string]$Root) {
    Assert-NoReparsePoints $Root
    $paths = [Collections.Generic.List[string]]::new()
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File) {
        $paths.Add($file.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/'))
    }
    $paths.Sort([StringComparer]::Ordinal)
    return $paths.ToArray()
}

function Remove-StagingDirectory {
    Assert-WorkspaceArtifactPath $stagingRoot
    Assert-PathNotReparsePoint $artifactsRoot
    Assert-NoReparsePoints $stagingRoot
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}

Remove-StagingDirectory
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null

try {
    if (-not $SkipFrontendBuild) {
        & npm.cmd run build:web
        if ($LASTEXITCODE -ne 0) { throw "Customer frontend build failed." }
        & npm.cmd run build:admin
        if ($LASTEXITCODE -ne 0) { throw "Administrator frontend build failed." }
    }

    $customerDist = Join-Path $repositoryRoot "apps/task-entry-web/dist"
    $adminDist = Join-Path $repositoryRoot "apps/admin-web/dist"
    if (-not (Test-Path -LiteralPath (Join-Path $customerDist "index.html"))) { throw "Customer frontend output is missing." }
    if (-not (Test-Path -LiteralPath (Join-Path $adminDist "index.html"))) { throw "Administrator frontend output is missing." }
    Assert-NoReparsePoints $customerDist
    Assert-NoReparsePoints $adminDist
    Copy-Item -LiteralPath $customerDist -Destination (Join-Path $stagingRoot "customer") -Recurse
    Copy-Item -LiteralPath $adminDist -Destination (Join-Path $stagingRoot "admin") -Recurse

    $apiTarget = Join-Path $stagingRoot "api"
    if ([string]::IsNullOrWhiteSpace($ApiPublishDirectory)) {
        & dotnet publish (Join-Path $repositoryRoot "services/platform-api/Lifewood.PlatformApi.csproj") -c Release -r $Runtime --self-contained true -p:PublishAot=true -o $apiTarget
        if ($LASTEXITCODE -ne 0) { throw "Native AOT API publish failed." }
    }
    else {
        $apiSource = (Resolve-Path -LiteralPath $ApiPublishDirectory).Path
        Assert-NoReparsePoints $apiSource
        Copy-Item -LiteralPath $apiSource -Destination $apiTarget -Recurse
    }

    if (-not (Test-Path -LiteralPath (Join-Path $apiTarget "Lifewood.PlatformApi.exe"))) { throw "Release package does not contain the Native AOT API executable." }

    $opsTarget = Join-Path $stagingRoot "ops"
    New-Item -ItemType Directory -Path $opsTarget | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\backup-platform.ps1") -Destination $opsTarget
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Destination $opsTarget
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "backup-platform.bat") -Destination $opsTarget
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "restore-platform.bat") -Destination $opsTarget
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "docs\deployment-and-backup.md") -Destination (Join-Path $opsTarget "README.md")

    Assert-NoReparsePoints $stagingRoot
    Get-ChildItem -LiteralPath $stagingRoot -Recurse -File | Where-Object { $_.Extension -in @(".pdb", ".map") } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

    $allowedRoots = @("admin", "api", "customer", "ops")
    $unexpectedRoots = Get-ChildItem -LiteralPath $stagingRoot -Directory | Where-Object { $_.Name -notin $allowedRoots }
    if ($unexpectedRoots) { throw "Release contains an unexpected top-level directory: $($unexpectedRoots.FullName -join ', ')" }

    Assert-NoReparsePoints $stagingRoot
    $forbidden = Get-ChildItem -LiteralPath $stagingRoot -Recurse -Force | Where-Object {
        $_.Name -in @("test-console", "dev-logs", "platform.db", "local-services.json") -or
        $_.Name -like ".env*" -or $_.Name -like "*.secret" -or $_.Name -like "*.bak" -or $_.Name -like "*.tmp" -or
        $_.Name -like "*.Tests.dll" -or $_.Extension -in @(".pdb", ".map", ".cs", ".ts", ".tsx") -or
        (($_.Extension -in @(".ps1", ".bat")) -and -not $_.FullName.StartsWith($opsTarget + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase))
    }
    if ($forbidden) { throw "Release contains forbidden development content: $($forbidden.FullName -join ', ')" }

    $payloadLines = foreach ($relativePath in Get-StableRelativeFiles $stagingRoot) {
        $payloadPath = Join-Path $stagingRoot $relativePath.Replace('/', [IO.Path]::DirectorySeparatorChar)
        "$relativePath`t$(Get-Sha256 $payloadPath)"
    }
    $contentHasher = [Security.Cryptography.SHA256]::Create()
    try {
        $contentBytes = [Text.Encoding]::UTF8.GetBytes(($payloadLines -join "`n"))
        $contentId = ([BitConverter]::ToString($contentHasher.ComputeHash($contentBytes))).Replace("-", "").ToLowerInvariant()
    }
    finally { $contentHasher.Dispose() }

    $manifest = [ordered]@{
        product = "Lifewood Book Creative Portal"
        revision = $revision
        sourceState = $sourceState
        contentId = $contentId
        runtime = $Runtime
        createdAtUtc = $releaseTimestamp.ToString("O")
        paths = [ordered]@{ customer = "/"; admin = "/admin/"; api = "/api/" }
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stagingRoot "release-manifest.json") -Encoding utf8

    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    $shortRevision = $revision.Substring(0, [Math]::Min(12, $revision.Length))
    $identity = if ($sourceState -eq "clean") { $shortRevision } else { "$shortRevision-dirty-$($contentId.Substring(0, 12))" }
    $archive = Join-Path $releaseRoot "lifewood-book-creative-portal-$Runtime-$identity.zip"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }

    Add-Type -AssemblyName System.IO.Compression
    $archiveStream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $zip = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            Assert-NoReparsePoints $stagingRoot
            foreach ($entryName in Get-StableRelativeFiles $stagingRoot) {
                $filePath = Join-Path $stagingRoot $entryName.Replace('/', [IO.Path]::DirectorySeparatorChar)
                $entry = $zip.CreateEntry($entryName, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = $releaseTimestamp
                $input = [IO.File]::OpenRead($filePath)
                $output = $entry.Open()
                try { $input.CopyTo($output) }
                finally { $output.Dispose(); $input.Dispose() }
            }
        }
        finally { $zip.Dispose() }
    }
    finally { $archiveStream.Dispose() }

    $hash = Get-Sha256 $archive
    Set-Content -LiteralPath ($archive + ".sha256") -Value "$hash  $([IO.Path]::GetFileName($archive))" -Encoding ascii
}
finally {
    Remove-StagingDirectory
}

Write-Output "Release package created: $archive"
Write-Output "SHA256: $hash"
