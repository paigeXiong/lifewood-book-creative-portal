using System.Collections.Concurrent;

namespace Lifewood.PlatformApi.Features;

internal sealed class AsyncKeyedLock
{
    private readonly ConcurrentDictionary<string, Entry> entries = new(StringComparer.Ordinal);
    internal int Count => entries.Count;

    public async ValueTask<IAsyncDisposable> AcquireAsync(string key, CancellationToken cancellationToken)
    {
        Entry entry;
        while (true)
        {
            entry = entries.GetOrAdd(key, static _ => new Entry());
            lock (entry.Sync)
            {
                if (entry.Retired) continue;
                entry.ReferenceCount++;
                break;
            }
        }

        try
        {
            await entry.Semaphore.WaitAsync(cancellationToken);
            return new Lease(this, key, entry);
        }
        catch
        {
            ReleaseReference(key, entry, releaseSemaphore: false);
            throw;
        }
    }

    private void ReleaseReference(string key, Entry entry, bool releaseSemaphore)
    {
        if (releaseSemaphore) entry.Semaphore.Release();
        lock (entry.Sync)
        {
            entry.ReferenceCount--;
            if (entry.ReferenceCount != 0) return;
            entry.Retired = true;
            ((ICollection<KeyValuePair<string, Entry>>)entries).Remove(new(key, entry));
            entry.Semaphore.Dispose();
        }
    }

    private sealed class Entry
    {
        public object Sync { get; } = new();
        public SemaphoreSlim Semaphore { get; } = new(1, 1);
        public int ReferenceCount { get; set; }
        public bool Retired { get; set; }
    }

    private sealed class Lease(AsyncKeyedLock owner, string key, Entry entry) : IAsyncDisposable
    {
        private int released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref released, 1) == 0)
                owner.ReleaseReference(key, entry, releaseSemaphore: true);
            return ValueTask.CompletedTask;
        }
    }
}
