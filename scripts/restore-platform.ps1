[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [string]$DataDirectory,
    [string]$CoordinationDirectory,
    [string]$SafetyBackupDestination,
    [switch]$Replace
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
function Get-InstalledRegistryPath([string]$Name) {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { return $null }
    try {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
            [Microsoft.Win32.RegistryHive]::LocalMachine,
            [Microsoft.Win32.RegistryView]::Registry64)
        try {
            $productKey = $baseKey.OpenSubKey("Software\Lifewood\BookCreativePortal")
            if ($null -eq $productKey) { return $null }
            try {
                $recorded = $productKey.GetValue($Name) -as [string]
                if ([string]::IsNullOrWhiteSpace($recorded)) { return $null }
                return [IO.Path]::GetFullPath($recorded)
            }
            finally { $productKey.Dispose() }
        }
        finally { $baseKey.Dispose() }
    }
    catch { return $null }
}
$installedDataDirectory = Get-InstalledRegistryPath "DataDirectory"
$installedCoordinationDirectory = Get-InstalledRegistryPath "CoordinationDirectory"
$isPortablePackage = (Test-Path -LiteralPath (Join-Path $repositoryRoot "start-server.bat") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $repositoryRoot "server\Lifewood.BookPortal.Server.exe") -PathType Leaf)
$target = if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) { [IO.Path]::GetFullPath($DataDirectory) }
    elseif (-not [string]::IsNullOrWhiteSpace($env:Lifewood__DataDirectory)) { [IO.Path]::GetFullPath($env:Lifewood__DataDirectory) }
    elseif ($isPortablePackage) { Join-Path $repositoryRoot "data" }
    elseif (-not [string]::IsNullOrWhiteSpace($installedDataDirectory)) { $installedDataDirectory }
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

function Assert-SqliteDatabase([string]$Path) {
    $expected = [byte[]](0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00)
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
            $header = [byte[]]::new(100)
            if ($stream.Read($header, 0, $header.Length) -ne $header.Length -or
                -not [Linq.Enumerable]::SequenceEqual([byte[]]$header[0..15], $expected)) {
                throw "invalid"
            }
            $pageSize = ([int]$header[16] -shl 8) -bor [int]$header[17]
            if ($pageSize -eq 1) { $pageSize = 65536 }
            $validPageSize = $pageSize -ge 512 -and $pageSize -le 65536 -and (($pageSize -band ($pageSize - 1)) -eq 0)
            $pageCountBytes = [byte[]]@($header[31], $header[30], $header[29], $header[28])
            $pageCount = [BitConverter]::ToUInt32($pageCountBytes, 0)
            if (-not $validPageSize -or $pageCount -lt 1 -or
                $stream.Length -lt ([int64]$pageCount * $pageSize) -or
                ($stream.Length % $pageSize) -ne 0) {
                throw "invalid"
            }
        }
        finally { $stream.Dispose() }
    }
    catch {
        throw "The archive platform.db is not a structurally valid SQLite database. / 备份中的 platform.db 不是结构有效的 SQLite 数据库。"
    }

    $packageRoot = Split-Path -Parent $PSScriptRoot
    $validatorCandidates = @(
        (Join-Path $packageRoot "server\Lifewood.BookPortal.Server.exe"),
        (Join-Path $repositoryRoot "services\platform-api\bin\Release\net10.0\Lifewood.BookPortal.Server.exe"),
        (Join-Path $repositoryRoot "services\platform-api\bin\Debug\net10.0\Lifewood.BookPortal.Server.exe")
    )
    $validator = $validatorCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($validator)) {
        throw "The server database validator is unavailable; restore was cancelled. Build the server first. / 服务端数据库校验器不可用，已取消恢复；请先构建服务端。"
    }

    $validationOutput = & $validator --validate-database $Path 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "SQLite quick_check rejected the restored database / SQLite 完整性检查未通过: $validationOutput"
    }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($source)
try {
    if ($zip.Entries.Count -eq 0) { throw "The backup archive is empty. / 备份压缩包为空。" }
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        if ($name.StartsWith('/') -or $name -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($name)) {
            throw "The backup contains an unsafe path / 备份包含不安全路径: $name"
        }
    }
}
finally { $zip.Dispose() }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-restore-" + [Guid]::NewGuid().ToString('N'))
$targetParent = Split-Path -Parent $target
$targetName = Split-Path -Leaf $target
$stagedTarget = Join-Path $targetParent (".$targetName.restore-" + [Guid]::NewGuid().ToString('N'))
$rollbackTarget = Join-Path $targetParent (".$targetName.rollback")
$restoreStatePath = Join-Path $targetParent (".$targetName.restore.state")
$isInstalledTarget = -not [string]::IsNullOrWhiteSpace($installedDataDirectory) -and
    [IO.Path]::GetFullPath($target).TrimEnd([IO.Path]::DirectorySeparatorChar).Equals(
        [IO.Path]::GetFullPath($installedDataDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar),
        [StringComparison]::OrdinalIgnoreCase)
