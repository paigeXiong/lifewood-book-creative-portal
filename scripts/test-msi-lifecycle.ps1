[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PreviousPackage,
    [Parameter(Mandatory = $true)][string]$CurrentPackage
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Never turn this into an installer smoke test on a developer's computer.
if ($env:OS -ne 'Windows_NT' -or $env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or
    $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:LIFEWOOD_ALLOW_DESTRUCTIVE_INSTALLER_TEST -ne '1') {
    throw 'MSI lifecycle requires an explicitly opted-in, disposable GitHub-hosted Windows runner.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'MSI lifecycle requires an elevated disposable runner.'
}
$serviceName = 'LifewoodBookCreativePortal'
$registry = 'HKLM:\Software\Lifewood\BookCreativePortal'
$program = Join-Path $env:ProgramFiles 'Lifewood Book Creative Portal'
if ((Get-Service -Name $serviceName -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath $registry) -or
    (Test-Path -LiteralPath $program) -or (Test-Path -LiteralPath (Join-Path $env:ProgramData 'Lifewood'))) {
    throw 'Runner already contains a Lifewood installation or retained data; refusing to modify it.'
}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 5098)
try { $listener.Start() } finally { $listener.Stop() }

function Invoke-Com($Target, [string]$Name, [Reflection.BindingFlags]$Flags, [object[]]$Arguments) {
    return $Target.GetType().InvokeMember($Name, $Flags, $null, $Target, $Arguments)
}
function Read-Package([string]$Path) {
    $path = (Resolve-Path -LiteralPath $Path).Path
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = Invoke-Com $installer 'OpenDatabase' ([Reflection.BindingFlags]::InvokeMethod) @($path, 0)
    $properties = @{}
    foreach ($name in @('ProductCode','UpgradeCode','ProductVersion','ProductLanguage','Manufacturer')) {
        $view = Invoke-Com $database 'OpenView' ([Reflection.BindingFlags]::InvokeMethod) @("SELECT Value FROM Property WHERE Property='$name'")
        try {
            Invoke-Com $view 'Execute' ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
            $record = Invoke-Com $view 'Fetch' ([Reflection.BindingFlags]::InvokeMethod) @()
            if (-not $record) { throw "Missing MSI property: $name" }
            $properties[$name] = Invoke-Com $record 'StringData' ([Reflection.BindingFlags]::GetProperty) @(1)
        } finally { Invoke-Com $view 'Close' ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null }
    }
    if ($properties.Manufacturer -ne 'Lifewood' -or $properties.UpgradeCode -ne '{7E717C0D-C4D0-49A6-A5AF-5F30A9D13FC0}') { throw 'Unexpected MSI product family.' }
    $properties.Path = $path
    return $properties
}
$previous = Read-Package $PreviousPackage
$current = Read-Package $CurrentPackage
if ([version]$current.ProductVersion -le [version]$previous.ProductVersion -or
    $current.ProductCode -eq $previous.ProductCode -or $current.ProductLanguage -eq $previous.ProductLanguage) {
    throw 'Use different product codes, ascending versions and different installer languages.'
}
$runId = [guid]::NewGuid().ToString('N')
$root = Join-Path (Join-Path $PSScriptRoot '..\artifacts\installer-lifecycle') $runId
$root = [IO.Path]::GetFullPath($root)
$data = Join-Path $env:ProgramData "LifewoodInstallerLifecycle\$runId\data"
$alternateData = Join-Path $env:ProgramData "LifewoodInstallerLifecycle\$runId\wrong-data"
New-Item -ItemType Directory -Path $root | Out-Null
$state = Join-Path $root 'private-state.json'
$checks = [Collections.Generic.List[string]]::new()
$success = $false
$started = $false
function Invoke-Msi([string]$Label, [string[]]$Arguments, [bool]$ExpectFailure = $false) {
    # Only package paths and generated fixture paths are accepted; never arbitrary user arguments.
    $log = Join-Path $root ($Label + '.log')
    $process = Start-Process msiexec.exe -ArgumentList ($Arguments + @('/qn','/norestart','/l*v',('"' + $log + '"'))) -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(180000)) { throw "MSI $Label exceeded 3 minutes. Let runner disposal terminate it; do not overlap another transaction." }
    if ($ExpectFailure) {
        if ($process.ExitCode -ne 1603) { throw "MSI $Label expected validation rejection (1603), received $($process.ExitCode)." }
    } elseif ($process.ExitCode -ne 0) { throw "MSI $Label failed: $($process.ExitCode)." }
}
function Assert-Service([string]$Version) {
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
        if ($service -and $service.State -eq 'Running') {
            if ($service.StartName -ne "NT SERVICE\$serviceName" -or -not $service.PathName.Contains($program) -or -not $service.PathName.Contains($data)) { throw 'Unexpected service identity or storage path.' }
            try {
                $health = Invoke-WebRequest 'http://127.0.0.1:5098/api/health' -UseBasicParsing -TimeoutSec 2
                if ($health.StatusCode -eq 200) { $ready = $true; break }
            } catch { }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Installed Windows service did not become healthy.' }
    $stored = (Get-ItemProperty -LiteralPath $registry).DataDirectory.TrimEnd('\')
    if ($stored -ne $data) { throw 'MSI redirected the persistent data directory.' }
    $expected = if ($Version -eq $previous.ProductVersion) { $previous.ProductCode } else { $current.ProductCode }
    $uninstall = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$expected"
    if ((Get-ItemProperty -LiteralPath $uninstall).DisplayVersion -ne $Version) { throw 'Installed product version does not match.' }
}
function Invoke-Fixture([string]$Mode) {
    $env:LIFEWOOD_INSTALLER_FIXTURE = '1'
    & node (Join-Path $PSScriptRoot 'installer-fixture.mjs') $Mode 'http://127.0.0.1:5098' $state
    if ($LASTEXITCODE -ne 0) { throw "Business data verification failed: $Mode" }
}
try {
    $started = $true
    Invoke-Msi 'install-previous' @('/i', ('"' + $previous.Path + '"'), 'PORT=5098', 'LISTENADDRESS=127.0.0.1', ('DATAFOLDER="' + $data + '"'))
    Assert-Service $previous.ProductVersion
    Invoke-Fixture 'seed'
    $checks.Add('Real Windows service under its virtual account; customer, project, delivery, feedback and backup seeded')

    # Simulate a damaged installation record on this disposable runner. Without the
    # original data path the upgrade must abort before removing the previous service.
    $originalDataRecord = (Get-ItemProperty -LiteralPath $registry).DataDirectory
    Remove-ItemProperty -LiteralPath $registry -Name DataDirectory
    try { Invoke-Msi 'rejected-upgrade' @('/i', ('"' + $current.Path + '"')) $true }
    finally { New-ItemProperty -LiteralPath $registry -Name DataDirectory -Value $originalDataRecord -PropertyType String -Force | Out-Null }
    Assert-Service $previous.ProductVersion
    Invoke-Fixture 'verify'
    $checks.Add('Invalid upgrade rejected before installation; previous service and business data remain usable')

    Invoke-Msi 'upgrade' @('/i', ('"' + $current.Path + '"'), ('DATAFOLDER="' + $alternateData + '"'))
    Assert-Service $current.ProductVersion
    if (Test-Path -LiteralPath $alternateData) { throw 'Upgrade created the forbidden alternate data directory.' }
    Invoke-Fixture 'verify'
    $checks.Add('Cross-language major upgrade preserves original data path and all business fixtures')

    Invoke-Msi 'uninstall' @('/x', $current.ProductCode)
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) { throw 'Uninstall left the service installed.' }
    if (-not (Test-Path -LiteralPath (Join-Path $data 'platform.db')) -or -not (Test-Path -LiteralPath ($data + '.backups'))) { throw 'Uninstall removed persistent data or backups.' }
    Invoke-Msi 'reinstall' @('/i', ('"' + $current.Path + '"'), 'PORT=5098', 'LISTENADDRESS=127.0.0.1')
    Assert-Service $current.ProductVersion
    Invoke-Fixture 'verify'
    $checks.Add('Uninstall and reinstall rediscover retained data, including the original backup bytes')
    Invoke-Msi 'final-uninstall' @('/x', $current.ProductCode)
    $success = $true
} finally {
    # Do not run a competing uninstall after an interrupted transaction. This machine is disposable.
    # Keep private fixture data only on this runner; upload the allowlisted report, never the entire folder.
    @{passed=$success; previousVersion=$previous.ProductVersion; currentVersion=$current.ProductVersion;
      previousLanguage=$previous.ProductLanguage; currentLanguage=$current.ProductLanguage; checks=@($checks);
      scope='MSI lifecycle; preflight rejection only, not post-install rollback or database migration compatibility'} |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'result.json') -Encoding utf8
    if ($started) { Write-Output "Installer lifecycle report: $root\result.json" }
}
if (-not $success) { throw 'MSI lifecycle failed.' }
