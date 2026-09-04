using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class RestoreStartupLockTests
{
    [Fact]
    public void Acquire_CreatesOnlyTheParentAndRemovesTheLockOnRelease()
    {
        var root = Path.Combine(Path.GetTempPath(), "lifewood-startup-lock-" + Guid.NewGuid().ToString("N"));
        var dataDirectory = Path.Combine(root, "data");
        try
        {
            using (var lease = RestoreStartupLock.Acquire(dataDirectory, null, TimeSpan.Zero))
            {
                Assert.True(Directory.Exists(root));
                Assert.False(Directory.Exists(dataDirectory));
                Assert.True(File.Exists(Path.Combine(root, ".lifewood-coordination", ".data.restore.lock")));
            }
            Assert.False(File.Exists(Path.Combine(root, ".lifewood-coordination", ".data.restore.lock")));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }

    [Fact]
    public void Acquire_FailsClosedWhileRestoreOwnsTheLock()
    {
        var root = Path.Combine(Path.GetTempPath(), "lifewood-startup-lock-" + Guid.NewGuid().ToString("N"));
        var coordinationDirectory = Path.Combine(root, "coordination");
        Directory.CreateDirectory(coordinationDirectory);
        var lockPath = Path.Combine(coordinationDirectory, ".data.restore.lock");
        try
        {
            using var restoreLease = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            var exception = Assert.Throws<IOException>(
                () => RestoreStartupLock.Acquire(Path.Combine(root, "data"), coordinationDirectory, TimeSpan.Zero));
            Assert.Contains("数据恢复", exception.Message, StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
