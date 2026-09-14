using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class ProjectQueryIndexTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-query-index-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly ProjectRepository projects;
    private readonly AdminRepository admin;
    private readonly CurrentUserDto owner;

    public ProjectQueryIndexTests()
    {
        Directory.CreateDirectory(root);
        connection = "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";
        projects = new(connection); projects.Initialize();
        var users = new UserRepository(connection, root); users.Initialize();
        owner = users.CreateOwner("负责人 Owner", "owner@query-index.test", "query-index-password-2026").User!;
        admin = new(connection); admin.Initialize();
        Sql("INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,is_active,created_at,updated_at) SELECT 'operator','operator@query-index.test','OPERATOR@QUERY-INDEX.TEST','Operator',password_hash,'operator',1,created_at,updated_at FROM users LIMIT 1");
    }
    private void Sql(string sql, params (string, object)[] args)
    {
        using var db = new SqliteConnection(connection); db.Open(); using var command = db.CreateCommand();
        command.CommandText = sql; foreach (var (key, value) in args) command.Parameters.AddWithValue(key, value); command.ExecuteNonQuery();
    }
    private TaskDraftDto Add(string user, string title, string author = "Author", string name = "Campaign")
    {
        var draft = projects.Create(user);
        return projects.Save(user, draft.Id, new(draft.Version, draft.Project with { ProjectName = name }, draft.Book with { Title = title, AuthorName = author })).Draft!;
    }

    [Theory]
    [InlineData("中文")]
    [InlineData("English")]
    public void CustomerSearchKeepsSubstringWildcardOrderingAndUpdateSemantics(string text)
    {
        var first = Add(owner.Id, text + " A needle");
        var second = Add(owner.Id, text + " B", "Needle author");
        var third = Add(owner.Id, text + " C", name: "Campaign needle");
        Add("other-owner", text + " needle");
        Sql("DROP INDEX ix_projects_owner_search"); projects.Initialize(); projects.Initialize();
        var result = projects.List(owner.Id, null, "NEEDLE", 1, 2, "project", "asc");
        Assert.Equal(3, result.Total); Assert.Equal(new[] { first.Id, second.Id }, result.Items.Select(item => item.Id));
        Assert.Equal(third.Id, Assert.Single(projects.List(owner.Id, "draft", "need_e", 2, 2, "project", "asc").Items).Id);
        Assert.Equal(3, projects.List(owner.Id, null, "%", 1, 20).Total);
        Assert.Equal(3, projects.List(owner.Id, null, "  ", 1, 20).Total);
        Assert.Equal(3, projects.List(owner.Id, null, text, 1, 20).Total);
        Assert.Empty(projects.List(owner.Id, "submitted", "needle", 1, 20).Items);
        Assert.Empty(projects.List(owner.Id, null, "' OR 1=1 --", 1, 20).Items);
        Assert.Equal(SaveOutcome.Saved, projects.Save(owner.Id, first.Id, new(first.Version, first.Project, first.Book with { Title = text + " Renamed" })).Outcome);
        Assert.Equal(2, projects.List(owner.Id, null, "needle", 1, 20).Total);
        Assert.Equal(SaveOutcome.Saved, projects.DeleteDraft(owner.Id, second.Id, second.Version).Outcome);
        Assert.Equal(third.Id, Assert.Single(projects.List(owner.Id, null, "needle", 1, 20).Items).Id);
    }

    [Theory]
    [InlineData("中文 needle")]
    [InlineData("English needle")]
    public void AdminIndexPreservesReturnedProjectsPermissionsFiltersAndStablePages(string title)
    {
        TaskDraftDto Submit() { var draft = Add(owner.Id, title); return projects.Submit(owner.Id, draft.Id, draft.Version, Guid.NewGuid().ToString(), null).Draft!; }
        var first = Submit(); var returned = Submit(); var unassigned = Submit(); Add(owner.Id, title);
        foreach (var item in new[] { first, returned })
            Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateWorkflow(item.Id, new("confirmed", "high", "operator", admin.GetProject(item.Id)!.WorkflowUpdatedAt)).Outcome);
        Assert.True(new RevisionStore(connection).Return(returned.Id, new(returned.Version, [new("style", "Clarify")], admin.GetProject(returned.Id)!.WorkflowUpdatedAt), owner));
        Sql("UPDATE projects SET workflow_updated_at='2030-01-01T00:00:00.0000000+00:00'");
        Sql("DROP INDEX ix_projects_admin_list"); admin.Initialize(); admin.Initialize();
        Assert.Equal(3, admin.ListProjects(null, null, "needle", 1, 20, owner.Id).Total);
        Assert.Equal(2, admin.ListProjects(null, "high", title, 1, 20, "operator").Total);
        Assert.Equal(returned.Id, Assert.Single(admin.ListProjects("awaiting_customer", null, title, 1, 20, "operator").Items).Id);
        Assert.Equal(3, admin.ListProjects(null, null, "负责人", 1, 20, owner.Id).Total);
        Assert.Equal(3, admin.ListProjects(null, null, owner.Email, 1, 20, owner.Id).Total);
        Assert.Equal(first.Id, Assert.Single(admin.ListProjects(null, null, first.TaskNumber, 1, 20, owner.Id).Items).Id);
        var expected = new[] { first.Id, returned.Id, unassigned.Id }.OrderBy(id => id, StringComparer.Ordinal).ToArray();
        Assert.Equal(expected, Enumerable.Range(1, 3).Select(page => Assert.Single(admin.ListProjects(null, null, null, page, 1, owner.Id).Items).Id));
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateWorkflow(first.Id, new("confirmed", "high", null, admin.GetProject(first.Id)!.WorkflowUpdatedAt)).Outcome);
        Assert.Equal(returned.Id, Assert.Single(admin.ListProjects(null, null, title, 1, 20, "operator").Items).Id);
        Sql("UPDATE users SET is_active=0 WHERE id='operator'");
        Assert.Empty(admin.ListProjects(null, null, title, 1, 20, "operator").Items);
        Assert.Empty(admin.ListProjects(null, null, title, 1, 20, "missing-user").Items);
    }
    public void Dispose() { SqliteConnection.ClearAllPools(); Directory.Delete(root, true); }
}
