[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:5077",
    [Parameter(Mandatory = $true)][string]$Email,
    [Parameter(Mandatory = $true)][SecureString]$Password
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd("/")
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$health = Invoke-RestMethod -Method Get -Uri "$base/api/health"
if ($health.status -ne "ok") { throw "The platform health endpoint is not ready." }

$anonymousStatus = 0
try {
    $anonymousStatus = (Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$base/api/projects").StatusCode
}
catch {
    $anonymousStatus = [int]$_.Exception.Response.StatusCode
}
if ($anonymousStatus -ne 401) { throw "Anonymous project access was not rejected." }

$token = (Invoke-RestMethod -Method Get -Uri "$base/api/auth/csrf" -WebSession $session).token
$plainPassword = [System.Net.NetworkCredential]::new("", $Password).Password
try {
    $body = @{ email = $Email; password = $plainPassword; rememberMe = $false } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -WebSession $session -Headers @{ "X-CSRF-TOKEN" = $token } -ContentType "application/json" -Body $body
}
finally {
    $plainPassword = $null
    $body = $null
}

$me = Invoke-RestMethod -Method Get -Uri "$base/api/me" -WebSession $session
if ($me.id -ne $login.id -or $me.email -ne $Email) { throw "The authenticated account did not match the requested account." }

$options = Invoke-RestMethod -Method Get -Uri "$base/api/form-options" -WebSession $session -Headers @{ "Accept-Language" = "zh-CN" }
if ($options.workflowStatuses.Count -eq 0 -or $options.projectPriorities.Count -eq 0) { throw "Server-managed workflow or priority options are missing." }

$voices = Invoke-RestMethod -Method Get -Uri "$base/api/voices" -WebSession $session -Headers @{ "Accept-Language" = "en-US" }
if ($voices.Count -eq 0) { throw "No enabled voice references were returned." }

$projects = Invoke-RestMethod -Method Get -Uri "$base/api/projects?page=1&pageSize=1" -WebSession $session
if ($null -eq $projects.items -or $projects.page -ne 1) { throw "Authenticated project listing returned an invalid payload." }

Write-Output "Platform API smoke test passed for $($me.email)."
