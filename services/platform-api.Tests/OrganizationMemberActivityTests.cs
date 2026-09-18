using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task MyOrganizationActivitySharesOnlySubmittedTitlesWithScopedPresenceAndPagination()
    {
        await BootstrapOwner(); using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        var member = (await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var owner = (await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        void Seed(string id, string state, string workflow, string title, string? actor = null) => OrganizationSql("""
            INSERT INTO projects(id,owner_id,status,version,project_json,book_json,workflow_status,created_at,updated_at)
            VALUES($id,$owner,$status,1,'{}',$book,$workflow,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')
            """, ("$id", id), ("$owner", actor ?? member.Id), ("$status", state), ("$workflow", workflow), ("$book", JsonSerializer.Serialize(new { title })));
        Seed("never-submitted", "draft", "new", "PRIVATE DRAFT");
        Seed("returned", "draft", "awaiting_customer", "PRIVATE EDIT");
        Seed("production", "submitted", "in_production", "Production title");
        Seed("completed", "submitted", "completed", "Completed title");
        Seed("closed", "submitted", "closed", "Closed title");
        Seed("another-user", "submitted", "new", "OTHER USER PROJECT", owner.Id);
        for (var i = 0; i < 11; i++) Seed("extra" + i, "submitted", "new", "Extra " + i);
        OrganizationSql("""
            INSERT INTO revision_rounds(id,project_id,created_at,reasons,before_snapshot) VALUES('round','returned','2026-09-02','[]','{"book":{"title":"Shared original"},"project":{}}');
            INSERT INTO customer_first_submissions(project_id,occurred_at) VALUES('production','2026-09-01T10:00:00Z');
            """);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        OrganizationSql("""
            UPDATE user_activity SET last_active=$now,last_login=$now-100 WHERE user_id=$id;
            INSERT INTO user_presence(user_id,session_id,tab_id,session_version,visible,last_seen,last_active)
            SELECT id,'test-session','test-tab',session_version,1,$now,$now FROM users WHERE id=$id;
            """, ("$now", now), ("$id", member.Id));
        var url = $"/api/me/organization/members/{member.Id}/activity";
        using var response = await ownerClient.GetAsync(url + "?locale=en-US");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
        var first = (await response.Content.ReadFromJsonAsync<OrganizationMemberActivity>())!;
        Assert.Equal(new OrganizationMemberCounts(15,12,1,1), first.Counts);
        Assert.Equal("online", first.Presence.Status); Assert.Equal("Online", first.PresenceLabel);
        Assert.InRange(first.Calendar.Days.Length, 60, 92);
        Assert.False(first.Calendar.Days.First().Collected);
        Assert.True(first.Calendar.Days.Last().Collected);
        Assert.Equal("Activity calendar", first.Labels["calendar"]);
        Assert.Equal(now, first.Presence.LastActiveAt!.Value.ToUnixTimeSeconds());
        Assert.Equal(10, first.Projects.Length); Assert.Equal(15, first.Total);
        var last = (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url + "?page=999"))!;
        Assert.Equal(2, last.Page); Assert.Equal(5, last.Projects.Length);
        var projects = first.Projects.Concat(last.Projects).ToArray();
        Assert.All(projects, p => Assert.True(p.CanOpen));
        Assert.Equal("Shared original", projects.Single(p => p.Id == "returned").Name);
        Assert.Null(projects.Single(p => p.Id == "returned").SubmittedAt);
        Assert.Equal("2026-09-01T10:00:00Z", projects.Single(p => p.Id == "production").SubmittedAt);
        Assert.DoesNotContain(projects, p => p.Name.Contains("PRIVATE") || p.Name.Contains("OTHER USER"));
        var hidden = (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url + "?search=PRIVATE"))!;
        Assert.Equal(0, hidden.Total); Assert.Equal(15, hidden.Counts.Submitted);
        foreach (var literal in new[] { "%", "_", "!" })
            Assert.Equal(0, (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url + "?search=" + Uri.EscapeDataString(literal)))!.Total);
        var filtered = (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url + "?search=original&locale=zh-CN"))!;
        Assert.Equal("待修改或回复", Assert.Single(filtered.Projects).StatusLabel); Assert.Equal("登录概况", filtered.Labels["activity"]);
        var own = (await customer.GetFromJsonAsync<OrganizationMemberActivity>(url))!;
        Assert.All(own.Projects, p => Assert.True(p.CanOpen));
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/projects/production")).StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        foreach (var hiddenField in new[] { "sessionId", "ipAddress", "email", "phone", "password" }) Assert.DoesNotContain(hiddenField, json);
        OrganizationSql("UPDATE user_presence SET last_seen=$old WHERE user_id=$id", ("$old", now - 180), ("$id", member.Id));
        Assert.Equal("offline", (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url))!.Presence.Status);
        OrganizationSql("UPDATE users SET organization_id=NULL WHERE id=$id", ("$id", member.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task MyOrganizationActivityRequiresCurrentMembershipAndValidFilters()
    {
        await BootstrapOwner(); using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        var member = (await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var url = $"/api/me/organization/members/{member.Id}/activity";
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(url)).StatusCode);
        foreach (var query in new[] { "locale=invalid", "page=0", "search=" + new string('x', 101) }) Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync(url + "?" + query)).StatusCode);
        OrganizationSql("DELETE FROM user_activity WHERE user_id=$id", ("$id", member.Id));
        var empty = (await ownerClient.GetFromJsonAsync<OrganizationMemberActivity>(url))!;
        Assert.Null(empty.Presence.LastLoginAt); Assert.Null(empty.Presence.LastActiveAt); Assert.Equal(0, empty.Total);
        OrganizationSql("UPDATE users SET closed_at='2026-09-17' WHERE id=$id", ("$id", member.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync(url)).StatusCode);
    }
}
