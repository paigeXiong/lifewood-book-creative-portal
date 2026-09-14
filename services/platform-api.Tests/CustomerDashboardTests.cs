using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class CustomerDashboardTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-dashboard-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly ProjectRepository projects;
    private readonly DeliveryRepository deliveries;
    private readonly CustomerDashboardRepository dashboard;
    private readonly CurrentUserDto owner;
    public CustomerDashboardTests()
    {
        Directory.CreateDirectory(root); connection = "Data Source=" + Path.Combine(root,"platform.db") + ";Pooling=False";
        projects=new(connection);projects.Initialize();var users=new UserRepository(connection,root);users.Initialize();
        owner=users.CreateOwner("Owner","owner@dashboard.test","dashboard-test-password-2026").User!;
        new AdminRepository(connection).Initialize(); deliveries=new(connection);deliveries.Initialize();dashboard=new(connection);dashboard.Initialize();
    }
    private void Sql(string sql,params (string,object)[] parameters)
    {using var db=new SqliteConnection(connection);db.Open();using var cmd=db.CreateCommand();cmd.CommandText=sql;foreach(var (key,value) in parameters)cmd.Parameters.AddWithValue(key,value);cmd.ExecuteNonQuery();}
    private CustomerDashboardDto Read(string? id=null,DateTime? month=null,TimeZoneInfo? zone=null,int? day=null,int page=1)
    {var now=DateTime.UtcNow;return dashboard.Get(id??owner.Id,month??new DateTime(now.Year,now.Month,1),zone??TimeZoneInfo.Utc,day??now.Day,page);}
    private TaskDraftDto Submit(string? id=null)
    {var task=projects.Create(id??owner.Id);return projects.Submit(id??owner.Id,task.Id,task.Version,Guid.NewGuid().ToString(),null).Draft!;}

    [Fact]
    public void ActualSubmissionsAreIdempotentAndOwnershipIsAppliedToEveryResult()
    {
        var draft=projects.Create(owner.Id); var key=Guid.NewGuid().ToString();
        projects.Submit(owner.Id,draft.Id,draft.Version,key,null);projects.Submit(owner.Id,draft.Id,draft.Version,key,null);
        Submit("other-owner");var result=Read();Assert.Equal(1,result.Counts.Total);Assert.Equal(1,result.Days.Sum(d=>d.Submissions));Assert.Single(result.Activities.Items);Assert.Single(result.RecentProjects);
        Sql("UPDATE projects SET owner_id='other-owner' WHERE id=$id",("$id",draft.Id));
        result=Read();Assert.Equal(0,result.Counts.Total);Assert.Empty(result.Statuses);Assert.Empty(result.Activities.Items);Assert.Empty(result.RecentProjects);Assert.All(result.Days,d=>Assert.Equal(0,d.Projects));
    }
    [Fact]
    public void ResubmissionAndRevokedPublicationAreActivityButOnlyActiveFilesAreDownloadable()
    {
        var task=Submit();var admin=new AdminRepository(connection);var current=admin.GetProject(task.Id)!;
        Assert.True(new RevisionStore(connection).Return(task.Id,new(task.Version,[new("project","Please clarify")],current.WorkflowUpdatedAt),owner));
        var returned=projects.Get(owner.Id,task.Id)!;Assert.Equal(1,Read().Counts.ActionRequired);
        projects.Submit(owner.Id,task.Id,returned.Version,Guid.NewGuid().ToString(),null);
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Publish("first",task.Id,owner.Id,"final.mp4","video/mp4",100,null,out _).Outcome);
        Assert.Equal(1,Read().Counts.Downloadable);
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Revoke(task.Id,"first").Outcome);
        var result=Read();Assert.Equal(0,result.Counts.Downloadable);Assert.Equal(0,result.Counts.ActionRequired);
        Assert.Equal(1,result.Days.Sum(d=>d.Submissions));Assert.Equal(1,result.Days.Sum(d=>d.Resubmissions));Assert.Equal(1,result.Days.Sum(d=>d.Deliveries));
        Assert.Equal(1,result.Days.Sum(d=>d.Projects));Assert.Equal(3,result.Activities.Total);
    }
    [Fact]
    public void InitializationNeverBackfillsGuessedFirstSubmissionTimesOrChangesCoverage()
    {
        var task=Submit();Sql("DELETE FROM customer_first_submissions; UPDATE projects SET first_submitted_at='2020-01-01T00:00:00.0000000+00:00'");
        var before=Read().HistoryCompleteFrom;dashboard.Initialize();dashboard.Initialize();
        Assert.Equal(before,Read().HistoryCompleteFrom);Assert.Equal(0,Read().Days.Sum(d=>d.Submissions));Assert.Equal(1,Read().Counts.Total);
    }
    [Fact]
    public void LocalDayBoundsGroupUtcEventsWithoutMonthOrMidnightLeakage()
    {
        var task=Submit();Sql("UPDATE customer_first_submissions SET occurred_at='2026-01-31T16:00:00.0000000+00:00' WHERE project_id=$id",("$id",task.Id));
        var zone=TimeZoneInfo.FindSystemTimeZoneById("Asia/Shanghai");
        var jan=Read(month:new(2026,1,1),zone:zone,day:31);Assert.Equal(0,jan.Days.Sum(d=>d.Submissions));Assert.Empty(jan.Activities.Items);
        var feb=Read(month:new(2026,2,1),zone:zone,day:1);Assert.Equal(1,feb.Days[0].Submissions);Assert.Single(feb.Activities.Items);Assert.Equal(28,feb.Days.Length);
        Assert.Equal(29,Read(month:new(2024,2,1)).Days.Length);
    }
    [Theory]
    [InlineData(2026,3,8,23)]
    [InlineData(2026,11,1,25)]
    public void DstDaysUseActualDayLength(int year,int month,int day,int hours)
    {
        var date=new DateTime(year,month,day);var zone=TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        Assert.Equal(hours,(CustomerDashboardRepository.DayStart(date.AddDays(1),zone)-CustomerDashboardRepository.DayStart(date,zone)).TotalHours);
    }
    [Fact]
    public void DailyActivityHasStableBoundedPagesAndDoesNotCountDraftEdits()
    {
        for(var i=0;i<25;i++)Submit();projects.Create(owner.Id);
        var first=Read(page:1);var second=Read(page:2);var beyond=Read(page:int.MaxValue);
        Assert.Equal(25,first.Activities.Total);Assert.Equal(20,first.Activities.Items.Length);Assert.Equal(5,second.Activities.Items.Length);Assert.Equal(2,beyond.Activities.Page);
        Assert.Empty(first.Activities.Items.Select(e=>e.Id).Intersect(second.Activities.Items.Select(e=>e.Id)));Assert.Equal(5,first.RecentProjects.Length);
        Assert.Equal(first.Counts.Total,first.Statuses.Sum(s=>s.Count));
    }
    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
