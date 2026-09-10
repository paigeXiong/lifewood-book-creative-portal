using Microsoft.Data.Sqlite;
using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Features;

internal sealed class RuntimeMonitor(string connectionString, string directory, long quota) : BackgroundService
{
    private readonly DateTimeOffset startedAt = DateTimeOffset.UtcNow;
    private RuntimeHealthDto? snapshot;
    public RuntimeHealthDto Snapshot => Volatile.Read(ref snapshot) ?? new(startedAt, null, null, null, null, null, null, quota, null, null, false);
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        while (!stoppingToken.IsCancellationRequested)
        {
            Volatile.Write(ref snapshot, Measure(stoppingToken));
            try { await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }
    internal RuntimeHealthDto Measure(CancellationToken token)
    {
        bool? database = null; long? free = null, used = 0, uploads = 0, deliveries = 0, failed = null; bool complete = true;
        try
        {
            using var c = new SqliteConnection(connectionString); c.Open();
            using var q = c.CreateCommand(); q.CommandTimeout = 3; q.CommandText = "SELECT 1"; database = Convert.ToInt32(q.ExecuteScalar()) == 1;
            try { q.CommandText = "SELECT count(*) FROM notification_events WHERE status='failed'"; failed = Convert.ToInt64(q.ExecuteScalar()); }
            catch (SqliteException) { /* A missing event metric does not invalidate successful database connectivity. */ }
        }
        catch (SqliteException) { database = false; }
        try
        {
            var full = Path.GetFullPath(directory);
            var drive = DriveInfo.GetDrives().Where(x=>x.IsReady && (full == x.RootDirectory.FullName.TrimEnd(Path.DirectorySeparatorChar) || full.StartsWith(x.RootDirectory.FullName, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))).OrderByDescending(x=>x.RootDirectory.FullName.Length).FirstOrDefault();
            free = drive?.AvailableFreeSpace;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        try
        {
            var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = false, AttributesToSkip = FileAttributes.ReparsePoint, ReturnSpecialDirectories = false };
            var count = 0;
            foreach (var path in Directory.EnumerateFiles(directory, "*", options))
            {
                token.ThrowIfCancellationRequested();
                if (++count > 100_000) { complete = false; break; }
                if (Path.GetFileName(path) == "platform.lock") continue;
                var size = new FileInfo(path).Length; used += size;
                var first = Path.GetRelativePath(directory, path).Split(Path.DirectorySeparatorChar)[0];
                if (first == "uploads") uploads += size;
                if (first == "deliveries") deliveries += size;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { complete = false; }
        if (!complete) used = uploads = deliveries = null;
        bool? pending = null;
        try { pending = new FileInfo(Path.Combine(directory, "audit-pending.ndjson")) is { Exists: true, Length: >0 }; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        return new(startedAt, DateTimeOffset.UtcNow, database, used, uploads, deliveries, free, quota, failed, pending, complete);
    }
}
