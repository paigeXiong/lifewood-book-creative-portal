[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LibraryPath,
    [Parameter(Mandatory = $true)][string]$PackagePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-ComMember($Target, [string]$Name, [Reflection.BindingFlags]$Flags, [object[]]$Arguments) {
    return $Target.GetType().InvokeMember($Name, $Flags, $null, $Target, $Arguments)
}

$library = (Resolve-Path -LiteralPath $LibraryPath -ErrorAction Stop).Path.Replace('"', '""')
$package = (Resolve-Path -LiteralPath $PackagePath -ErrorAction Stop).Path
$interop = @"
using System.Runtime.InteropServices;
using System.Text;
public static class InstallerSessionInterop
{
    [DllImport(@"$library", CallingConvention = CallingConvention.Winapi)]
    public static extern uint ValidateDataDirectory(uint sessionHandle);

    [DllImport(@"$library", CallingConvention = CallingConvention.Winapi)]
    public static extern uint NormalizePort(uint sessionHandle);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiOpenPackageW")]
    public static extern uint MsiOpenPackage(string packagePath, out uint sessionHandle);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiSetPropertyW")]
    public static extern uint MsiSetProperty(uint sessionHandle, string name, string value);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiGetPropertyW")]
    private static extern uint MsiGetPropertyNative(uint sessionHandle, string name, StringBuilder value, ref uint length);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiDoActionW")]
    public static extern uint MsiDoAction(uint sessionHandle, string action);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiEvaluateConditionW")]
    public static extern int MsiEvaluateCondition(uint sessionHandle, string condition);

    [DllImport("msi.dll", EntryPoint = "MsiCloseHandle")]
    public static extern uint MsiCloseHandle(uint handle);

    public static string GetProperty(uint sessionHandle, string name)
    {
        uint length = 0;
        var status = MsiGetPropertyNative(sessionHandle, name, null, ref length);
        if (status != 0 && status != 234) throw new System.InvalidOperationException("MsiGetProperty failed: " + status);
        length++;
        var value = new StringBuilder((int)length);
        status = MsiGetPropertyNative(sessionHandle, name, value, ref length);
        if (status != 0) throw new System.InvalidOperationException("MsiGetProperty failed: " + status);
        return value.ToString();
    }
}
"@
Add-Type -TypeDefinition $interop

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("lifewood-installer-session-test-" + [Guid]::NewGuid().ToString('N'))
$sessionHandle = [uint32]0
$registryPath = $null
try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    $dataDirectory = Join-Path $testRoot "production-data"
    New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    $windowsDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
    $programFiles64 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $programFiles32 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $installDirectory = Join-Path $programFiles64 "Lifewood Book Creative Portal"

    $status = [InstallerSessionInterop]::MsiOpenPackage($package, [ref]$sessionHandle)
    if ($status -ne 0) { throw "MsiOpenPackage failed: $status" }

    $customActionData = @(
        $dataDirectory,
        "The production-data directory is unsafe. Choose a dedicated local directory.",
        $installDirectory,
        $windowsDirectory,
        $programFiles64,
        $programFiles32,
        $userProfile
    ) -join "`t"
    $status = [InstallerSessionInterop]::MsiSetProperty($sessionHandle, "CustomActionData", $customActionData)
    if ($status -ne 0) { throw "MsiSetProperty failed: $status" }

    $result = [InstallerSessionInterop]::ValidateDataDirectory($sessionHandle)
    if ($result -ne 0) { throw "ValidateDataDirectory rejected safe CustomActionData with MSI error: $result" }

    $listenCondition = 'LISTENADDRESS = "127.0.0.1" OR LISTENADDRESS = "0.0.0.0"'
    $status = [InstallerSessionInterop]::MsiSetProperty($sessionHandle, "LISTENADDRESS", "example.com")
    if ($status -ne 0) { throw "MsiSetProperty failed for invalid listening address: $status" }
    if ([InstallerSessionInterop]::MsiEvaluateCondition($sessionHandle, $listenCondition) -ne 0) {
        throw "The MSI engine did not reject an unsafe listening address."
    }
    $status = [InstallerSessionInterop]::MsiSetProperty($sessionHandle, "LISTENADDRESS", "0.0.0.0")
    if ($status -ne 0) { throw "MsiSetProperty failed for valid listening address: $status" }
    if ([InstallerSessionInterop]::MsiEvaluateCondition($sessionHandle, $listenCondition) -ne 1) {
        throw "The MSI engine did not accept the all-interface listening address."
    }

    [void][InstallerSessionInterop]::MsiCloseHandle($sessionHandle)
    $sessionHandle = [uint32]0

    # Exercise the real Windows Installer AppSearch path against a legacy REG_DWORD,
    # using an isolated HKCU key and a temporary MSI database copy.
    $testPackage = Join-Path $testRoot "legacy-port-appsearch.msi"
    Copy-Item -LiteralPath $package -Destination $testPackage
    $registryRelativePath = "Software\Lifewood\BookCreativePortal\InstallerTests\" + [Guid]::NewGuid().ToString('N')
    $registryPath = "HKCU:\" + $registryRelativePath
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -Path $registryPath -Name Port -Value 5077 -PropertyType DWord -Force | Out-Null

    $windowsInstaller = New-Object -ComObject WindowsInstaller.Installer
    $openArguments = [object[]]@([string]$testPackage, [int]1)
    $database = Invoke-ComMember -Target $windowsInstaller -Name "OpenDatabase" -Flags ([Reflection.BindingFlags]::InvokeMethod) -Arguments $openArguments
    $escapedKey = $registryRelativePath.Replace("'", "''")
    $queryArguments = [object[]]@("UPDATE ``RegLocator`` SET ``Root``=1, ``Key``='$escapedKey' WHERE ``Signature_``='PreviousPort'")
    $view = Invoke-ComMember -Target $database -Name "OpenView" -Flags ([Reflection.BindingFlags]::InvokeMethod) -Arguments $queryArguments
    Invoke-ComMember $view "Execute" ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
    Invoke-ComMember $view "Close" ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
    Invoke-ComMember $database "Commit" ([Reflection.BindingFlags]::InvokeMethod) @() | Out-Null
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($view)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($database)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($windowsInstaller)

    $status = [InstallerSessionInterop]::MsiOpenPackage($testPackage, [ref]$sessionHandle)
    if ($status -ne 0) { throw "MsiOpenPackage failed for AppSearch test: $status" }
    $status = [InstallerSessionInterop]::MsiDoAction($sessionHandle, "AppSearch")
    if ($status -ne 0) { throw "AppSearch failed: $status" }
    $rawPort = [InstallerSessionInterop]::GetProperty($sessionHandle, "PORT")
    if ($rawPort -ne '#5077') { throw "AppSearch did not reproduce the legacy DWORD port value. Actual: '$rawPort'" }
    $status = [InstallerSessionInterop]::NormalizePort($sessionHandle)
    if ($status -ne 0) { throw "NormalizePort failed: $status" }
    $normalizedPort = [InstallerSessionInterop]::GetProperty($sessionHandle, "PORT")
    if ($normalizedPort -ne '5077') { throw "Legacy DWORD port was not normalized. Actual: '$normalizedPort'" }
    if ([InstallerSessionInterop]::MsiEvaluateCondition($sessionHandle, 'PORT >= 1024 AND PORT <= 65535') -ne 1) {
        throw "The normalized legacy port does not satisfy the MSI launch condition."
    }
    Write-Output "Installer MSI session-property test passed."
}
finally {
    if ($sessionHandle -ne 0) { [void][InstallerSessionInterop]::MsiCloseHandle($sessionHandle) }
    if ($registryPath -and (Test-Path -LiteralPath $registryPath)) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
