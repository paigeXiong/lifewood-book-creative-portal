[CmdletBinding()]
param(
    [int]$ApiPort = 5077,
    [int]$WebPort = 5173,
    [int]$AdminPort = 5174,
    [switch]$SkipBuild,
    [switch]$Stop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$webUrl = "http://127.0.0.1:$WebPort"
$apiUrl = "http://127.0.0.1:$ApiPort"
$adminUrl = "http://127.0.0.1:$AdminPort"
$apiProject = Join-Path $repositoryRoot "services\platform-api\Lifewood.PlatformApi.csproj"
$apiExecutable = Join-Path $repositoryRoot "services\platform-api\bin\Debug\net10.0\Lifewood.PlatformApi.exe"
$nodeModules = Join-Path $repositoryRoot "node_modules"
$viteEntry = Join-Path $repositoryRoot "node_modules\vite\bin\vite.js"
$logDirectory = Join-Path $repositoryRoot "artifacts\dev-logs"
$stateFile = Join-Path $logDirectory "local-services.json"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$apiLog = Join-Path $logDirectory "api-$runStamp.log"
$apiErrorLog = Join-Path $logDirectory "api-$runStamp.error.log"
$webLog = Join-Path $logDirectory "web-$runStamp.log"
$webErrorLog = Join-Path $logDirectory "web-$runStamp.error.log"
$adminLog = Join-Path $logDirectory "admin-$runStamp.log"
$adminErrorLog = Join-Path $logDirectory "admin-$runStamp.error.log"
$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT

function Assert-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $InstallHint"
    }
}

function Wait-ForHttp([string]$Url, [string]$ServiceName, [System.Diagnostics.Process]$Process, [string]$ErrorLog) {
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $details = if (Test-Path -LiteralPath $ErrorLog) { Get-Content -LiteralPath $ErrorLog -Raw } else { "No error log was produced." }
            throw "$ServiceName failed with exit code $($Process.ExitCode).`n$details"
        }
        try {
            $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }
    throw "$ServiceName did not become ready within 30 seconds. See: $ErrorLog"
}

function Test-HttpEndpoint([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Test-RecordedProcess($Entry) {
    try {
        $process = Get-Process -Id $Entry.id -ErrorAction Stop
        return $process.Path -eq $Entry.path
    }
    catch {
        return $false
    }
}

function Stop-LocalServices {
    if (-not (Test-Path -LiteralPath $stateFile)) {
        Write-Host "No recorded local services are running."
        return
    }
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    foreach ($entry in $state.processes) {
        $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
        if ($null -ne $process -and $process.Path -eq $entry.path) {
            Stop-Process -Id $process.Id -Force
            Write-Host "Stopped $($entry.name) (PID $($process.Id))."
        }
    }
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
}

try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    if ($Stop) {
        Stop-LocalServices
        return
    }

    Assert-Command "dotnet" "Install the .NET 10 SDK."
    Assert-Command "node.exe" "Install Node.js 22 or newer."
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        throw "Frontend dependencies are missing. Run npm install in $repositoryRoot first."
    }

    if (-not (Test-Path -LiteralPath $viteEntry)) {
        throw "Vite is missing. Run npm install in $repositoryRoot first."
    }
    if (Test-Path -LiteralPath $stateFile) {
        $existing = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $recordedProcesses = @($existing.processes)
        $runningProcesses = @($recordedProcesses | Where-Object { Test-RecordedProcess $_ })
        $allProcessesRunning = $recordedProcesses.Count -gt 0 -and $runningProcesses.Count -eq $recordedProcesses.Count
        $recordedApi = $recordedProcesses | Where-Object { $_.name -eq "API" } | Select-Object -First 1
        $apiMatchesCurrentLauncher = $null -ne $recordedApi -and $recordedApi.path -eq $apiExecutable
        $allProcessesRunning = $allProcessesRunning -and $apiMatchesCurrentLauncher
        $allEndpointsHealthy = (Test-HttpEndpoint "$apiUrl/api/health") -and
            (Test-HttpEndpoint $webUrl) -and
            (Test-HttpEndpoint $adminUrl)

        if ($allProcessesRunning -and $allEndpointsHealthy) {
            Write-Host "Local development environment is already running." -ForegroundColor Green
            Write-Host "Web:  $webUrl/zh-CN/tasks"
            Write-Host "Admin center: $adminUrl/zh-CN/projects"
            Write-Host "API:  $apiUrl/api/health"
            return
        }

        Write-Host "A stale or incomplete service record was found. Restarting local services..." -ForegroundColor DarkYellow
        Stop-LocalServices
    }
    Set-Location -LiteralPath $repositoryRoot

    if (-not $SkipBuild) {
        Write-Host "Checking the platform API..." -ForegroundColor DarkGreen
        & dotnet build $apiProject --no-restore
        if ($LASTEXITCODE -ne 0) { throw "The platform API build failed." }
    }
    if (-not (Test-Path -LiteralPath $apiExecutable)) {
        throw "The platform API executable was not found. Retry without -SkipBuild."
    }

    $env:ASPNETCORE_ENVIRONMENT = "Development"
    $apiProcess = Start-Process -FilePath $apiExecutable `
        -ArgumentList "--urls", $apiUrl `
        -WorkingDirectory (Split-Path -Parent $apiProject) `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog
    $startedProcesses.Add($apiProcess)

    $webProcess = Start-Process -FilePath (Get-Command node.exe).Source `
        -ArgumentList $viteEntry, "--host", "127.0.0.1", "--port", $WebPort, "--strictPort" `
        -WorkingDirectory (Join-Path $repositoryRoot "apps\task-entry-web") `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $webLog -RedirectStandardError $webErrorLog
    $startedProcesses.Add($webProcess)

    $adminProcess = Start-Process -FilePath (Get-Command node.exe).Source `
        -ArgumentList $viteEntry, "--host", "127.0.0.1", "--port", $AdminPort, "--strictPort" `
        -WorkingDirectory (Join-Path $repositoryRoot "apps\admin-web") `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $adminLog -RedirectStandardError $adminErrorLog
    $startedProcesses.Add($adminProcess)

    Wait-ForHttp "$apiUrl/api/health" "Platform API" $apiProcess $apiErrorLog
    Wait-ForHttp $webUrl "Web application" $webProcess $webErrorLog
    Wait-ForHttp $adminUrl "Admin center" $adminProcess $adminErrorLog

    @{
        startedAt = (Get-Date).ToString("O")
        webUrl = "$webUrl/zh-CN/tasks"
        adminUrl = "$adminUrl/zh-CN/projects"
        apiUrl = "$apiUrl/api/health"
        processes = @(
            @{ name = "API"; id = $apiProcess.Id; path = $apiProcess.Path },
            @{ name = "Web"; id = $webProcess.Id; path = $webProcess.Path }
            @{ name = "Admin center"; id = $adminProcess.Id; path = $adminProcess.Path }
        )
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

    Write-Host ""
    Write-Host "Local development environment is ready." -ForegroundColor Green
    Write-Host "Web:  $webUrl/zh-CN/tasks"
    Write-Host "Admin center: $adminUrl/zh-CN/projects"
    Write-Host "API:  $apiUrl/api/health"
    Write-Host "Logs: $logDirectory"
    Write-Host "Stop: powershell -File scripts/start-local.ps1 -Stop" -ForegroundColor DarkGray
}
catch {
    foreach ($process in $startedProcesses) {
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    }
    throw
}
finally {
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
}
