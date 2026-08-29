using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

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
        string message = "The production-data directory is unsafe. Choose a dedicated local directory.";
        try
        {
            var parts = GetProperty(sessionHandle, "CustomActionData").Split('\t');
            if (parts.Length < 7) throw new InvalidOperationException("CustomActionData is incomplete.");
            message = parts[1];
            if (DataDirectoryValidator.IsSafe(parts[0], parts[2], parts[3], parts[4], parts[5], parts[6]))
                return ErrorSuccess;
        }
        catch (Exception exception)
        {
            message += $" ({exception.GetType().Name})";
        }

        ShowError(sessionHandle, message);
        return ErrorInstallFailure;
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
        var value = new StringBuilder(checked((int)length + 1));
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
        string userProfile)
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
                if (Directory.EnumerateFileSystemEntries(fullPath).Any() &&
                    !LooksLikeSqliteDatabase(Path.Combine(fullPath, "platform.db"))) return false;
            }
            catch { return false; }
        }
        return true;
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
