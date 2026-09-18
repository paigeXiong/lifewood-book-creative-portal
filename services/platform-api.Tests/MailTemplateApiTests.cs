using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task MailTemplateDraftPreviewAndEditsAreScopedAndAudited()
    {
        await BootstrapOwner();
        var csrf=await GetCsrf(ownerClient);
        async Task<HttpResponseMessage> Send(HttpClient client,HttpMethod method,string path,object input) {
            using var request=new HttpRequestMessage(method,path){Content=JsonContent.Create(input)};
            request.Headers.Add("X-CSRF-TOKEN",await GetCsrf(client));
            return await client.SendAsync(request);
        }
        var input=new SaveMailTemplate("default","Custom subject","First\nSecond",true);
        using var customer=await CreateCustomerClient(csrf);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Post,"/api/admin/mail/templates/notice/preview?locale=en-US",input)).StatusCode);
        var preview=await Send(ownerClient,HttpMethod.Post,"/api/admin/mail/templates/notice/preview?locale=en-US",input);
        Assert.Equal(HttpStatusCode.OK,preview.StatusCode);
        Assert.Contains("First<br>Second",(await preview.Content.ReadFromJsonAsync<MailTemplate>())!.Body.Html);
        var original=(await ownerClient.GetFromJsonAsync<MailTemplate[]>("/api/admin/mail/templates?locale=en-US"))!.Single(t=>t.Kind=="notice");
        Assert.Equal("default",original.Revision);
        Assert.Equal(HttpStatusCode.OK,(await Send(ownerClient,HttpMethod.Put,"/api/admin/mail/templates/notice?locale=en-US",input with {Enabled=false})).StatusCode);
        var updated=(await ownerClient.GetFromJsonAsync<MailTemplate[]>("/api/admin/mail/templates?locale=en-US"))!.Single(t=>t.Kind=="notice");
        Assert.False(updated.Enabled);
        Assert.Equal(HttpStatusCode.OK,(await Send(ownerClient,HttpMethod.Put,"/api/admin/mail/templates/notice?locale=en-US",input with {Revision=updated.Revision,Reset=true})).StatusCode);
        using var audit=System.Text.Json.JsonDocument.Parse(await ownerClient.GetStringAsync("/api/admin/audit-events?page=1&pageSize=100"));
        var items=audit.RootElement.GetProperty("items").EnumerateArray().ToArray();
        Assert.Contains(items,x=>x.GetProperty("actionId").GetString()=="mail.template_update" && x.GetProperty("targetId").GetString()=="notice/en-US");
        Assert.Contains(items,x=>x.GetProperty("actionId").GetString()=="mail.template_reset");
        Assert.DoesNotContain("First",audit.RootElement.GetRawText());
    }
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
