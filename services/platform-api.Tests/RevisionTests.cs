using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
using Xunit;
using System.Text.Json.Nodes;
using System.Text.Json;
using Lifewood.PlatformApi.Serialization;
namespace Lifewood.PlatformApi.Tests;
public sealed class RevisionTests : IDisposable {
    readonly string folder=Path.Combine(Path.GetTempPath(),"revision-"+Guid.NewGuid().ToString("N"));
    readonly ProjectRepository projects; readonly RevisionStore store;
    readonly CurrentUserDto admin=new("admin",null,"Administrator",null,null,null,[],[],"en-US",null);
    readonly CurrentUserDto customer=new("customer",null,"Customer",null,null,null,[],[],"en-US",null);
    public RevisionTests(){Directory.CreateDirectory(folder);var cs=$"Data Source={Path.Combine(folder,"test.db")};Pooling=False";projects=new(cs);projects.Initialize();store=new(cs);}
    DateTimeOffset WorkflowTime(string id) {
        using var c=new SqliteConnection($"Data Source={Path.Combine(folder,"test.db")};Pooling=False");c.Open();
        using var cmd=c.CreateCommand();cmd.CommandText="SELECT COALESCE(workflow_updated_at,updated_at) FROM projects WHERE id=$id";cmd.Parameters.AddWithValue("$id",id);
        return DateTimeOffset.Parse((string)cmd.ExecuteScalar()!);
    }
    TaskDraftDto Submitted(){var draft=projects.Create(customer.Id);return projects.Submit(customer.Id,draft.Id,draft.Version,Guid.NewGuid().ToString(),null).Draft!;}
    [Fact] public void ReturnedDeletionChecksOwnerVersionAndStateBeforeRemovingHistory() {
        var task=Submitted();
        Assert.True(store.Return(task.Id,new(task.Version,[new("style","Reason")],WorkflowTime(task.Id)),admin));
        var draft=projects.Get(customer.Id,task.Id)!;
        Assert.Equal(SaveOutcome.NotFound,projects.DeleteDraft("someone-else",task.Id,draft.Version).Outcome);
        Assert.Equal(SaveOutcome.VersionConflict,projects.DeleteDraft(customer.Id,task.Id,task.Version).Outcome);
        Assert.Single(store.View(task.Id,true,"en-US").Rounds);
        var resubmitted=projects.Submit(customer.Id,task.Id,draft.Version,Guid.NewGuid().ToString(),null).Draft!;
        Assert.Equal(SaveOutcome.NotEditable,projects.DeleteDraft(customer.Id,task.Id,resubmitted.Version).Outcome);
        Assert.True(store.Return(task.Id,new(resubmitted.Version,[new("style","Again")],WorkflowTime(task.Id)),admin));
        draft=projects.Get(customer.Id,task.Id)!;
        Assert.Equal(SaveOutcome.Saved,projects.DeleteDraft(customer.Id,task.Id,draft.Version).Outcome);
        Assert.Null(projects.Get(customer.Id,task.Id));
        Assert.Empty(store.View(task.Id,true,"en-US").Rounds);
        Assert.Empty(projects.List(customer.Id,"action_required",null,1,10).Items);
        Assert.Equal(0,projects.GetStats(customer.Id).ActionRequired);
    }
    [Fact] public void AttentionFilterUsesReturnStateOwnershipSearchAndPaging() {
        var first=Submitted(); var second=Submitted();
        var ordinary=projects.Create(customer.Id);
        var other=projects.Create("another-customer");
        other=projects.Submit("another-customer",other.Id,other.Version,Guid.NewGuid().ToString(),null).Draft!;
        foreach(var task in new[]{first,second,other})
            Assert.True(store.Return(task.Id,new(task.Version,[new("style","Please clarify")],WorkflowTime(task.Id)),admin));
        var page1=projects.List(customer.Id,"action_required",null,1,1);
        var page2=projects.List(customer.Id,"action_required",null,2,1);
        Assert.Equal(2,page1.Total); Assert.Single(page1.Items); Assert.Single(page2.Items);
        Assert.NotEqual(page1.Items[0].Id,page2.Items[0].Id);
        Assert.DoesNotContain(page1.Items.Concat(page2.Items),p=>p.Id==ordinary.Id||p.Id==other.Id);
        Assert.Empty(projects.List(customer.Id,"action_required","unmatched",1,10).Items);
        var current=projects.Get(customer.Id,first.Id)!;
        projects.Submit(customer.Id,first.Id,current.Version,Guid.NewGuid().ToString(),null);
        Assert.Equal(second.Id,Assert.Single(projects.List(customer.Id,"action_required",null,1,10).Items).Id);
    }
    [Fact] public void ReturnLocksUnselectedUnitsAndKeepsHistoryAfterReplyOnlySubmission(){
        var task=Submitted();Assert.True(store.Return(task.Id,new(task.Version,[new("style","Please explain the style")],WorkflowTime(task.Id)),admin));
        var draft=projects.Get(customer.Id,task.Id)!;Assert.Equal("draft",draft.Status);
        Assert.Equal(SaveOutcome.NotEditable,projects.Save(customer.Id,task.Id,new(draft.Version,draft.Project,draft.Book with{Title="Not allowed"})).Outcome);
        var round=store.View(task.Id,false,"en-US").Rounds.Single();Assert.Null(round.BeforeSnapshot);
        Assert.True(store.Reply(task.Id,round.Id,new(Guid.NewGuid().ToString(),"style","Please keep the style; it matches the book."),customer,false));
        Assert.False(store.Reply(task.Id,round.Id,new(Guid.NewGuid().ToString(),"voice","Wrong section"),customer,false));
        var submitted=projects.Submit(customer.Id,task.Id,draft.Version,Guid.NewGuid().ToString(),null).Draft!;
        Assert.Equal(task.TaskNumber,submitted.TaskNumber);
        var history=store.View(task.Id,true,"en-US").Rounds.Single();Assert.NotNull(history.SubmittedAt);Assert.NotNull(history.BeforeSnapshot);Assert.NotNull(history.AfterSnapshot);Assert.Equal(2,history.Messages.Length);
        Assert.False(store.Reply(task.Id,round.Id,new(Guid.NewGuid().ToString(),"style","Late message"),customer,false));
        Assert.True(store.Return(task.Id,new(submitted.Version,[new("project","Clarify the title"),new("references","Clarify audience")],WorkflowTime(task.Id)),admin));
        Assert.Single(store.View(task.Id,false,"zh-CN").Rounds);Assert.Equal(2,store.View(task.Id,true,"en-US").Rounds.Length);
    }
    [Fact] public void ReturnRejectsStaleVersionAndInvalidUnits(){var task=Submitted();Assert.False(store.Return(task.Id,new(task.Version-1,[new("style","Reason")],WorkflowTime(task.Id)),admin));Assert.False(store.Return(task.Id,new(task.Version,[new("unknown","Reason")],WorkflowTime(task.Id)),admin));Assert.False(store.Return(task.Id,new(task.Version,[new("style","")],WorkflowTime(task.Id)),admin));}
    [Fact] public void SelectedStyleIsEditableButCharactersAreNot(){var task=Submitted();Assert.True(store.Return(task.Id,new(task.Version,[new("style","Reason")],WorkflowTime(task.Id)),admin));var draft=projects.Get(customer.Id,task.Id)!;var saved=projects.SaveCreative(customer.Id,task.Id,new(draft.Version,draft.Creative with {VisualStyleId="new-style"}));Assert.Equal(SaveOutcome.Saved,saved.Outcome);}
    [Fact] public void LocalizedLabelsHaveMatchingKeys(){var a=store.View("none",true,"en-US");var b=store.View("none",true,"zh-CN");Assert.Equal(a.Labels.Keys.Order(),b.Labels.Keys.Order());Assert.All(a.Units,u=>Assert.NotEqual(u.Label,b.Units.Single(v=>v.Id==u.Id).Label));}
    [Fact] public void UnchangedPreviouslySubmittedUnitsIgnoreNewRequirements() {
        var task=Submitted();
        Assert.True(store.Return(task.Id,new(task.Version,[new("style","Explain style")],WorkflowTime(task.Id)),admin));
        var draft=projects.Get(customer.Id,task.Id)!;
        FieldErrorDto[] errors=[new("book.sourceAssets.new-required","required"),new("creative.visualStyleId","required")];
        Assert.Empty(store.FilterSubmissionErrors(task.Id,draft,errors));
        var changed=draft with {Creative=draft.Creative with {VisualStyleId="new-style"}};
        Assert.Equal("creative.visualStyleId",Assert.Single(store.FilterSubmissionErrors(task.Id,changed,errors)).Field);
    }
    [Fact] public void HistoryRetainsAssetReferenceAfterRemoval() {
        var draft=projects.Create(customer.Id);
        var asset=new ReferenceAssetDto(Guid.NewGuid().ToString("N"),"cover","cover.jpg","image/jpeg",120,"/asset");
        draft=projects.Save(customer.Id,draft.Id,new(draft.Version,draft.Project,draft.Book with {SourceAssets=[asset]})).Draft!;
        var task=projects.Submit(customer.Id,draft.Id,draft.Version,Guid.NewGuid().ToString(),null).Draft!;
        Assert.True(store.Return(task.Id,new(task.Version,[new("project","Replace cover")],WorkflowTime(task.Id)),admin));
        draft=projects.Get(customer.Id,task.Id)!;
        Assert.Equal(SaveOutcome.Saved,projects.RemoveAsset(customer.Id,task.Id,draft.Version,asset.Id).Outcome);
        Assert.Equal(asset,store.HistoryAsset(task.Id,asset.Id));
        Assert.Null(store.HistoryAsset("another-project",asset.Id));
    }
    [Fact] public void ReturnRejectsMissingOrStaleWorkflowTokenWithoutCreatingHistory() {
        var task=Submitted();
        var stale=WorkflowTime(task.Id);
        Assert.False(store.Return(task.Id,new(task.Version,[new("style","Reason")]),admin));
        using(var c=new SqliteConnection($"Data Source={Path.Combine(folder,"test.db")};Pooling=False")) {
            c.Open();using var cmd=c.CreateCommand();
            cmd.CommandText="UPDATE projects SET workflow_status='completed',workflow_updated_at=$now WHERE id=$id";
            cmd.Parameters.AddWithValue("$id",task.Id);cmd.Parameters.AddWithValue("$now",stale.AddSeconds(1).ToString("O"));cmd.ExecuteNonQuery();
        }
        Assert.False(store.Return(task.Id,new(task.Version,[new("style","Reason")],stale),admin));
        Assert.Empty(store.View(task.Id,true,"en-US").Rounds);
        Assert.Equal("submitted",projects.Get(customer.Id,task.Id)!.Status);
        Assert.True(store.Return(task.Id,new(task.Version,[new("style","Reason")],WorkflowTime(task.Id)),admin));
    }

