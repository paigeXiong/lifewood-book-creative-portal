using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Globalization;
using System.Text;
using Microsoft.Win32.SafeHandles;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Buffers.Binary;

namespace Lifewood.InstallerActions;

public static class InstallerActions
{
    private const uint ErrorSuccess = 0;
    private const uint ErrorMoreData = 234;
    private const uint ErrorInstallFailure = 1603;
    private const uint InstallMessageError = 0x01000000;

    [UnmanagedCallersOnly(EntryPoint = "ValidateDataDirectory", CallConvs = [typeof(CallConvStdcall)])]
    public static uint ValidateDataDirectory(uint sessionHandle)
    {
        string message = "The data or backup directory is unsafe or its service permissions could not be set. Choose dedicated local directories.";
        try
        {
            var parts = GetProperty(sessionHandle, "CustomActionData").Split('\t');
            if (parts.Length < 7) throw new InvalidOperationException("CustomActionData is incomplete.");
            message = parts[1];
            if (DataDirectoryValidator.IsSafe(parts[0], parts[2], parts[3], parts[4], parts[5], parts[6]) &&
                DataDirectoryValidator.IsSafe(BackupDirectoryPath(parts[0]), parts[2], parts[3], parts[4], parts[5], parts[6], backupStorage: true))
                return ErrorSuccess;
        }
        catch (Exception exception)
        {
            message += $" ({exception.GetType().Name})";
        }

        ShowError(sessionHandle, message);
        return ErrorInstallFailure;
    }

    [UnmanagedCallersOnly(EntryPoint = "PrepareBackupDirectory", CallConvs = [typeof(CallConvStdcall)])]
    public static uint PrepareBackupDirectory(uint sessionHandle)
    {
        var message = "The backup directory is unsafe or its service permissions could not be set.";
        try
        {
            var parts = GetProperty(sessionHandle, "CustomActionData").Split('\t');
            if (parts.Length < 7) throw new InvalidOperationException("CustomActionData is incomplete.");
            message = parts[1];
            if (PrepareValidatedBackup(parts[0], parts[2], parts[3], parts[4], parts[5], parts[6])) return ErrorSuccess;
        }
        catch (Exception exception) { message += $" ({exception.GetType().Name})"; }
        ShowError(sessionHandle, message);
        return ErrorInstallFailure;
    }

