[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$PackagePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ComMember($Target, [string]$Name, [Reflection.BindingFlags]$Flags, [object[]]$Arguments) {
    return $Target.GetType().InvokeMember($Name, $Flags, $null, $Target, $Arguments)
}

function Read-MsiRows($Database, [string]$Sql) {
    $view = Invoke-ComMember $Database "OpenView" ([Reflection.BindingFlags]::InvokeMethod) @($Sql)
    try {
        Invoke-ComMember $view "Execute" ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
        $rows = @()
        while ($record = Invoke-ComMember $view "Fetch" ([Reflection.BindingFlags]::InvokeMethod) @()) {
            $fieldCount = Invoke-ComMember $record "FieldCount" ([Reflection.BindingFlags]::GetProperty) @()
            $values = @()
            for ($index = 1; $index -le $fieldCount; $index++) {
                $values += Invoke-ComMember $record "StringData" ([Reflection.BindingFlags]::GetProperty) @($index)
            }
            $rows += ,$values
        }
        return $rows
    }
    finally {
        Invoke-ComMember $view "Close" ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
    }
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

$windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
foreach ($candidate in $PackagePath) {
    $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
    $database = Invoke-ComMember $windowsInstaller "OpenDatabase" ([Reflection.BindingFlags]::InvokeMethod) @($resolved, 0)

    $component = @(Read-MsiRows $database "SELECT Attributes FROM Component WHERE Component='PersistentDataDirectory'")
    Assert-True ($component.Count -eq 1) "PersistentDataDirectory component is missing in $resolved"
    $attributes = [int]$component[0][0]
    Assert-True (($attributes -band 16) -eq 16) "Production data component is not permanent in $resolved"
    Assert-True (($attributes -band 128) -eq 128) "Production data component can be overwritten in $resolved"

    $service = @(Read-MsiRows $database "SELECT Arguments FROM ServiceInstall WHERE Name='LifewoodBookCreativePortal'")
    Assert-True ($service.Count -eq 1 -and $service[0][0].Contains('--Lifewood:DataDirectory "[DATAFOLDER]."')) "Service does not use a quote-safe persistent data property in $resolved"

    $serviceAccount = @(Read-MsiRows $database "SELECT StartName FROM ServiceInstall WHERE Name='LifewoodBookCreativePortal'")
    Assert-True ($serviceAccount.Count -eq 1 -and $serviceAccount[0][0] -eq 'NT AUTHORITY\LocalService') "Service does not run as LocalService in $resolved"

    $registry = @(Read-MsiRows $database "SELECT Value FROM Registry WHERE Name='DataDirectory' AND Component_='PersistentDataDirectory'")
    Assert-True ($registry.Count -eq 1 -and $registry[0][0] -eq '[DATAFOLDER]') "Persistent data path is not recorded in $resolved"

    $pathLock = @(Read-MsiRows $database "SELECT Target FROM CustomAction WHERE Action='SetDATAFOLDER'")
    Assert-True ($pathLock.Count -eq 1 -and $pathLock[0][0] -eq '[PREVIOUSDATAFOLDER]') "Upgrade data-path lock is missing in $resolved"

    $pathLockSequence = @(Read-MsiRows $database "SELECT Condition, Sequence FROM InstallExecuteSequence WHERE Action='SetDATAFOLDER'")
    Assert-True ($pathLockSequence.Count -eq 1 -and $pathLockSequence[0][0] -eq 'EXISTINGINSTALL AND PREVIOUSDATAFOLDER') "Upgrade data-path lock is not sequenced safely in $resolved"

    $secureProperties = @(Read-MsiRows $database "SELECT Value FROM Property WHERE Property='SecureCustomProperties'")
    Assert-True ($secureProperties.Count -eq 1 -and $secureProperties[0][0].Contains('DATAFOLDER') -and $secureProperties[0][0].Contains('PREVIOUSDATAFOLDER')) "Persistent path properties are not secured for elevated install in $resolved"

    $launchConditions = @(Read-MsiRows $database "SELECT Condition FROM LaunchCondition")
    $conditionText = ($launchConditions | ForEach-Object { $_[0] }) -join "`n"
    Assert-True ($conditionText.Contains('PORT >= 1024 AND PORT <= 65535')) "Execute-sequence port validation is missing in $resolved"
    Assert-True ($conditionText.Contains('REMOVE OR NOT (Installed OR WIX_UPGRADE_DETECTED) OR (EXISTINGINSTALL AND PREVIOUSDATAFOLDER)')) "Damaged overlay or upgrade metadata is not blocked in $resolved"

    $removals = @(Read-MsiRows $database "SELECT Component_ FROM RemoveFile")
    Assert-True (-not ($removals | ForEach-Object { $_[0] } | Where-Object { $_ -eq 'PersistentDataDirectory' })) "Production data component contains removal instructions in $resolved"

    $files = @(Read-MsiRows $database "SELECT FileName FROM File")
    $forbidden = @($files | ForEach-Object { $_[0] } | Where-Object { $_ -match '(?i)(platform\.db|audit-pending|platform\.lock)' })
    if ($forbidden.Count -gt 0) { throw "Production data file is embedded in ${resolved}: $($forbidden[0])" }

    Write-Output "MSI data-preservation checks passed: $resolved"
}
