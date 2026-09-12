[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$LibraryPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$library = (Resolve-Path -LiteralPath $LibraryPath).Path.Replace('"','""')
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class InstallerBackupInterop {
    [DllImport(@"$library", CharSet = CharSet.Unicode, CallingConvention = CallingConvention.Winapi)]
    public static extern int PrepareBackupDirectoryPath(string data, string install, string windows, string program64, string program32, string profile);
}
"@
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('..\artifacts\installer-lifecycle\acl-' + [guid]::NewGuid().ToString('N'))))
New-Item -ItemType Directory -Path $root | Out-Null
$program64 = [Environment]::GetFolderPath('ProgramFiles')
$program32 = [Environment]::GetFolderPath('ProgramFilesX86')
$windows = [Environment]::GetFolderPath('Windows')
$profile = [Environment]::GetFolderPath('UserProfile')
$install = Join-Path $program64 'Lifewood Book Creative Portal'
$sidOutput = & sc.exe showsid LifewoodBookCreativePortal
if ($LASTEXITCODE -ne 0 -or ($sidOutput -join ' ') -notmatch '(S-1-5-80-(?:\d+-){4}\d+)') { throw 'Cannot obtain the Windows service SID.' }
$serviceSid = $Matches[1]
$expected = @($serviceSid, 'S-1-5-18', 'S-1-5-32-544')
$checks = [Collections.Generic.List[string]]::new()
function Assert-Prepare([string]$Data, [bool]$Expected, [string]$Name) {
    $actual = [InstallerBackupInterop]::PrepareBackupDirectoryPath($Data,$install,$windows,$program64,$program32,$profile)
    if (($actual -eq 1) -ne $Expected) { throw "Backup path check failed: $Name" }
    $checks.Add($Name)
}
function Assert-Private([string]$Path) {
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) { throw 'Backup ACL inherits from the parent.' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544') { throw 'Backup owner must be Administrators.' }
    $rules = @($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 3) { throw 'Unexpected backup access rules.' }
    foreach ($rule in $rules) {
        if ($rule.IdentityReference.Value -notin $expected -or $rule.AccessControlType -ne 'Allow' -or
            ($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Incorrect backup access rule.' }
    }
}
$data = Join-Path $root 'data'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Assert-Prepare $data $false 'non-elevated process cannot grant service permissions'
    if (Test-Path -LiteralPath ($data + '.backups')) { throw 'Failed provisioning left a directory.' }
    @{passed=$true; scope='non-elevated rejection only; full ACL cases require the elevated CI runner'; checks=@($checks)} |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'acl-result.json') -Encoding utf8
    Write-Output 'Non-elevated provisioning refusal passed. Full service ACL checks require elevated CI.'
    exit 0
}
Assert-Prepare $data $true 'new backup directory with private ACL'
$backup = $data + '.backups'
Assert-Private $backup
$archive = Join-Path $backup 'backup-fixture.zip'
[IO.File]::WriteAllText($archive, 'Unchanged fixture bytes')
$acl = Get-Acl -LiteralPath $archive
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl -LiteralPath $archive -AclObject $acl
$hash = (Get-FileHash -LiteralPath $archive).Hash
Assert-Prepare $data $true 'existing private archive retained'
if ((Get-FileHash -LiteralPath $archive).Hash -ne $hash) { throw 'Archive content changed.' }

# A foreign explicit ACE must be rejected without silently rewriting the archive.
$acl = Get-Acl -LiteralPath $archive
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'), 'Read', 'Allow'))
Set-Acl -LiteralPath $archive -AclObject $acl
$before = (Get-Acl -LiteralPath $archive).Sddl
Assert-Prepare $data $false 'foreign explicit archive access rejected'
if ((Get-Acl -LiteralPath $archive).Sddl -ne $before) { throw 'Rejected archive permissions changed.' }

$unrelatedData = Join-Path $root 'unrelated'
New-Item -ItemType Directory -Path ($unrelatedData + '.backups') | Out-Null
Set-Content -LiteralPath (Join-Path ($unrelatedData + '.backups') 'notes.txt') -Value 'Not a platform backup'
Assert-Prepare $unrelatedData $false 'unrelated sibling directory rejected'
$linkedData = Join-Path $root 'linked'
$outside = Join-Path $root 'outside'
New-Item -ItemType Directory -Path $outside | Out-Null
$outsideAcl = (Get-Acl -LiteralPath $outside).Sddl
$link = New-Item -ItemType Junction -Path ($linkedData + '.backups') -Target $outside
try { Assert-Prepare $linkedData $false 'backup junction rejected' }
finally { Remove-Item -LiteralPath $link.FullName -Force }
if ((Get-Acl -LiteralPath $outside).Sddl -ne $outsideAcl) { throw 'Junction target permissions changed.' }

$nestedData = Join-Path $root 'nested'
Assert-Prepare $nestedData $true 'nested fixture initialized'
$link = New-Item -ItemType Junction -Path (Join-Path ($nestedData + '.backups') 'backup-link') -Target $outside
try { Assert-Prepare $nestedData $false 'nested archive junction rejected' }
finally { Remove-Item -LiteralPath $link.FullName -Force }

$protectedData = Join-Path $root 'protected'
Assert-Prepare $protectedData $true 'protected fixture initialized'
$child = Join-Path ($protectedData + '.backups') '.backup-private'
New-Item -ItemType Directory -Path $child | Out-Null
$acl = Get-Acl -LiteralPath $child
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
$acl.SetAccessRuleProtection($true,$false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'),'FullControl','Allow'))
Set-Acl -LiteralPath $child -AclObject $acl
Assert-Prepare $protectedData $false 'protected child missing service permissions rejected'
$foreignData = Join-Path $root 'foreign-owner'
Assert-Prepare $foreignData $true 'owner fixture initialized'
$acl = Get-Acl -LiteralPath ($foreignData + '.backups')
$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
Set-Acl -LiteralPath ($foreignData + '.backups') -AclObject $acl
Assert-Prepare $foreignData $false 'foreign backup owner rejected'
Assert-Prepare $install $false 'program directory rejected'
@{passed=$true;checks=@($checks)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'acl-result.json') -Encoding utf8
Write-Output "Installer backup permission checks passed ($($checks.Count) cases)."
