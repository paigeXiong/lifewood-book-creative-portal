using System.Security.Cryptography;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class BackupVerificationTests : IDisposable
{
    readonly string root=Path.Combine(Path.GetTempPath(),"lw-verify-"+Guid.NewGuid().ToString("N"));
    readonly CurrentUserDto actor=new("system",null,"System",null,null,null,[],[],"en-US",null);
    string Data=>Path.Combine(root,"data"); string Store=>Path.Combine(root,"backups");
    public BackupVerificationTests(){Directory.CreateDirectory(Data);Directory.CreateDirectory(Store);}
    BackupService Service(BackupGate gate){var audit=new AuditRepository($"Data Source={Path.Combine(Data,"platform.db")};Pooling=False",Data);audit.Initialize();return new(Data,Store,gate,audit,NullLogger<BackupService>.Instance);}
    async Task<BackupRecord> Fixture(string? state=null){
        var stage=Path.Combine(root,"stage");Directory.CreateDirectory(stage);await File.WriteAllTextAsync(Path.Combine(stage,"platform.db"),"fixture");
        var id=Guid.NewGuid().ToString("N");var zip=Path.Combine(Store,$"backup-{id}.zip");await BackupArchive.Pack(stage,zip,CancellationToken.None);
        var item=new BackupRecord(id,DateTimeOffset.UtcNow,"manual","completed",Sha256:Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(zip))),VerificationStatus:state);
        await File.WriteAllTextAsync(Path.Combine(Store,$"backup-{id}.json"),JsonSerializer.Serialize(item,AppJsonContext.Default.BackupRecord));return item;
    }
    [Theory][InlineData("valid","passed")][InlineData("tampered","damaged")][InlineData("missing","unavailable")][InlineData("cancelled","interrupted")]
    public async Task VerificationPreservesCompletedArchiveAndDoesNotPauseBusiness(string mode,string expected){
        var item=await Fixture();var path=Path.Combine(Store,$"backup-{item.Id}.zip");
        if(mode=="tampered")await File.AppendAllTextAsync(path,"changed");if(mode=="missing")File.Delete(path);
        var gate=new BackupGate();using var service=Service(gate);using var business=gate.TryEnter();Assert.NotNull(business);
        var job=service.QueueVerification(item.Id,actor);Assert.NotNull(job);Assert.False(service.Delete(item.Id));Assert.False(service.ReserveRestore());Assert.Null(service.Queue(actor));Assert.Null(service.QueueVerification(item.Id,actor));
        await service.RunVerification(job!,mode=="cancelled"?new CancellationToken(true):CancellationToken.None);
        var result=Assert.Single(service.List(1,null,null,expected).Items);Assert.Equal("completed",result.Status);Assert.Equal(expected,result.VerificationStatus);Assert.NotNull(result.VerifiedAt);Assert.Null(service.List(1,null,null).Current);Assert.False(gate.Paused);
        Assert.True(service.ReserveRestore());service.ReleaseRestore();
        using var reloaded=Service(new BackupGate());Assert.Equal(expected,Assert.Single(reloaded.List(1,null,null).Items).VerificationStatus);
    }
    [Theory][InlineData("queued")][InlineData("checking")]
    public async Task StartupMarksOnlyTheInterruptedCheck(string status){var item=await Fixture(status);using var service=Service(new BackupGate());var result=Assert.Single(service.List(1,null,null,"interrupted").Items);Assert.Equal("completed",result.Status);Assert.True(File.Exists(Path.Combine(Store,$"backup-{item.Id}.zip")));Assert.Null(service.List(1,null,null).Current);}
    [Fact] public async Task NullManifestFilesAreClassifiedAsDamage(){
        var item=await Fixture();var path=Path.Combine(Store,$"backup-{item.Id}.zip");
        using(var zip=System.IO.Compression.ZipFile.Open(path,System.IO.Compression.ZipArchiveMode.Update)){zip.GetEntry(BackupArchive.ManifestName)!.Delete();using var writer=new StreamWriter(zip.CreateEntry(BackupArchive.ManifestName).Open());writer.Write("{\"format\":1,\"files\":null}");}
        item=item with{Sha256=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path)))};await File.WriteAllTextAsync(Path.Combine(Store,$"backup-{item.Id}.json"),JsonSerializer.Serialize(item,AppJsonContext.Default.BackupRecord));
        using var service=Service(new BackupGate());await service.RunVerification(service.QueueVerification(item.Id,actor)!,CancellationToken.None);Assert.Equal("damaged",Assert.Single(service.List(1,null,null).Items).VerificationStatus);
    }
    [Fact] public async Task FailedResultWriteNeverPublishesPassedAndCanBeRetried(){
        var item=await Fixture();using var service=Service(new BackupGate());Assert.NotNull(service.QueueVerification(item.Id,actor));
        var blocker=Path.Combine(Store,$"backup-{item.Id}.json.tmp");Directory.CreateDirectory(blocker);
        Assert.Equal("recordFailed",service.SaveVerificationOutcome(item.Id,"passed"));
        var failed=Assert.Single(service.List(1,null,null,"recordFailed").Items);Assert.Null(failed.VerifiedAt);Assert.Equal("completed",failed.Status);
        await service.RunVerification(failed,CancellationToken.None);Assert.Null(service.List(1,null,null).Current);
        Directory.Delete(blocker);var retry=service.QueueVerification(item.Id,actor);Assert.NotNull(retry);await service.RunVerification(retry!,CancellationToken.None);
        Assert.Equal("passed",Assert.Single(service.List(1,null,null).Items).VerificationStatus);
        using var reloaded=Service(new BackupGate());Assert.Equal("passed",Assert.Single(reloaded.List(1,null,null).Items).VerificationStatus);
    }
    public void Dispose(){Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
