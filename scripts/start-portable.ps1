[CmdletBinding()]
param([switch]$NoBrowser)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$packageRoot = Split-Path -Parent $PSScriptRoot
$server = Join-Path $packageRoot "server\Lifewood.BookPortal.Server.exe"
$dataDirectory = Join-Path $packageRoot "data"
$outputLog = Join-Path $packageRoot "server.log"
$errorLog = Join-Path $packageRoot "server.error.log"
$defaultBindUrl = "http://0.0.0.0:5077"

function Get-ConfiguredEndpoint {
    $scheme = "http"
    $address = "0.0.0.0"
    $port = 5077
    $settingsPath = Join-Path $dataDirectory "runtime-settings.json"
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        try {
            $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
            $candidateScheme = [string]$settings.scheme
            $candidateAddress = [string]$settings.listenAddress
            $candidatePort = [int]$settings.port
            $parsedAddress = $null
            $validAddress = $candidateAddress.Equals("localhost", [StringComparison]::OrdinalIgnoreCase) -or
                [Net.IPAddress]::TryParse($candidateAddress.Trim('[', ']'), [ref]$parsedAddress)
            if ($candidateScheme -in @("http", "https") -and $validAddress -and $candidatePort -ge 1 -and $candidatePort -le 65535) {
                $scheme = $candidateScheme
                $address = $candidateAddress
                $port = $candidatePort
            }
        }
        catch {
            Write-Warning "The saved runtime endpoint is invalid; checking the default endpoint. / 已保存的运行端点无效，将检查默认端点。"
        }
    }

    $localAddress = if ($address -in @("0.0.0.0", "*")) { "127.0.0.1" }
        elseif ($address -in @("::", "[::]")) { "::1" }
        else { $address.Trim('[', ']') }
    $formattedLocalAddress = if ($localAddress.Contains(":")) { "[$localAddress]" } else { $localAddress }
    return [pscustomobject]@{
        Health = "{0}://{1}:{2}/api/health" -f $scheme, $formattedLocalAddress, $port
        Portal = "{0}://{1}:{2}/" -f $scheme, $formattedLocalAddress, $port
        Bind = "{0}://{1}:{2}" -f $scheme, $address, $port
    }
}

function Test-Health([string]$Url) {
    & curl.exe --silent --fail --insecure --max-time 2 $Url *> $null
    return $LASTEXITCODE -eq 0
}

if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
    throw "Server executable was not found. / 未找到服务端程序。"
}
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw "Windows curl.exe is required for startup verification. / 启动检查需要 Windows curl.exe。"
}

$endpoint = Get-ConfiguredEndpoint
if (Test-Health -Url $endpoint.Health) {
    Write-Host "The web server is already running. / 网页服务端已在运行。" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $endpoint.Portal }
    return
}

Set-Content -LiteralPath $outputLog -Value "[Lifewood] Server log / 服务端日志" -Encoding UTF8
Set-Content -LiteralPath $errorLog -Value "[Lifewood] Server error log / 服务端错误日志" -Encoding UTF8
$startArguments = @{
    FilePath = $server
    ArgumentList = @("--urls", $defaultBindUrl, "--Lifewood:DataDirectory", $dataDirectory)
    WorkingDirectory = (Split-Path -Parent $server)
    WindowStyle = "Hidden"
    PassThru = $true
    RedirectStandardOutput = $outputLog
    RedirectStandardError = $errorLog
}
$process = Start-Process @startArguments

Write-Host "Waiting for the web server... / 正在等待网页服务端..."
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($process.HasExited) { break }
    if (Test-Health -Url $endpoint.Health) { $ready = $true; break }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        try { $process.WaitForExit(10000) | Out-Null } catch { }
    }
    $details = if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Raw } else { "" }
    throw ("The web server did not become healthy and was stopped. Check server.log and server.error.log. / 网页服务端未能就绪，已停止该进程，请检查日志。" + [Environment]::NewLine + $details)
}

Write-Host "Web server started. / 网页服务端已启动。" -ForegroundColor Green
Write-Host "Local portal / 本机门户: $($endpoint.Portal)"
Write-Host "Listener / 监听地址: $($endpoint.Bind)"
if (-not $NoBrowser) { Start-Process $endpoint.Portal }
