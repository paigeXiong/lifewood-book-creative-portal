[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-operation-tests-" + [Guid]::NewGuid().ToString("N"))

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "$Message Expected '$Expected', received '$Actual'." }
}

function New-TestSqliteDatabase([string]$Path) {
    $database = [byte[]]::new(512)
    $signature = [Text.Encoding]::ASCII.GetBytes("SQLite format 3")
    [Array]::Copy($signature, 0, $database, 0, $signature.Length)
    $database[15] = 0
    $database[16] = 2
    $database[17] = 0
    $database[18] = 1
    $database[19] = 1
    $database[21] = 64
    $database[22] = 32
    $database[23] = 32
    $database[31] = 1
    $database[47] = 4
    $database[59] = 1
    $database[100] = 13
    $database[105] = 2
    [IO.File]::WriteAllBytes($Path, $database)
}

try {
    New-Item -ItemType Directory -Path $testRoot | Out-Null

    foreach ($relativePath in @(
        "scripts\backup-platform.ps1",
        "scripts\restore-platform.ps1",
        "scripts\start-local.ps1",
        "scripts\start-portable.ps1",
        "scripts\open-portal.ps1"
    )) {
        $tokens = $null
        $errors = $null
        [void][Management.Automation.Language.Parser]::ParseFile(
            (Join-Path $repositoryRoot $relativePath),
            [ref]$tokens,
            [ref]$errors)
        if ($errors.Count -gt 0) {
            throw "$relativePath has a PowerShell syntax error at $($errors[0].Extent.StartLineNumber):$($errors[0].Extent.StartColumnNumber): $($errors[0].Message)"
        }
    }

    $launcherData = Join-Path $testRoot "launcher-data"
    New-Item -ItemType Directory -Path $launcherData | Out-Null
    Set-Content -LiteralPath (Join-Path $launcherData "runtime-settings.json") -Encoding UTF8 -Value '{"listenAddress":"0.0.0.0","port":6443,"scheme":"https"}'
    $launcher = Join-Path $repositoryRoot "scripts\open-portal.ps1"
    $adminUrl = & $launcher -DataDirectory $launcherData -Port 5077 -Locale en-US -Area admin -PrintOnly
    Assert-Equal $adminUrl "https://127.0.0.1:6443/admin/en-US/overview" "The MSI portal launcher ignored the saved runtime endpoint."

    $source = Join-Path $testRoot "restore-source"
    $archive = Join-Path $testRoot "restore.zip"
    $target = Join-Path $testRoot "restored-data"
    $safetyBackups = Join-Path $testRoot "safety-backups"
    New-Item -ItemType Directory -Path $source | Out-Null
    New-TestSqliteDatabase (Join-Path $source "platform.db")
    Set-Content -LiteralPath (Join-Path $source "restored.txt") -Value "complete" -Encoding UTF8
    Compress-Archive -Path (Join-Path $source "*") -DestinationPath $archive
    New-Item -ItemType Directory -Path $target | Out-Null
    New-TestSqliteDatabase (Join-Path $target "platform.db")
    Set-Content -LiteralPath (Join-Path $target "previous.txt") -Value "previous" -Encoding UTF8
    $originalAccessRules = [IO.Directory]::GetAccessControl($target).GetSecurityDescriptorSddlForm(
        [Security.AccessControl.AccessControlSections]::Access)
    & (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Archive $archive -DataDirectory $target -SafetyBackupDestination $safetyBackups -Replace
    Assert-Equal (Get-Content -LiteralPath (Join-Path $target "restored.txt") -Raw).Trim() "complete" "The staged restore did not commit all files."
    if (Test-Path -LiteralPath (Join-Path $target "previous.txt")) {
        throw "The restore mixed previous data into the restored directory."
    }
    if (@(Get-ChildItem -LiteralPath $safetyBackups -Filter "*.zip" -File).Count -ne 1) {
        throw "The replacement restore did not create exactly one safety backup."
    }
    if (Get-ChildItem -LiteralPath $testRoot -Directory -Filter ".restored-data.restore-*" -Force) {
        throw "The restore left a staging directory behind."
    }
    $restoredAccessRules = [IO.Directory]::GetAccessControl($target).GetSecurityDescriptorSddlForm(
        [Security.AccessControl.AccessControlSections]::Access)
    Assert-Equal $restoredAccessRules $originalAccessRules "The restore did not preserve the target directory ACL."

    $corruptSource = Join-Path $testRoot "corrupt-source"
    $corruptArchive = Join-Path $testRoot "corrupt.zip"
    New-Item -ItemType Directory -Path $corruptSource | Out-Null
    New-TestSqliteDatabase (Join-Path $corruptSource "platform.db")
    $corruptBytes = [IO.File]::ReadAllBytes((Join-Path $corruptSource "platform.db"))
    $corruptBytes[100] = 0
    [IO.File]::WriteAllBytes((Join-Path $corruptSource "platform.db"), $corruptBytes)
    Compress-Archive -Path (Join-Path $corruptSource "*") -DestinationPath $corruptArchive

    $recoveryTarget = Join-Path $testRoot "recovery-data"
    $recoveryRollback = Join-Path $testRoot ".recovery-data.rollback"
    $recoveryState = Join-Path $testRoot ".recovery-data.restore.state"
    New-Item -ItemType Directory -Path $recoveryRollback | Out-Null
    New-TestSqliteDatabase (Join-Path $recoveryRollback "platform.db")
    Set-Content -LiteralPath (Join-Path $recoveryRollback "previous.txt") -Value "recovered" -Encoding UTF8
    New-Item -ItemType Directory -Path $recoveryTarget | Out-Null
    New-TestSqliteDatabase (Join-Path $recoveryTarget "platform.db")
    Set-Content -LiteralPath (Join-Path $recoveryTarget "new.txt") -Value "ambiguous" -Encoding UTF8
    [IO.File]::WriteAllText($recoveryState, "switching")
    $corruptRejected = $false
    try {
        & (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Archive $corruptArchive -DataDirectory $recoveryTarget -Replace
    }
    catch { $corruptRejected = $true }
    if (-not $corruptRejected) { throw "The restore accepted a database rejected by SQLite quick_check." }
    Assert-Equal (Get-Content -LiteralPath (Join-Path $recoveryTarget "previous.txt") -Raw).Trim() "recovered" "Interrupted restore recovery did not restore the previous directory."
    if (Test-Path -LiteralPath $recoveryRollback) { throw "Interrupted restore recovery left the rollback directory behind." }
    if (-not (Get-ChildItem -LiteralPath $testRoot -Directory -Filter ".recovery-data.interrupted-*" -Force)) {
        throw "Interrupted restore recovery discarded the ambiguous post-crash directory."
    }

    $lockedTarget = Join-Path $testRoot "locked-data"
    $lockCoordinationDirectory = Join-Path $testRoot ".lifewood-coordination"
    New-Item -ItemType Directory -Path $lockCoordinationDirectory -Force | Out-Null
    $restoreLockPath = Join-Path $lockCoordinationDirectory ".locked-data.restore.lock"
    $restoreLock = [IO.File]::Open($restoreLockPath, "OpenOrCreate", "ReadWrite", "None")
    $lockRejected = $false
    try {
        try { & (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Archive $archive -DataDirectory $lockedTarget }
        catch { $lockRejected = $true }
    }
    finally { $restoreLock.Dispose() }
    if (-not $lockRejected) { throw "Concurrent restores were not rejected by the parent-directory lock." }

    $startLocal = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\start-local.ps1") -Raw
    if (-not $startLocal.Contains('$env:VITE_API_PROXY_TARGET = $apiUrl')) {
        throw "The local launcher does not pass its custom API port to Vite."
    }
    $backupScript = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\backup-platform.ps1") -Raw
    $restoreScript = Get-Content -LiteralPath (Join-Path $repositoryRoot "scripts\restore-platform.ps1") -Raw
    if ($backupScript -notmatch '(?s)elseif \(\$isPortablePackage\).*?elseif \(-not \[string\]::IsNullOrWhiteSpace\(\$installedDataDirectory\)\)' -or
        $restoreScript -notmatch '(?s)elseif \(\$isPortablePackage\).*?elseif \(-not \[string\]::IsNullOrWhiteSpace\(\$installedDataDirectory\)\)') {
        throw "Portable backup or restore does not take precedence over the MSI registry instance."
    }
    if ($restoreScript -notmatch '\$env:Lifewood__CoordinationDirectory') {
        throw "Restore does not honor the configured coordination directory."
    }
    $serverProgram = Get-Content -LiteralPath (Join-Path $repositoryRoot "services\platform-api\Program.cs") -Raw
    if (-not $serverProgram.Contains("RestoreStartupLock.Acquire")) {
        throw "The server does not coordinate every startup path with data restore."
    }

    Write-Output "Operation regression tests passed."
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