    [Fact] public void EachRevisionSnapshotKeepsItsOwnBilingualConfigurationAcrossResubmissionAndRestart() {
        var now=DateTimeOffset.UtcNow;
        var first=new SubmissionConfigurationSnapshotDto(1,now,
            [new("genres","art","原艺术","Original art",null,null,null,null,false,true,0,now)],[],[]);
        var changed=first with {FormOptions=[first.FormOptions[0] with {LabelZhCn="改名",LabelEnUs="Renamed",Enabled=false}]};
        var draft=projects.Create(customer.Id);
        var submitted=projects.Submit(customer.Id,draft.Id,draft.Version,Guid.NewGuid().ToString(),first).Draft!;
        using(var c=new SqliteConnection($"Data Source={Path.Combine(folder,"test.db")};Pooling=False")) {
            c.Open();using var cmd=c.CreateCommand();
            cmd.CommandText="DROP TRIGGER revision_close; CREATE TRIGGER revision_close AFTER UPDATE OF status ON projects BEGIN SELECT 1; END;";
            cmd.ExecuteNonQuery();
        }
        projects.Initialize();
        Assert.True(store.Return(draft.Id,new(submitted.Version,[new("style","Reason")],WorkflowTime(draft.Id)),admin));
        draft=projects.Get(customer.Id,draft.Id)!;
        submitted=projects.Submit(customer.Id,draft.Id,draft.Version,Guid.NewGuid().ToString(),changed).Draft!;
        var round=Assert.Single(store.View(draft.Id,true,"en-US").Rounds);
        var before=JsonNode.Parse(round.BeforeSnapshot!)!["configuration"]!.Deserialize(AppJsonContext.Default.SubmissionConfigurationSnapshotDto)!;
        var after=JsonNode.Parse(round.AfterSnapshot!)!["configuration"]!.Deserialize(AppJsonContext.Default.SubmissionConfigurationSnapshotDto)!;
        Assert.Equal("原艺术",before.FormOptions[0].LabelZhCn);
        Assert.Equal("Original art",before.FormOptions[0].LabelEnUs);
        Assert.Equal("改名",after.FormOptions[0].LabelZhCn);
        Assert.Equal("Renamed",after.FormOptions[0].LabelEnUs);
        Assert.False(after.FormOptions[0].Enabled);
        projects.Initialize();
        Assert.True(store.Return(draft.Id,new(submitted.Version,[new("voice","Reason")],WorkflowTime(draft.Id)),admin));
        var historical=store.View(draft.Id,true,"en-US").Rounds.Single(r=>r.Id==round.Id);
        Assert.Equal(round.BeforeSnapshot,historical.BeforeSnapshot);
        Assert.Equal(round.AfterSnapshot,historical.AfterSnapshot);
    }

    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(folder,true);}
}
