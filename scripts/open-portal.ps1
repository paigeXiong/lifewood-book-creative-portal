[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
    [Parameter(Mandatory = $true)][ValidateSet("zh-CN", "en-US")][string]$Locale,
    [Parameter(Mandatory = $true)][ValidateSet("customer", "admin")][string]$Area,
    [switch]$PrintOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scheme = "http"
$address = "127.0.0.1"
$settingsPath = Join-Path ([IO.Path]::GetFullPath($DataDirectory)) "runtime-settings.json"
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
            $Port = $candidatePort
        }
    }
    catch {
        $message = if ($Locale -eq "zh-CN") { "运行端点配置无效，将打开安装时的地址。" }
            else { "The runtime endpoint is invalid; opening the installation endpoint." }
        Write-Warning $message
    }
}

$browserAddress = if ($address -in @("0.0.0.0", "*")) { "127.0.0.1" }
    elseif ($address -in @("::", "[::]")) { "::1" }
    else { $address.Trim('[', ']') }
$hostName = if ($browserAddress.Contains(":")) { "[$browserAddress]" } else { $browserAddress }
$path = if ($Area -eq "admin") { "/admin/$Locale/overview" } else { "/$Locale/tasks" }
$url = "{0}://{1}:{2}{3}" -f $scheme, $hostName, $Port, $path
if ($PrintOnly) { Write-Output $url } else { Start-Process $url }
