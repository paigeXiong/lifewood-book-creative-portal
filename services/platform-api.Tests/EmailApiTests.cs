using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact] public async Task MailQueueStatusRequiresOwnerAndRejectsInvalidFilters() {
        await BootstrapOwner();
        using var anonymous = factory.CreateClient();
        Assert.Contains((await anonymous.GetAsync("/api/admin/mail/status")).StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden });
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/mail/status")).StatusCode);
        var ownerCsrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", ownerCsrf, JsonContent.Create(new { displayName = "Mail admin", email = "mail-admin@example.test", password = "admin-password-123", role = "admin" }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var admin = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await Send(admin, HttpMethod.Post, "/api/auth/login", await GetCsrf(admin), JsonContent.Create(new { email = "mail-admin@example.test", password = "admin-password-123" }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.GetAsync("/api/admin/mail/status")).StatusCode);
        using var response = await ownerClient.GetAsync("/api/admin/mail/status"); Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.True(response.Headers.CacheControl!.NoStore);
        var page = (await response.Content.ReadFromJsonAsync<MailQueuePage>())!; Assert.False(page.Available); Assert.Empty(page.Items); Assert.Equal(7, page.Counts.Count); Assert.Equal(6, page.ConfigurationChecks.Count);
        var publicStatus = await anonymous.GetStringAsync("/api/auth/email-status"); Assert.DoesNotContain("configurationChecks", publicStatus); Assert.DoesNotContain("credentials", publicStatus);
        foreach (var query in new[] { "status=invalid", "kind=invalid", "page=0", "page=100001" }) Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/admin/mail/status?" + query)).StatusCode);
    }
    [Theory]
    [InlineData("zh-CN")]
    [InlineData("en-US")]
    public async Task EmailVerificationRecoveryAndPreferencesWorkOverHttpWithoutRealMail(string locale) {
        var mailer = new AcceptanceMailbox();
        var dataDirectory = Path.Combine(root, "email-http");
        WebApplicationFactory<Program> CreateEmailHost() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder => {
            builder.UseEnvironment("Development"); builder.UseSetting("Lifewood:DataDirectory", dataDirectory); builder.UseSetting("Lifewood:RequireWebAssets", "false");
            builder.UseSetting("Lifewood:Mail:Enabled", "true"); builder.UseSetting("Lifewood:Mail:Host", "smtp.example.test"); builder.UseSetting("Lifewood:Mail:From", "portal@example.test"); builder.UseSetting("Lifewood:Mail:PublicUrl", "https://portal.example.test");
            builder.ConfigureServices(services => {
                services.AddSingleton<IStartupFilter, LoopbackConnectionStartupFilter>(); services.AddSingleton<IPlatformMailer>(mailer);
                foreach (var item in services.Where(x => x.ImplementationType == typeof(EmailWorker)).ToArray()) services.Remove(item);
            });
        });
        await using var emailFactory = CreateEmailHost();
        using var client = emailFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        Assert.True((await client.GetFromJsonAsync<MailAvailabilityDto>("/api/auth/email-status"))!.Available);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me/email")).StatusCode);
        var bootstrap = await Send(client, HttpMethod.Post, "/api/auth/bootstrap", await GetCsrf(client), JsonContent.Create(new { displayName = "Email Owner", email = "email-owner@example.test", password = "owner-password-123", locale }));
        Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
        var owner = (await bootstrap.Content.ReadFromJsonAsync<CurrentUserDto>())!;
        var notifications = emailFactory.Services.GetRequiredService<NotificationRepository>();
        void RaiseNotification(string key) {
            // Isolated business-event fixture; exercise the production recipient snapshot and dispatcher.
            using var db = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(dataDirectory, "platform.db")}"); db.Open();
            using var tx = db.BeginTransaction();
            NotificationRepository.Capture(db, tx, key, "account", "", "acceptance-actor", owner.Id);
            tx.Commit(); notifications.Dispatch();
        }
        var configurationStatus = await client.GetStringAsync("/api/admin/mail/status");
        Assert.Contains("configurationChecks", configurationStatus); Assert.DoesNotContain("smtp.example.test", configurationStatus); Assert.DoesNotContain("portal@example.test", configurationStatus);
        var csrf = await GetCsrf(client);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/me/email/verify", new {})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(client, HttpMethod.Put, "/api/me/email/preferences", csrf, JsonContent.Create(new { notifications = true }))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(client, HttpMethod.Post, "/api/me/email/verify", csrf)).StatusCode);
        var repository = emailFactory.Services.GetRequiredService<EmailRepository>(); await repository.DeliverOne(mailer, CancellationToken.None);
        var verification = Regex.Match(mailer.Messages.Single().Body, "token=([A-F0-9]{64})").Groups[1].Value;
        Assert.Contains($"/{locale}/email-action#purpose=verify", mailer.Messages.Single().Body);
        Assert.Contains(verification, mailer.Messages.Single().Html);
        Assert.Contains(locale == "en-US" ? "Verify your email" : "验证邮箱", mailer.Messages.Single().Subject);
        Assert.False((await client.GetFromJsonAsync<EmailSettingsDto>("/api/me/email"))!.Verified);
        using var anonymous = emailFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true }); var anonymousCsrf = await GetCsrf(anonymous);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(anonymous, HttpMethod.Post, "/api/auth/email/verify", anonymousCsrf, JsonContent.Create(new { token = verification }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(anonymous, HttpMethod.Post, "/api/auth/email/verify", anonymousCsrf, JsonContent.Create(new { token = verification }))).StatusCode);
        using var status = await client.GetAsync("/api/me/email"); Assert.True(status.Headers.CacheControl!.NoStore);
        var verified = (await status.Content.ReadFromJsonAsync<EmailSettingsDto>())!;
        Assert.True(verified.Verified); Assert.False(verified.Notifications);
        Assert.Equal(6,verified.Topics!.Length);
        Assert.Equal(locale=="en-US"?"Project completed":"项目完成",verified.Topics.Single(topic=>topic.Id=="completed").Label);
        Assert.Equal(HttpStatusCode.BadRequest,(await Send(client,HttpMethod.Put,"/api/me/email/preferences",csrf,JsonContent.Create(new {notifications=true,topics=new[]{"invalid"}}))).StatusCode);
        RaiseNotification("before-opt-in");
        var originalUnread = notifications.Counts(owner.Id).Unread;
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Put, "/api/me/email/preferences", csrf, JsonContent.Create(new { notifications = true }))).StatusCode);
        repository.QueueNotifications(); await repository.DeliverOne(mailer, CancellationToken.None);
        Assert.Single(mailer.Messages); // Opt-in must not email existing notifications.
        RaiseNotification("after-opt-in");
        repository.QueueNotifications(); await repository.DeliverOne(mailer, CancellationToken.None);
        Assert.Equal(2, mailer.Messages.Count);
        Assert.Contains($"/{locale}/notifications", mailer.Messages.Last().Body);
        Assert.Contains($"/{locale}/notifications", mailer.Messages.Last().Html);
        Assert.DoesNotContain("acceptance-actor", mailer.Messages.Last().Body);
        RaiseNotification("cancel-on-opt-out"); repository.QueueNotifications();
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Put, "/api/me/email/preferences", csrf, JsonContent.Create(new { notifications = false }))).StatusCode);
        await repository.DeliverOne(mailer, CancellationToken.None);
        Assert.Equal(2, mailer.Messages.Count);
        Assert.Equal(originalUnread + 2, notifications.Counts(owner.Id).Unread); // Site notifications remain available.
        foreach (var email in new[] { "unknown@example.test", "email-owner@example.test", "email-owner@example.test" }) {
            var response = await Send(anonymous, HttpMethod.Post, "/api/auth/password/forgot", anonymousCsrf, JsonContent.Create(new { email }));
            Assert.Equal(HttpStatusCode.NoContent, response.StatusCode); Assert.Equal("", await response.Content.ReadAsStringAsync());
        }
        await repository.DeliverOne(mailer, CancellationToken.None); Assert.Equal(3, mailer.Messages.Count);
        var reset = Regex.Match(mailer.Messages.Last().Body, "token=([A-F0-9]{64})").Groups[1].Value;
        Assert.Equal(HttpStatusCode.NoContent, (await Send(anonymous, HttpMethod.Post, "/api/auth/password/reset", anonymousCsrf, JsonContent.Create(new { token = reset, newPassword = "new-password-123" }))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(anonymous, HttpMethod.Post, "/api/auth/password/reset", anonymousCsrf, JsonContent.Create(new { token = reset, newPassword = "other-password-123" }))).StatusCode);
        // Reopen the isolated host with persisted data/keys. This also separates the rapid
        // link-replay checks from login's production per-IP authentication rate limit.
        await emailFactory.DisposeAsync();
        // TestServer disposal may finish before top-level Program releases its data-directory lock.
        var shutdownDeadline = Environment.TickCount64 + 5000;
        while (true) {
            try { using var dataLock = new FileStream(Path.Combine(dataDirectory, "platform.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None); break; }
            catch (IOException) when (Environment.TickCount64 < shutdownDeadline) { await Task.Delay(25); }
        }
        await using var restartedFactory = CreateEmailHost();
        using var resumed = restartedFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(resumed, HttpMethod.Post, "/api/auth/login", await GetCsrf(resumed), JsonContent.Create(new { email = owner.Email, password = "owner-password-123" }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(resumed, HttpMethod.Post, "/api/auth/login", await GetCsrf(resumed), JsonContent.Create(new { email = owner.Email, password = "new-password-123" }))).StatusCode);
        await restartedFactory.Services.GetRequiredService<EmailRepository>().DeliverOne(mailer, CancellationToken.None);
        Assert.Equal(4, mailer.Messages.Count);
        Assert.Contains(locale == "en-US" ? "Password changed" : "密码已修改", mailer.Messages.Last().Subject);
        Assert.DoesNotContain("token=", mailer.Messages.Last().Body);
        Assert.DoesNotContain("new-password-123", mailer.Messages.Last().Html);
        Assert.False((await resumed.GetFromJsonAsync<EmailSettingsDto>("/api/me/email"))!.Notifications);
        Assert.All(mailer.Messages, mail => Assert.False(string.IsNullOrWhiteSpace(mail.Html)));
    }
    private sealed class AcceptanceMailbox : IPlatformMailer {
        public readonly System.Collections.Concurrent.ConcurrentQueue<(string Subject, string Body, string? Html)> Messages = new();
        public Task Send(string address, string subject, string body, CancellationToken cancellation) { Messages.Enqueue((subject, body, null)); return Task.CompletedTask; }
        public Task SendContent(string address, string subject, MailBody body, CancellationToken cancellation) { Messages.Enqueue((subject, body.Text, body.Html)); return Task.CompletedTask; }
    }
    [Fact] public async Task UnconfiguredMailHasAnExplicitUnavailableResponse() {
        Assert.False((await ownerClient.GetFromJsonAsync<MailAvailabilityDto>("/api/auth/email-status"))!.Available);
        var response = await Send(ownerClient, HttpMethod.Post, "/api/auth/password/forgot", await GetCsrf(ownerClient), JsonContent.Create(new { email = "nobody@example.test" }));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("email.errors.unavailable", (await response.Content.ReadFromJsonAsync<ApiErrorDto>())!.MessageKey);
    }
}
