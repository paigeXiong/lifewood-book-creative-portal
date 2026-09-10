using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Serialization;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class RestoreHistoryTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"lw-history-"+Guid.NewGuid().ToString("N"));
    public RestoreHistoryTests()=>Directory.CreateDirectory(root);
    private RestoreJournal Job(int minute=0,string status="completed") {
        var now=DateTimeOffset.Parse("2026-09-10T06:00:00Z").AddMinutes(minute);
        return new(new(Guid.NewGuid().ToString("N"),Guid.NewGuid().ToString("N"),status,now.AddSeconds(20)),Path.Combine(root,"data"),root,null,1,"private-executable",["private-argument"],"private-working-directory",now,now.AddDays(-1),"opaque-actor");
    }
    [Fact] public void HistorySurvivesJournalReplacementAndKeepsMinimalMetadata()
    {
        var first=Job();RestoreEngine.Write(first);var second=Job(1,"failed");RestoreEngine.Write(second);
        var result=RestoreHistory.List(root,1,null);Assert.Equal(2,result.Total);Assert.Equal(second.State.Id,result.Items[0].State.Id);Assert.Equal(first.State.Id,result.Items[1].State.Id);
        var saved=File.ReadAllText(Path.Combine(RestoreHistory.DirectoryPath(root),first.State.Id+".json"));Assert.DoesNotContain("private-",saved);Assert.DoesNotContain("dataDirectory",saved);Assert.Contains("opaque-actor",saved);
    }
    [Fact] public void HistoryFiltersAndPaginatesDeterministically()
    {
        for(var i=0;i<25;i++)RestoreEngine.Write(Job(i,i%2==0?"failed":"completed"));
        Assert.Equal(20,RestoreHistory.List(root,1,null).Items.Length);var second=RestoreHistory.List(root,2,null);Assert.Equal(5,second.Items.Length);Assert.Equal(25,second.Total);
        var filtered=RestoreHistory.List(root,1,"failed");Assert.Equal(13,filtered.Total);Assert.All(filtered.Items,x=>Assert.Equal("failed",x.State.Status));Assert.Equal(2,RestoreHistory.List(root,int.MaxValue,null).Page);
    }
    [Fact] public void LegacyJournalIsVisibleWithoutWritingFromReadEndpoint()
    {
        var legacy=Job() with {StartedAt=null,BackupCreatedAt=null,ActorId=null};File.WriteAllText(RestoreEngine.JournalPath(root),JsonSerializer.Serialize(legacy,AppJsonContext.Default.RestoreJournal));
        var result=RestoreHistory.List(root,1,null);Assert.Single(result.Items);Assert.Null(result.Items[0].ActorId);Assert.False(Directory.Exists(RestoreHistory.DirectoryPath(root)));
        RestoreHistory.Save(legacy);RestoreEngine.Write(Job(2));Assert.Equal(2,RestoreHistory.List(root,1,null).Total);
    }
    [Fact] public void BadHistoryCannotInvalidateSuccessfulRestore()
    {
        File.WriteAllText(RestoreHistory.DirectoryPath(root),"blocked history folder");var job=Job();RestoreEngine.Write(job);
        Assert.Equal("completed",RestoreEngine.Read(root)!.State.Status);var result=RestoreHistory.List(root,1,null);Assert.True(result.Incomplete);Assert.Single(result.Items);
    }
    [Fact] public void CorruptRecordIsReportedWhileOtherHistoryRemainsVisible()
    {
        RestoreEngine.Write(Job());File.WriteAllText(Path.Combine(RestoreHistory.DirectoryPath(root),Guid.NewGuid().ToString("N")+".json"),"broken-json");
        var result=RestoreHistory.List(root,1,null);Assert.True(result.Incomplete);Assert.Equal(1,result.Total);
    }
    public void Dispose()=>Directory.Delete(root,true);
}
