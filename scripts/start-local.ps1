[CmdletBinding()]
param(
    [int]$ApiPort = 5077,
    [int]$WebPort = 5173,
    [int]$AdminPort = 5174,
    [ValidateSet("Debug", "Release")][string]$Configuration = "Debug",
    [string]$StateDirectory,
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
$apiExecutable = Join-Path $repositoryRoot "services\platform-api\bin\$Configuration\net10.0\Lifewood.BookPortal.Server.exe"
$nodeModules = Join-Path $repositoryRoot "node_modules"
$viteEntry = Join-Path $repositoryRoot "node_modules\vite\bin\vite.js"
$logDirectory = if ($StateDirectory) { [IO.Path]::GetFullPath($StateDirectory) } else { Join-Path $repositoryRoot "artifacts\dev-logs" }
$stateFile = Join-Path $logDirectory "local-services.json"
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$apiLog = Join-Path $logDirectory "api-$runStamp.log"
$apiErrorLog = Join-Path $logDirectory "api-$runStamp.error.log"
$webLog = Join-Path $logDirectory "web-$runStamp.log"
$webErrorLog = Join-Path $logDirectory "web-$runStamp.error.log"
$adminLog = Join-Path $logDirectory "admin-$runStamp.log"
$adminErrorLog = Join-Path $logDirectory "admin-$runStamp.error.log"
# Read the same saved configuration as the API. Never write runtime settings from the launcher.
$runtimeDataDirectory = if ($env:Lifewood__DataDirectory) { $env:Lifewood__DataDirectory } else { "data" }
if (-not [IO.Path]::IsPathRooted($runtimeDataDirectory)) { $runtimeDataDirectory = Join-Path (Split-Path -Parent $apiProject) $runtimeDataDirectory }
$runtimePath = Join-Path $runtimeDataDirectory "runtime-settings.json"
$apiScheme = "http"
$apiAddress = "127.0.0.1"
$webScheme = "http"
$webAddress = "127.0.0.1"
$adminScheme = "http"
$adminAddress = "127.0.0.1"
if ((-not $Stop) -and (Test-Path -LiteralPath $runtimePath)) {
    $savedRuntime = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    $apiAddress = $savedRuntime.listenAddress
    $ApiPort = [int]$savedRuntime.port
    if ($savedRuntime.PSObject.Properties['scheme']) { $apiScheme = $savedRuntime.scheme }
    foreach ($name in @("customer", "admin")) {
        if (-not $savedRuntime.PSObject.Properties[$name]) { continue }
        $listener = $savedRuntime.$name
        if ($null -eq $listener -or $listener.shared) { continue }
        if ($name -eq "customer") { $webScheme = $listener.scheme; $webAddress = $listener.listenAddress; $WebPort = [int]$listener.port }
        else { $adminScheme = $listener.scheme; $adminAddress = $listener.listenAddress; $AdminPort = [int]$listener.port }
    }
}
function Listener-Url([string]$Scheme, [string]$Address, [int]$Port, [switch]$Connect) {
    $parsedAddress = $null
    if ($Scheme -notin @("http", "https") -or ($Address -ne "localhost" -and -not [Net.IPAddress]::TryParse($Address, [ref]$parsedAddress)) -or $Port -lt 1 -or $Port -gt 65535) { throw "Invalid listener in runtime-settings.json." }
    if ($Connect -and $Address -eq "0.0.0.0") { $Address = "127.0.0.1" }
    if ($Connect -and $Address -eq "::") { $Address = "::1" }
    if ($Address.Contains(":")) { $Address = "[$Address]" }
    return "${Scheme}://${Address}:$Port"
}
$apiUrl = Listener-Url $apiScheme $apiAddress $ApiPort -Connect
$apiListenUrl = Listener-Url $apiScheme $apiAddress $ApiPort
$webUrl = Listener-Url $webScheme $webAddress $WebPort -Connect
$webListenUrl = Listener-Url $webScheme $webAddress $WebPort
$adminUrl = Listener-Url $adminScheme $adminAddress $AdminPort -Connect
$adminListenUrl = Listener-Url $adminScheme $adminAddress $AdminPort
if (-not $Stop) {
    if (@($ApiPort, $WebPort, $AdminPort | Select-Object -Unique).Count -ne 3) { throw "Backend, customer and admin development ports must be different." }
    if ($webScheme -eq "https" -or $adminScheme -eq "https") {
        if (-not $env:LIFEWOOD_DEV_TLS_CERT -or -not $env:LIFEWOOD_DEV_TLS_KEY -or -not (Test-Path -LiteralPath $env:LIFEWOOD_DEV_TLS_CERT) -or -not (Test-Path -LiteralPath $env:LIFEWOOD_DEV_TLS_KEY)) { throw "HTTPS requires LIFEWOOD_DEV_TLS_CERT and LIFEWOOD_DEV_TLS_KEY to point to valid PEM certificate and key files." }
    }
}
$previousLocalLaunchId = $env:Lifewood__LocalLaunchId
$previousLocalProcessRecord = $env:Lifewood__LocalProcessRecord
$previousDevScheme = $env:LIFEWOOD_DEV_SCHEME
$startedProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
$previousApiProxyTarget = $env:VITE_API_PROXY_TARGET
$previousAdminAppUrl = $env:VITE_ADMIN_APP_URL
$previousCustomerAppUrl = $env:VITE_CUSTOMER_APP_URL

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

function Refresh-ServerReceipt($State) {
    if (-not $State.PSObject.Properties['launchId']) { return }
    $receiptPath = Join-Path $logDirectory "api-process.json"
    if (-not (Test-Path -LiteralPath $receiptPath)) { return }
    try {
        $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
        $server = $State.processes | Where-Object { $_.name -eq "Server" } | Select-Object -First 1
        if ($receipt.launchId -eq $State.launchId -and $null -ne $server -and $receipt.path -eq $server.path) {
            $candidate = Get-Process -Id $receipt.id -ErrorAction Stop
            if ($candidate.Path -eq $server.path) { $server.id = $candidate.Id }
        }
    } catch { Write-Verbose "The server process receipt is unavailable." }
}

function Stop-LocalServices {
    if (-not (Test-Path -LiteralPath $stateFile)) {
        Write-Host "No recorded local services are running."
        return
    }
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    Refresh-ServerReceipt $state
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
        Refresh-ServerReceipt $existing
        $recordedProcesses = @($existing.processes)
        $runningProcesses = @($recordedProcesses | Where-Object { Test-RecordedProcess $_ })
        $allProcessesRunning = $recordedProcesses.Count -gt 0 -and $runningProcesses.Count -eq $recordedProcesses.Count
        $recordedApi = $recordedProcesses | Where-Object { $_.name -eq "Server" } | Select-Object -First 1
        $apiMatchesCurrentLauncher = $null -ne $recordedApi -and $recordedApi.path -eq $apiExecutable -and
            $existing.PSObject.Properties['listenerConfiguration'] -and $existing.listenerConfiguration -eq "$apiListenUrl|$webListenUrl|$adminListenUrl"
        $allProcessesRunning = $allProcessesRunning -and $apiMatchesCurrentLauncher
        $allEndpointsHealthy = (Test-HttpEndpoint "$apiUrl/api/health") -and
            (Test-HttpEndpoint $webUrl) -and
            (Test-HttpEndpoint $adminUrl)

        if ($allProcessesRunning -and $allEndpointsHealthy) {
            Write-Host "Local development environment is already running." -ForegroundColor Green
            Write-Host "Web:  $webUrl/zh-CN/tasks"
            Write-Host "Admin center: $adminUrl/zh-CN/projects"
            Write-Host "Server health: $apiUrl/api/health"
            return
        }

        Write-Host "A stale or incomplete service record was found. Restarting local services..." -ForegroundColor DarkYellow
        Stop-LocalServices
    }
    Set-Location -LiteralPath $repositoryRoot

    if (-not $SkipBuild) {
        Write-Host "Checking the web server..." -ForegroundColor DarkGreen
        & dotnet build $apiProject -c $Configuration --no-restore
        if ($LASTEXITCODE -ne 0) { throw "The web server build failed." }
    }
    if (-not (Test-Path -LiteralPath $apiExecutable)) {
        throw "The web server executable was not found. Retry without -SkipBuild."
    }

    $launchId = [Guid]::NewGuid().ToString("N")
    $env:Lifewood__LocalLaunchId = $launchId
    $env:Lifewood__LocalProcessRecord = Join-Path $logDirectory "api-process.json"
    $env:ASPNETCORE_ENVIRONMENT = "Development"
    $env:VITE_API_PROXY_TARGET = $apiUrl
    $env:VITE_ADMIN_APP_URL = $adminUrl
    $env:VITE_CUSTOMER_APP_URL = $webUrl
    $apiProcess = Start-Process -FilePath $apiExecutable `
        -ArgumentList "--urls", $apiListenUrl, "--Lifewood:RequireWebAssets", "false", "--Lifewood:CustomerUrl=$webListenUrl", "--Lifewood:AdminUrl=$adminListenUrl" `
        -WorkingDirectory (Split-Path -Parent $apiProject) `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog
    $startedProcesses.Add($apiProcess)

    $env:LIFEWOOD_DEV_SCHEME = $webScheme
    $webProcess = Start-Process -FilePath (Get-Command node.exe).Source `
        -ArgumentList $viteEntry, "--host", $webAddress, "--port", $WebPort, "--strictPort" `
        -WorkingDirectory (Join-Path $repositoryRoot "apps\task-entry-web") `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $webLog -RedirectStandardError $webErrorLog
    $startedProcesses.Add($webProcess)

    $env:LIFEWOOD_DEV_SCHEME = $adminScheme
    $adminProcess = Start-Process -FilePath (Get-Command node.exe).Source `
        -ArgumentList $viteEntry, "--host", $adminAddress, "--port", $AdminPort, "--strictPort" `
        -WorkingDirectory (Join-Path $repositoryRoot "apps\admin-web") `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $adminLog -RedirectStandardError $adminErrorLog
    $startedProcesses.Add($adminProcess)

    Wait-ForHttp "$apiUrl/api/health" "Web server" $apiProcess $apiErrorLog
    Wait-ForHttp $webUrl "Web application" $webProcess $webErrorLog
    Wait-ForHttp $adminUrl "Admin center" $adminProcess $adminErrorLog

    @{
        launchId = $launchId
        listenerConfiguration = "$apiListenUrl|$webListenUrl|$adminListenUrl"
        startedAt = (Get-Date).ToString("O")
        webUrl = "$webUrl/zh-CN/tasks"
        adminUrl = "$adminUrl/zh-CN/projects"
        apiUrl = "$apiUrl/api/health"
        processes = @(
            @{ name = "Server"; id = $apiProcess.Id; path = $apiProcess.Path },
            @{ name = "Web"; id = $webProcess.Id; path = $webProcess.Path }
            @{ name = "Admin center"; id = $adminProcess.Id; path = $adminProcess.Path }
        )
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8

    Write-Host ""
    Write-Host "Local development environment is ready." -ForegroundColor Green
    Write-Host "Web:  $webUrl/zh-CN/tasks"
    Write-Host "Admin center: $adminUrl/zh-CN/projects"
    Write-Host "Server health: $apiUrl/api/health"
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
    $env:Lifewood__LocalLaunchId = $previousLocalLaunchId
    $env:Lifewood__LocalProcessRecord = $previousLocalProcessRecord
    $env:LIFEWOOD_DEV_SCHEME = $previousDevScheme
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
    $env:VITE_API_PROXY_TARGET = $previousApiProxyTarget
    $env:VITE_ADMIN_APP_URL = $previousAdminAppUrl
    $env:VITE_CUSTOMER_APP_URL = $previousCustomerAppUrl
}