    private static string BackupDirectoryPath(string dataDirectory) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataDirectory)) + ".backups";

    internal static SecurityIdentifier BackupServiceSid()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        // Windows service SIDs use SHA-1 of the uppercase UTF-16 service name.
        // Derive it before InstallServices, without depending on account lookup.
        var digest = SHA1.HashData(Encoding.Unicode.GetBytes("LIFEWOODBOOKCREATIVEPORTAL"));
        var serviceSid = "S-1-5-80";
        for (var index = 0; index < 5; index++) serviceSid += "-" + BinaryPrimitives.ReadUInt32LittleEndian(digest.AsSpan(index * 4, 4)).ToString(CultureInfo.InvariantCulture);
        return new SecurityIdentifier(serviceSid);
    }

    private static DirectorySecurity BackupPermissions()
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var permissions = new DirectorySecurity();
        permissions.SetOwner(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null));
        permissions.SetAccessRuleProtection(true, false);
        foreach (var identity in new[] {
            BackupServiceSid(),
            new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null)
        }) permissions.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        return permissions;
    }

    private static bool PrepareValidatedBackup(string data, string install, string windows, string program64, string program32, string profile)
    {
        if (!OperatingSystem.IsWindows()) return false;
        if (!DataDirectoryValidator.IsSafe(data, install, windows, program64, program32, profile)) return false;
        var backup = BackupDirectoryPath(data);
        if (!DataDirectoryValidator.IsSafe(backup, install, windows, program64, program32, profile, backupStorage: true)) return false;
        var permissions = BackupPermissions();
        using var guards = new StoragePathGuards(backup, permissions);
        // Recheck while every path component is held against rename/delete. Existing archive
        // trees with foreign owners or ACEs are refused, not recursively rewritten by SYSTEM.
        if (!DataDirectoryValidator.IsSafe(data, install, windows, program64, program32, profile) ||
            !DataDirectoryValidator.IsSafe(backup, install, windows, program64, program32, profile, backupStorage: true)) return false;
        FileSystemAclExtensions.SetAccessControl(new DirectoryInfo(backup), permissions);
        return true;
    }

    private sealed class StoragePathGuards : IDisposable
    {
        private readonly List<SafeFileHandle> handles = [];
        public StoragePathGuards(string target, DirectorySecurity permissions)
        {
            try
            {
                var root = Path.GetPathRoot(target)!;
                var paths = new List<string> { root };
                var current = root;
                foreach (var part in Path.GetRelativePath(root, target).Split(Path.DirectorySeparatorChar))
                {
                    current = Path.Combine(current, part);
                    paths.Add(current);
                }
                foreach (var path in paths)
                {
                    if (!Directory.Exists(path)) CreatePrivateDirectory(path, permissions);
                    // OPEN_REPARSE_POINT inspects the link itself. Omitting FILE_SHARE_DELETE
                    // prevents replacement of this component while descendant paths are used.
                    var handle = OpenStorageDirectory(path, 0x00020080, 3, nint.Zero, 3, 0x02200000, nint.Zero);
                    if (handle.IsInvalid) { handle.Dispose(); throw new IOException("Cannot lock the backup path."); }
                    handles.Add(handle);
                    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Backup path contains a reparse point.");
                }
            }
            catch { Dispose(); throw; }
        }
        public void Dispose() { for (var index = handles.Count - 1; index >= 0; index--) handles[index].Dispose(); handles.Clear(); }
    }

    private static void CreatePrivateDirectory(string path, DirectorySecurity permissions)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        var bytes = permissions.GetSecurityDescriptorBinaryForm();
        var pointer = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var attributes = new SecurityAttributes { Length = Marshal.SizeOf<SecurityAttributes>(), Descriptor = pointer };
            // CreateDirectoryW applies the descriptor atomically and never changes an existing
            // directory's ACL. A raced existing directory is opened and checked before any write.
            if (!CreateStorageDirectory(path, ref attributes) && Marshal.GetLastWin32Error() != 183)
                throw new IOException("Cannot create the private backup directory.");
        }
        finally { Marshal.FreeHGlobal(pointer); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes { public int Length; public nint Descriptor; public int InheritHandle; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateDirectoryW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateStorageDirectory(string path, ref SecurityAttributes attributes);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    private static extern SafeFileHandle OpenStorageDirectory(string path, uint access, uint share, nint security, uint creation, uint flags, nint template);

    // Build-time fixture: validate both paths before exercising real permissions.
    [UnmanagedCallersOnly(EntryPoint = "PrepareBackupDirectoryPath", CallConvs = [typeof(CallConvStdcall)])]
    public static int PrepareBackupDirectoryPath(nint dataDirectory, nint installDirectory, nint windowsDirectory,
        nint programFiles64, nint programFiles32, nint userProfile)
    {
        try
        {
            var data = Marshal.PtrToStringUni(dataDirectory) ?? "";
            var install = Marshal.PtrToStringUni(installDirectory) ?? "";
            var windows = Marshal.PtrToStringUni(windowsDirectory) ?? "";
            var program64 = Marshal.PtrToStringUni(programFiles64) ?? "";
            var program32 = Marshal.PtrToStringUni(programFiles32) ?? "";
            var profile = Marshal.PtrToStringUni(userProfile) ?? "";
            return PrepareValidatedBackup(data, install, windows, program64, program32, profile) ? 1 : 0;
        }
        catch { return 0; }
    }

    [UnmanagedCallersOnly(EntryPoint = "NormalizePort", CallConvs = [typeof(CallConvStdcall)])]
    public static uint NormalizePort(uint sessionHandle)
    {
        try
        {
            var value = GetProperty(sessionHandle, "PORT");
            if (!TryNormalizeRegistryInteger(value, out var normalized)) return ErrorSuccess;
            return MsiSetProperty(sessionHandle, "PORT", normalized);
        }
        catch
        {
            return ErrorInstallFailure;
        }
    }

    internal static bool TryNormalizeRegistryInteger(string value, out string normalized)
    {
        normalized = value;
        if (value.Length < 2 || value[0] != '#') return false;

        var number = value.AsSpan(1);
        if (number.Length > 0 && number[0] == '+') number = number[1..];
        if (!int.TryParse(number, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var parsed)) return false;
        normalized = parsed.ToString(CultureInfo.InvariantCulture);
        return true;
    }

    // Exported only for the build-time smoke test. MSI invokes ValidateDataDirectory above.
    [UnmanagedCallersOnly(EntryPoint = "ValidateDataDirectoryPath", CallConvs = [typeof(CallConvStdcall)])]
    public static int ValidateDataDirectoryPath(
        nint dataDirectory,
        nint installDirectory,
        nint windowsDirectory,
        nint programFiles64,
        nint programFiles32,
        nint userProfile)
    {
        try
        {
            return DataDirectoryValidator.IsSafe(
                Marshal.PtrToStringUni(dataDirectory) ?? "",
                Marshal.PtrToStringUni(installDirectory) ?? "",
                Marshal.PtrToStringUni(windowsDirectory) ?? "",
                Marshal.PtrToStringUni(programFiles64) ?? "",
                Marshal.PtrToStringUni(programFiles32) ?? "",
                Marshal.PtrToStringUni(userProfile) ?? "") ? 1 : 0;
        }
        catch
        {
            return 0;
        }
    }

    private static string GetProperty(uint sessionHandle, string name)
    {
        uint length = 0;
        var status = MsiGetProperty(sessionHandle, name, null, ref length);
        if (status != ErrorMoreData && status != ErrorSuccess) throw new InvalidOperationException($"MsiGetProperty failed: {status}");
        length = checked(length + 1);
        var value = new StringBuilder(checked((int)length));
        status = MsiGetProperty(sessionHandle, name, value, ref length);
        if (status != ErrorSuccess) throw new InvalidOperationException($"MsiGetProperty failed: {status}");
        return value.ToString();
    }

    private static void ShowError(uint sessionHandle, string message)
    {
        var record = MsiCreateRecord(0);
        if (record == 0) return;
        try
        {
            if (MsiRecordSetString(record, 0, message) == ErrorSuccess)
                _ = MsiProcessMessage(sessionHandle, InstallMessageError, record);
        }
        finally
        {
            _ = MsiCloseHandle(record);
        }
    }

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiGetPropertyW")]
    private static extern uint MsiGetProperty(uint install, string name, StringBuilder? value, ref uint valueLength);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiSetPropertyW")]
    private static extern uint MsiSetProperty(uint install, string name, string value);

    [DllImport("msi.dll", EntryPoint = "MsiCreateRecord")]
    private static extern uint MsiCreateRecord(uint parameterCount);

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiRecordSetStringW")]
    private static extern uint MsiRecordSetString(uint record, uint field, string value);

    [DllImport("msi.dll", EntryPoint = "MsiProcessMessage")]
    private static extern int MsiProcessMessage(uint install, uint messageType, uint record);

    [DllImport("msi.dll", EntryPoint = "MsiCloseHandle")]
    private static extern uint MsiCloseHandle(uint handle);
}

internal static class DataDirectoryValidator
{
    public static bool IsSafe(
        string candidate,
        string installDirectory,
        string windowsDirectory,
        string programFiles64,
        string programFiles32,
        string userProfile,
        bool backupStorage = false)
    {
        if (string.IsNullOrWhiteSpace(candidate) || candidate.IndexOfAny(Path.GetInvalidPathChars()) >= 0 || candidate.Any(character => character < ' ')) return false;
        if (!Path.IsPathFullyQualified(candidate)) return false;
        var rawSegments = candidate.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (rawSegments.Any(IsAmbiguousWindowsSegment)) return false;
        if (candidate.StartsWith("\\\\", StringComparison.Ordinal) ||
            candidate.StartsWith("\\\\?\\", StringComparison.Ordinal) ||
            candidate.StartsWith("\\\\.\\", StringComparison.Ordinal)) return false;
        if (candidate.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Any(segment => segment.EndsWith(' ') || segment.EndsWith('.'))) return false;

        string fullPath;
        try { fullPath = Path.GetFullPath(candidate); }
        catch { return false; }
        if (!Path.IsPathFullyQualified(fullPath)) return false;
        if (fullPath.Length > 2 && fullPath.AsSpan(2).Contains(':')) return false;
        var root = Path.GetPathRoot(fullPath);
        if (string.IsNullOrWhiteSpace(root) || Trim(fullPath).Equals(Trim(root), StringComparison.OrdinalIgnoreCase)) return false;
        try { if (new DriveInfo(root!).DriveType == DriveType.Network) return false; }
        catch { return false; }
        if (File.Exists(fullPath)) return false;
        if (HasReparseAncestor(fullPath)) return false;
        if (!TryCanonicalize(fullPath, out var canonicalPath)) return false;
        var canonicalRoot = Path.GetPathRoot(canonicalPath);
        if (string.IsNullOrWhiteSpace(canonicalRoot) || !Trim(root!).Equals(Trim(canonicalRoot), StringComparison.OrdinalIgnoreCase)) return false;
        var profilesRoot = string.IsNullOrWhiteSpace(userProfile) ? null : Path.GetDirectoryName(Trim(userProfile));
        if (WithinCanonical(canonicalPath, installDirectory) || WithinCanonical(canonicalPath, windowsDirectory) ||
            WithinCanonical(canonicalPath, programFiles64) || WithinCanonical(canonicalPath, programFiles32) ||
            SameCanonicalPath(canonicalPath, userProfile) || SameCanonicalPath(canonicalPath, profilesRoot ?? "")) return false;
        if (Directory.Exists(fullPath))
        {
            try
            {
                if (backupStorage)
                {
                    if (Directory.EnumerateFileSystemEntries(fullPath).Any(path =>
                        !Path.GetFileName(path).StartsWith("backup-", StringComparison.Ordinal) &&
                        !Path.GetFileName(path).StartsWith(".backup-", StringComparison.Ordinal))) return false;
                    if (HasReparseDescendant(fullPath) || !HasPrivateBackupPermissions(fullPath)) return false;
                }
                else if (Directory.EnumerateFileSystemEntries(fullPath).Any() &&
                    !LooksLikeSqliteDatabase(Path.Combine(fullPath, "platform.db"))) return false;
            }
            catch { return false; }
        }
        return true;
    }

    private static bool HasPrivateBackupPermissions(string path)
    {
        if (!OperatingSystem.IsWindows()) return false;
        // Do not inherit or rewrite an unrelated owner's archive tree during elevation.
        // Existing platform-created archives already have these three private identities.
        var allowed = new HashSet<string>(StringComparer.Ordinal) {
            InstallerActions.BackupServiceSid().Value, "S-1-5-18", "S-1-5-32-544"
        };
        var pending = new Stack<string>();
        pending.Push(path);
        while (pending.TryPop(out var entry))
        {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) return false;
            var directory = (attributes & FileAttributes.Directory) != 0;
            FileSystemSecurity security = directory
                ? FileSystemAclExtensions.GetAccessControl(new DirectoryInfo(entry))
                : FileSystemAclExtensions.GetAccessControl(new FileInfo(entry));
            if (security.GetOwner(typeof(SecurityIdentifier)) is not {} owner || !allowed.Contains(owner.Value)) return false;
            var rights = new Dictionary<string, FileSystemRights>();
            foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier)))
            {
                var identity = rule.IdentityReference.Value;
                if (rule.AccessControlType != AccessControlType.Allow || !allowed.Contains(identity)) return false;
                if ((rule.PropagationFlags & PropagationFlags.InheritOnly) != 0) continue;
                rights[identity] = rights.GetValueOrDefault(identity) | rule.FileSystemRights;
            }
            foreach (var identity in allowed) if ((rights.GetValueOrDefault(identity) & FileSystemRights.FullControl) != FileSystemRights.FullControl) return false;
            if (directory) foreach (var child in Directory.EnumerateFileSystemEntries(entry)) pending.Push(child);
        }
        return true;
    }

    private static bool HasReparseDescendant(string path)
    {
        foreach (var entry in Directory.EnumerateFileSystemEntries(path))
        {
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) return true;
            if ((attributes & FileAttributes.Directory) != 0 && HasReparseDescendant(entry)) return true;
        }
        return false;
    }

    private static bool IsAmbiguousWindowsSegment(string segment)
    {
        if (string.IsNullOrEmpty(segment) || (segment.Length == 2 && segment[1] == ':')) return false;
        if (segment.IndexOfAny(['"', '<', '>', '|', '*', '?']) >= 0) return true;
        var baseName = segment.Split('.')[0].TrimEnd(' ', '.').ToUpperInvariant();
        return baseName is "CON" or "PRN" or "AUX" or "NUL" ||
               (baseName.Length == 4 && (baseName.StartsWith("COM", StringComparison.Ordinal) || baseName.StartsWith("LPT", StringComparison.Ordinal)) && baseName[3] is >= '1' and <= '9');
    }

    private static bool LooksLikeSqliteDatabase(string path)
    {
        if (!File.Exists(path)) return false;
        try
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return false;
            Span<byte> header = stackalloc byte[16];
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return stream.Read(header) == header.Length && header.SequenceEqual("SQLite format 3\0"u8);
        }
        catch { return false; }
    }

    private static bool HasReparseAncestor(string path)
    {
        string? current = path;
        while (!string.IsNullOrWhiteSpace(current))
        {
            if (Directory.Exists(current) || File.Exists(current))
            {
                try
                {
                    if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) return true;
                }
                catch { return true; }
            }
            var parent = Path.GetDirectoryName(current);
            if (string.Equals(parent, current, StringComparison.OrdinalIgnoreCase)) break;
            current = parent;
        }
        return false;
    }

    private static bool TryCanonicalize(string path, out string canonical)
    {
        canonical = "";
        string fullPath;
        try { fullPath = Path.GetFullPath(path); }
        catch { return false; }
        var existing = fullPath;
        while (!Directory.Exists(existing))
        {
            if (File.Exists(existing)) return false;
            var parent = Path.GetDirectoryName(existing);
            if (string.IsNullOrWhiteSpace(parent) || parent.Equals(existing, StringComparison.OrdinalIgnoreCase)) return false;
            existing = parent;
        }

        using var handle = CreateFile(existing, 0, 7, nint.Zero, 3, 0x02000000, nint.Zero);
        if (handle.IsInvalid) return false;
        var resolved = new StringBuilder(32_768);
        var length = GetFinalPathNameByHandle(handle, resolved, (uint)resolved.Capacity, 0);
        if (length == 0 || length >= resolved.Capacity) return false;
        var basePath = NormalizeFinalPath(resolved.ToString());
        if (basePath is null) return false;
        var suffix = Path.GetRelativePath(existing, fullPath);
        try { canonical = suffix == "." ? Path.GetFullPath(basePath) : Path.GetFullPath(Path.Combine(basePath, suffix)); }
        catch { return false; }
        return true;
    }

    private static string? NormalizeFinalPath(string value)
    {
        if (value.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase)) return "\\\\" + value[8..];
        if (value.StartsWith("\\\\?\\", StringComparison.OrdinalIgnoreCase)) return value[4..];
        return value.StartsWith("\\\\.\\", StringComparison.OrdinalIgnoreCase) ? null : value;
    }

    private static bool WithinCanonical(string candidate, string protectedRoot)
    {
        if (string.IsNullOrWhiteSpace(protectedRoot)) return false;
        if (!TryCanonicalize(protectedRoot, out var canonicalRoot)) return true;
        var normalizedRoot = Trim(canonicalRoot);
        var normalizedCandidate = Trim(candidate);
        return normalizedCandidate.Equals(normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
               normalizedCandidate.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static bool SameCanonicalPath(string candidate, string protectedPath)
    {
        if (string.IsNullOrWhiteSpace(protectedPath)) return false;
        return !TryCanonicalize(protectedPath, out var canonicalProtected) ||
               Trim(candidate).Equals(Trim(canonicalProtected), StringComparison.OrdinalIgnoreCase);
    }

    private static string Trim(string value) => value.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateFileW")]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        nint securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        nint templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "GetFinalPathNameByHandleW")]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint pathLength, uint flags);
}
