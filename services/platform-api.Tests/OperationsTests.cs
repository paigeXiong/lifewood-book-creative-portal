using System.IO.Compression;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;

public sealed class OperationsTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"lw-operations-"+Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly ProjectRepository projects;
    private readonly AdminRepository admin;
    private readonly OperationsRepository operations;
    private readonly NotificationRepository notifications;
    private readonly string owner;
    public OperationsTests()
    {
        Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";
        projects=new(connection);projects.Initialize();var users=new UserRepository(connection,root);users.Initialize();
        owner=users.CreateOwner("Owner","owner@operations.test","password-12345").User!.Id;
        admin=new(connection);admin.Initialize();new DeliveryRepository(connection).Initialize();
        operations=new(connection);notifications=new(connection);notifications.Initialize();
        Sql("INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,is_active,created_at,updated_at) SELECT 'op','op@test.example','OP@TEST.EXAMPLE','Operator',password_hash,'operator',1,created_at,updated_at FROM users LIMIT 1");
    }
    private void Sql(string text, params (string,object)[] args){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=text;foreach(var (k,v) in args)q.Parameters.AddWithValue(k,v);q.ExecuteNonQuery();}
    private TaskDraftDto Project(string? assignee=null)
    {
        var d=projects.Create(owner);d=projects.Submit(owner,d.Id,d.Version,Guid.NewGuid().ToString(),null).Draft!;
        if(assignee is not null)Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateWorkflow(d.Id,new("contacting","normal",assignee,admin.GetProject(d.Id)!.WorkflowUpdatedAt)).Outcome);
        return d;
    }
    private NotificationPage Feed(string user)=>notifications.List(user,"en-US",null,null,null,null,null,null,null);

    [Fact] public void WorkbenchFiltersBeforeCountingAndPaging()
    {
        var first=Project("op");var second=Project("op");Project();Project(owner);projects.Create(owner);
        var due=DateTimeOffset.Parse("2026-09-09T08:00:00+08:00");
        Assert.Equal(AdminWriteOutcome.Saved,operations.SetFollowup(first.Id,"op",new(due,0)).Outcome);
        var list=operations.Workbench("op","en-US","active",null,false,1,1,due.AddHours(-1));
        Assert.Equal(2,list.Total);Assert.Single(list.Items);Assert.Equal(first.Id,list.Items[0].Id);
        Assert.Equal(1,list.Queues.Single(q=>q.Id=="due_soon").Count);Assert.Equal(0,list.Queues.Single(q=>q.Id=="unassigned").Count);
        Assert.Equal(second.Id,Assert.Single(operations.Workbench("op","en-US","active",null,false,2,1,due.AddHours(-1)).Items).Id);
        Assert.Equal(1,operations.Workbench("op","zh-CN","overdue",null,false,1,20,due).Total);
        Assert.Equal("已逾期",operations.Workbench("op","zh-CN","overdue",null,false,1,20,due).Queues.Single(q=>q.Id=="overdue").Label);
        Assert.Equal(1,operations.Workbench(owner,"en-US","active",null,true,1,20).Total);
        Assert.Equal(0,operations.Workbench("op","en-US","active","not present",false,1,20).Total);
        Assert.Equal(2,operations.Workbench("op","en-US","active","owner@operations.test",false,1,20).Total);
    }
    [Fact] public void DeadlineWritesEnforceScopeVersionAndTerminalState()
    {
        var p=Project("op");var other=Project();var due=DateTimeOffset.UtcNow.AddHours(1);
        Assert.Null(operations.GetFollowup(other.Id,"op"));Assert.Equal(AdminWriteOutcome.NotFound,operations.SetFollowup(other.Id,"op",new(due,0)).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved,operations.SetFollowup(p.Id,"op",new(due,0)).Outcome);
        Assert.Equal(AdminWriteOutcome.Conflict,operations.SetFollowup(p.Id,"op",new(null,0)).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved,operations.SetFollowup(p.Id,"op",new(due.ToOffset(TimeSpan.FromHours(8)),1)).Outcome);
        Assert.Equal(1,operations.GetFollowup(p.Id,"op")!.Version);
        Sql("UPDATE projects SET workflow_status='completed' WHERE id=$id",("$id",p.Id));
        Assert.Equal(AdminWriteOutcome.Invalid,operations.SetFollowup(p.Id,"op",new(due.AddDays(1),1)).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved,operations.SetFollowup(p.Id,"op",new(null,1)).Outcome);
        Assert.Null(operations.GetFollowup(p.Id,"op")!.DueAt);
        Sql("UPDATE projects SET assignee_user_id=NULL WHERE id=$id",("$id",p.Id));
        Assert.Null(operations.GetFollowup(p.Id,"op"));Assert.Equal(AdminWriteOutcome.NotFound,operations.SetFollowup(p.Id,"op",new(null,2)).Outcome);
    }
    [Fact] public void EachReminderStageIsDurableAndOnlyResponsibleStaffReceiveIt()
    {
        var p=Project("op");var now=DateTimeOffset.UtcNow;
        operations.SetFollowup(p.Id,"op",new(now.AddHours(1),0));
        operations.CreateDueReminders(now);new OperationsRepository(connection).CreateDueReminders(now);notifications.Dispatch();
        var due=Assert.Single(Feed("op").Items,n=>n.Kind=="followup_due");
        Assert.Equal("pending",due.State);Assert.DoesNotContain(Feed(owner).Items,n=>n.Kind=="followup_due");
        operations.CreateDueReminders(now.AddHours(2));operations.CreateDueReminders(now.AddHours(3));notifications.Dispatch();
        Assert.Single(Feed("op").Items,n=>n.Kind=="followup_overdue");
        operations.SetFollowup(p.Id,"op",new(null,1));
        Assert.All(Feed("op").Items.Where(n=>n.Kind.StartsWith("followup_")),n=>Assert.Equal("expired",n.State));
        Assert.Null(notifications.Target("op",due.Id,"en-US",true));
    }
    [Fact] public void ReminderLedgerSurvivesNotificationCleanupAndReassignment()
    {
        var p=Project("op");operations.SetFollowup(p.Id,"op",new(DateTimeOffset.UtcNow.AddMinutes(-1),0));
        operations.CreateDueReminders(DateTimeOffset.UtcNow);notifications.Dispatch();
        Sql("DELETE FROM notifications WHERE event_id IN (SELECT id FROM notification_events WHERE kind='followup_overdue'); DELETE FROM notification_targets WHERE event_id IN (SELECT id FROM notification_events WHERE kind='followup_overdue'); DELETE FROM notification_events WHERE kind='followup_overdue'");
        new OperationsRepository(connection).CreateDueReminders(DateTimeOffset.UtcNow);notifications.Dispatch();
        Assert.DoesNotContain(Feed("op").Items,n=>n.Kind=="followup_overdue");
        Sql("UPDATE projects SET assignee_user_id=$owner WHERE id=$id",("$owner",owner),("$id",p.Id));
        operations.CreateDueReminders(DateTimeOffset.UtcNow);notifications.Dispatch();
        Assert.Single(Feed(owner).Items,n=>n.Kind=="followup_overdue");
        Assert.Empty(Feed("op").Items);
        Sql("UPDATE projects SET workflow_status='closed' WHERE id=$id",("$id",p.Id));
        Assert.Equal("expired",Assert.Single(Feed(owner).Items,n=>n.Kind=="followup_overdue").State);
    }
    [Fact] public void DeadlineMigrationIsIdempotentAndReturnsStayVisible()
    {
        var p=Project("op");operations.SetFollowup(p.Id,"op",new(DateTimeOffset.UtcNow.AddHours(1),0));
        projects.Initialize();Assert.Equal(1,operations.GetFollowup(p.Id,"op")!.Version);
        var detail=admin.GetProject(p.Id)!;var user=new UserRepository(connection,root).Get(owner)!;
        Assert.True(new RevisionStore(connection).Return(p.Id,new(p.Version,[new("style","Please revise")],detail.WorkflowUpdatedAt),user));
        Assert.Equal(p.Id,Assert.Single(operations.Workbench("op","en-US","waiting_customer",null,false,1,20).Items).Id);
        Assert.NotNull(operations.GetFollowup(p.Id,"op"));
    }
    [Fact] public void InternalRemindersDisappearAfterStaffBecomesACustomer()
    {
        var p=Project(owner);operations.SetFollowup(p.Id,owner,new(DateTimeOffset.UtcNow.AddMinutes(-1),0));operations.CreateDueReminders(DateTimeOffset.UtcNow);notifications.Dispatch();
        Assert.Single(Feed(owner).Items,n=>n.Kind=="followup_overdue");
        Sql("UPDATE users SET role='customer' WHERE id=$id",("$id",owner));
        Assert.DoesNotContain(Feed(owner).Items,n=>n.Kind.StartsWith("followup_"));
    }
    private AdminProjectDetailDto WithFile(string fileName="cover.png")
    {
        var p=Project();var id=Guid.NewGuid().ToString("N");var asset=new ReferenceAssetDto(id,"book-cover",fileName,"image/png",3,"https://untrusted.invalid/ignore");
        var folder=Path.Combine(root,"uploads",owner,p.Id);Directory.CreateDirectory(folder);File.WriteAllBytes(Path.Combine(folder,id+"_cover.png"),[1,2,3]);
        return admin.GetProject(p.Id)! with {Project=p with {Book=p.Book with {Title="<script>alert(1)</script>",SourceAssets=[asset]}}};
    }
    [Fact] public void ExportFileNamesKeepTheirExtensions(){Assert.EndsWith(".pdf",ProjectExport.SafeName(new string('书',105)+".pdf"));Assert.EndsWith(".mp3",ProjectExport.SafeName(new string('a',105)+".mp3"));}
    [Theory] [InlineData("en-US")] [InlineData("zh-CN")]
    public async Task ExportIsReadableEscapedCompleteAndCleansItsTemporaryFile(string locale)
    {
        var d=WithFile("../../cover.png");d=d with {Notes=[new("note",d.Project.Id,owner,"Owner","private-secret",DateTimeOffset.UtcNow)]};
        var files=ProjectExport.Attachments(root,d);var stream=await ProjectExport.Build(root,d.Project,null,files,locale,CancellationToken.None);var path=stream.Name;
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Read,leaveOpen:true))
        {
            Assert.Equal(3,zip.Entries.Count);Assert.All(zip.Entries,e=>{Assert.DoesNotContain("../",e.FullName);Assert.DoesNotContain('\\',e.FullName);});
            using var reader=new StreamReader(zip.GetEntry("brief.html")!.Open());var html=await reader.ReadToEndAsync();
            Assert.Contains("&lt;script&gt;",html);Assert.DoesNotContain("<script>",html);Assert.DoesNotContain("private-secret",html);
            Assert.Contains(locale=="en-US"?"Project brief":"项目需求说明",html);
            using var raw=new StreamReader(zip.GetEntry("project.json")!.Open());Assert.DoesNotContain("private-secret",await raw.ReadToEndAsync());
        }
        await stream.DisposeAsync();Assert.False(File.Exists(path));
    }
    [Fact] public async Task ExportRejectsMissingPendingOrChangedFilesAndCancellation()
    {
        var d=WithFile();var files=ProjectExport.Attachments(root,d);File.WriteAllText(files[0].Path+".pending","");
        Assert.Throws<InvalidDataException>(()=>ProjectExport.Attachments(root,d));File.Delete(files[0].Path+".pending");
        using var cancel=new CancellationTokenSource();cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>ProjectExport.Build(root,d.Project,null,files,"en-US",cancel.Token));
        Assert.Empty(Directory.GetFiles(Path.Combine(root,"exports")));
        File.Delete(files[0].Path);Assert.Throws<InvalidDataException>(()=>ProjectExport.Attachments(root,d));
    }
    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
