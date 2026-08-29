[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-backup-special-names-" + [Guid]::NewGuid().ToString('N'))
$dataRoot = Join-Path $testRoot "data"
$backupRoot = Join-Path $testRoot "backups"
$restoreRoot = Join-Path $testRoot "restored"

try {
    New-Item -ItemType Directory -Path (Join-Path $dataRoot "uploads\owner\project") -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $dataRoot "platform.db"), [byte[]](1, 2, 3, 4))
    $expected = @{
        "uploads\owner\project\chapter[1].pdf" = [byte[]](10, 20, 30)
        "uploads\owner\project\outline[draft].txt" = [byte[]](40, 50, 60)
        "root[1].bin" = [byte[]](70, 80, 90)
    }
    foreach ($entry in $expected.GetEnumerator()) {
        [IO.File]::WriteAllBytes((Join-Path $dataRoot $entry.Key), $entry.Value)
    }

    & (Join-Path $repositoryRoot "scripts\backup-platform.ps1") -DataDirectory $dataRoot -Destination $backupRoot
    $archive = Get-ChildItem -LiteralPath $backupRoot -Filter "*.zip" -File | Select-Object -First 1
    if ($null -eq $archive) { throw "Backup archive was not created." }

    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $restoreRoot
    foreach ($entry in $expected.GetEnumerator()) {
        $restoredPath = Join-Path $restoreRoot $entry.Key
        if (-not (Test-Path -LiteralPath $restoredPath -PathType Leaf)) {
            throw "Backup omitted a literal filename: $($entry.Key)"
        }
        $actual = [IO.File]::ReadAllBytes($restoredPath)
        if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$entry.Value, [byte[]]$actual)) {
            throw "Backup changed file contents: $($entry.Key)"
        }
    }
    Write-Output "Backup special-filename test passed."
}
finally {
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
