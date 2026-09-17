using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class AdminAnalyticsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-admin-analytics-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly ProjectRepository projects;
    private readonly AdminAnalyticsRepository analytics;
    private readonly CurrentUserDto owner;
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-09-17T12:00:00Z");
    public AdminAnalyticsTests()
    {
        Directory.CreateDirectory(root); connection = "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";
        projects = new(connection); projects.Initialize(); var users = new UserRepository(connection, root); users.Initialize();
        owner = users.CreateOwner("Owner", "owner@analytics.test", "analytics-test-password-2026").User!;
        new AdminRepository(connection).Initialize(); new DeliveryRepository(connection).Initialize();
        new CustomerDashboardRepository(connection).Initialize(); analytics = new(connection); analytics.Initialize();
    }
    private void Sql(string sql, params (string, object)[] parameters)
    { using var db = new SqliteConnection(connection); db.Open(); using var cmd = db.CreateCommand(); cmd.CommandText = sql; foreach(var (key,value) in parameters) cmd.Parameters.AddWithValue(key,value); cmd.ExecuteNonQuery(); }
    private string Submit(DateTimeOffset when)
    {
        var draft = projects.Create(owner.Id); projects.Submit(owner.Id, draft.Id, draft.Version, Guid.NewGuid().ToString(), null);
        Sql("UPDATE customer_first_submissions SET occurred_at=$at WHERE project_id=$id", ("$at", when.ToString("O")), ("$id", draft.Id)); return draft.Id;
    }
    private void Complete(string id, DateTimeOffset when) => Sql("UPDATE projects SET workflow_status='completed',workflow_updated_at=$at WHERE id=$id", ("$at",when.ToString("O")),("$id",id));
    private AdminAnalyticsDto Read(int days = 30, string zone = "UTC") => analytics.Get(days, TimeZoneInfo.FindSystemTimeZoneById(zone), Now);
    [Fact] public void EmptyDataHasNoInventedDurationsAndCompleteDateRange()
    {
        var data = Read(); Assert.Null(data.AverageDays); Assert.Null(data.MedianDays); Assert.Equal(0,data.DurationSamples); Assert.Equal(30,data.Trend.Length);
        Assert.Equal("2026-08-19", data.Trend[0].Date); Assert.All(data.Aging,a=>Assert.Equal(0,a.Count));
        var coverage=data.TrackingStartedAt; analytics.Initialize(); Assert.Equal(coverage,Read().TrackingStartedAt);
    }
    [Fact] public void MeanMedianUseCompletionPeriodAndImmutableFirstCompletion()
    {
        foreach (var duration in new[] { 1, 3, 8, 40 }) Complete(Submit(Now.AddDays(-duration-1)), Now.AddDays(-1));
        var data=Read(7); Assert.Equal(4,data.DurationSamples); Assert.Equal(13,data.AverageDays!.Value,5); Assert.Equal(5.5,data.MedianDays!.Value,5); Assert.Equal(4,data.Completed); Assert.Equal(2,data.Submitted);
        var id=Submit(Now.AddDays(-5)); Complete(id,Now.AddDays(-2));
        Sql("UPDATE projects SET workflow_status='in_production',workflow_updated_at=$at WHERE id=$id",("$id",id),("$at",Now.ToString("O"))); Complete(id,Now);
        data=Read(7); Assert.Equal(5,data.Completed); Assert.Equal(3,data.MedianDays!.Value,5); Assert.Equal(1,data.Trend.Single(d=>d.Date=="2026-09-15").Completed); Assert.Equal(0,data.Trend[^1].Completed);
    }
    [Fact] public void LegacyCompletionsAndInvalidStartsNeverBecomeFakeDurationSamples()
    {
        var legacy=Submit(Now.AddDays(-20)); Complete(legacy,Now.AddDays(-4));
        Sql("DELETE FROM admin_project_completions WHERE project_id=$id",("$id",legacy)); analytics.Initialize();
        Assert.Equal(1,Read().UntrackedCompleted); Assert.Equal(0,Read().Completed);
        Sql("UPDATE projects SET workflow_status='in_production' WHERE id=$id",("$id",legacy)); Complete(legacy,Now);
        var missing=Submit(Now.AddDays(-3)); Sql("DELETE FROM customer_first_submissions WHERE project_id=$id",("$id",missing)); Complete(missing,Now.AddDays(-1));
        var invalid=Submit(Now); Complete(invalid,Now.AddDays(-1));
        var future=Submit(Now.AddDays(-2)); Complete(future,Now.AddDays(1));
        var data=Read(); Assert.Equal(2,data.Completed); Assert.Equal(0,data.DurationSamples); Assert.Null(data.AverageDays); Assert.Equal(1,data.UntrackedCompleted);
    }
    [Fact] public void AgingQueuesExcludeUnsubmittedAndClosedProjects()
    {
        projects.Create(owner.Id);
        foreach(var days in new[]{ 0,7,8,14,15,30,31 }) Submit(Now.AddDays(-days));
        var waiting=Submit(Now.AddDays(-40)); Sql("UPDATE projects SET workflow_status='awaiting_customer',followup_due_at=$at WHERE id=$id",("$id",waiting),("$at",Now.ToString("O")));
        var missing=Submit(Now); Sql("DELETE FROM customer_first_submissions WHERE project_id=$id",("$id",missing));
        var closed=Submit(Now); Sql("UPDATE projects SET workflow_status='closed' WHERE id=$id",("$id",closed));
        Complete(Submit(Now.AddDays(-2)),Now);
        var data=Read(); Assert.Equal(new[]{2,2,2,2,1},data.Aging.Select(a=>a.Count)); Assert.Equal(new[]{9,1,9,1},data.Queues.Select(a=>a.Count));
    }
    [Fact] public void TrendsRespectLocalMidnightAndExcludeFutureEvents()
    {
        Complete(Submit(DateTimeOffset.Parse("2026-09-10T16:00:00Z")),DateTimeOffset.Parse("2026-09-16T16:00:00Z"));
        Complete(Submit(DateTimeOffset.Parse("2026-09-10T15:59:59Z")),Now.AddHours(1));
        var data=Read(7,"Asia/Shanghai"); Assert.Equal(1,data.Submitted); Assert.Equal(1,data.Completed); Assert.Equal(1,data.Trend[0].Submitted); Assert.Equal(1,data.Trend[^1].Completed);
    }
    [Fact] public void ReturnedDraftsRemainInCurrentWorkload()
    {
        var id=Submit(Now.AddDays(-10)); var draft=projects.Get(owner.Id,id)!;
        var admin=new AdminRepository(connection); var before=admin.GetProject(id)!;
        Assert.True(new RevisionStore(connection).Return(id,new(draft.Version,[new("project","Please clarify")],before.WorkflowUpdatedAt),owner));
        Assert.Equal("draft",projects.Get(owner.Id,id)!.Status);
        var data=Read(); Assert.Equal(1,data.Queues.Single(q=>q.Id=="active").Count); Assert.Equal(1,data.Queues.Single(q=>q.Id=="waiting_customer").Count); Assert.Equal(1,data.Aging.Single(a=>a.Id=="fortnight").Count);
    }
    public void Dispose() { SqliteConnection.ClearAllPools(); Directory.Delete(root,true); }
}
