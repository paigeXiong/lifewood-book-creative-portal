[CmdletBinding()]
param([string]$BaseUrl = "http://127.0.0.1:5088")

$ErrorActionPreference = "Stop"

function Get-Csrf($Session) {
    (Invoke-RestMethod -Uri "$BaseUrl/api/auth/csrf" -WebSession $Session).token
}

function Invoke-Write([string]$Method, [string]$Path, $Body, $Session) {
    $token = Get-Csrf $Session
    Invoke-RestMethod -Method $Method -Uri "$BaseUrl$Path" -WebSession $Session -Headers @{ "X-CSRF-TOKEN" = $token } -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8)
}

$ownerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$owner = Invoke-Write Post "/api/auth/bootstrap" @{ displayName = "Platform Owner"; email = "owner@smoke.local"; password = "OwnerSmoke!2026" } $ownerSession
if (-not ($owner.permissions -contains "admin.access")) { throw "The owner did not receive administrator access." }

$customer = Invoke-Write Post "/api/admin/users" @{ displayName = "Smoke Customer"; email = "customer@smoke.local"; password = "CustomerSmoke!2026"; role = "customer" } $ownerSession
$administrator = Invoke-Write Post "/api/admin/users" @{ displayName = "Smoke Admin"; email = "admin@smoke.local"; password = "Administrator!2026"; role = "admin" } $ownerSession
if ($customer.role -ne "customer" -or $administrator.role -ne "admin") { throw "Administrator user creation returned the wrong roles." }

$customerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-Write Post "/api/auth/login" @{ email = "customer@smoke.local"; password = "CustomerSmoke!2026"; rememberMe = $false } $customerSession
if (-not ($login.permissions -contains "tasks.write") -or ($login.permissions -contains "admin.access")) { throw "Customer permissions are invalid." }

$draft = Invoke-Write Post "/api/projects" @{} $customerSession
if ($draft.status -ne "draft") { throw "The customer could not create a draft." }

try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/projects" -WebSession $customerSession | Out-Null
    throw "A customer accessed the administrator API."
}
catch {
    if ($_.Exception.Response.StatusCode -ne 403) { throw }
}

$projects = Invoke-RestMethod -Uri "$BaseUrl/api/admin/projects" -WebSession $ownerSession
if (-not ($projects.items.id -contains $draft.id)) { throw "The administrator could not see the customer's project." }

$followed = Invoke-Write Put "/api/admin/projects/$($draft.id)/workflow" @{ workflowStatus = "contacting"; priority = "high"; assigneeUserId = $administrator.id } $ownerSession
if ($followed.workflowStatus -ne "contacting" -or $followed.assigneeUserId -ne $administrator.id) { throw "Project follow-up was not persisted." }
$assignees = Invoke-RestMethod -Uri "$BaseUrl/api/admin/assignees" -WebSession $ownerSession
if (-not ($assignees.id -contains $administrator.id)) { throw "The active administrator was missing from the assignee list." }

$note = Invoke-Write Post "/api/admin/projects/$($draft.id)/notes" @{ body = "Customer contacted; waiting for the source manuscript." } $ownerSession
if ([string]::IsNullOrWhiteSpace($note.id)) { throw "The internal note was not created." }
$detail = Invoke-RestMethod -Uri "$BaseUrl/api/admin/projects/$($draft.id)" -WebSession $ownerSession
if ($detail.notes.Count -ne 1) { throw "The internal note was not returned with project details." }

if ($detail.project.updatedAt -ne $draft.updatedAt) { throw "Internal follow-up changed the customer-visible project timestamp." }
$disabled = Invoke-Write Put "/api/admin/users/$($customer.id)" @{ displayName = $customer.displayName; role = "customer"; active = $false } $ownerSession
if ($disabled.active) { throw "The customer account was not disabled." }
try {
    Invoke-RestMethod -Uri "$BaseUrl/api/me" -WebSession $customerSession | Out-Null
    throw "A disabled customer retained an authenticated session."
}
catch {
    if ($_.Exception.Response.StatusCode -ne 401) { throw }
}

Write-Host "Authenticated administrator workflow smoke test passed."
Write-Host "Created roles: owner, admin, customer"
Write-Host "Cross-customer project access: passed"
Write-Host "Workflow, assignee, priority, and internal note persistence: passed"
Write-Host "Customer isolation and immediate deactivation: passed"
