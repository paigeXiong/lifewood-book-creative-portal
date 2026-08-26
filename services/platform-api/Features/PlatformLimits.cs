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
            var used = Directory.EnumerateFiles(dataDirectory, "*", SearchOption.AllDirectories)
                .Where(path => !Path.GetFileName(path).Equals("platform.lock", StringComparison.OrdinalIgnoreCase))
                .Sum(path => new FileInfo(path).Length);
            if (requestedBytes > limits.MaxStoredBytes - used)
            {
                gate.Release();
                return null;
            }
            return new Reservation(gate);
        }
        catch { gate.Release(); throw; }
    }
    private sealed class Reservation(SemaphoreSlim gate) : IAsyncDisposable
    {
        private bool released;
        public ValueTask DisposeAsync() { if (!released) { released = true; gate.Release(); } return ValueTask.CompletedTask; }
    }
}
