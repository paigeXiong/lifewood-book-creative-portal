using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task CustomerDashboardEnforcesAuthenticationIsolationAndCalendarValidation()
    {
        const string path="/api/projects/dashboard?month=2026-02&timeZone=Asia%2FShanghai&day=1";
        using var anonymous=factory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=false});
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(path)).StatusCode);
        await BootstrapOwner();using var customer=await CreateCustomerClient(await GetCsrf(ownerClient));
        var owner=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var user=(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var projects=new ProjectRepository("Data Source="+Path.Combine(root,"platform.db"));
        projects.Create(owner.Id);projects.Create(user.Id);projects.Create(user.Id);
        using var response=await customer.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.True(response.Headers.CacheControl!.NoStore);
        var report=(await response.Content.ReadFromJsonAsync<CustomerDashboardDto>())!;
        Assert.Equal(2,report.Counts.Total);Assert.Equal(2,report.RecentProjects.Length);Assert.Equal(28,report.Days.Length);
        Assert.Equal(1,(await ownerClient.GetFromJsonAsync<CustomerDashboardDto>(path))!.Counts.Total);
        Assert.DoesNotContain(owner.Id,await response.Content.ReadAsStringAsync());
        foreach(var query in new[]{"month=2026-02&timeZone=UTC&day=29","month=invalid&timeZone=UTC","month=2026-02&timeZone=not-a-zone","month=1999-12&timeZone=UTC","month=2026-02&timeZone=UTC&day=0"})
            Assert.Equal(HttpStatusCode.BadRequest,(await customer.GetAsync("/api/projects/dashboard?"+query)).StatusCode);
        using var db=new Microsoft.Data.Sqlite.SqliteConnection("Data Source="+Path.Combine(root,"platform.db"));db.Open();using var cmd=db.CreateCommand();
        cmd.CommandText="UPDATE users SET is_active=0 WHERE id=$id";cmd.Parameters.AddWithValue("$id",user.Id);cmd.ExecuteNonQuery();
        Assert.Equal(HttpStatusCode.Unauthorized,(await customer.GetAsync(path)).StatusCode);
    }
}
