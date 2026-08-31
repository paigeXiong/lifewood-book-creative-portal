[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PublishDirectory,
    [int]$Port = 5087
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$publishRoot = (Resolve-Path -LiteralPath $PublishDirectory).Path
$executable = Join-Path $publishRoot "Lifewood.BookPortal.Server.exe"
if (-not (Test-Path -LiteralPath $executable)) {
    throw "Native AOT executable was not found: $executable"
}

$smokeRoot = Join-Path $repositoryRoot "artifacts/aot-smoke"
$runDirectory = Join-Path $smokeRoot ([Guid]::NewGuid().ToString("N"))
$dataDirectory = Join-Path $runDirectory "data"

function Assert-NoReparsePoints([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push([IO.Path]::GetFullPath($Path))
    while ($pending.Count -gt 0) {
        $current = $pending.Pop()
        $item = Get-Item -LiteralPath $current -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "AOT smoke cleanup refuses to traverse a junction or symbolic link: $($item.FullName)" }
        if (-not $item.PSIsContainer) { continue }
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "AOT smoke cleanup refuses to traverse a junction or symbolic link: $($child.FullName)" }
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}

function Assert-PathNotReparsePoint([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "AOT smoke refuses to use a junction or symbolic link: $($item.FullName)" }
}

Assert-PathNotReparsePoint $smokeRoot
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$baseUrl = "http://127.0.0.1:$Port"
$process = $null

try {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $executable
    $start.WorkingDirectory = $publishRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $false
    $start.RedirectStandardError = $false
    $start.Environment["ASPNETCORE_URLS"] = $baseUrl
    $start.Environment["ASPNETCORE_ENVIRONMENT"] = "Production"
    $start.Environment["Lifewood__DataDirectory"] = $dataDirectory
    $start.Environment["Lifewood__RequireWebAssets"] = "false"
    $process = [Diagnostics.Process]::Start($start)
    if ($null -eq $process) { throw "Native AOT process did not start." }

    $ready = $false
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(45)
    while ([DateTimeOffset]::UtcNow -lt $deadline -and -not $process.HasExited) {
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/health" -TimeoutSec 2
            if ($health.status -eq "ok") { $ready = $true; break }
        }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) {
        throw "Native AOT server did not become healthy."
    }

    $anonymousStatus = 0
    try { $anonymousStatus = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/api/projects" -TimeoutSec 5).StatusCode }
    catch { $anonymousStatus = [int]$_.Exception.Response.StatusCode }
    if ($anonymousStatus -ne 401) { throw "Anonymous project access was not rejected." }

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $csrf = (Invoke-RestMethod -Method Get -Uri "$baseUrl/api/auth/csrf" -WebSession $session).token
    $password = "Aot!" + [Guid]::NewGuid().ToString("N")
    $ownerBody = @{ displayName = "AOT Smoke Owner"; email = "aot-smoke@example.test"; password = $password } | ConvertTo-Json
    $owner = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/auth/bootstrap" -WebSession $session -Headers @{ "X-CSRF-TOKEN" = $csrf } -ContentType "application/json" -Body $ownerBody
    if ($owner.email -ne "aot-smoke@example.test") { throw "AOT bootstrap returned an unexpected account." }

    $me = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/me" -WebSession $session
    if ($me.id -ne $owner.id) { throw "AOT authenticated session could not be restored." }

    $csrf = (Invoke-RestMethod -Method Get -Uri "$baseUrl/api/auth/csrf" -WebSession $session).token
    $customerBody = @{ displayName = "AOT Customer"; email = "aot-customer@example.test"; password = $password; role = "customer" } | ConvertTo-Json
    $customer = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/users" -WebSession $session -Headers @{ "X-CSRF-TOKEN" = $csrf } -ContentType "application/json" -Body $customerBody
    $audit = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/admin/audit-events?actionId=user.create&page=1&pageSize=10" -WebSession $session
    if ($audit.total -ne 1 -or $audit.items[0].targetId -ne $customer.id) { throw "AOT audit trail did not record the created account." }

    $actions = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/admin/audit-actions" -WebSession $session -Headers @{ "Accept-Language" = "en-US" }
    if (-not ($actions | Where-Object { $_.id -eq "user.create" -and $_.label -eq "Created user" })) {
        throw "AOT localized audit action catalog is incomplete."
    }

    Write-Output "Native AOT runtime smoke test passed."
}
finally {
    try {
        if ($null -ne $process) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            try { $process.WaitForExit(10000) | Out-Null } catch { }
        }
    }
    finally {
        $resolvedSmokeRoot = [IO.Path]::GetFullPath($smokeRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $resolvedRunDirectory = [IO.Path]::GetFullPath($runDirectory)
        if ($resolvedRunDirectory.StartsWith($resolvedSmokeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $resolvedRunDirectory)) {
            Assert-PathNotReparsePoint $resolvedSmokeRoot
            Assert-NoReparsePoints $resolvedRunDirectory
            Remove-Item -LiteralPath $resolvedRunDirectory -Recurse -Force
        }
    }
}
