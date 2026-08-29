[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$LibraryPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$library = (Resolve-Path -LiteralPath $LibraryPath -ErrorAction Stop).Path.Replace('"', '""')
$interop = @"
using System.Runtime.InteropServices;
public static class InstallerActionsInterop
{
    [DllImport(@"$library", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Winapi)]
    public static extern int ValidateDataDirectoryPath(
        string dataDirectory,
        string installDirectory,
        string windowsDirectory,
        string programFiles64,
        string programFiles32,
        string userProfile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateSymbolicLinkW")]
    [return: MarshalAs(UnmanagedType.I1)]
    public static extern bool CreateSymbolicLink(string symlink, string target, int flags);
}
"@
Add-Type -TypeDefinition $interop

$windowsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
$programFiles64 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$programFiles32 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
$userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
$installDirectory = Join-Path $programFiles64 "Lifewood Book Creative Portal"
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-installer-path-test-" + [Guid]::NewGuid().ToString('N'))
$substDrive = $null

function Assert-Validation([string]$Path, [bool]$Expected, [string]$Case) {
    $actual = [InstallerActionsInterop]::ValidateDataDirectoryPath(
        $Path, $installDirectory, $windowsDirectory, $programFiles64, $programFiles32, $userProfile) -eq 1
    if ($actual -ne $Expected) { throw "Installer path validation failed for ${Case}: $Path" }
}

try {
    $empty = Join-Path $testRoot "empty-data"
    $unrelated = Join-Path $testRoot "unrelated-data"
    $existingPlatform = Join-Path $testRoot "existing-platform"
    $linkedPlatform = Join-Path $testRoot "linked-platform"
    $outsideDatabase = Join-Path $testRoot "outside-platform.db"
    $junction = Join-Path $testRoot "junction-data"
    New-Item -ItemType Directory -Path $empty,$unrelated,$existingPlatform,$linkedPlatform -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $unrelated "unrelated.txt") -Value "not platform data"
    [IO.File]::WriteAllBytes((Join-Path $existingPlatform "platform.db"), [Text.Encoding]::ASCII.GetBytes("SQLite format 3`0"))
    [IO.File]::WriteAllBytes($outsideDatabase, [Text.Encoding]::ASCII.GetBytes("SQLite format 3`0"))
    $databaseLink = Join-Path $linkedPlatform "platform.db"
    $linkCreated = [InstallerActionsInterop]::CreateSymbolicLink($databaseLink, $outsideDatabase, 2)
    if (-not $linkCreated) { $linkCreated = [InstallerActionsInterop]::CreateSymbolicLink($databaseLink, $outsideDatabase, 0) }
    if (-not $linkCreated) { throw "Could not create the platform.db symbolic-link test fixture. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    New-Item -ItemType Junction -Path $junction -Target $empty | Out-Null

    Assert-Validation $empty $true "empty dedicated directory"
    Assert-Validation (Join-Path $testRoot "new-data") $true "new dedicated directory"
    Assert-Validation "data" $false "relative path"
    Assert-Validation "C:data" $false "drive-relative path"
    Assert-Validation "C:\unsafe?\data" $false "Win32 wildcard segment"
    Assert-Validation "C:\CON\data" $false "Win32 reserved device segment"
    Assert-Validation $existingPlatform $true "existing platform directory"
    Assert-Validation $linkedPlatform $false "platform database symbolic link"
    Assert-Validation $unrelated $false "unrelated non-empty directory"
    Assert-Validation ([IO.Path]::GetPathRoot($testRoot)) $false "drive root"
    Assert-Validation $windowsDirectory $false "Windows directory"
    Assert-Validation (Join-Path $programFiles64 "UnsafeData") $false "Program Files descendant"
    $shortProgramFiles = (& cmd.exe /d /c "for %I in (`"$programFiles64`") do @echo %~sI").Trim()
    if ($shortProgramFiles -and -not $shortProgramFiles.Equals($programFiles64, [StringComparison]::OrdinalIgnoreCase)) {
        Assert-Validation (Join-Path $shortProgramFiles "UnsafeData") $false "Program Files 8.3 alias"
    }
    Assert-Validation $installDirectory $false "application install directory"
    Assert-Validation $userProfile $false "user-profile root"
    Assert-Validation (Split-Path -Parent $userProfile) $false "user-profiles root"
    Assert-Validation "\\server\share\lifewood" $false "UNC share"
    Assert-Validation $junction $false "junction"
    Assert-Validation (Join-Path $testRoot "trailing.\data") $false "Win32-normalized segment"

    foreach ($letter in @('Z','Y','X','W','V','U','T')) {
        if (-not (Test-Path -LiteralPath "${letter}:\")) { $substDrive = $letter; break }
    }
    if ($null -eq $substDrive) { throw "No free drive letter is available for the SUBST validation test." }
    & subst.exe "${substDrive}:" $programFiles64
    if ($LASTEXITCODE -ne 0) { throw "Could not create the SUBST validation drive." }
    Assert-Validation "${substDrive}:\UnsafeData" $false "SUBST alias into Program Files"
    & subst.exe "${substDrive}:" /D
    if ($LASTEXITCODE -ne 0) { throw "Could not remove the protected SUBST validation drive." }
    & subst.exe "${substDrive}:" $testRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not create the ordinary SUBST validation drive." }
    Assert-Validation "${substDrive}:\new-data" $false "session-scoped SUBST alias"

    Write-Output "Installer data-path validation test passed."
}
finally {
    if ($null -ne $substDrive) { & subst.exe "${substDrive}:" /D 2>$null }
    if (Test-Path -LiteralPath $junction) { Remove-Item -LiteralPath $junction -Force }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
