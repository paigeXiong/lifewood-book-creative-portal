using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task MailTemplatePreviewRequiresOwnerAndDoesNotChangeQueue()
    {
        await BootstrapOwner();
        using var anonymous = factory.CreateClient();
        Assert.Contains((await anonymous.GetAsync("/api/admin/mail/templates?locale=en-US")).StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/mail/templates?locale=en-US")).StatusCode);
        var before = await ownerClient.GetStringAsync("/api/admin/mail/status");
        foreach (var locale in new[] { "en-US", "zh-CN" }) {
            var response = await ownerClient.GetAsync("/api/admin/mail/templates?locale=" + locale);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
            var templates = (await response.Content.ReadFromJsonAsync<MailTemplate[]>())!;
            Assert.Equal(4, templates.Length); Assert.All(templates, t => Assert.DoesNotContain("href=", t.Body.Html));
        }
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/admin/mail/templates?locale=invalid")).StatusCode);
        using var oldStatus = System.Text.Json.JsonDocument.Parse(before);
        using var newStatus = System.Text.Json.JsonDocument.Parse(await ownerClient.GetStringAsync("/api/admin/mail/status"));
        Assert.Equal(oldStatus.RootElement.GetProperty("total").GetInt64(), newStatus.RootElement.GetProperty("total").GetInt64());
    }
}
