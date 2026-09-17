using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed partial class VoiceSampleApiIntegrationTests
{
    private void OrganizationSql(string sql, params (string, object)[] parameters)
    {
        using var db = new SqliteConnection("Data Source=" + Path.Combine(root, "platform.db"));
        db.Open(); using var command = db.CreateCommand(); command.CommandText = sql;
        foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value);
        command.ExecuteNonQuery();
    }

    [Fact]
    public async Task MyOrganizationScopesSearchPagesAndAvatarsToCurrentMembership()
    {
        await BootstrapOwner();
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        var me = (await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        for (var i = 0; i < 13; i++)
            OrganizationSql("""
                INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,organization_id,created_at,updated_at)
                SELECT $id,$id,$id,$name,'unused','customer',organization_id,created_at,updated_at FROM users WHERE id=$actor
                """, ("$id", "member" + i), ("$name", i == 0 ? "100% Member" : "Member " + i.ToString("D2")), ("$actor", me.Id));
        OrganizationSql("""
            INSERT INTO organizations(id,name,normalized_name,is_active,created_at,updated_at) VALUES('other','Other','OTHER',1,'2026-01-01','2026-01-01');
            INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,organization_id,created_at,updated_at)
            VALUES('outsider','private@other.test','PRIVATE@OTHER.TEST','Outside person','unused','customer','other','2026-01-01','2026-01-01');
            UPDATE users SET closed_at='2026-01-01' WHERE id='member12';
            UPDATE users SET is_active=0 WHERE id='member11';
            """);
        using var response = await customer.GetAsync("/api/me/organization?locale=en-US&organizationId=other");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("email", body); Assert.DoesNotContain("phone", body); Assert.DoesNotContain("Outside person", body);
        var first = (await response.Content.ReadFromJsonAsync<MyOrganizationPage>())!;
        Assert.Equal(14, first.Total); Assert.Equal(14, first.Organization!.MemberCount); Assert.Equal(12, first.Items.Length);
        Assert.Equal("Members", first.Labels.Members); Assert.Contains(first.Items, x => x.IsSelf);
        var last = (await customer.GetFromJsonAsync<MyOrganizationPage>("/api/me/organization?page=999"))!;
        Assert.Equal(2, last.Page); Assert.Equal(2, last.Items.Length);
        Assert.Empty(first.Items.Select(x => x.Id).Intersect(last.Items.Select(x => x.Id)));
        Assert.DoesNotContain(first.Items.Concat(last.Items), x => x.Id == "member12");
        Assert.Contains(first.Items.Concat(last.Items), x => x.Id == "member11" && !x.Active);
        var filtered = (await customer.GetFromJsonAsync<MyOrganizationPage>("/api/me/organization?search=%25&locale=zh-CN"))!;
        Assert.Equal("100% Member", Assert.Single(filtered.Items).DisplayName); Assert.Equal("组织成员", filtered.Labels.Members);
        Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync(first.Items[0].AvatarUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync("/api/me/organization/members/outsider/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync("/api/me/organization/members/member12/avatar")).StatusCode);
        using var profileResponse = await customer.GetAsync("/api/me/organization/members/member0?locale=en-US");
        Assert.Equal(HttpStatusCode.OK, profileResponse.StatusCode); Assert.True(profileResponse.Headers.CacheControl!.NoStore);
        var profile = (await profileResponse.Content.ReadFromJsonAsync<OrganizationMemberProfile>())!;
        Assert.Equal("100% Member", profile.DisplayName); Assert.Equal("Customer member", profile.RoleLabel);
        Assert.Equal(first.Organization.Name, profile.OrganizationName); Assert.Equal("Name", profile.Labels.Name);
        var profileJson = await profileResponse.Content.ReadAsStringAsync();
        foreach (var hidden in new[] { "email", "phone", "password", "active", "session", "permissions" }) Assert.DoesNotContain(hidden, profileJson, StringComparison.OrdinalIgnoreCase);
        var chinese = (await customer.GetFromJsonAsync<OrganizationMemberProfile>("/api/me/organization/members/member0?locale=zh-CN"))!;
        Assert.Equal("姓名", chinese.Labels.Name); Assert.Equal("客户成员", chinese.RoleLabel);
        foreach (var id in new[] { "outsider", "member12", "unknown" })
            Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync($"/api/me/organization/members/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await customer.GetAsync("/api/me/organization/members/member0?locale=unknown")).StatusCode);
        OrganizationSql("UPDATE users SET organization_id='other' WHERE id=$id", ("$id", me.Id));
        var moved = (await customer.GetFromJsonAsync<MyOrganizationPage>("/api/me/organization"))!;
        Assert.Equal("Other", moved.Organization!.Name); Assert.Equal(2, moved.Total);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync("/api/me/organization/members/member0/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync("/api/me/organization/members/member0")).StatusCode);
    }

    [Fact]
    public async Task MyOrganizationHandlesNoMembershipAndRequiresAuthentication()
    {
        await BootstrapOwner(withOrganization: false);
        using var anonymous = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/me/organization")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/me/organization/members/unknown/avatar")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/me/organization/members/unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync("/api/me/organization/members/unknown")).StatusCode);
        var result = (await ownerClient.GetFromJsonAsync<MyOrganizationPage>("/api/me/organization"))!;
        Assert.Null(result.Organization); Assert.Empty(result.Items); Assert.Equal(0, result.Total);
        foreach (var query in new[] { "page=0", "page=-1", "locale=unknown", "search=" + new string('x', 101) })
            Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/me/organization?" + query)).StatusCode);
    }
}
