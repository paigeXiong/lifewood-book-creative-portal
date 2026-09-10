using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class BackupTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-backup-test-" + Guid.NewGuid().ToString("N"));
    public BackupTests() => Directory.CreateDirectory(root);
    [Fact] public async Task GateDrainsActiveRequestsAndAlwaysReopens()
    {
        var gate = new BackupGate(); var active = gate.TryEnter(); Assert.NotNull(active);
        var pending = gate.PauseAsync(CancellationToken.None); Assert.False(pending.IsCompleted); Assert.Null(gate.TryEnter());
        active!.Dispose(); using (await pending) { Assert.True(gate.Paused); Assert.Null(gate.TryEnter()); }
        using var reopened = gate.TryEnter(); Assert.NotNull(reopened);
    }
    [Fact] public async Task CancelledDrainDoesNotLeavePlatformPaused()
    {
        var gate = new BackupGate(); using var active = gate.TryEnter(); using var timeout = new CancellationTokenSource();
        var pending = gate.PauseAsync(timeout.Token); timeout.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending); Assert.False(gate.Paused);
    }
    [Fact] public async Task SnapshotIncludesWalChangesAndFilesAndDetectsTampering()
    {
        var data = Path.Combine(root, "data"); var stage = Path.Combine(root, "stage");Directory.CreateDirectory(data);
        using var connection = new SqliteConnection($"Data Source={Path.Combine(data,"platform.db")};Pooling=False");connection.Open();
        using var command = connection.CreateCommand();command.CommandText="PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('committed');";command.ExecuteNonQuery();
        Directory.CreateDirectory(Path.Combine(data,"uploads"));await File.WriteAllTextAsync(Path.Combine(data,"uploads","book [1].txt"),"attached content");
        await File.WriteAllTextAsync(Path.Combine(data,"platform.lock"),"");
        await BackupArchive.Snapshot(data,stage,CancellationToken.None);
        command.CommandText="INSERT INTO sample VALUES('later');";command.ExecuteNonQuery();
        using var copy=new SqliteConnection($"Data Source={Path.Combine(stage,"platform.db")};Pooling=False");copy.Open();using var query=copy.CreateCommand();query.CommandText="SELECT count(*) FROM sample";Assert.Equal(1L,query.ExecuteScalar());copy.Close();
        var zip=Path.Combine(root,"backup.zip");var manifest=await BackupArchive.Pack(stage,zip,CancellationToken.None);Assert.Equal(2,manifest.Files.Length);
        await BackupArchive.Verify(zip,CancellationToken.None);
        using(var archive=System.IO.Compression.ZipFile.Open(zip,System.IO.Compression.ZipArchiveMode.Update)){var entry=archive.GetEntry("uploads/book [1].txt")!;entry.Delete();using var writer=new StreamWriter(archive.CreateEntry("uploads/book [1].txt").Open());writer.Write("damaged");}
        await Assert.ThrowsAsync<BackupIntegrityException>(()=>BackupArchive.Verify(zip,CancellationToken.None));
    }
    [Fact] public void ScheduleUsesConfiguredTimezoneAndSkipsMissedRuns()
    {
        var now=DateTimeOffset.Parse("2026-09-10T19:00:00Z"); // 03:00 in Shanghai
        var policy=new BackupPolicy(true,"daily",2);
        Assert.Equal(DateTimeOffset.Parse("2026-09-11T18:00:00Z"),BackupService.NextRun(policy,now));
        Assert.False(BackupService.Valid(policy with {RetainCount=0}));
        Assert.False(BackupService.Valid(policy with {TimeZoneId="invalid"}));
        Assert.True(BackupService.Valid(policy));
    }
    [Fact] public void RestartCleansInterruptedScratchAndRetentionKeepsManualCopies()
    {
        var data=Path.Combine(root,"data");var storage=Path.Combine(root,"backups");Directory.CreateDirectory(data);Directory.CreateDirectory(storage);
        var connection=$"Data Source={Path.Combine(data,"platform.db")};Pooling=False";
        var audit=new Lifewood.PlatformApi.Persistence.AuditRepository(connection,data);audit.Initialize();
        var interrupted=Guid.NewGuid().ToString("N");var manual=Guid.NewGuid().ToString("N");var old=Guid.NewGuid().ToString("N");var newest=Guid.NewGuid().ToString("N");
        foreach(var item in new[]{new BackupRecord(interrupted,DateTimeOffset.UtcNow,"manual","compressing"),new BackupRecord(manual,DateTimeOffset.UtcNow.AddDays(-90),"manual","completed"),new BackupRecord(old,DateTimeOffset.UtcNow.AddDays(-60),"scheduled","completed"),new BackupRecord(newest,DateTimeOffset.UtcNow,"scheduled","completed")}) {
            File.WriteAllText(Path.Combine(storage,$"backup-{item.Id}.json"),System.Text.Json.JsonSerializer.Serialize(item,Lifewood.PlatformApi.Serialization.AppJsonContext.Default.BackupRecord));
            if(item.Status=="completed")File.WriteAllText(Path.Combine(storage,$"backup-{item.Id}.zip"),"fixture");
        }
        var stage=Path.Combine(storage,$".backup-{interrupted}.stage");Directory.CreateDirectory(stage);File.WriteAllText(Path.Combine(stage,"private"),"fixture");File.WriteAllText(Path.Combine(storage,$"backup-{interrupted}.zip.partial"),"partial");
        using var service=new BackupService(data,storage,new BackupGate(),audit,Microsoft.Extensions.Logging.Abstractions.NullLogger<BackupService>.Instance);
        Assert.False(Directory.Exists(stage));Assert.False(File.Exists(Path.Combine(storage,$"backup-{interrupted}.zip.partial")));
        Assert.Equal("failed",service.List(1,null,null).Items.Single(x=>x.Id==interrupted).Status);
        service.Prune();Assert.True(File.Exists(Path.Combine(storage,$"backup-{manual}.zip")));Assert.True(File.Exists(Path.Combine(storage,$"backup-{newest}.zip")));Assert.False(File.Exists(Path.Combine(storage,$"backup-{old}.zip")));
    }
    public void Dispose() { SqliteConnection.ClearAllPools(); Directory.Delete(root,true); }
}
