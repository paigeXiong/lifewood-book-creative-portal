[CmdletBinding()]
param(
    [string]$Version,
    [string]$OutputDirectory,
    [switch]$SkipFrontendBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = Join-Path $repositoryRoot "artifacts"
$payloadRoot = Join-Path $artifactsRoot "msi-payload"
$installerActionsRoot = Join-Path $artifactsRoot "msi-installer-actions"
$outputRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { Join-Path $artifactsRoot "installer" } else { [IO.Path]::GetFullPath($OutputDirectory) }
$projectPath = Join-Path $repositoryRoot "installer\Lifewood.Installer.wixproj"

function Assert-ArtifactPath([string]$Path) {
    $root = [IO.Path]::GetFullPath($artifactsRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidate = [IO.Path]::GetFullPath($Path)
    if (-not $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "MSI working paths must stay inside $root"
    }
}

function Remove-ArtifactDirectory([string]$Path) {
    Assert-ArtifactPath $Path
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to remove reparse point: $Path" }
    Remove-Item -LiteralPath $Path -Recurse -Force
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
        finally { $sha256.Dispose() }
    }
    finally { $stream.Dispose() }
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $package = Get-Content -LiteralPath (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
    $Version = [string]$package.version
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "MSI version must use major.minor.patch, for example 0.2.0." }
$versionParts = @($Version.Split('.') | ForEach-Object { [int]$_ })
if ($versionParts[0] -gt 255 -or $versionParts[1] -gt 255 -or $versionParts[2] -gt 65535) {
    throw "MSI version limits are major <= 255, minor <= 255, and patch <= 65535."
}

Assert-ArtifactPath $payloadRoot
Assert-ArtifactPath $installerActionsRoot
Assert-ArtifactPath $outputRoot
Remove-ArtifactDirectory $payloadRoot
Remove-ArtifactDirectory $installerActionsRoot
Remove-ArtifactDirectory $outputRoot
New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

if (-not $SkipFrontendBuild) {
    & npm.cmd run build:web
    if ($LASTEXITCODE -ne 0) { throw "Customer frontend build failed." }
    & npm.cmd run build:admin
    if ($LASTEXITCODE -ne 0) { throw "Administrator frontend build failed." }
}

$customerDist = Join-Path $repositoryRoot "apps\task-entry-web\dist"
$adminDist = Join-Path $repositoryRoot "apps\admin-web\dist"
if (-not (Test-Path -LiteralPath (Join-Path $customerDist "index.html"))) { throw "Customer frontend output is missing." }
if (-not (Test-Path -LiteralPath (Join-Path $adminDist "index.html"))) { throw "Administrator frontend output is missing." }
$serverTarget = Join-Path $payloadRoot "server"
& dotnet publish (Join-Path $repositoryRoot "services\platform-api\Lifewood.PlatformApi.csproj") -c Release -r win-x64 --self-contained true -p:PublishAot=true -o $serverTarget
if ($LASTEXITCODE -ne 0) { throw "Native AOT server publish failed." }
if (-not (Test-Path -LiteralPath (Join-Path $serverTarget "Lifewood.BookPortal.Server.exe"))) { throw "Native AOT server executable is missing." }
Get-ChildItem -LiteralPath $serverTarget -Recurse -File | Where-Object { $_.Extension -in @(".pdb", ".map") } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
$serverWebTarget = Join-Path $serverTarget "web"
New-Item -ItemType Directory -Path $serverWebTarget | Out-Null
Copy-Item -LiteralPath $customerDist -Destination (Join-Path $serverWebTarget "customer") -Recurse
Copy-Item -LiteralPath $adminDist -Destination (Join-Path $serverWebTarget "admin") -Recurse

$forbiddenPayload = @(Get-ChildItem -LiteralPath $payloadRoot -Recurse -Force | Where-Object {
    $_.FullName -match '[\\/](data|uploads|deliveries|keys)([\\/]|$)' -or
    $_.Name -in @('platform.db', 'audit-pending.jsonl', 'platform.lock') -or
    $_.Extension -in @('.pdb', '.map')
})
if ($forbiddenPayload.Count -gt 0) {
    throw "Production data must not be included in MSI payload: $($forbiddenPayload[0].FullName)"
}

$opsTarget = Join-Path $payloadRoot "ops"
New-Item -ItemType Directory -Path $opsTarget | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\backup-platform.ps1") -Destination $opsTarget
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Destination $opsTarget
Copy-Item -LiteralPath (Join-Path $repositoryRoot "scripts\open-portal.ps1") -Destination $opsTarget
Copy-Item -LiteralPath (Join-Path $repositoryRoot "backup-platform.bat") -Destination $opsTarget
Copy-Item -LiteralPath (Join-Path $repositoryRoot "restore-platform.bat") -Destination $opsTarget
Copy-Item -LiteralPath (Join-Path $repositoryRoot "docs\deployment-and-backup.md") -Destination (Join-Path $opsTarget "README.md")

& dotnet publish (Join-Path $repositoryRoot "installer\Lifewood.InstallerActions\Lifewood.InstallerActions.csproj") -c Release -r win-x64 --self-contained true -p:PublishAot=true -o $installerActionsRoot
if ($LASTEXITCODE -ne 0) { throw "Native installer action publish failed." }
if (-not (Test-Path -LiteralPath (Join-Path $installerActionsRoot "Lifewood.InstallerActions.dll"))) { throw "Native installer action library is missing." }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-installer-data-path.ps1") -LibraryPath (Join-Path $installerActionsRoot "Lifewood.InstallerActions.dll")
if ($LASTEXITCODE -ne 0) { throw "Installer data-path validation test failed." }

& dotnet build $projectPath -c Release -p:PayloadDir=$payloadRoot -p:InstallerActionsDir=$installerActionsRoot -p:ProductVersion=$Version -p:OutputPath=$outputRoot
if ($LASTEXITCODE -ne 0) { throw "MSI build failed." }

$packages = @(Get-ChildItem -LiteralPath $outputRoot -Filter "*.msi" -Recurse -File)
if ($packages.Count -lt 2) { throw "Expected localized en-US and zh-CN MSI packages." }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-installer-msi-session.ps1") -LibraryPath (Join-Path $installerActionsRoot "Lifewood.InstallerActions.dll") -PackagePath $packages[0].FullName
if ($LASTEXITCODE -ne 0) { throw "Installer MSI session-property test failed." }
& (Join-Path $PSScriptRoot "test-msi-data-preservation.ps1") -PackagePath @($packages.FullName)
if ($LASTEXITCODE -ne 0) { throw "MSI data-preservation verification failed." }
foreach ($packagePath in $packages) {
    $hash = Get-Sha256 $packagePath.FullName
    Set-Content -LiteralPath ($packagePath.FullName + ".sha256") -Value "$hash  $($packagePath.Name)" -Encoding ascii
    Write-Output "MSI package created: $($packagePath.FullName)"
    Write-Output "SHA256: $hash"
}

Remove-ArtifactDirectory $payloadRoot
Remove-ArtifactDirectory $installerActionsRoot
