using System.Text.Json;
using System.IO.Compression;
using System.Security.Cryptography;
using Microsoft.Data.Sqlite;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

// All API operations and writing background jobs participate; only explicitly read-only status/streams bypass it.
internal sealed class BackupGate
{
    private readonly object sync = new();
    private int active;
    private bool paused;
    private TaskCompletionSource drained = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public bool Paused { get { lock (sync) return paused; } }
    public IDisposable? TryEnter()
    {
        lock (sync) { if (paused) return null; active++; return new Lease(() => { lock (sync) { if (--active == 0) drained.TrySetResult(); } }); }
    }
    public async Task<IDisposable> PauseAsync(CancellationToken token)
    {
        Task wait;
        lock (sync) { if (paused) throw new InvalidOperationException("Snapshot already active."); paused = true; drained = new(TaskCreationOptions.RunContinuationsAsynchronously); if (active == 0) drained.TrySetResult(); wait = drained.Task; }
        try { await wait.WaitAsync(token); return new Lease(Resume); }
        catch { Resume(); throw; }
    }
    private void Resume() { lock (sync) paused = false; }
    private sealed class Lease(Action release) : IDisposable { private Action? action = release; public void Dispose() => Interlocked.Exchange(ref action, null)?.Invoke(); }
}

internal static class BackupArchive
{
    public const string ManifestName = "lifewood-backup-manifest.json";
    public static void CheckDirectory(string path)
    {
        for (var current = new DirectoryInfo(Path.GetFullPath(path)); current is not null; current = current.Parent)
            if (current.Exists && current.Attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked directories are not supported.");
    }
    public static async Task Snapshot(string data, string stage, CancellationToken token)
    {
        CheckDirectory(data); Directory.CreateDirectory(stage);
        using (var source = new SqliteConnection($"Data Source={Path.Combine(data, "platform.db")};Pooling=False"))
        using (var target = new SqliteConnection($"Data Source={Path.Combine(stage, "platform.db")};Pooling=False"))
        { source.Open(); target.Open(); source.BackupDatabase(target); }
        foreach (var file in Directory.EnumerateFileSystemEntries(data, "*", SearchOption.AllDirectories))
        {
            token.ThrowIfCancellationRequested();
            var attributes = File.GetAttributes(file);
            if (attributes.HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked data cannot be backed up.");
            if (attributes.HasFlag(FileAttributes.Directory)) continue;
            var relative = Path.GetRelativePath(data, file);
            if (relative is "platform.db" or "platform.db-wal" or "platform.db-shm" or "platform.db-journal" or "platform.lock" or ManifestName) continue;
            var destination = Path.Combine(stage, relative); Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            await using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            await using var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true);
            await input.CopyToAsync(output, token);
        }
    }
    public static async Task<BackupManifest> Pack(string stage, string zipPath, CancellationToken token)
    {
        var files = new List<BackupFile>();
        using (var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
        {
            foreach (var file in Directory.EnumerateFiles(stage, "*", SearchOption.AllDirectories).Order())
            {
                token.ThrowIfCancellationRequested();
                var name = Path.GetRelativePath(stage, file).Replace('\\', '/');
                await using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
                var hash = Convert.ToHexString(await SHA256.HashDataAsync(input, token)); input.Position = 0;
                files.Add(new(name, input.Length, hash));
                var entry = zip.CreateEntry(name, CompressionLevel.Fastest);
                await using var output = entry.Open(); await input.CopyToAsync(output, token);
            }
            var manifest = new BackupManifest(1, typeof(BackupArchive).Assembly.GetName().Version?.ToString() ?? "unknown", DateTimeOffset.UtcNow, files.ToArray());
            await using var stream = zip.CreateEntry(ManifestName).Open();
            await JsonSerializer.SerializeAsync(stream, manifest, AppJsonContext.Default.BackupManifest, token);
            return manifest;
        }
    }
    public static async Task Verify(string zipPath, CancellationToken token)
    {
        await using var input=File.OpenRead(zipPath);
        await Verify(input,token);
    }
    internal static async Task Verify(Stream input,CancellationToken token)
    {
        using var zip = new ZipArchive(input,ZipArchiveMode.Read,leaveOpen:true);
        var metadata = zip.GetEntry(ManifestName) ?? throw new BackupIntegrityException("Missing manifest.");
        if (metadata.Length > 32_000_000) throw new BackupIntegrityException("Oversized manifest.");
        using var stream = metadata.Open();
        var manifest = await JsonSerializer.DeserializeAsync(stream, AppJsonContext.Default.BackupManifest, token) ?? throw new BackupIntegrityException("Invalid manifest.");
        if (manifest.Format != 1 || manifest.Files is null || manifest.Files.Length + 1 != zip.Entries.Count || !manifest.Files.Any(f => f is not null && f.Path == "platform.db")) throw new BackupIntegrityException("Invalid file list.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in manifest.Files)
        {
            if (file is null || string.IsNullOrEmpty(file.Path) || !names.Add(file.Path) || file.Path.StartsWith('/') || file.Path.Contains('\\') || file.Path.Split('/').Any(p => p is ".." or "." or "")) throw new BackupIntegrityException("Unsafe manifest path.");
            var entry = zip.GetEntry(file.Path) ?? throw new BackupIntegrityException("Missing file.");
            if (entry.Length != file.Size) throw new BackupIntegrityException("File size mismatch.");
            await using var content = entry.Open();
            if (Convert.ToHexString(await SHA256.HashDataAsync(content, token)) != file.Sha256) throw new BackupIntegrityException("File checksum mismatch.");
        }
    }
}
