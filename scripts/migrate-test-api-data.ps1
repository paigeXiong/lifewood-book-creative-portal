[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$oldData = Join-Path $repositoryRoot "services\test-api\data"
$newData = Join-Path $repositoryRoot "services\platform-api\data"
$oldDatabase = Join-Path $oldData "test-tasks.db"
$newDatabase = Join-Path $newData "platform.db"
$stateFile = Join-Path $repositoryRoot "artifacts\dev-logs\local-services.json"
$migrationRoot = Join-Path $repositoryRoot "artifacts\data-migration"

if (Test-Path -LiteralPath $newDatabase) {
    Write-Host "Platform data is already present; no migration is needed." -ForegroundColor DarkGray
    return
}

if (-not (Test-Path -LiteralPath $oldDatabase)) {
    Write-Host "No legacy test API data was found." -ForegroundColor DarkGray
    return
}

if (Test-Path -LiteralPath $stateFile) {
    throw "Stop the local services before migrating data. Run stop-local.bat first."
}

$legacyProcesses = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
    $_.ProcessId -ne $PID -and (
        $_.Name -ieq "Lifewood.TestApi.exe" -or
        ($_.CommandLine -and (
            $_.CommandLine -match 'Lifewood[.]TestApi' -or
            $_.CommandLine -match 'services[\\/]test-api'
        ))
    )
})
if ($legacyProcesses.Count -gt 0) {
    throw "A legacy API process is still running. Stop Lifewood.TestApi before migrating data."
}

if (Test-Path -LiteralPath $newData) {
    throw "The platform data directory already exists without platform.db. Move it aside and retry to avoid mixing data sets."
}

$rootPath = (Resolve-Path -LiteralPath $repositoryRoot).Path
$oldPath = (Resolve-Path -LiteralPath $oldData).Path
if (-not $oldPath.StartsWith($rootPath + "\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Legacy data path escapes the repository."
}

New-Item -ItemType Directory -Path $migrationRoot -Force | Out-Null
$temporaryData = Join-Path $migrationRoot ("data-" + [Guid]::NewGuid().ToString("N"))
try {
    Copy-Item -LiteralPath $oldData -Destination $temporaryData -Recurse
    foreach ($suffix in @("", "-wal", "-shm")) {
        $sourceName = Join-Path $temporaryData ("test-tasks.db" + $suffix)
        if (Test-Path -LiteralPath $sourceName) {
            Rename-Item -LiteralPath $sourceName -NewName ("platform.db" + $suffix)
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $temporaryData "platform.db"))) {
        throw "The copied database could not be verified."
    }
    Move-Item -LiteralPath $temporaryData -Destination $newData
    Write-Host "Legacy registration data was copied to the platform API." -ForegroundColor Green
    Write-Host "The first real owner account will claim the copied projects and upload files during account creation." -ForegroundColor DarkGray
    Write-Host "The original data remains unchanged at: $oldData" -ForegroundColor DarkGray
}
catch {
    if (Test-Path -LiteralPath $temporaryData) {
        Remove-Item -LiteralPath $temporaryData -Recurse -Force
    }
    throw
}
