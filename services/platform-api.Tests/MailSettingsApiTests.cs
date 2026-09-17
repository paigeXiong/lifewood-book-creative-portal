using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task MailServiceSettingsRequireOwnerAndCsrfAndNeverReturnCredentials()
    {
        await BootstrapOwner();
        using var anonymous = factory.CreateClient();
        Assert.Contains((await anonymous.GetAsync("/api/admin/mail/settings")).StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        var current = (await ownerClient.GetFromJsonAsync<MailServiceDto>("/api/admin/mail/settings?locale=en-US"))!;
        var input = new SaveMailSettings(current.Revision, true, "smtp.example.test", 587, "sender@example.test", "sender@example.test", "sensitive-test-value", false, "https://portal.example.test");
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/mail/settings")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(customer, HttpMethod.Put, "/api/admin/mail/settings", await GetCsrf(customer), JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(customer, HttpMethod.Post, "/api/admin/mail/test", await GetCsrf(customer), JsonContent.Create(new MailTestRequest(current.Revision)))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.PutAsJsonAsync("/api/admin/mail/settings", input)).StatusCode);
        var csrf = await GetCsrf(ownerClient);
        var saved = await Send(ownerClient, HttpMethod.Put, "/api/admin/mail/settings?locale=en-US", csrf, JsonContent.Create(input));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode); Assert.True(saved.Headers.CacheControl!.NoStore);
        Assert.DoesNotContain("sensitive-test-value", await saved.Content.ReadAsStringAsync());
        var dto = (await saved.Content.ReadFromJsonAsync<MailServiceDto>())!; Assert.True(dto.HasPassword); Assert.True(dto.Available);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(ownerClient, HttpMethod.Put, "/api/admin/mail/settings", csrf, JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(ownerClient, HttpMethod.Put, "/api/admin/mail/settings", csrf, JsonContent.Create(input with { Revision = dto.Revision, Password = "", Host = "other.example.test" }))).StatusCode);
        var audit = await ownerClient.GetStringAsync("/api/admin/audit-events");
        Assert.DoesNotContain("sensitive-test-value", audit); Assert.Contains("mail.settings_update", audit);
        Assert.Equal(HttpStatusCode.OK, (await Send(ownerClient, HttpMethod.Put, "/api/admin/mail/settings", csrf, JsonContent.Create(input with { Revision = dto.Revision, Password = "", Enabled = false }))).StatusCode);
    }
    [Theory]
    [InlineData(null)]
    [InlineData("testAuthentication")]
    [InlineData("testRecipient")]
    [InlineData("testTls")]
    [InlineData("testConnection")]
    [InlineData("testTimeout")]
    [InlineData("testFailed")]
    public async Task MailServiceTestUsesSavedSenderAndThrottlesWithoutSendingRealMail(string? failure)
    {
        var fake = new DiagnosticMailer(failure);
        await using var mailFactory = factory.WithWebHostBuilder(builder => {
            builder.UseSetting("Lifewood:DataDirectory", Path.Combine(root, "mail-test-http"));
            builder.ConfigureServices(services => services.AddSingleton<IPlatformMailer>(fake));
        });
        using var client = mailFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, "/api/auth/bootstrap", await GetCsrf(client), JsonContent.Create(new { displayName = "Mail Owner", email = "owner@example.test", password = "owner-password-123", locale = "en-US" }))).StatusCode);
        var dto = (await client.GetFromJsonAsync<MailServiceDto>("/api/admin/mail/settings"))!;
        var input = new SaveMailSettings(dto.Revision, true, "smtp.example.test", 587, "sender@example.test", "", "", false, "https://portal.example.test");
        var saved = await Send(client, HttpMethod.Put, "/api/admin/mail/settings", await GetCsrf(client), JsonContent.Create(input));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode); dto = (await saved.Content.ReadFromJsonAsync<MailServiceDto>())!;
        var csrf = await GetCsrf(client);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/admin/mail/test", new MailTestRequest(dto.Revision))).StatusCode);
        var test = await Send(client, HttpMethod.Post, "/api/admin/mail/test?locale=en-US", csrf, JsonContent.Create(new MailTestRequest(dto.Revision)));
        if (failure is not null) {
            Assert.Equal(HttpStatusCode.BadGateway, test.StatusCode);
            var body = await test.Content.ReadAsStringAsync();
            Assert.Contains("mailService.errors." + failure, body);
            Assert.DoesNotContain("sensitive-diagnostic", body);
            Assert.Equal(HttpStatusCode.TooManyRequests, (await Send(client, HttpMethod.Post, "/api/admin/mail/test", csrf, JsonContent.Create(new MailTestRequest(dto.Revision)))).StatusCode);
            Assert.Empty(fake.Messages); return;
        }
        Assert.Equal(HttpStatusCode.NoContent, test.StatusCode);
        Assert.Equal("sender@example.test", fake.Messages.Single().Address); Assert.Contains("Email test", fake.Messages.Single().Subject);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Send(client, HttpMethod.Post, "/api/admin/mail/test", csrf, JsonContent.Create(new MailTestRequest(dto.Revision)))).StatusCode);
        Assert.Single(fake.Messages);
    }
    private sealed class DiagnosticMailer(string? failure) : IPlatformMailer
    {
        public readonly System.Collections.Concurrent.ConcurrentQueue<(string Address, string Subject)> Messages = new();
        public Task Send(string address, string subject, string body, CancellationToken cancellation)
        {
            Exception? error = failure switch {
                "testAuthentication" => new System.Net.Mail.SmtpException((System.Net.Mail.SmtpStatusCode)535, "sensitive-diagnostic"),
                "testRecipient" => new System.Net.Mail.SmtpFailedRecipientException(System.Net.Mail.SmtpStatusCode.MailboxUnavailable, "sensitive-diagnostic@example.test"),
                "testTls" => new System.Net.Mail.SmtpException("sensitive-diagnostic", new System.Security.Authentication.AuthenticationException("sensitive-diagnostic")),
                "testConnection" => new System.Net.Mail.SmtpException("sensitive-diagnostic", new System.Net.Sockets.SocketException((int)System.Net.Sockets.SocketError.ConnectionRefused)),
                "testTimeout" => new TimeoutException("sensitive-diagnostic"),
                "testFailed" => new IOException("sensitive-diagnostic"),
                _ => null
            };
            if (error is not null) return Task.FromException(error);
            Messages.Enqueue((address, subject)); return Task.CompletedTask;
        }
    }

}
