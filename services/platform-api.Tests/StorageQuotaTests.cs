using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class StorageQuotaTests : IDisposable
{
    readonly string root=Path.Combine(Path.GetTempPath(),"lw-quota-"+Guid.NewGuid().ToString("N"));
    public StorageQuotaTests()=>Directory.CreateDirectory(root);
    [Fact] public void DisappearingJournalDoesNotFailTheUploadQuotaCheck()
    {
        var stable=Path.Combine(root,"attachment");File.WriteAllBytes(stable,new byte[12]);
        var journal=Path.Combine(root,"platform.db-journal");File.WriteAllBytes(journal,new byte[8]);
        IEnumerable<string> EnumeratedFiles(){yield return stable;File.Delete(journal);yield return journal;}
        Assert.Equal(12,StorageQuota.MeasureFiles(EnumeratedFiles(),CancellationToken.None));
    }
    [Fact] public async Task QuotaStillCountsExistingFilesAndReleasesTheReservation()
    {
        File.WriteAllBytes(Path.Combine(root,"attachment"),new byte[12]);
        var quota=new StorageQuota(root,new(20,20,60));Assert.Null(await quota.TryReserveAsync(9,CancellationToken.None));
        await using(await quota.TryReserveAsync(8,CancellationToken.None)){}
        await using var next=await quota.TryReserveAsync(8,CancellationToken.None);Assert.NotNull(next);
        Assert.ThrowsAny<OperationCanceledException>(()=>StorageQuota.MeasureFiles([Path.Combine(root,"attachment")],new CancellationToken(true)));
    }
    [Fact] public async Task WaitingReservationRechecksUsageAfterTheFirstWriterFinishes()
    {
        await File.WriteAllBytesAsync(Path.Combine(root, "existing"), new byte[8]);
        var quota = new StorageQuota(root, new(20, 10, 60));
        var first = await quota.TryReserveAsync(2, CancellationToken.None);
        Assert.NotNull(first);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var waiting = quota.TryReserveAsync(2, timeout.Token).AsTask();
        try
        {
            Assert.False(waiting.IsCompleted);
            await File.WriteAllBytesAsync(Path.Combine(root, "new-upload"), new byte[2]);
        }
        finally { await first.DisposeAsync(); }
        await using var second = await waiting;
        Assert.Null(second);
        File.Delete(Path.Combine(root, "new-upload"));
        await using var recovered = await quota.TryReserveAsync(2, timeout.Token);
        Assert.NotNull(recovered);
    }
    public void Dispose()=>Directory.Delete(root,true);
}
