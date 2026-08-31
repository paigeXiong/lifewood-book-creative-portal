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
    Assert-True (-not $service[0][0].Contains('AllowInsecureHttp')) "Service still depends on the obsolete insecure-HTTP compatibility flag in $resolved"

    $serviceAccount = @(Read-MsiRows $database "SELECT StartName FROM ServiceInstall WHERE Name='LifewoodBookCreativePortal'")
    Assert-True ($serviceAccount.Count -eq 1 -and $serviceAccount[0][0] -eq 'NT SERVICE\LifewoodBookCreativePortal') "Service does not run under its dedicated virtual account in $resolved"

    $dataAcl = @(Read-MsiRows $database "SELECT * FROM Wix4SecureObject")
    Assert-True ($dataAcl.Count -eq 1 -and $dataAcl[0][0] -eq 'DATAFOLDER' -and $dataAcl[0][1] -eq 'CreateFolder' -and $dataAcl[0][3] -eq 'NT SERVICE\LifewoodBookCreativePortal' -and $dataAcl[0][5] -eq '-1073676288') "Persistent data ACL does not grant the dedicated service account generic read, generic write, and delete in $resolved"

    $registry = @(Read-MsiRows $database "SELECT Value FROM Registry WHERE Name='DataDirectory' AND Component_='PersistentDataDirectory'")
    Assert-True ($registry.Count -eq 1 -and $registry[0][0] -eq '[DATAFOLDER]') "Persistent data path is not recorded in $resolved"

    $pathLock = @(Read-MsiRows $database "SELECT Target FROM CustomAction WHERE Action='SetDATAFOLDER'")
    Assert-True ($pathLock.Count -eq 1 -and $pathLock[0][0] -eq '[PREVIOUSDATAFOLDER]') "Upgrade data-path lock is missing in $resolved"

    $pathLockSequence = @(Read-MsiRows $database "SELECT Condition, Sequence FROM InstallExecuteSequence WHERE Action='SetDATAFOLDER'")
    Assert-True ($pathLockSequence.Count -eq 1 -and $pathLockSequence[0][0] -eq 'EXISTINGINSTALL AND PREVIOUSDATAFOLDER') "Upgrade data-path lock is not sequenced safely in $resolved"

    $validatorBinary = @(Read-MsiRows $database "SELECT Name FROM Binary WHERE Name='InstallerActions'")
    Assert-True ($validatorBinary.Count -eq 1) "Native data-directory validator is missing in $resolved"
    $validator = @(Read-MsiRows $database "SELECT Type, Source, Target FROM CustomAction WHERE Action='ValidateDataDirectory'")
    Assert-True ($validator.Count -eq 1 -and $validator[0][1] -eq 'InstallerActions' -and $validator[0][2] -eq 'ValidateDataDirectory') "Data-directory validation custom action is missing in $resolved"
    $validatorType = [int]$validator[0][0]
    Assert-True (($validatorType -band 1024) -eq 1024 -and ($validatorType -band 2048) -eq 2048 -and ($validatorType -band 8192) -eq 8192) "Data-directory validator is not elevated, deferred, and target-hidden in $resolved"
    $validatorSequence = @(Read-MsiRows $database "SELECT Condition, Sequence FROM InstallExecuteSequence WHERE Action='ValidateDataDirectory'")
    $validatorDataSequence = @(Read-MsiRows $database "SELECT Condition, Sequence FROM InstallExecuteSequence WHERE Action='SetValidateDataDirectory'")
    $createFoldersSequence = @(Read-MsiRows $database "SELECT Sequence FROM InstallExecuteSequence WHERE Action='CreateFolders'")
    $secureObjectsSequence = @(Read-MsiRows $database "SELECT Sequence FROM InstallExecuteSequence WHERE Action='Wix4SchedSecureObjects_X64'")
    Assert-True ($validatorSequence.Count -eq 1 -and $validatorSequence[0][0] -eq 'NOT REMOVE~="ALL"' -and $validatorDataSequence.Count -eq 1 -and $validatorDataSequence[0][0] -eq 'NOT REMOVE~="ALL"' -and [int]$validatorDataSequence[0][1] -lt [int]$validatorSequence[0][1] -and $createFoldersSequence.Count -eq 1 -and [int]$validatorSequence[0][1] -lt [int]$createFoldersSequence[0][0] -and $secureObjectsSequence.Count -eq 1 -and [int]$validatorSequence[0][1] -lt [int]$secureObjectsSequence[0][0]) "Data-directory validator input or execution is not sequenced before directory creation and ACL changes in $resolved"
    $validatorData = @(Read-MsiRows $database "SELECT Target FROM CustomAction WHERE Action='SetValidateDataDirectory'")
    Assert-True ($validatorData.Count -eq 1 -and $validatorData[0][0].Contains('[DATAFOLDER]') -and $validatorData[0][0].Contains('[INSTALLFOLDER]') -and $validatorData[0][0].Contains('[WindowsFolder]')) "Data-directory validator input is incomplete in $resolved"

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