$resolvedCoordinationDirectory = if (-not [string]::IsNullOrWhiteSpace($CoordinationDirectory)) {
    [IO.Path]::GetFullPath($CoordinationDirectory)
}
elseif (-not [string]::IsNullOrWhiteSpace($env:Lifewood__CoordinationDirectory)) {
    [IO.Path]::GetFullPath($env:Lifewood__CoordinationDirectory)
}
elseif ($isInstalledTarget -and -not [string]::IsNullOrWhiteSpace($installedCoordinationDirectory)) {
    $installedCoordinationDirectory
}
else { Join-Path $targetParent ".lifewood-coordination" }
$restoreLockPath = Join-Path $resolvedCoordinationDirectory (".$targetName.restore.lock")
$restoreCommitted = $false
$restoreLock = $null
$service = $null
$serviceWasRunning = $false
$targetAcl = $null

function Assert-PlatformStopped {
    if (-not (Test-Path -LiteralPath $target)) { return }
    $platformLockPath = Join-Path $target "platform.lock"
    try { $platformLock = [IO.File]::Open($platformLockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw "The platform is running. Stop it before restoring data. / 平台仍在运行，请先停止服务再恢复数据。" }
    $platformLock.Dispose()
}

function Set-RestoreState([string]$Phase) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Phase)
    $stateStream = [IO.File]::Open($restoreStatePath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try {
        $stateStream.Write($bytes, 0, $bytes.Length)
        $stateStream.Flush($true)
    }
    finally { $stateStream.Dispose() }
}

New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
New-Item -ItemType Directory -Path $resolvedCoordinationDirectory -Force | Out-Null
try {
    $restoreLock = [IO.File]::Open($restoreLockPath, 'OpenOrCreate', 'ReadWrite', 'None')
}
catch {
    throw "Another restore is already running for this data directory. / 此数据目录已有另一个恢复任务正在执行。"
}

