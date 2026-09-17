using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using Microsoft.Extensions.DependencyInjection;
using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task AiProxyAuthenticationFailureIsLocalizedWithoutLeakingCredentials()
    {
        await BootstrapOwner();
        var ai = factory.Services.GetRequiredService<BookRecognitionSettingsStore>();
        Assert.True(ai.Upsert(new(null, "Proxy test", "openai", "https://example.invalid/completions", "test", "never-send-business-secret")));
        var provider = ai.Get("en-US").Providers.Single(p => p.Name == "Proxy test");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var server = Task.Run(async () => {
            using var accepted = await listener.AcceptTcpClientAsync(timeout.Token); using var stream = accepted.GetStream();
            var bytes = new List<byte>(); var one = new byte[1];
            while (!Encoding.ASCII.GetString(bytes.ToArray()).EndsWith("\r\n\r\n")) { Assert.Equal(1, await stream.ReadAsync(one, timeout.Token)); bytes.Add(one[0]); }
            await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), timeout.Token);
            return Encoding.ASCII.GetString(bytes.ToArray());
        });
        var store = factory.Services.GetRequiredService<OutboundProxyStore>();
        var current = (await ownerClient.GetFromJsonAsync<ProxySettingsDto>("/api/admin/outbound-proxy"))!;
        Assert.Null(store.Save(new(current.Revision, "ai:" + provider.Id, "custom", $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}", "", ""), current.Scopes.Select(p => p.Id).ToHashSet()));
        var updated = (await ownerClient.GetFromJsonAsync<ProxySettingsDto>("/api/admin/outbound-proxy"))!;
        var response = await Send(ownerClient, HttpMethod.Post, "/api/admin/outbound-proxy/test", await GetCsrf(ownerClient), JsonContent.Create(new ProxyTestRequest(updated.Revision, "ai:" + provider.Id)));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("outboundProxy.errors.authentication", await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain("never-send-business-secret", await server);
    }
    [Theory]
    [InlineData("en-US", "Global default")]
    [InlineData("zh-CN", "全局默认")]
    public async Task ProxySettingsOwnerCsrfRevisionAndCredentialBoundary(string locale, string global)
    {
        await BootstrapOwner();
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/outbound-proxy")).StatusCode);
        var current = (await ownerClient.GetFromJsonAsync<ProxySettingsDto>("/api/admin/outbound-proxy?locale=" + locale))!;
        Assert.Equal(global, current.Scopes.Single(p => p.Id == "global").Label);
        var input = new SaveProxyRequest(current.Revision, "global", "custom", "http://127.0.0.1:7890", "owner", "secret-proxy-test");
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.PutAsJsonAsync("/api/admin/outbound-proxy", input)).StatusCode);
        var csrf = await GetCsrf(ownerClient);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(customer, HttpMethod.Post, "/api/admin/outbound-proxy/test", await GetCsrf(customer), JsonContent.Create(new ProxyTestRequest(current.Revision, "global")))).StatusCode);
        var saved = await Send(ownerClient, HttpMethod.Put, "/api/admin/outbound-proxy", csrf, JsonContent.Create(input));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode); Assert.True(saved.Headers.CacheControl!.NoStore);
        Assert.DoesNotContain("secret-proxy-test", await saved.Content.ReadAsStringAsync());
        var data = (await saved.Content.ReadFromJsonAsync<ProxySettingsDto>())!;
        Assert.True(data.Scopes.Single(p => p.Id == "global").HasPassword);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(ownerClient, HttpMethod.Put, "/api/admin/outbound-proxy", csrf, JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(ownerClient, HttpMethod.Put, "/api/admin/outbound-proxy", csrf, JsonContent.Create(input with { Revision = data.Revision, Scope = "unknown" }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(ownerClient, HttpMethod.Post, "/api/admin/outbound-proxy/test", csrf, JsonContent.Create(new ProxyTestRequest(data.Revision, "https://example.com")))).StatusCode);
        var audit = await ownerClient.GetStringAsync("/api/admin/audit-events"); Assert.Contains("proxy.settings_update", audit); Assert.DoesNotContain("secret-proxy-test", audit);
    }
}
