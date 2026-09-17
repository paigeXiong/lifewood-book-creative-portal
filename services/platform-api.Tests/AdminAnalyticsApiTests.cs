using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task AdminAnalyticsRequiresPermissionAndValidRangeAndTimeZone()
    {
        await BootstrapOwner(); using var anonymous=factory.CreateClient();
        const string url="/api/admin/overview/analytics?days=30&timeZone=Asia%2FShanghai";
        Assert.Contains((await anonymous.GetAsync(url)).StatusCode,new[]{HttpStatusCode.Unauthorized,HttpStatusCode.Forbidden});
        using var customer=await CreateCustomerClient(await GetCsrf(ownerClient)); Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync(url)).StatusCode);
        var response=await ownerClient.GetAsync(url); Assert.Equal(HttpStatusCode.OK,response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
        var report=(await response.Content.ReadFromJsonAsync<AdminAnalyticsDto>())!; Assert.Equal(30,report.Trend.Length); Assert.Null(report.AverageDays);
        foreach(var query in new[]{"days=1&timeZone=UTC","days=30&timeZone=invalid","days=30"}) Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.GetAsync("/api/admin/overview/analytics?"+query)).StatusCode);
    }
}
