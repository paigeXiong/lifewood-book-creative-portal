[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:5077"
)

$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Uri "$BaseUrl/api/health"
if ($health.status -ne "ok") { throw "API health check failed." }

$authStatus = Invoke-RestMethod -Uri "$BaseUrl/api/auth/status"
if ($null -eq $authStatus.requiresBootstrap) { throw "Authentication status is invalid." }

try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/projects" -ErrorAction Stop | Out-Null
    throw "Anonymous access to the administrator API was accepted."
}
catch {
    if ($_.Exception.Response.StatusCode -ne 401) { throw }
}

Write-Host "Administrator API boundary smoke test passed."
Write-Host "Health: $($health.status)"
Write-Host "Requires bootstrap: $($authStatus.requiresBootstrap)"
Write-Host "Anonymous administrator access: 401"
