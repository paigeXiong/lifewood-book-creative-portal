namespace Lifewood.PlatformApi.Features;

internal sealed record PlatformLimits(int MaxDraftsPerUser, long MaxStoredBytes, int WriteRequestsPerMinute)
{
    public static PlatformLimits FromConfiguration(IConfiguration configuration) => new(
        PositiveInt(configuration["Lifewood:Limits:MaxDraftsPerUser"], 20),
        PositiveLong(configuration["Lifewood:Limits:MaxStoredBytes"], 10_000_000_000),
        PositiveInt(configuration["Lifewood:Limits:WriteRequestsPerMinute"], 60));

    private static int PositiveInt(string? value, int fallback) => int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
    private static long PositiveLong(string? value, long fallback) => long.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
}

internal sealed class StorageQuota(string dataDirectory, PlatformLimits limits)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public async ValueTask<IAsyncDisposable?> TryReserveAsync(long requestedBytes, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            var used = MeasureFiles(Directory.EnumerateFiles(dataDirectory, "*", SearchOption.AllDirectories), cancellationToken);
            if (requestedBytes > limits.MaxStoredBytes - used)
            {
                gate.Release();
                return null;
            }
            return new Reservation(gate);
        }
        catch { gate.Release(); throw; }
    }
    internal static long MeasureFiles(IEnumerable<string> paths, CancellationToken token)
    {
        long used = 0;
        foreach (var path in paths)
        {
            token.ThrowIfCancellationRequested();
            if (Path.GetFileName(path).Equals("platform.lock", StringComparison.OrdinalIgnoreCase)) continue;
            try { used = checked(used + new FileInfo(path).Length); }
            // SQLite journals and staged files may disappear between enumeration and stat.
            // Only a missing file is safe to omit; permissions and other I/O errors still fail closed.
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
        return used;
    }
    private sealed class Reservation(SemaphoreSlim gate) : IAsyncDisposable
    {
        private bool released;
        public ValueTask DisposeAsync() { if (!released) { released = true; gate.Release(); } return ValueTask.CompletedTask; }
    }
}
