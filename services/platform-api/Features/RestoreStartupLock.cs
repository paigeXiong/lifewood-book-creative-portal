using System.Diagnostics;

namespace Lifewood.PlatformApi.Features;

internal sealed class RestoreStartupLock : IDisposable
{
    private readonly string path;
    private FileStream? stream;

    private RestoreStartupLock(string path, FileStream stream)
    {
        this.path = path;
        this.stream = stream;
    }

    public static RestoreStartupLock Acquire(string dataDirectory, string? configuredCoordinationDirectory, TimeSpan timeout)
    {
        var normalizedDataDirectory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataDirectory));
        var parent = Path.GetDirectoryName(normalizedDataDirectory)
            ?? throw new InvalidOperationException("The data directory has no parent. / 数据目录没有父目录。");
        var coordinationDirectory = string.IsNullOrWhiteSpace(configuredCoordinationDirectory)
            ? Path.Combine(parent, ".lifewood-coordination")
            : Path.GetFullPath(configuredCoordinationDirectory);
        Directory.CreateDirectory(coordinationDirectory);
        var lockPath = Path.Combine(coordinationDirectory, $".{Path.GetFileName(normalizedDataDirectory)}.restore.lock");
        var stopwatch = Stopwatch.StartNew();

        while (true)
        {
            try
            {
                return new RestoreStartupLock(
                    lockPath,
                    new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                if (stopwatch.Elapsed >= timeout)
                    throw new IOException("Data restore is still active; server startup was cancelled. / 数据恢复仍在进行，已取消服务启动。", exception);
                Thread.Sleep(250);
            }
        }
    }

    public void Release()
    {
        var activeStream = Interlocked.Exchange(ref stream, null);
        if (activeStream is null) return;
        activeStream.Dispose();
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    public void Dispose() => Release();
}