try {
    if ($isInstalledTarget -and [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        $service = Get-Service -Name "LifewoodBookCreativePortal" -ErrorAction SilentlyContinue
        if ($null -ne $service -and $service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
            $serviceWasRunning = $true
            try {
                Stop-Service -InputObject $service -Force
                $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(30))
            }
            catch {
                throw "The Windows service could not be stopped; restore was cancelled. / 无法停止 Windows 服务，已取消恢复。"
            }
        }
    }

    $restorePhase = if (Test-Path -LiteralPath $restoreStatePath -PathType Leaf) {
        (Get-Content -LiteralPath $restoreStatePath -Raw).Trim()
    }
    else { "" }
    if (Test-Path -LiteralPath $rollbackTarget) {
        if ($restorePhase -eq "committed" -and (Test-Path -LiteralPath $target)) {
            Assert-SqliteDatabase (Join-Path $target "platform.db")
            Remove-Item -LiteralPath $rollbackTarget -Recurse -Force
            Write-Warning "Completed cleanup from a committed restore. / 已完成上次已提交恢复遗留的清理。"
        }
        elseif ($restorePhase -eq "switching") {
            if (Test-Path -LiteralPath $target) {
                $interruptedTarget = Join-Path $targetParent (".$targetName.interrupted-" + [Guid]::NewGuid().ToString('N'))
                Move-Item -LiteralPath $target -Destination $interruptedTarget
                Write-Warning "Preserved an ambiguous post-crash directory at / 已保留崩溃后的待确认目录: $interruptedTarget"
            }
            Move-Item -LiteralPath $rollbackTarget -Destination $target
            Write-Warning "Recovered the previous data directory after an interrupted restore. / 检测到上次恢复被中断，已自动还原原数据目录。"
        }
        elseif (-not (Test-Path -LiteralPath $target)) {
            Move-Item -LiteralPath $rollbackTarget -Destination $target
            Write-Warning "Recovered an unambiguous previous data directory. / 已恢复明确可识别的原数据目录。"
        }
        else {
            throw "Both data and rollback directories exist without a valid restore state; manual recovery is required. / 数据目录与回滚目录同时存在且无有效恢复状态，需要手动恢复。"
        }
        if (Test-Path -LiteralPath $restoreStatePath) { Remove-Item -LiteralPath $restoreStatePath -Force }
    }
    elseif (Test-Path -LiteralPath $restoreStatePath) {
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $restoreStatePath -Force
            Write-Warning "Removed an incomplete restore marker; the data directory was never replaced. / 已清理未完成的恢复标记，数据目录未被替换。"
        }
        else {
            throw "An incomplete restore marker exists without data or rollback directories. / 存在未完成恢复标记，但数据与回滚目录均缺失。"
        }
    }

    Assert-SafeDataTarget $target ($Replace -and (Test-Path -LiteralPath $target))
    Assert-PlatformStopped
    if (Test-Path -LiteralPath $target) {
        if ((Get-ChildItem -LiteralPath $target -Force | Where-Object Name -ne 'platform.lock') -and -not $Replace) {
            throw "The data directory is not empty. Re-run with -Replace to create a safety backup and replace it. / 数据目录非空，请使用 -Replace 创建安全备份后替换。"
        }
        if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
            $targetAcl = [IO.Directory]::GetAccessControl($target)
        }
    }

    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    Expand-Archive -LiteralPath $source -DestinationPath $tempRoot
    $extractedDatabase = Join-Path $tempRoot 'platform.db'
    if (-not (Test-Path -LiteralPath $extractedDatabase -PathType Leaf)) { throw "The archive does not contain platform.db at its root. / 备份根目录中缺少 platform.db。" }
    Assert-SqliteDatabase $extractedDatabase
    if ($Replace -and (Test-Path -LiteralPath $target)) {
        $backupArguments = @{ DataDirectory = $target }
        if (-not [string]::IsNullOrWhiteSpace($SafetyBackupDestination)) {
            $backupArguments.Destination = $SafetyBackupDestination
        }
        & (Join-Path $PSScriptRoot 'backup-platform.ps1') @backupArguments
        if (-not $?) { throw "The safety backup failed; restore was cancelled. / 安全备份失败，已取消恢复。" }
        Assert-SafeDataTarget $target $true
    }

    New-Item -ItemType Directory -Path $stagedTarget | Out-Null
    Get-ChildItem -LiteralPath $tempRoot -Force | Copy-Item -Destination $stagedTarget -Recurse -Force
    Assert-SqliteDatabase (Join-Path $stagedTarget 'platform.db')
    if ($null -ne $targetAcl) { [IO.Directory]::SetAccessControl($stagedTarget, $targetAcl) }

    Assert-PlatformStopped
    if (Test-Path -LiteralPath $target) {
        Set-RestoreState "switching"
        Move-Item -LiteralPath $target -Destination $rollbackTarget
    }
    try {
        Move-Item -LiteralPath $stagedTarget -Destination $target
        if (Test-Path -LiteralPath $rollbackTarget) { Set-RestoreState "committed" }
        $restoreCommitted = $true
    }
    catch {
        $commitError = $_
        if ((Test-Path -LiteralPath $rollbackTarget) -and -not (Test-Path -LiteralPath $target)) {
            try {
                Move-Item -LiteralPath $rollbackTarget -Destination $target
                if (Test-Path -LiteralPath $restoreStatePath) { Remove-Item -LiteralPath $restoreStatePath -Force }
            }
            catch {
                throw "Restore commit and automatic rollback failed; previous data remains at / 恢复提交及自动回滚均失败，原数据位于: $rollbackTarget"
            }
        }
        throw $commitError
    }

    if (Test-Path -LiteralPath $rollbackTarget) {
        try { Remove-Item -LiteralPath $rollbackTarget -Recurse -Force }
        catch { Write-Warning "Restore succeeded, but previous data remains at / 恢复成功，但原数据仍保留于: $rollbackTarget" }
    }
    if (Test-Path -LiteralPath $restoreStatePath) { Remove-Item -LiteralPath $restoreStatePath -Force }
    Write-Host "Restore completed / 恢复完成: $target" -ForegroundColor Green
}
finally {
    if (-not $restoreCommitted -and (Test-Path -LiteralPath $rollbackTarget) -and -not (Test-Path -LiteralPath $target)) {
        try {
            Move-Item -LiteralPath $rollbackTarget -Destination $target
            if (Test-Path -LiteralPath $restoreStatePath) { Remove-Item -LiteralPath $restoreStatePath -Force }
        }
        catch { Write-Warning "Automatic rollback requires manual recovery from / 自动回滚失败，请手动恢复: $rollbackTarget" }
    }
    if (Test-Path -LiteralPath $tempRoot) {
        try { Remove-Item -LiteralPath $tempRoot -Recurse -Force } catch { }
    }
    if (-not $restoreCommitted -and (Test-Path -LiteralPath $stagedTarget)) {
        try { Remove-Item -LiteralPath $stagedTarget -Recurse -Force } catch { }
    }
    if ($null -ne $restoreLock) { $restoreLock.Dispose() }
    if (Test-Path -LiteralPath $restoreLockPath) {
        try { Remove-Item -LiteralPath $restoreLockPath -Force } catch { }
    }
    if ($serviceWasRunning -and $null -ne $service) {
        try { Start-Service -InputObject $service }
        catch { Write-Warning "Data restore finished, but the Windows service could not restart. / 数据恢复已结束，但 Windows 服务无法重新启动。" }
    }
}
