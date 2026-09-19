using System.Text.RegularExpressions;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed class EmailTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "portal-email-" + Guid.NewGuid().ToString("N"));
    private readonly string connection, owner;
    private readonly UserRepository users;
    private readonly EmailRepository emails;
    private readonly FakeMailer mailer = new();
    internal sealed class FakeMailer : IPlatformMailer {
        public readonly System.Collections.Concurrent.ConcurrentQueue<(string Address, string Subject, string Body)> Messages = new();
        public bool Fail;
        public Task Send(string address, string subject, string body, CancellationToken cancellation) { if (Fail) throw new IOException("Simulated failure"); Messages.Enqueue((address, subject, body)); return Task.CompletedTask; }
    }
    internal static MailSettings Settings() => new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
        ["Lifewood:Mail:Enabled"] = "true", ["Lifewood:Mail:Host"] = "smtp.example.test", ["Lifewood:Mail:From"] = "portal@example.test", ["Lifewood:Mail:PublicUrl"] = "https://portal.example.test"
    }).Build());
    public EmailTests() {
        Directory.CreateDirectory(root); connection = "Data Source=" + Path.Combine(root, "test.db") + ";Pooling=False";
        new ProjectRepository(connection).Initialize(); new RevisionStore(connection).Initialize(); users = new(connection, root); users.Initialize();
        owner = users.CreateOwner("Owner", "owner@example.test", "password-123", organizationName: "Organization").User!.Id;
        new AdminRepository(connection).Initialize(); new DeliveryRepository(connection).Initialize();
        var notifications = new NotificationRepository(connection); notifications.Initialize();
        emails = new(connection, new EphemeralDataProtectionProvider(), Settings(), users, notifications); emails.Initialize();
    }
    private object? Sql(string sql) { using var c = new SqliteConnection(connection); c.Open(); using var q = c.CreateCommand(); q.CommandText = sql; return q.ExecuteScalar(); }
    private async Task<string> Link(string purpose) {
        Assert.True(emails.Request(purpose, purpose == "verify" ? owner : "owner@example.test"));
        await emails.DeliverOne(mailer, CancellationToken.None);
        return Regex.Match(mailer.Messages.Last().Body, "token=([A-F0-9]{64})").Groups[1].Value;
    }
    private async Task Verify() { Assert.True(emails.Consume("verify", await Link("verify"))); }
    private sealed class LimitedMailer:IPlatformMailer {
        public Task Send(string address,string subject,string body,CancellationToken cancellation)=>throw new MailRateLimitedException(DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds());
    }
    [Fact] public async Task QuotaWaitDoesNotConsumeRetriesAndExpiredLinksAreRemoved() {
        Assert.True(emails.Request("verify",owner));
        for(var i=0;i<7;i++)await emails.DeliverOne(new LimitedMailer(),CancellationToken.None);
        Assert.Equal(0L,Sql("SELECT attempts FROM email_outbox WHERE kind='verify'"));
        Assert.Equal("pending",Sql("SELECT status FROM email_outbox WHERE kind='verify'"));
        Sql("UPDATE email_outbox SET expires=0");
        await emails.DeliverOne(mailer,CancellationToken.None);
        Assert.Empty(mailer.Messages);
    }
    [Fact] public async Task DisabledTemplateBlocksNewAndQueuedBusinessEmails() {
        await Verify(); Assert.True(emails.SavePreferences(owner,true));
        Notify("template-pending"); emails.QueueNotifications();
        Assert.Null(emails.Templates.Save("notice","zh-CN",new("default","通知","正文",false)));
        await emails.DeliverOne(mailer,CancellationToken.None);
        Assert.Single(mailer.Messages);
        Assert.Equal("cancelled",Sql("SELECT status FROM email_outbox WHERE kind='notice'"));
        Notify("template-disabled"); emails.QueueNotifications();
        Assert.Equal(0L,Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice' AND status='pending'"));
    }
    [Fact] public async Task RichQueueAndLegacyProtectedBodiesBothDeliver()
    {
        var protection = new EphemeralDataProtectionProvider();
        var repository = new EmailRepository(connection, protection, Settings(), users, new NotificationRepository(connection));
        Assert.True(repository.Request("verify", owner));
        var rich = new RichMailer();
        await repository.DeliverOne(rich, CancellationToken.None);
        Assert.Contains("href=", rich.Body!.Html);
        Assert.Contains("token=", rich.Body.Text);
        var legacy = "Previously queued plain text\nhttps://portal.example.test/#token=legacy";
        using var db = new SqliteConnection(connection); db.Open();
        using var command = db.CreateCommand();
        command.CommandText = "UPDATE email_outbox SET status='pending',body=$body,next_attempt=0";
        command.Parameters.AddWithValue("$body", protection.CreateProtector("BookCreativePortal.EmailOutbox.v1").Protect(legacy));
        command.ExecuteNonQuery();
        await repository.DeliverOne(rich, CancellationToken.None);
        Assert.Equal(legacy, rich.Body.Text); Assert.Null(rich.Body.Html);
        Assert.Equal("", Sql("SELECT body FROM email_outbox"));
    }
    private sealed class RichMailer : IPlatformMailer {
        public MailBody? Body;
        public Task Send(string address, string subject, string body, CancellationToken cancellation) => throw new InvalidOperationException("Rich content must use SendContent.");
        public Task SendContent(string address, string subject, MailBody body, CancellationToken cancellation) { Body = body; return Task.CompletedTask; }
    }
    [Fact] public void QueueStatusIsReadOnlyMaskedFilteredAndPaged() {
        Assert.True(emails.Request("verify", owner));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        for (var i = 0; i < 30; i++) Sql($"INSERT INTO email_outbox(id,user_id,email,kind,body,subject,status,attempts,next_attempt,expires) VALUES('record-{i:00}','{owner}','owner@example.test','notice','private-body-token','private-subject','sent',0,{now},{now + 3600})");
        Sql($"UPDATE email_outbox SET status='failed',attempts=5 WHERE id='record-00'; UPDATE email_outbox SET status='pending',expires={now - 1} WHERE id='record-01'; UPDATE email_outbox SET expires={now - 8 * 86400} WHERE id='record-02'; UPDATE email_outbox SET attempts=2 WHERE kind='verify'");
        var page = emails.QueueStatus(null, null, 1);
        Assert.Equal(30, page.Total); Assert.Equal(25, page.Items.Count); Assert.Equal(5, emails.QueueStatus(null, null, 2).Items.Count);
        Assert.Equal(2, emails.QueueStatus(null, null, 100).Page);
        Assert.Equal(1, page.Counts.Single(x => x.Status == "retrying").Count); Assert.Equal(1, page.Counts.Single(x => x.Status == "expired").Count);
        var retry = Assert.Single(emails.QueueStatus("retrying", "verify", 1).Items); Assert.Equal(2, retry.Failures); Assert.NotNull(retry.NextAttempt);
        var failed = Assert.Single(emails.QueueStatus("failed", null, 1).Items); Assert.Equal(5, failed.Failures); Assert.Null(failed.NextAttempt);
        Assert.All(page.Items, item => Assert.Equal("o***@example.test", item.Recipient));
        var json = System.Text.Json.JsonSerializer.Serialize(page, Lifewood.PlatformApi.Serialization.AppJsonContext.Default.MailQueuePage);
        Assert.DoesNotContain("owner@example.test", json); Assert.DoesNotContain("private-body-token", json); Assert.DoesNotContain("private-subject", json); Assert.DoesNotContain("\"body\"", json);
        Assert.Equal("pending", Sql("SELECT status FROM email_outbox WHERE id='record-01'")); // Projection must not mutate expired records.
        Sql("UPDATE users SET is_active=0"); Assert.Single(emails.QueueStatus("paused", "verify", 1).Items);
    }
    [Fact] public void QueueSearchCombinesFiltersWithoutExposingRecipientsOrChangingCounts() {
        Assert.True(emails.Request("verify", owner));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        for (var i = 0; i < 28; i++) Sql($"INSERT INTO email_outbox(id,user_id,email,kind,body,subject,status,attempts,next_attempt,expires) VALUES('search-{i:00}','{owner}','other_%@example.test','notice','private','private','sent',0,{now},{now + 3600})");
        var result = emails.QueueStatus("sent", "notice", 99, "  OTHER_%@EXAMPLE.TEST  ");
        Assert.Equal(28, result.Total); Assert.Equal(2, result.Page); Assert.Equal(3, result.Items.Count);
        Assert.All(result.Items, item => Assert.Equal("o***@example.test", item.Recipient));
        Assert.Equal(29, result.Counts.Sum(item => item.Count));
        Assert.Equal(1, emails.QueueStatus(null, "verify", 1, "OWNER@").Total);
        Assert.Equal(0, emails.QueueStatus("sent", "verify", 1, "owner").Total);
        Assert.Equal(0, emails.QueueStatus(null, null, 1, "' OR 1=1 --").Total);
        Assert.Equal(28, emails.QueueStatus(null, null, 1, "_%").Total);
        Assert.Equal(29, emails.QueueStatus(null, null, 1, "example.test").Total);
    }
    [Fact] public void QueueStatusProjectsDisabledSendingWithoutChangingQueue() {
        Assert.True(emails.Request("verify", owner));
        var disabled = new MailSettings(new ConfigurationBuilder().Build());
        var repository = new EmailRepository(connection, new EphemeralDataProtectionProvider(), disabled, users, new NotificationRepository(connection));
        var page = repository.QueueStatus(null, null, 1); Assert.False(page.Available); Assert.Equal("paused", Assert.Single(page.Items).Status);
        Assert.Equal("pending", Sql("SELECT status FROM email_outbox"));
    }
    [Fact] public async Task VerificationIsExplicitSingleUseAndNotificationOptInIsSeparate() {
        Assert.False(emails.Status(owner).Verified); Assert.False(emails.SavePreferences(owner, true)); Assert.False(emails.Request("reset", "owner@example.test"));
        var token = await Link("verify"); Assert.Equal(64, token.Length); Assert.False(emails.Status(owner).Verified);
        Assert.False(emails.Consume("reset", token, "password-new")); Assert.True(emails.Consume("verify", token)); Assert.False(emails.Consume("verify", token));
        Assert.True(emails.Status(owner).Verified); Assert.False(emails.Status(owner).Notifications); Assert.True(emails.SavePreferences(owner, true));
        Assert.True(emails.Status(owner).Notifications); Assert.True(emails.SavePreferences(owner, false));
    }
    [Fact] public async Task ResetRequiresVerifiedEmailAndRevokesExistingSessions() {
        await Verify(); var version = Convert.ToInt64(Sql("SELECT session_version FROM users")); var token = await Link("reset");
        Assert.False(emails.Consume("reset", token, "short")); Assert.True(emails.Consume("reset", token, "new-password-123")); Assert.False(emails.Consume("reset", token, "other-password"));
        Assert.Equal(version + 1, Convert.ToInt64(Sql("SELECT session_version FROM users")));
        Assert.Equal(AccountLoginOutcome.InvalidCredentials, users.Authenticate("owner@example.test", "password-123").Outcome);
        Assert.NotNull(users.Authenticate("owner@example.test", "new-password-123").User);
        await emails.DeliverOne(mailer, CancellationToken.None); Assert.Contains("密码已修改", mailer.Messages.Last().Subject);
    }
    [Theory] [InlineData("expiry")] [InlineData("password")] [InlineData("disabled")] [InlineData("email")]
    public async Task StaleLinksCannotChangeAccounts(string change) {
        var token = await Link("verify");
        if (change == "expiry") Sql("UPDATE email_tokens SET expires=0");
        if (change == "password") users.ResetPassword(owner, "new-password-123");
        if (change == "disabled") Sql("UPDATE users SET is_active=0");
        if (change == "email") Sql("UPDATE users SET email='different@example.test'");
        Assert.False(emails.Consume("verify", token));
    }
    [Fact] public async Task QueueEncryptsSecretsThrottlesRequestsAndRetriesWithoutLosingToken() {
        Assert.True(emails.Request("verify", owner)); Assert.False(emails.Request("verify", owner));
        var encrypted = (string)Sql("SELECT body FROM email_outbox")!; Assert.DoesNotContain("token=", encrypted); Assert.DoesNotContain("https://", encrypted);
        mailer.Fail = true; await emails.DeliverOne(mailer, CancellationToken.None); Assert.Equal("pending", emails.Status(owner).DeliveryStatus);
        Sql("UPDATE email_outbox SET next_attempt=0"); mailer.Fail = false; await emails.DeliverOne(mailer, CancellationToken.None);
        Assert.Equal("sent", emails.Status(owner).DeliveryStatus); Assert.Equal("", Sql("SELECT body FROM email_outbox"));
        var token = Regex.Match(mailer.Messages.Single().Body, "token=([A-F0-9]{64})").Groups[1].Value;
        Assert.NotEqual(token, Sql("SELECT hash FROM email_tokens")); Assert.True(emails.Consume("verify", token));
    }
    private void Notify(string key, string kind = "account") => Sql($"INSERT INTO notification_events(event_key,kind,project_id,actor_id,target_id,status) VALUES('{key}','{kind}','','','', 'sent'); INSERT INTO notifications(event_id,user_id) VALUES(last_insert_rowid(),'{owner}');");
    [Fact] public async Task PublishingDeliveryNotifiesCompletionSubscribersWithoutDuplicateCompletion() {
        await Verify();Assert.True(emails.SavePreferences(owner,true,["completed"]));
        var admin=new AdminRepository(connection);Assert.Equal(AdminWriteOutcome.Saved,admin.CreateUser(new("Publisher","publisher@example.test","password-123","admin",null),out var publisher).Outcome);
        var projects=new ProjectRepository(connection);var draft=projects.Create(owner);
        projects.Submit(owner,draft.Id,draft.Version,Guid.NewGuid().ToString(),null);
        var deliveries=new DeliveryRepository(connection);
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Publish("delivery-one",draft.Id,publisher!.Id,"final.mp4","video/mp4",100,null,out _).Outcome);
        new NotificationRepository(connection).Dispatch();emails.QueueNotifications();await emails.DeliverOne(mailer,CancellationToken.None);
        Assert.Equal(2,mailer.Messages.Count);
        Assert.Equal(1L,Sql($"SELECT COUNT(*) FROM notification_events WHERE project_id='{draft.Id}' AND kind='completed'"));
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Revoke(draft.Id,"delivery-one").Outcome);
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Publish("delivery-two",draft.Id,publisher.Id,"new.mp4","video/mp4",100,null,out _).Outcome);
        // Revoking a delivery reopens production, so publishing again is a new completion.
        Assert.Equal(2L,Sql($"SELECT COUNT(*) FROM notification_events WHERE project_id='{draft.Id}' AND kind='completed'"));
        var alreadyDone=projects.Create(owner);projects.Submit(owner,alreadyDone.Id,alreadyDone.Version,Guid.NewGuid().ToString(),null);
        var before=admin.GetProject(alreadyDone.Id)!;
        Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateWorkflow(alreadyDone.Id,new("completed","normal",null,before.WorkflowUpdatedAt),publisher.Id).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved,deliveries.Publish("delivery-three",alreadyDone.Id,publisher.Id,"done.mp4","video/mp4",100,null,out _).Outcome);
        Assert.Equal(1L,Sql($"SELECT COUNT(*) FROM notification_events WHERE project_id='{alreadyDone.Id}' AND kind='completed'"));
    }
    [Fact] public async Task TopicSelectionFiltersQueueAndRechecksPendingMessagesWithoutInboxPageLimit() {
        await Verify(); Assert.True(emails.SavePreferences(owner,true,["completed","returned"]));
        var project=new ProjectRepository(connection).Create(owner);
        void ProjectNotice(string key,string kind){Notify(key,kind);Sql($"UPDATE notification_events SET project_id='{project.Id}' WHERE event_key='{key}'");}
        Notify("excluded-account");ProjectNotice("excluded-progress","workflow");emails.QueueNotifications();
        Assert.Equal(0L,Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        ProjectNotice("completed-event","completed");
        for(var i=0;i<40;i++)Notify("excluded-newer-"+i);
        emails.QueueNotifications();Assert.Equal(1L,Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        Assert.True(emails.SavePreferences(owner,true,["returned"]));
        await emails.DeliverOne(mailer,CancellationToken.None);Assert.Single(mailer.Messages);
        Assert.Equal("cancelled",Sql("SELECT status FROM email_outbox WHERE kind='notice'"));
        ProjectNotice("return-event","returned");emails.QueueNotifications();await emails.DeliverOne(mailer,CancellationToken.None);
        Assert.Equal(2,mailer.Messages.Count);
        Assert.True(emails.SavePreferences(owner,true,[]));ProjectNotice("silent-return","returned");emails.QueueNotifications();
        Assert.Equal(0L,Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice' AND status='pending'"));
        Assert.False(emails.SavePreferences(owner,true,["invalid"]));
        Assert.False(emails.SavePreferences(owner,true,["returned","returned"]));
        Assert.All(emails.Status(owner).Topics!,topic=>Assert.False(topic.Enabled));
        Assert.True(emails.SavePreferences(owner,false));Assert.All(emails.Status(owner).Topics!,topic=>Assert.False(topic.Enabled));
    }
    [Fact] public async Task NoticesOnlySendNewVisibleUnreadEventsAndOptOutCancelsQueue() {
        await Verify(); Notify("old"); Assert.True(emails.SavePreferences(owner, true)); emails.QueueNotifications();
        Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        Notify("new"); Notify("new-2"); emails.QueueNotifications(); emails.QueueNotifications();
        Assert.Equal(1L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        Assert.True(emails.SavePreferences(owner, false)); await emails.DeliverOne(mailer, CancellationToken.None);
        Assert.Single(mailer.Messages); Assert.True(emails.SavePreferences(owner, true));
        Notify("inaccessible", "workflow"); emails.QueueNotifications(); Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        Notify("read"); Sql("UPDATE notifications SET read_at='2026-09-16' WHERE id=(SELECT MAX(id) FROM notifications)"); emails.QueueNotifications();
        Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        Notify("deliver"); emails.QueueNotifications(); await emails.DeliverOne(mailer, CancellationToken.None);
        Assert.Equal(2, mailer.Messages.Count); Assert.Contains("/zh-CN/notifications", mailer.Messages.Last().Body);
    }
    [Fact] public async Task ConcurrentDeliveryDoesNotSendSameMessageTwice() {
        Assert.True(emails.Request("verify", owner));
        await Task.WhenAll(emails.DeliverOne(mailer, CancellationToken.None), emails.DeliverOne(mailer, CancellationToken.None)); Assert.Single(mailer.Messages);
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task QueuedNoticeIsCancelledWhenNoLongerUnreadOrAccessible(bool lostAccess) {
        await Verify(); Assert.True(emails.SavePreferences(owner, true)); Notify("queued"); emails.QueueNotifications();
        if (lostAccess) Sql("UPDATE notification_events SET kind='workflow',project_id='missing' WHERE event_key='queued'");
        else Sql("UPDATE notifications SET read_at='2026-09-16'");
        await emails.DeliverOne(mailer, CancellationToken.None);
        Assert.Single(mailer.Messages); Assert.Equal("cancelled", Sql("SELECT status FROM email_outbox WHERE kind='notice'"));
    }
    [Fact] public async Task PendingNoticesCoalesceAndRetainNewestEligibleEvents() {
        await Verify(); Assert.True(emails.SavePreferences(owner, true)); Notify("first"); emails.QueueNotifications();
        Sql("UPDATE notifications SET read_at='2026-09-16'"); Notify("second"); emails.QueueNotifications();
        Assert.Equal(1L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
        await emails.DeliverOne(mailer, CancellationToken.None); Assert.Equal(2, mailer.Messages.Count);
    }
    [Fact] public void MailIsDisabledWithoutExplicitConfiguration() {
        Assert.False(new MailSettings(new ConfigurationBuilder().Build()).Ready);
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public async Task RetentionRunsWithoutReadyMailAndPreservesLiveQueue(bool enabledButIncomplete) {
        Assert.True(emails.Request("verify", owner));
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var encrypted = Sql("SELECT body FROM email_outbox");
        Sql($"""
        INSERT INTO email_tokens VALUES('expired','{owner}','owner@example.test','reset',0,{now - 1});
        INSERT INTO email_outbox(id,user_id,email,kind,body,subject,status,next_attempt,expires) VALUES
        ('expired','{owner}','owner@example.test','reset','expired-secret','subject','pending',0,{now - 1}),
        ('old','{owner}','owner@example.test','notice','old-secret','subject','sent',0,{now - 8 * 86400}),
        ('recent','{owner}','owner@example.test','notice','legacy-failed-secret','subject','failed',0,{now - 6 * 86400});
        """);
        var settings = new MailSettings(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Lifewood:Mail:Enabled"] = enabledButIncomplete ? "true" : "false"
        }).Build());
        var repository = new EmailRepository(connection, new EphemeralDataProtectionProvider(), settings, users, new NotificationRepository(connection));
        await repository.DeliverOne(mailer, CancellationToken.None);
        Assert.Empty(mailer.Messages);
        Assert.Equal(1L, Sql("SELECT COUNT(*) FROM email_tokens"));
        Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE id='old'"));
        Assert.Equal("expired", Sql("SELECT status FROM email_outbox WHERE id='expired'"));
        Assert.Equal("failed", Sql("SELECT status FROM email_outbox WHERE id='recent'"));
        Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE status<>'pending' AND body<>''"));
        Assert.Equal(encrypted, Sql("SELECT body FROM email_outbox WHERE kind='verify'"));
        Assert.Equal("pending", Sql("SELECT status FROM email_outbox WHERE kind='verify'"));
        await emails.DeliverOne(mailer, CancellationToken.None);
        var token = Regex.Match(Assert.Single(mailer.Messages).Body, "token=([A-F0-9]{64})").Groups[1].Value;
        Assert.True(emails.Consume("verify", token));
    }
    [Fact] public async Task ExhaustedRetriesEraseBodyAndKeepFailureMetadata() {
        Assert.True(emails.Request("verify", owner)); mailer.Fail = true;
        var encrypted = Sql("SELECT body FROM email_outbox");
        for (var attempt = 1; attempt <= 5; attempt++) {
            Sql("UPDATE email_outbox SET next_attempt=0");
            await emails.DeliverOne(mailer, CancellationToken.None);
            Assert.Equal((long)attempt, Sql("SELECT attempts FROM email_outbox"));
            Assert.Equal(attempt == 5 ? "" : encrypted, Sql("SELECT body FROM email_outbox"));
        }
        Assert.Equal("failed", Sql("SELECT status FROM email_outbox"));
        mailer.Fail = false; await emails.DeliverOne(mailer, CancellationToken.None);
        Assert.Empty(mailer.Messages);
        Assert.Equal(5, Assert.Single(emails.QueueStatus("failed", "verify", 1).Items).Failures);
    }
    [Fact] public async Task DisabledWorkerDefersRetentionUntilBackupGateReopens() {
        Assert.True(emails.Request("verify", owner));
        Sql("UPDATE email_tokens SET expires=0; UPDATE email_outbox SET expires=0");
        Sql($"INSERT INTO email_settings(user_id,email,verified,notifications,cursor) VALUES('{owner}','owner@example.test',1,1,0)");
        Notify("eligible-while-disabled");
        var settings = new MailSettings(new ConfigurationBuilder().Build());
        var repository = new EmailRepository(connection, new EphemeralDataProtectionProvider(), settings, users, new NotificationRepository(connection));
        var gate = new BackupGate(); using var pause = await gate.PauseAsync(CancellationToken.None);
        using var worker = new EmailWorker(repository, settings, mailer, gate, Microsoft.Extensions.Logging.Abstractions.NullLogger<EmailWorker>.Instance);
        await worker.StartAsync(CancellationToken.None);
        try {
            await Task.Delay(150);
            Assert.Equal(1L, Sql("SELECT COUNT(*) FROM email_tokens"));
            Assert.Equal(1L, Sql("SELECT COUNT(*) FROM email_outbox"));
            pause.Dispose();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            while (Convert.ToInt64(Sql("SELECT COUNT(*) FROM email_outbox")) != 0) await Task.Delay(50, timeout.Token);
            Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_tokens"));
            Assert.Equal(0L, Sql("SELECT cursor FROM email_settings"));
            Assert.Equal(0L, Sql("SELECT COUNT(*) FROM email_outbox WHERE kind='notice'"));
            Assert.Empty(mailer.Messages);
        }
        finally { await worker.StopAsync(CancellationToken.None); }
    }
    public void Dispose() { SqliteConnection.ClearAllPools(); Directory.Delete(root, true); }
}
