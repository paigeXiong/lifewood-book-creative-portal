using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class RestoreTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"lw-restore-test-"+Guid.NewGuid().ToString("N"));
    public RestoreTests()=>Directory.CreateDirectory(root);
    private string Data(string name) {var path=Path.Combine(root,name);Directory.CreateDirectory(path);using var c=new SqliteConnection($"Data Source={Path.Combine(path,"platform.db")};Pooling=False");c.Open();using var q=c.CreateCommand();q.CommandText="CREATE TABLE users(id TEXT,role TEXT,is_active INTEGER,session_version INTEGER); INSERT INTO users VALUES('owner','owner',1,3); CREATE TABLE saved_account_sessions(id TEXT); INSERT INTO saved_account_sessions VALUES('old'); CREATE TABLE user_presence(id TEXT); CREATE TABLE presence_session_activity(id TEXT); CREATE TABLE ended_presence_sessions(id TEXT);";q.ExecuteNonQuery();return path;}
    private RestoreJournal Job(string data) {var storage=Path.Combine(root,"backups");Directory.CreateDirectory(storage);return new(new(Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("N"),"restarting",DateTimeOffset.UtcNow),data,storage,null,123,"unused",[],root);}
    [Fact] public async Task ExtractChecksOwnerAndContentAndPreparationRevokesSessions()
    {
        var data=Data("data");File.WriteAllText(Path.Combine(data,"runtime-settings.json"),"current");var original=Data("original");File.WriteAllText(Path.Combine(original,"runtime-settings.json"),"old");File.WriteAllText(Path.Combine(original,"attachment.txt"),"original file");
        var archive=Path.Combine(root,"archive.zip");await BackupArchive.Pack(original,archive,CancellationToken.None);
        var stage=Path.Combine(root,"stage");Directory.CreateDirectory(stage);await RestoreEngine.Extract(archive,stage,"owner",CancellationToken.None);RestoreEngine.PrepareData(stage,data);
        Assert.Equal("current",File.ReadAllText(Path.Combine(stage,"runtime-settings.json")));Assert.Equal("original file",File.ReadAllText(Path.Combine(stage,"attachment.txt")));
        using var c=new SqliteConnection($"Data Source={Path.Combine(stage,"platform.db")};Pooling=False");c.Open();using var q=c.CreateCommand();q.CommandText="SELECT count(*) FROM saved_account_sessions";Assert.Equal(0L,q.ExecuteScalar());q.CommandText="SELECT session_version FROM users";Assert.Equal(4L,q.ExecuteScalar());
        Assert.Equal("ownerMissing",Assert.Throws<RestoreValidationException>(()=>RestoreEngine.ValidateDatabase(stage,"different-owner")).Code);
    }
    [Fact] public void InterruptedSwitchRestoresOriginalDirectory()
    {
        var data=Data("data");var job=Job(data);Directory.CreateDirectory(RestoreEngine.Stage(job));File.WriteAllText(Path.Combine(data,"original"),"keep");File.WriteAllText(Path.Combine(RestoreEngine.Stage(job),"incoming"),"replace");
        RestoreEngine.Switch(job);Assert.True(File.Exists(Path.Combine(data,"incoming")));
        RestoreEngine.Recover(data,job.StorageDirectory,null);
        Assert.Equal("keep",File.ReadAllText(Path.Combine(data,"original")));Assert.False(File.Exists(Path.Combine(data,"incoming")));Assert.Equal("rolledBack",RestoreEngine.Read(job.StorageDirectory)!.State.Status);
    }
    [Fact] public void FailureBetweenDirectoryRenamesRollsBack()
    {
        var data=Data("data");var job=Job(data);RestoreEngine.Status(job,"switching");Directory.Move(data,RestoreEngine.Rollback(job));
        RestoreEngine.Recover(data,job.StorageDirectory,null);Assert.True(File.Exists(Path.Combine(data,"platform.db")));Assert.Equal("rolledBack",RestoreEngine.Read(job.StorageDirectory)!.State.Status);
    }
    [Fact] public void ReadyStartupCommitsWithoutRevertingAndLiveLockPreventsSwitch()
    {
        var data=Data("data");var job=Job(data);Directory.CreateDirectory(RestoreEngine.Stage(job));
        using(var lease=new FileStream(Path.Combine(data,"platform.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None))Assert.Throws<IOException>(()=>RestoreEngine.Switch(job));
        Assert.False(Directory.Exists(RestoreEngine.Rollback(job)));
        RestoreEngine.Switch(job);File.WriteAllText(RestoreEngine.Ready(job),job.State.Id);RestoreEngine.Recover(data,job.StorageDirectory,null);
        Assert.Equal("completed",RestoreEngine.Read(job.StorageDirectory)!.State.Status);Assert.False(Directory.Exists(RestoreEngine.Rollback(job)));
    }
    [Fact] public async Task WindowsUnsafeArchivePathsNeverExtract()
    {
        var data=Data("data");var zip=Path.Combine(root,"archive.zip");await BackupArchive.Pack(data,zip,CancellationToken.None);
        using(var archive=System.IO.Compression.ZipFile.Open(zip,System.IO.Compression.ZipArchiveMode.Update)) {
            var metadata=archive.GetEntry(BackupArchive.ManifestName)!;Lifewood.PlatformApi.Contracts.BackupManifest manifest;using(var input=metadata.Open())manifest=System.Text.Json.JsonSerializer.Deserialize(input,Lifewood.PlatformApi.Serialization.AppJsonContext.Default.BackupManifest)!;metadata.Delete();
            var empty=Convert.ToHexString(System.Security.Cryptography.SHA256.HashData([]));using(var stream=archive.CreateEntry("platform.db:alternate").Open()){};
            using var output=archive.CreateEntry(BackupArchive.ManifestName).Open();System.Text.Json.JsonSerializer.Serialize(output,manifest with {Files=[..manifest.Files,new("platform.db:alternate",0,empty)]},Lifewood.PlatformApi.Serialization.AppJsonContext.Default.BackupManifest);
        }
        var stage=Path.Combine(root,"stage");Directory.CreateDirectory(stage);Assert.Equal("integrity",(await Assert.ThrowsAsync<RestoreValidationException>(()=>RestoreEngine.Extract(zip,stage,"owner",CancellationToken.None))).Code);Assert.Empty(Directory.EnumerateFileSystemEntries(stage));
    }
    [Fact] public void IncompleteManualRecoveryRefusesStartup()
    {
        var data=Data("data");var job=Job(data);RestoreEngine.Status(job,"recoveryRequired","recovery");Assert.Throws<IOException>(()=>RestoreEngine.Recover(data,job.StorageDirectory,null));
    }
    [Fact] public async Task CommitWatcherRetriesUnreadableJournalAndHasDeadline()
    {
        var data=Data("data");var job=Job(data);File.WriteAllText(RestoreEngine.JournalPath(job.StorageDirectory),"incomplete-json");
        var wait=RestoreEngine.WaitForCommit(job.StorageDirectory,job.State.Id,CancellationToken.None,TimeSpan.FromSeconds(2));
        await Task.Delay(150);RestoreEngine.Status(job,"completed");Assert.True(await wait);
        RestoreEngine.Status(job,"starting");Assert.False(await RestoreEngine.WaitForCommit(job.StorageDirectory,job.State.Id,CancellationToken.None,TimeSpan.FromMilliseconds(200)));
    }
    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
