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
    public void Dispose()=>Directory.Delete(root,true);
}
