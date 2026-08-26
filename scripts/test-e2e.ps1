[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root "artifacts\e2e-data"
if (Test-Path -LiteralPath $target) {
    $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path
    if (-not $resolvedTarget.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "E2E data path escaped the workspace." }
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}
& npm.cmd exec playwright test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
