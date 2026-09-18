using System.Buffers.Binary;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed partial class VoiceSampleApiIntegrationTests : IAsyncLifetime
{
    private const string VoiceId = "warm-storyteller";
    private const string OrphanUploadId = "11111111111111111111111111111111";
    private const string OrphanDeliveryId = "22222222222222222222222222222222";
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-platform-http-tests-" + Guid.NewGuid().ToString("N"));
    private readonly WebApplicationFactory<Program> factory;
    private readonly HttpClient ownerClient;

    public VoiceSampleApiIntegrationTests()
    {
        var sampleDirectory = Path.Combine(root, "voice-samples");
        Directory.CreateDirectory(sampleDirectory);
        File.WriteAllText(Path.Combine(sampleDirectory, "interrupted.upload"), "orphan");
        var interruptedUpload = Path.Combine(root, "uploads", "owner", "project", "interrupted.upload");
        var interruptedDelivery = Path.Combine(root, "deliveries", "project", "interrupted.upload");
        Directory.CreateDirectory(Path.GetDirectoryName(interruptedUpload)!);
        Directory.CreateDirectory(Path.GetDirectoryName(interruptedDelivery)!);
        File.WriteAllText(interruptedUpload, "orphan");
        File.WriteAllText(interruptedDelivery, "orphan");
        var orphanUpload = Path.Combine(root, "uploads", "owner", "project", $"{OrphanUploadId}_orphan.png");
        var orphanDelivery = Path.Combine(root, "deliveries", "project", $"{OrphanDeliveryId}_orphan.mp4");
        File.WriteAllText(orphanUpload, "orphan");
        File.WriteAllText(orphanUpload + ".pending", "");
        File.WriteAllText(orphanDelivery, "orphan");
        File.WriteAllText(orphanDelivery + ".pending", "");
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("Lifewood:DataDirectory", root);
            builder.UseSetting("Lifewood:RequireWebAssets", "false");
            builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, LoopbackConnectionStartupFilter>(services));
        });
        ownerClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
    }

    [Fact]
    public async Task AuditToolsRespectPermissionsAndRecordNotificationChanges()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf);
        foreach(var path in new[]{"/api/admin/audit-events", "/api/admin/audit-events/export", "/api/admin/runtime-health"})
            Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync(path)).StatusCode);
        var rules = await ownerClient.GetFromJsonAsync<NotificationRules>("/api/admin/notifications/rules");
        var rule = rules!.Items.First();
        using var save = await Send(ownerClient,HttpMethod.Put,"/api/admin/notifications/rules",csrf,JsonContent.Create(rule with {Enabled=!rule.Enabled}));
        Assert.Equal(HttpStatusCode.OK,save.StatusCode);
        var audit = await ownerClient.GetFromJsonAsync<PagedAuditEventsDto>("/api/admin/audit-events?actionId=notification.config");
        var item = Assert.Single(audit!.Items);
        Assert.Equal("rules/"+rule.Kind,item.TargetId);
        Assert.NotNull(item.Context);
        Assert.Contains(item.Context!.Changes!,x=>x.Field=="enabled" && x.Before!=x.After);
        using var export = await ownerClient.GetAsync("/api/admin/audit-events/export?actionId=notification.config&locale=en-US");
        Assert.Equal(HttpStatusCode.OK,export.StatusCode);
        Assert.Equal("text/csv",export.Content.Headers.ContentType!.MediaType);
        Assert.Contains("Changed notification configuration",await export.Content.ReadAsStringAsync());
        Assert.DoesNotContain(item.TraceId,await export.Content.ReadAsStringAsync());
        using var health = await ownerClient.GetAsync("/api/admin/runtime-health");
        Assert.Equal(HttpStatusCode.OK,health.StatusCode);
        Assert.DoesNotContain(root,await health.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task BootstrapRejectsNonLoopbackClients()
    {
        var remoteRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-remote-bootstrap-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? remoteFactory = null;
        try
        {
            remoteFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("Lifewood:DataDirectory", remoteRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, RemoteConnectionStartupFilter>(services));
            });
            using var client = remoteFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            var csrf = await GetCsrf(client);
            using var response = await Send(client, HttpMethod.Post, "/api/auth/bootstrap", csrf,
                JsonContent.Create(new { displayName = "Remote Owner", email = "remote@example.test", password = "remote-password-123" }));
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.Equal("auth.bootstrap_local_only", await ErrorCode(response));
        }
        finally
        {
            if (remoteFactory is not null) await remoteFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(remoteRoot);
        }
    }

    [Fact]
    public async Task ProductionDefaultLoopbackHttpBootstrapsWithoutCompatibilityFlag()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-production-loopback-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? productionFactory = null;
        try
        {
            productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("Lifewood:DataDirectory", productionRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, LoopbackConnectionStartupFilter>(services));
            });
            using var client = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            var csrf = await GetCsrf(client);
            using var bootstrap = await Send(client, HttpMethod.Post, "/api/auth/bootstrap", csrf,
                JsonContent.Create(new { displayName = "Production Owner", email = "production@example.test", password = "production-password-123" }));
            Assert.Equal(HttpStatusCode.OK, bootstrap.StatusCode);
            using var me = await client.GetAsync("/api/me");
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
        }
        finally
        {
            if (productionFactory is not null) await productionFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(productionRoot);
        }
    }

    [Theory]
    [InlineData("Kestrel:Endpoints:Public:Url", "http://0.0.0.0:5000")]
    [InlineData("HTTP_PORTS", "5000")]
    public async Task ProductionAllowsNonLoopbackHttpRegardlessOfListenerConfigurationSource(string setting, string value)
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-production-nonloopback-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? productionFactory = null;
        try
        {
            productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting(setting, value);
                builder.UseSetting("Lifewood:DataDirectory", productionRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, RemoteConnectionStartupFilter>(services));
            });
            using var client = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            using var response = await client.GetAsync("/api/auth/csrf");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.DoesNotContain(response.Headers.GetValues("Set-Cookie"), value => value.Contains("; secure", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            if (productionFactory is not null) await productionFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(productionRoot);
        }
    }

    [Fact]
    public async Task ProductionRemoteHttpIgnoresForwardedHttpsWithoutTrustedProxy()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-production-spoofed-proxy-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? productionFactory = null;
        try
        {
            productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("Lifewood:DataDirectory", productionRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, RemoteConnectionStartupFilter>(services));
            });
            using var client = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
            request.Headers.Add("X-Forwarded-Proto", "https");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.DoesNotContain(response.Headers.GetValues("Set-Cookie"), value => value.Contains("; secure", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            if (productionFactory is not null) await productionFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(productionRoot);
        }
    }

    [Fact]
    public async Task ProductionAcceptsForwardedHttpsOnlyFromExplicitTrustedProxy()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-production-trusted-proxy-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? productionFactory = null;
        try
        {
            productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("Network:TrustedProxies:0", "203.0.113.10");
                builder.UseSetting("Lifewood:DataDirectory", productionRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, MappedRemoteConnectionStartupFilter>(services));
            });
            using var client = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
            request.Headers.Add("X-Forwarded-Proto", "https");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Contains(response.Headers.GetValues("Set-Cookie"), value => value.Contains("; secure", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            if (productionFactory is not null) await productionFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(productionRoot);
        }
    }

    [Fact]
    public async Task ProductionTrustedLoopbackProxyCanForwardPlainHttpWithoutSecureCookies()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "lifewood-platform-production-loopback-proxy-http-" + Guid.NewGuid().ToString("N"));
        WebApplicationFactory<Program>? productionFactory = null;
        try
        {
            productionFactory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("Network:TrustedProxies:0", "127.0.0.1");
                builder.UseSetting("Lifewood:DataDirectory", productionRoot);
                builder.UseSetting("Lifewood:RequireWebAssets", "false");
                builder.ConfigureServices(services => Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton<Microsoft.AspNetCore.Hosting.IStartupFilter, LoopbackConnectionStartupFilter>(services));
            });
            using var client = productionFactory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            using var request = new HttpRequestMessage(HttpMethod.Get, "/api/auth/csrf");
            request.Headers.Host = "127.0.0.1";
            request.Headers.Add("X-Forwarded-Proto", "http");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.DoesNotContain(response.Headers.GetValues("Set-Cookie"), value => value.Contains("; secure", StringComparison.OrdinalIgnoreCase));
        }
        finally
        {
            if (productionFactory is not null) await productionFactory.DisposeAsync();
            SqliteConnection.ClearAllPools();
            await DeleteTestDirectoryAsync(productionRoot);
        }
    }

    [Fact]
    public async Task BootstrapRejectsNonLoopbackHostOnLoopbackConnection()
    {
        var csrf = await GetCsrf(ownerClient);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/bootstrap")
        {
            Content = JsonContent.Create(new { displayName = "Rebinding Owner", email = "rebinding@example.test", password = "rebinding-password-123" })
        };
        request.Headers.Host = "attacker.example";
        request.Headers.Add("X-CSRF-TOKEN", csrf);

        using var response = await ownerClient.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("auth.bootstrap_local_only", await ErrorCode(response));
    }

    [Fact]
    public async Task AdminWriteReturnsNonRetryableFailureWhenAuditCannotBePersisted()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", csrf,
            JsonContent.Create(new { displayName = "Audit Target", email = "audit-target@example.test", password = "audit-target-password-123", role = "customer" }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var userId = created.RootElement.GetProperty("id").GetString()!;

        using (var connection = new SqliteConnection($"Data Source={Path.Combine(root, "platform.db")}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END;";
            command.ExecuteNonQuery();
        }
        Directory.CreateDirectory(Path.Combine(root, "audit-pending.ndjson"));

        using var update = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{userId}", csrf,
            JsonContent.Create(new { displayName = "Updated Despite Audit Failure", phone = (string?)null, role = "customer", active = true, organizationId = (string?)null }));

        Assert.Equal(HttpStatusCode.InternalServerError, update.StatusCode);
        using var error = JsonDocument.Parse(await update.Content.ReadAsStringAsync());
        Assert.Equal("audit.persistence_failed", error.RootElement.GetProperty("code").GetString());
        Assert.Equal("errors.system.unexpected", error.RootElement.GetProperty("messageKey").GetString());
        Assert.False(error.RootElement.GetProperty("retryable").GetBoolean());
        Assert.False(string.IsNullOrWhiteSpace(error.RootElement.GetProperty("requestId").GetString()));

        using var users = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/admin/users?search=Updated%20Despite%20Audit%20Failure&page=1&pageSize=30"));
        Assert.Equal(userId, Assert.Single(users.RootElement.GetProperty("items").EnumerateArray()).GetProperty("id").GetString());
    }

    [Fact]
    public async Task VoiceSampleEndpointsEnforceSecurityAndManageRealFiles()
    {
        Assert.False(File.Exists(Path.Combine(root, "voice-samples", "interrupted.upload")));
        Assert.False(Directory.EnumerateFiles(Path.Combine(root, "uploads"), "*.upload", SearchOption.AllDirectories).Any());
        Assert.False(Directory.EnumerateFiles(Path.Combine(root, "deliveries"), "*.upload", SearchOption.AllDirectories).Any());
        Assert.DoesNotContain(Directory.EnumerateFiles(Path.Combine(root, "uploads"), "*", SearchOption.AllDirectories), path => Path.GetFileName(path).Contains(OrphanUploadId, StringComparison.Ordinal));
        Assert.DoesNotContain(Directory.EnumerateFiles(Path.Combine(root, "deliveries"), "*", SearchOption.AllDirectories), path => Path.GetFileName(path).Contains(OrphanDeliveryId, StringComparison.Ordinal));
        await BootstrapOwner();
        var ownerCsrf = await GetCsrf(ownerClient);

        using var clearExisting = await Send(ownerClient, HttpMethod.Delete, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf);
        Assert.Equal(HttpStatusCode.OK, clearExisting.StatusCode);
        using var missingPublicSample = await ownerClient.GetAsync($"/api/voices/{VoiceId}/sample");
        Assert.Equal(HttpStatusCode.NotFound, missingPublicSample.StatusCode);

        using (var missingCsrf = AudioRequest(new byte[] { 0x49, 0x44, 0x33 }, "sample.mp3", "audio/mpeg"))
        {
            using var response = await ownerClient.PostAsync($"/api/admin/voices/{VoiceId}/sample", missingCsrf);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("auth.csrf", await ErrorCode(response));
        }

        var headerOnlyWav = new byte[44];
        "RIFF"u8.CopyTo(headerOnlyWav);
        "WAVE"u8.CopyTo(headerOnlyWav.AsSpan(8));
        using (var invalidAudio = AudioRequest(headerOnlyWav, "fake.wav", "audio/wav"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, invalidAudio);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("validation.audio", await ErrorCode(response));
        }
        using (var id3Only = AudioRequest("ID3invalid"u8.ToArray(), "fake.mp3", "audio/mpeg"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, id3Only);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("validation.audio", await ErrorCode(response));
        }
        using (var truncatedMp3 = AudioRequest(new byte[] { 0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00 }, "truncated.mp3", "audio/mpeg"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, truncatedMp3);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("validation.audio", await ErrorCode(response));
        }

        var invalidExtensibleWav = MinimalWav();
        invalidExtensibleWav[20] = 0xfe;
        invalidExtensibleWav[21] = 0xff;
        using (var extensibleAudio = AudioRequest(invalidExtensibleWav, "invalid-extensible.wav", "audio/wav"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, extensibleAudio);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        var misalignedWav = MinimalWav();
        misalignedWav[40] = 0x01;
        using (var misalignedAudio = AudioRequest(misalignedWav, "misaligned.wav", "audio/wav"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, misalignedAudio);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        var wav = MinimalWav();
        using (var validAudio = AudioRequest(wav, "sample.wav", "audio/wav"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, validAudio);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        using var publicSample = await ownerClient.GetAsync($"/api/voices/{VoiceId}/sample");
        Assert.Equal(HttpStatusCode.OK, publicSample.StatusCode);
        Assert.Equal("audio/wav", publicSample.Content.Headers.ContentType?.MediaType);
        Assert.Equal(wav, await publicSample.Content.ReadAsByteArrayAsync());
        Assert.Equal("no-cache", publicSample.Headers.CacheControl?.ToString());

        var oversizedBytes = new byte[20_000_001];
        wav.CopyTo(oversizedBytes, 0);
        using (var oversized = AudioRequest(oversizedBytes, "oversized.wav", "audio/wav"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, oversized);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("validation.audio", await ErrorCode(response));
        }
        Assert.Equal(wav, await ownerClient.GetByteArrayAsync($"/api/voices/{VoiceId}/sample"));

        var storedWav = Path.Combine(root, "voice-samples", VoiceId + ".wav");
        await File.WriteAllBytesAsync(storedWav, oversizedBytes);
        using (var oversizedOnDisk = await ownerClient.GetAsync($"/api/voices/{VoiceId}/sample"))
        {
            Assert.Equal(HttpStatusCode.NotFound, oversizedOnDisk.StatusCode);
        }
        await File.WriteAllBytesAsync(storedWav, wav);

        var mp3 = MinimalMp3();
        using (var replacement = AudioRequest(mp3, "replacement.mp3", "audio/mpeg"))
        {
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, replacement);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        Assert.False(File.Exists(Path.Combine(root, "voice-samples", VoiceId + ".wav")));
        Assert.True(File.Exists(Path.Combine(root, "voice-samples", VoiceId + ".mp3")));
        using var replacedSample = await ownerClient.GetAsync($"/api/voices/{VoiceId}/sample");
        Assert.Equal("audio/mpeg", replacedSample.Content.Headers.ContentType?.MediaType);
        Assert.Equal(mp3, await replacedSample.Content.ReadAsByteArrayAsync());

        var initialMp3 = mp3;
        mp3 = MinimalMp3(1024);
        async Task<bool> ReadDuringReplacement()
        {
            using var response = await ownerClient.GetAsync($"/api/admin/voices/{VoiceId}/sample");
            var bytes = await response.Content.ReadAsByteArrayAsync();
            return response.StatusCode == HttpStatusCode.OK && (bytes.SequenceEqual(initialMp3) || bytes.SequenceEqual(mp3));
        }
        async Task<bool> ReplaceDuringPlayback()
        {
            using var content = AudioRequest(mp3, "concurrent.mp3", "audio/mpeg");
            using var response = await Send(ownerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf, content);
            return response.StatusCode == HttpStatusCode.OK;
        }
        var concurrentOperations = Enumerable.Range(0, 6).Select(_ => ReadDuringReplacement())
            .Concat(Enumerable.Range(0, 3).Select(_ => ReplaceDuringPlayback()));
        Assert.All(await Task.WhenAll(concurrentOperations), Assert.True);

        var voice = await FindAdminVoice(ownerClient, VoiceId);
        var disablePayload = new
        {
            nameZhCn = voice.GetProperty("nameZhCn").GetString(),
            nameEnUs = voice.GetProperty("nameEnUs").GetString(),
            descriptionZhCn = voice.GetProperty("descriptionZhCn").GetString(),
            descriptionEnUs = voice.GetProperty("descriptionEnUs").GetString(),
            tagIds = voice.GetProperty("tagIds").EnumerateArray().Select(item => item.GetString()).ToArray(),
            recommended = voice.GetProperty("recommended").GetBoolean(),
            enabled = false,
            sortOrder = voice.GetProperty("sortOrder").GetInt32(),
            expectedUpdatedAt = voice.GetProperty("updatedAt").GetString()
        };
        using var disableResponse = await Send(ownerClient, HttpMethod.Put, $"/api/admin/voices/{VoiceId}", ownerCsrf, JsonContent.Create(disablePayload));
        Assert.Equal(HttpStatusCode.OK, disableResponse.StatusCode);
        using var disabledPublicSample = await ownerClient.GetAsync($"/api/voices/{VoiceId}/sample");
        Assert.Equal(HttpStatusCode.NotFound, disabledPublicSample.StatusCode);
        using var adminPreview = await ownerClient.GetAsync($"/api/admin/voices/{VoiceId}/sample");
        Assert.Equal(HttpStatusCode.OK, adminPreview.StatusCode);
        Assert.Equal(mp3, await adminPreview.Content.ReadAsByteArrayAsync());

        using var customerClient = await CreateCustomerClient(ownerCsrf);
        var customerCsrf = await GetCsrf(customerClient);
        using (var forbiddenAudio = AudioRequest(wav, "forbidden.wav", "audio/wav"))
        {
            using var response = await Send(customerClient, HttpMethod.Post, $"/api/admin/voices/{VoiceId}/sample", customerCsrf, forbiddenAudio);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }

        using var deleteResponse = await Send(ownerClient, HttpMethod.Delete, $"/api/admin/voices/{VoiceId}/sample", ownerCsrf);
        Assert.Equal(HttpStatusCode.OK, deleteResponse.StatusCode);
        Assert.False(File.Exists(Path.Combine(root, "voice-samples", VoiceId + ".wav")));
        Assert.False(File.Exists(Path.Combine(root, "voice-samples", VoiceId + ".mp3")));
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(root, "voice-samples"), VoiceId + ".*.backup"));
        using var missingAdminSample = await ownerClient.GetAsync($"/api/admin/voices/{VoiceId}/sample");
        Assert.Equal(HttpStatusCode.NotFound, missingAdminSample.StatusCode);
    }

    [Fact]
    public async Task AdminOverviewRequiresAdministratorPermission()
    {
        await BootstrapOwner();
        using var ownerOverview = await ownerClient.GetAsync("/api/admin/overview");
        Assert.Equal(HttpStatusCode.OK, ownerOverview.StatusCode);
        using var overview = JsonDocument.Parse(await ownerOverview.Content.ReadAsStringAsync());
        Assert.True(overview.RootElement.TryGetProperty("totalProjects", out _));
        Assert.True(overview.RootElement.TryGetProperty("workflowStatuses", out _));

        var csrf = await GetCsrf(ownerClient);
        using var customerClient = await CreateCustomerClient(csrf);
        using var forbidden = await customerClient.GetAsync("/api/admin/overview");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [Fact]
    public async Task FinalDeliveryUploadUsesValidatedFileAndLeavesNoPendingArtifacts()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var projectId = created.RootElement.GetProperty("id").GetString()!;
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(root, "platform.db")}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE projects SET status = 'submitted', workflow_status = 'new', workflow_updated_at = updated_at WHERE id = $id;";
            command.Parameters.AddWithValue("$id", projectId);
            command.ExecuteNonQuery();
        }

        using var content = new MultipartFormDataContent();
        var video = new ByteArrayContent(MinimalMp4());
        video.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        content.Add(video, "file", "final.mp4");
        content.Add(new StringContent("Ready for customer review."), "note");
        using var publish = await Send(ownerClient, HttpMethod.Post, $"/api/admin/projects/{projectId}/deliveries", csrf, content);

        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
        using var published = JsonDocument.Parse(await publish.Content.ReadAsStringAsync());
        var deliveryId = published.RootElement.GetProperty("id").GetString()!;
        var deliveryFolder = Path.Combine(root, "deliveries", projectId);
        var storedDelivery = Assert.Single(Directory.EnumerateFiles(deliveryFolder, $"{deliveryId}_*"));
        Assert.Empty(Directory.EnumerateFiles(deliveryFolder, "*.upload"));
        Assert.Empty(Directory.EnumerateFiles(deliveryFolder, "*.pending"));

        using var duplicateContent = new MultipartFormDataContent();
        var duplicateVideo = new ByteArrayContent(MinimalMp4());
        duplicateVideo.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        duplicateContent.Add(duplicateVideo, "file", "replacement.mp4");
        using var duplicate = await Send(ownerClient, HttpMethod.Post, $"/api/admin/projects/{projectId}/deliveries", csrf, duplicateContent);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        using var duplicateError = JsonDocument.Parse(await duplicate.Content.ReadAsStringAsync());
        Assert.Equal("delivery.active_exists", duplicateError.RootElement.GetProperty("code").GetString());
        Assert.Single(Directory.EnumerateFiles(deliveryFolder), path => !path.EndsWith(".upload", StringComparison.Ordinal) && !path.EndsWith(".pending", StringComparison.Ordinal));

        File.WriteAllText(storedDelivery + ".pending", "");

        using var download = await ownerClient.GetAsync($"/api/admin/projects/{projectId}/deliveries/{deliveryId}/file");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("video/mp4", download.Content.Headers.ContentType?.MediaType);
        using var revoke = await Send(ownerClient, HttpMethod.Delete, $"/api/admin/projects/{projectId}/deliveries/{deliveryId}", csrf);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);
        Assert.DoesNotContain(Directory.EnumerateFiles(deliveryFolder), path => Path.GetFileName(path).StartsWith(deliveryId, StringComparison.Ordinal));
    }

    [Fact]
    public async Task SubmissionSnapshotPreservesBilingualLabelsAndProjectIsolation()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var me = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me"));
        var ownerId = me.RootElement.GetProperty("id").GetString()!;
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var projectId = created.RootElement.GetProperty("id").GetString()!;
        var version = created.RootElement.GetProperty("version").GetInt32();
        var snapshot = new SubmissionConfigurationSnapshotDto(
            1,
            DateTimeOffset.UtcNow,
            [new AdminFormOptionDto("brands", "brand-a", "品牌 A", "Brand A", null, null, null, null, false, true, 0, DateTimeOffset.UtcNow)],
            [],
            []);
        var repository = new ProjectRepository($"Data Source={Path.Combine(root, "platform.db")}");
        Assert.Equal(SaveOutcome.Saved, repository.Submit(ownerId, projectId, version, Guid.NewGuid().ToString("N"), snapshot).Outcome);

        using var customerSnapshot = await ownerClient.GetAsync($"/api/projects/{projectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.OK, customerSnapshot.StatusCode);
        using var customerDocument = JsonDocument.Parse(await customerSnapshot.Content.ReadAsStringAsync());
        var option = Assert.Single(customerDocument.RootElement.GetProperty("formOptions").EnumerateArray());
        Assert.Equal("品牌 A", option.GetProperty("labelZhCn").GetString());
        Assert.Equal("Brand A", option.GetProperty("labelEnUs").GetString());

        using var adminSnapshot = await ownerClient.GetAsync($"/api/admin/projects/{projectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.OK, adminSnapshot.StatusCode);

        using var changeLiveOption = await Send(ownerClient, HttpMethod.Put, "/api/admin/form-options/brands/brand-a", csrf,
            JsonContent.Create(new
            {
                labelZhCn = "品牌 A（已改名）",
                labelEnUs = "Brand A Renamed",
                descriptionZhCn = (string?)null,
                descriptionEnUs = (string?)null,
                tone = (string?)null,
                previewColor = (string?)null,
                enabled = false,
                sortOrder = 0,
                expectedUpdatedAt = (string?)null,
                allowsCustomValue = false
            }));
        Assert.Equal(HttpStatusCode.OK, changeLiveOption.StatusCode);
        using var unchangedSnapshot = JsonDocument.Parse(await ownerClient.GetStringAsync($"/api/projects/{projectId}/submission-snapshot"));
        Assert.Equal("品牌 A", Assert.Single(unchangedSnapshot.RootElement.GetProperty("formOptions").EnumerateArray()).GetProperty("labelZhCn").GetString());

        using var createLegacy = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, createLegacy.StatusCode);
        using var legacyDocument = JsonDocument.Parse(await createLegacy.Content.ReadAsStringAsync());
        var legacyProjectId = legacyDocument.RootElement.GetProperty("id").GetString()!;
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(root, "platform.db")}"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE projects SET status = 'submitted', submission_snapshot_json = NULL WHERE id = $id;";
            command.Parameters.AddWithValue("$id", legacyProjectId);
            command.ExecuteNonQuery();
        }
        using var legacyCustomerSnapshot = await ownerClient.GetAsync($"/api/projects/{legacyProjectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.NotFound, legacyCustomerSnapshot.StatusCode);
        using var legacyAdminSnapshot = await ownerClient.GetAsync($"/api/admin/projects/{legacyProjectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.NotFound, legacyAdminSnapshot.StatusCode);

        using var otherCustomer = await CreateCustomerClient(csrf);
        using var isolated = await otherCustomer.GetAsync($"/api/projects/{projectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.OK, isolated.StatusCode);
        using var forbiddenAdmin = await otherCustomer.GetAsync($"/api/admin/projects/{projectId}/submission-snapshot");
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenAdmin.StatusCode);
    }

    [Fact]
    public async Task AvatarEndpointsPersistRealImagesAndRestoreGeneratedDefault()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);

        using (var defaultAvatar = await ownerClient.GetAsync("/api/me/avatar"))
        {
            Assert.Equal(HttpStatusCode.OK, defaultAvatar.StatusCode);
            Assert.Equal("image/svg+xml", defaultAvatar.Content.Headers.ContentType?.MediaType);
        }

        using (var invalid = AvatarRequest("not-an-image"u8.ToArray(), "fake.png", "image/png"))
        using (var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, invalid))
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("validation.failed", await ErrorCode(response));
        }
        var fakeJpeg = new byte[] { 0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0xFF, 0xD9 };
        var fakePng = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 };
        var fakeWebp = new byte[] { 0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };
        foreach (var fake in new[] { (fakeJpeg, "fake.jpg", "image/jpeg"), (fakePng, "header.png", "image/png"), (fakeWebp, "shell.webp", "image/webp") })
        {
            using var upload = AvatarRequest(fake.Item1, fake.Item2, fake.Item3);
            using var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, upload);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        var duplicateHeader = png[..33].Concat(png[8..33]).Concat(png[33..]).ToArray();
        var invalidPaletteIndex = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAAA1BMVEUAAACnej3aAAAACklEQVR4nGNgBAAAAwACS/Xd6gAAAABJRU5ErkJggg==");
        foreach (var malformed in new[] { duplicateHeader, invalidPaletteIndex })
        {
            using var upload = AvatarRequest(malformed, "malformed.png", "image/png");
            using var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, upload);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        var interlacedPng = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAFoEvQfAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==");
        using (var upload = AvatarRequest(interlacedPng, "interlaced.png", "image/png"))
        using (var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, upload))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
        var oversizedDimensions = png.ToArray();
        oversizedDimensions[16] = 0x00;
        oversizedDimensions[17] = 0x00;
        oversizedDimensions[18] = 0x10;
        oversizedDimensions[19] = 0x01;
        using (var oversizedImage = AvatarRequest(oversizedDimensions, "oversized.png", "image/png"))
        using (var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, oversizedImage))
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        using (var upload = AvatarRequest(png, "avatar.png", "image/png"))
        using (var response = await Send(ownerClient, HttpMethod.Post, "/api/me/avatar", csrf, upload))
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var updated = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.True(updated.RootElement.GetProperty("hasCustomAvatar").GetBoolean());
            Assert.Contains("/api/me/avatar?v=", updated.RootElement.GetProperty("avatarUrl").GetString());
        }

        using (var storedAvatar = await ownerClient.GetAsync("/api/me/avatar"))
        {
            Assert.Equal(HttpStatusCode.OK, storedAvatar.StatusCode);
            Assert.Equal("image/png", storedAvatar.Content.Headers.ContentType?.MediaType);
            Assert.Equal(png, await storedAvatar.Content.ReadAsByteArrayAsync());
        }

        using (var me = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me")))
        {
            Assert.True(me.RootElement.GetProperty("hasCustomAvatar").GetBoolean());
        }

        using (var remove = await Send(ownerClient, HttpMethod.Delete, "/api/me/avatar", csrf))
        {
            Assert.Equal(HttpStatusCode.OK, remove.StatusCode);
            using var updated = JsonDocument.Parse(await remove.Content.ReadAsStringAsync());
            Assert.False(updated.RootElement.GetProperty("hasCustomAvatar").GetBoolean());
            Assert.StartsWith("/api/me/avatar?v=", updated.RootElement.GetProperty("avatarUrl").GetString());
        }
        using (var restored = await ownerClient.GetAsync("/api/me/avatar"))
        {
            Assert.Equal("image/svg+xml", restored.Content.Headers.ContentType?.MediaType);
        }
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(root, "avatars")));
    }

    [Fact]
    public async Task NewDraftUsesCurrentUserContactAndOrganizationProfile()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);

        using var organizationResponse = await Send(ownerClient, HttpMethod.Post, "/api/admin/organizations", csrf,
            JsonContent.Create(new { name = "Lifewood Books" }));
        Assert.Equal(HttpStatusCode.OK, organizationResponse.StatusCode);
        using var organization = JsonDocument.Parse(await organizationResponse.Content.ReadAsStringAsync());
        var organizationId = organization.RootElement.GetProperty("id").GetString();

        using var meResponse = await ownerClient.GetAsync("/api/me");
        using var me = JsonDocument.Parse(await meResponse.Content.ReadAsStringAsync());
        var ownerId = me.RootElement.GetProperty("id").GetString();

        using var updateResponse = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{ownerId}", csrf,
            JsonContent.Create(new { displayName = "Owner", phone = (string?)null, role = "owner", active = true, organizationId }));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);

        using var profileResponse = await Send(ownerClient, HttpMethod.Put, "/api/me/profile", csrf,
            JsonContent.Create(new { displayName = "Test Owner", clientName = "Preferred Client", phone = "+86 138 0000 0000" }));
        Assert.Equal(HttpStatusCode.OK, profileResponse.StatusCode);

        using var created = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var draft = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var project = draft.RootElement.GetProperty("project");
        Assert.Equal("Lifewood Books", project.GetProperty("clientName").GetString());
        Assert.Equal("Test Owner", project.GetProperty("contactName").GetString());
        Assert.Equal("owner@example.test", project.GetProperty("email").GetString());
        Assert.Equal("+86 138 0000 0000", project.GetProperty("phone").GetString());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ProjectCreationRequiresOrganizationForOwnersAndCustomers(bool customer)
    {
        await BootstrapOwner(withOrganization: false);
        var ownerCsrf = await GetCsrf(ownerClient);
        using var customerClient = customer ? await CreateCustomerClient(ownerCsrf) : null;
        var client = customerClient ?? ownerClient;
        var csrf = await GetCsrf(client);
        var account = (await client.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        Assert.Null(account.Organization);
        using var denied = await Send(client, HttpMethod.Post, "/api/projects", csrf,
            JsonContent.Create(new { clientName = "Forged Client", organization = new { id = "fake", name = "Fake Organization" } }));
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("project.organization_required", await ErrorCode(denied));
        using var error = JsonDocument.Parse(await denied.Content.ReadAsStringAsync());
        Assert.Equal("errors.project.organizationRequired", error.RootElement.GetProperty("messageKey").GetString());
        var projects = new ProjectRepository($"Data Source={Path.Combine(root, "platform.db")}");
        Assert.Equal(0, projects.CountDrafts(account.Id));

        using var organizationResponse = await Send(ownerClient, HttpMethod.Post, "/api/admin/organizations", ownerCsrf, JsonContent.Create(new { name = "Assigned Organization" }));
        Assert.Equal(HttpStatusCode.OK, organizationResponse.StatusCode);
        using var organization = JsonDocument.Parse(await organizationResponse.Content.ReadAsStringAsync());
        var organizationId = organization.RootElement.GetProperty("id").GetString();
        using var assigned = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{account.Id}", ownerCsrf,
            JsonContent.Create(new { displayName = account.DisplayName, role = customer ? "customer" : "owner", active = true, organizationId }));
        Assert.Equal(HttpStatusCode.OK, assigned.StatusCode);
        using var created = await Send(client, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { clientName = "Forged Client" }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var draft = (await created.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal("Assigned Organization", draft.Project.ClientName);

        using var unassigned = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{account.Id}", ownerCsrf,
            JsonContent.Create(new { displayName = account.DisplayName, role = customer ? "customer" : "owner", active = true, organizationId = (string?)null }));
        Assert.Equal(HttpStatusCode.OK, unassigned.StatusCode);
        using var deniedAgain = await Send(client, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new {}));
        Assert.Equal(HttpStatusCode.Forbidden, deniedAgain.StatusCode);
        Assert.Equal("project.organization_required", await ErrorCode(deniedAgain));
        var existing = (await client.GetFromJsonAsync<TaskDraftDto>($"/api/projects/{draft.Id}"))!;
        Assert.Equal("Assigned Organization", existing.Project.ClientName);
        Assert.Equal(1, projects.CountDrafts(account.Id));
    }

    [Fact]
    public async Task BootstrapAcceptsOptionalContactAndOrganizationProfile()
    {
        var csrf = await GetCsrf(ownerClient);
        using var response = await Send(ownerClient, HttpMethod.Post, "/api/auth/bootstrap", csrf,
            JsonContent.Create(new
            {
                displayName = "Initial Owner",
                email = "initial@example.test",
                password = "owner-password-123",
                phone = "+1 801 555 0100",
                organizationName = "Deseret Book",
                locale = "en-US"
            }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal("Initial Owner", document.RootElement.GetProperty("displayName").GetString());
        Assert.Equal("+1 801 555 0100", document.RootElement.GetProperty("phone").GetString());
        Assert.Equal("Deseret Book", document.RootElement.GetProperty("organization").GetProperty("name").GetString());
        Assert.Equal("Deseret Book", document.RootElement.GetProperty("clientName").GetString());
        Assert.Equal("en-US", document.RootElement.GetProperty("locale").GetString());

        var preferenceCsrf = await GetCsrf(ownerClient);
        using var preferenceResponse = await Send(ownerClient, HttpMethod.Put, "/api/me/preferences", preferenceCsrf,
            JsonContent.Create(new { locale = "zh-CN" }));
        Assert.Equal(HttpStatusCode.OK, preferenceResponse.StatusCode);
        using var preference = JsonDocument.Parse(await preferenceResponse.Content.ReadAsStringAsync());
        Assert.Equal("zh-CN", preference.RootElement.GetProperty("locale").GetString());
    }

    [Fact]
    public async Task AdministratorWorkflowDoesNotExposeOrMutateCustomerDrafts()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var created = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var createdDocument = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var draftId = createdDocument.RootElement.GetProperty("id").GetString();

        using var list = await ownerClient.GetAsync("/api/admin/projects");
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        using var listDocument = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
        Assert.Equal(0, listDocument.RootElement.GetProperty("total").GetInt32());

        using var detail = await ownerClient.GetAsync($"/api/admin/projects/{draftId}");
        Assert.Equal(HttpStatusCode.NotFound, detail.StatusCode);
        using var workflow = await Send(ownerClient, HttpMethod.Put, $"/api/admin/projects/{draftId}/workflow", csrf,
            JsonContent.Create(new { workflowStatus = "contacting", priority = "normal", assigneeUserId = (string?)null }));
        Assert.Equal(HttpStatusCode.NotFound, workflow.StatusCode);
        using var note = await Send(ownerClient, HttpMethod.Post, $"/api/admin/projects/{draftId}/notes", csrf,
            JsonContent.Create(new { body = "A draft must not enter internal follow-up." }));
        Assert.Equal(HttpStatusCode.NotFound, note.StatusCode);
    }

    [Fact]
    public async Task AuditQueryRecordsOnlySuccessfulAdministratorWritesAndRequiresPermission()
    {
        using var anonymous = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var unauthorized = await anonymous.GetAsync("/api/admin/audit-events");
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var created = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", csrf,
            JsonContent.Create(new { displayName = "Audit Customer", email = "audit@example.test", password = "audit-password-123", role = "customer" }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var createdUser = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var createdUserId = createdUser.RootElement.GetProperty("id").GetString();
        using var duplicate = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", csrf,
            JsonContent.Create(new { displayName = "Duplicate", email = "audit@example.test", password = "audit-password-123", role = "customer" }));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        ownerClient.DefaultRequestHeaders.AcceptLanguage.Clear();
        ownerClient.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en-US");
        using var actionsResponse = await ownerClient.GetAsync("/api/admin/audit-actions");
        Assert.Equal(HttpStatusCode.OK, actionsResponse.StatusCode);
        using var actions = JsonDocument.Parse(await actionsResponse.Content.ReadAsStringAsync());
        Assert.Contains(actions.RootElement.EnumerateArray(), item =>
            item.GetProperty("id").GetString() == "user.create" && item.GetProperty("label").GetString() == "Created user");

        using var eventsResponse = await ownerClient.GetAsync("/api/admin/audit-events?actionId=user.create&page=1&pageSize=30");
        Assert.Equal(HttpStatusCode.OK, eventsResponse.StatusCode);
        using var events = JsonDocument.Parse(await eventsResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, events.RootElement.GetProperty("total").GetInt32());
        var auditEvent = Assert.Single(events.RootElement.GetProperty("items").EnumerateArray());
        Assert.Equal("Test Owner", auditEvent.GetProperty("actorName").GetString());
        Assert.Equal("user.create", auditEvent.GetProperty("actionId").GetString());
        Assert.Equal(createdUserId, auditEvent.GetProperty("targetId").GetString());
        Assert.False(auditEvent.TryGetProperty("password", out _));
        var actorUserId = auditEvent.GetProperty("actorUserId").GetString();
        using var avatar = await ownerClient.GetAsync($"/api/admin/audit-avatar/{actorUserId}?name=Test%20Owner");
        Assert.Equal(HttpStatusCode.OK, avatar.StatusCode);
        Assert.Equal("image/svg+xml", avatar.Content.Headers.ContentType?.MediaType);

        using var customerClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var customerCsrf = await GetCsrf(customerClient);
        using var login = await Send(customerClient, HttpMethod.Post, "/api/auth/login", customerCsrf,
            JsonContent.Create(new { email = "audit@example.test", password = "audit-password-123", rememberMe = false }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var forbidden = await customerClient.GetAsync("/api/admin/audit-events");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        using var forbiddenAvatar = await customerClient.GetAsync($"/api/admin/audit-avatar/{actorUserId}?name=Test%20Owner");
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenAvatar.StatusCode);
    }

    [Fact]
    public async Task AccountSwitchingRequiresVerifiedDeviceSessionsAndRejectsStalePageWrites()
    {
        await BootstrapOwner();
        var csrf=await GetCsrf(ownerClient);
        using var me=JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me"));
        var first=me.RootElement.GetProperty("id").GetString()!;
        using var created=await Send(ownerClient,HttpMethod.Post,"/api/admin/users",csrf,JsonContent.Create(new{displayName="Switch Customer",email="switch@example.test",password="switch-password-123",role="customer"}));
        Assert.Equal(HttpStatusCode.OK,created.StatusCode);
        using var createdJson=JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var second=createdJson.RootElement.GetProperty("id").GetString()!;
        using var unverified=await Send(ownerClient,HttpMethod.Post,"/api/auth/accounts/switch",csrf,JsonContent.Create(new{id=second}));
        Assert.Equal(HttpStatusCode.Unauthorized,unverified.StatusCode);
        using var bad=await Send(ownerClient,HttpMethod.Post,"/api/auth/accounts/add",csrf,JsonContent.Create(new{email="switch@example.test",password="wrong",rememberMe=true}));
        Assert.Equal(HttpStatusCode.Unauthorized,bad.StatusCode);
        using var added=await Send(ownerClient,HttpMethod.Post,"/api/auth/accounts/add",csrf,JsonContent.Create(new{email="switch@example.test",password="switch-password-123",rememberMe=true}));
        Assert.Equal(HttpStatusCode.OK,added.StatusCode);
        Assert.Contains(added.Headers.GetValues("Set-Cookie"),cookie=>cookie.StartsWith("lw_accounts=")&&cookie.Contains("httponly",StringComparison.OrdinalIgnoreCase));
        csrf=await GetCsrf(ownerClient);
        using(var list=JsonDocument.Parse(await ownerClient.GetStringAsync("/api/auth/accounts"))) Assert.Equal(2,list.RootElement.GetProperty("items").GetArrayLength());
        using var staleRequest=new HttpRequestMessage(HttpMethod.Post,"/api/projects"){Content=JsonContent.Create(new{})};
        staleRequest.Headers.Add("X-CSRF-TOKEN",csrf);staleRequest.Headers.Add("X-LW-Account",first);
        using var stale=await ownerClient.SendAsync(staleRequest);
        Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);Assert.Equal("auth.account_changed",await ErrorCode(stale));
        using var switched=await Send(ownerClient,HttpMethod.Post,"/api/auth/accounts/switch",csrf,JsonContent.Create(new{id=first}));
        Assert.Equal(HttpStatusCode.OK,switched.StatusCode);
        using(var user=JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me")))Assert.Equal(first,user.RootElement.GetProperty("id").GetString());
        using var separate=factory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=true});
        var otherCsrf=await GetCsrf(separate);
        using var login=await Send(separate,HttpMethod.Post,"/api/auth/login",otherCsrf,JsonContent.Create(new{email="switch@example.test",password="switch-password-123",rememberMe=false}));
        Assert.Equal(HttpStatusCode.OK,login.StatusCode);otherCsrf=await GetCsrf(separate);
        using var foreign=await Send(separate,HttpMethod.Post,"/api/auth/accounts/switch",otherCsrf,JsonContent.Create(new{id=first}));
        Assert.Equal(HttpStatusCode.Unauthorized,foreign.StatusCode);
        csrf=await GetCsrf(ownerClient);
        using var removed=await Send(ownerClient,HttpMethod.Delete,$"/api/auth/accounts/{second}",csrf);
        Assert.Equal(HttpStatusCode.NoContent,removed.StatusCode);
        using var removedSwitch=await Send(ownerClient,HttpMethod.Post,"/api/auth/accounts/switch",csrf,JsonContent.Create(new{id=second}));
        Assert.Equal(HttpStatusCode.Unauthorized,removedSwitch.StatusCode);
        using var logout=await Send(ownerClient,HttpMethod.Post,"/api/auth/logout",csrf);
        Assert.Equal(HttpStatusCode.NoContent,logout.StatusCode);
        using var anonymous=await ownerClient.GetAsync("/api/auth/accounts");Assert.Equal(HttpStatusCode.Unauthorized,anonymous.StatusCode);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CustomerCanDeleteReturnedProjectWithHistoryAndFilesAndRecoverFromStorageFailure(bool hasUploads)
    {
        await BootstrapOwner();
        var ownerCsrf = await GetCsrf(ownerClient);
        using var created = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", ownerCsrf,
            JsonContent.Create(new { displayName = "Returning Customer", email = "return-delete@example.test", password = "return-delete-123", role = "customer" }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var csrf = await GetCsrf(client);
        using var login = await Send(client, HttpMethod.Post, "/api/auth/login", csrf,
            JsonContent.Create(new { email = "return-delete@example.test", password = "return-delete-123", rememberMe = false }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        csrf = await GetCsrf(client);
        using var me = JsonDocument.Parse(await client.GetStringAsync("/api/me"));
        var userId = me.RootElement.GetProperty("id").GetString()!;
        var connection = $"Data Source={Path.Combine(root, "platform.db")}";
        var repository = new ProjectRepository(connection);
        var revisions = new Lifewood.PlatformApi.Features.RevisionStore(connection);
        var draft = repository.Create(userId);
        var submitted = repository.Submit(userId, draft.Id, draft.Version, Guid.NewGuid().ToString(), null).Draft!;
        using var ownerMe = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me"));
        var actor = new CurrentUserDto(ownerMe.RootElement.GetProperty("id").GetString()!, null, "Owner", null, null, null, [], [], "en-US", null);
        Assert.True(revisions.Return(draft.Id, new(submitted.Version, [new("project", "Update details")], submitted.UpdatedAt), actor));
        draft = repository.Get(userId, draft.Id)!;
        var uploadFolder = Path.Combine(root, "uploads", userId, draft.Id);
        var deliveryFolder = Path.Combine(root, "deliveries", draft.Id);
        if (hasUploads) Directory.CreateDirectory(uploadFolder);
        Directory.CreateDirectory(deliveryFolder);
        var upload = Path.Combine(uploadFolder, "source.txt"); var delivery = Path.Combine(deliveryFolder, "video.mp4");
        if (hasUploads) await File.WriteAllTextAsync(upload, "source");
        await File.WriteAllTextAsync(delivery, "delivery");
        using var stale = await Send(client, HttpMethod.Delete, $"/api/projects/{draft.Id}?version={draft.Version - 1}", csrf);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        using var wrongOwner = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{draft.Id}?version={draft.Version}", ownerCsrf);
        Assert.Equal(HttpStatusCode.NotFound, wrongOwner.StatusCode);
        void Sql(string sql) { using var c = new SqliteConnection(connection); c.Open(); using var q = c.CreateCommand(); q.CommandText=sql; q.ExecuteNonQuery(); }
        Sql("CREATE TRIGGER reject_test_delete BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT,'test storage failure'); END;");
        using var failed = await Send(client, HttpMethod.Delete, $"/api/projects/{draft.Id}?version={draft.Version}", csrf);
        Assert.Equal(HttpStatusCode.InternalServerError, failed.StatusCode);
        Assert.Equal(hasUploads, File.Exists(upload)); Assert.True(File.Exists(delivery));
        Assert.Single(revisions.View(draft.Id, true, "en-US").Rounds);
        Sql("DROP TRIGGER reject_test_delete;");
        using var removed = await Send(client, HttpMethod.Delete, $"/api/projects/{draft.Id}?version={draft.Version}", csrf);
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
        Assert.False(Directory.Exists(uploadFolder)); Assert.False(Directory.Exists(deliveryFolder));
        Assert.Empty(revisions.View(draft.Id, true, "en-US").Rounds);
        using var missing = await ownerClient.GetAsync($"/api/admin/projects/{draft.Id}");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using var c = new SqliteConnection(connection); c.Open(); using var q = c.CreateCommand();
        q.CommandText="SELECT (SELECT COUNT(*) FROM revision_messages) + (SELECT COUNT(*) FROM notification_events) + (SELECT COUNT(*) FROM notification_targets) + (SELECT COUNT(*) FROM notifications)";
        Assert.Equal(0L, (long)q.ExecuteScalar()!);
    }

    [Fact]
    public async Task DraftDeletionRequiresCurrentVersionAndRemovesOnlyDrafts()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var document = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var id = document.RootElement.GetProperty("id").GetString()!;
        var version = document.RootElement.GetProperty("version").GetInt32();
        using var meDocument = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me"));
        var ownerId = meDocument.RootElement.GetProperty("id").GetString()!;
        var uploadFolder = Path.Combine(root, "uploads", ownerId, id);
        Directory.CreateDirectory(uploadFolder);
        await File.WriteAllTextAsync(Path.Combine(uploadFolder, "pending-upload.txt"), "draft attachment");

        using var staleDelete = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{id}?version={version + 1}", csrf);
        Assert.Equal(HttpStatusCode.Conflict, staleDelete.StatusCode);
        Assert.Equal("project.version_conflict", await ErrorCode(staleDelete));
        Assert.True(File.Exists(Path.Combine(uploadFolder, "pending-upload.txt")));
        using var stillPresent = await ownerClient.GetAsync($"/api/projects/{id}");
        Assert.Equal(HttpStatusCode.OK, stillPresent.StatusCode);

        using var delete = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{id}?version={version}", csrf);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.False(Directory.Exists(uploadFolder));
        var tombstoneRoot = Path.Combine(root, "uploads", ".deleted");
        Assert.False(Directory.Exists(tombstoneRoot) && Directory.EnumerateDirectories(tombstoneRoot, "*", SearchOption.AllDirectories).Any());
        using var missing = await ownerClient.GetAsync($"/api/projects/{id}");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Theory]
    [InlineData("book-cover")]
    [InlineData("style-reference")]
    public async Task RetryingTheSameUploadReturnsTheStoredFileWithoutChangingTheDraft(string category)
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        create.EnsureSuccessStatusCode();
        var original = JsonNode.Parse(await create.Content.ReadAsStringAsync())!;
        var id = original["id"]!.GetValue<string>();
        var version = original["version"]!.GetValue<int>();
        var key = Guid.NewGuid().ToString();
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        MultipartFormDataContent Body(string name = "photo.png", string? uploadKey = null)
        {
            var body = ReferenceRequest(png, name, "image/png", version, category);
            body.Add(new StringContent(uploadKey ?? key), "uploadId");
            return body;
        }
        using var firstBody = Body();
        using var secondBody = Body();
        // Both requests carry the original version, as after a lost response or a double click.
        var responses = await Task.WhenAll(
            Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", csrf, firstBody),
            Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", csrf, secondBody));
        using var first = responses[0]; using var second = responses[1];
        first.EnsureSuccessStatusCode(); second.EnsureSuccessStatusCode();
        var a = JsonNode.Parse(await first.Content.ReadAsStringAsync())!;
        var b = JsonNode.Parse(await second.Content.ReadAsStringAsync())!;
        Assert.Equal(a["asset"]!["id"]!.GetValue<string>(), b["asset"]!["id"]!.GetValue<string>());
        Assert.Equal(version + 1, b["draft"]!["version"]!.GetValue<int>());
        var assets = category == "book-cover" ? b["draft"]!["book"]!["sourceAssets"]!.AsArray() : b["draft"]!["creative"]!["styleReferenceImages"]!.AsArray();
        Assert.Single(assets);
        using var download = await ownerClient.GetAsync(a["asset"]!["url"]!.GetValue<string>());
        Assert.Equal(png, await download.Content.ReadAsByteArrayAsync());
        using var changedBody = Body("different.png");
        using var changed = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", csrf, changedBody);
        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        var differentBytes = (byte[])png.Clone(); differentBytes[^1] ^= 1;
        using var differentBody = ReferenceRequest(differentBytes, "photo.png", "image/png", version, category);
        differentBody.Add(new StringContent(key), "uploadId");
        using var different = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", csrf, differentBody);
        Assert.Equal(HttpStatusCode.Conflict, different.StatusCode);
        using var invalidBody = Body(uploadKey: "../../file");
        using var invalid = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", csrf, invalidBody);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var other = await CreateCustomerClient(csrf);
        var otherCsrf = await GetCsrf(other);
        using var forbiddenBody = Body();
        using var forbidden = await Send(other, HttpMethod.Post, $"/api/projects/{id}/files?categoryId={category}", otherCsrf, forbiddenBody);
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
    }

    [Fact]
    public async Task CreativeReferenceImagesUploadDownloadAndDeleteAsStoredAssets()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var me = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/me"));
        var ownerId = me.RootElement.GetProperty("id").GetString()!;
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        var draft = JsonNode.Parse(await create.Content.ReadAsStringAsync())!.AsObject();
        var id = draft["id"]!.GetValue<string>();
        var characterId = Guid.NewGuid().ToString("N");
        var creative = draft["creative"]!.AsObject();
        creative["characters"] = new JsonArray(new JsonObject
        {
            ["id"] = characterId, ["roleTypeId"] = "protagonist", ["name"] = "Mara", ["storyRole"] = "Lead",
            ["personality"] = "Curious", ["appearance"] = "Traveler", ["ageRangeId"] = null, ["genderId"] = null,
            ["clothing"] = null, ["emotion"] = null, ["voiceHint"] = null,
            ["referenceImageUrls"] = new JsonArray()
        });
        creative.Remove("styleReferenceImages");
        using var save = await Send(ownerClient, HttpMethod.Put, $"/api/projects/{id}/creative", csrf,
            JsonContent.Create(new { version = draft["version"]!.GetValue<int>(), creative }));
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        using var savedDocument = JsonDocument.Parse(await save.Content.ReadAsStringAsync());
        var version = savedDocument.RootElement.GetProperty("version").GetInt32();
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

        using var characterUpload = ReferenceRequest(png, "character.png", "image/png", version, "character-reference", characterId);
        using var uploadResponse = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId=character-reference", csrf, characterUpload);
        Assert.Equal(HttpStatusCode.OK, uploadResponse.StatusCode);
        var uploadedDraft = JsonNode.Parse(await uploadResponse.Content.ReadAsStringAsync())!["draft"]!.AsObject();
        var characterAsset = uploadedDraft["creative"]!["characters"]![0]!["referenceImages"]![0]!;
        var fileId = characterAsset["id"]!.GetValue<string>();
        version = uploadedDraft["version"]!.GetValue<int>();

        using var download = await ownerClient.GetAsync($"/api/projects/{id}/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("image/png", download.Content.Headers.ContentType?.MediaType);
        var storedCharacterFile = Assert.Single(
            Directory.EnumerateFiles(Path.Combine(root, "uploads", ownerId, id), $"{fileId}_*"),
            path => !path.EndsWith(".pending", StringComparison.OrdinalIgnoreCase));
        File.WriteAllText(storedCharacterFile + ".pending", "");
        using var downloadWithPendingMarker = await ownerClient.GetAsync($"/api/projects/{id}/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, downloadWithPendingMarker.StatusCode);

        var webp = "RIFF"u8.ToArray().Concat(new byte[4]).Concat("WEBP"u8.ToArray()).ToArray();
        using var styleUpload = ReferenceRequest(webp, "style.webp", "image/webp", version, "style-reference");
        using var styleResponse = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{id}/files?categoryId=style-reference", csrf, styleUpload);
        Assert.Equal(HttpStatusCode.OK, styleResponse.StatusCode);
        var styleDraft = JsonNode.Parse(await styleResponse.Content.ReadAsStringAsync())!["draft"]!.AsObject();
        var styleFileId = styleDraft["creative"]!["styleReferenceImages"]![0]!["id"]!.GetValue<string>();

        var creativeWithoutCharacter = styleDraft["creative"]!.DeepClone().AsObject();
        creativeWithoutCharacter["characters"] = new JsonArray();
        using var removeCharacter = await Send(ownerClient, HttpMethod.Put, $"/api/projects/{id}/creative", csrf,
            JsonContent.Create(new { version = styleDraft["version"]!.GetValue<int>(), creative = creativeWithoutCharacter }));
        Assert.Equal(HttpStatusCode.BadRequest, removeCharacter.StatusCode);
        Assert.Equal("validation.assets", await ErrorCode(removeCharacter));
        using var retainedDownload = await ownerClient.GetAsync($"/api/projects/{id}/files/{fileId}");
        Assert.Equal(HttpStatusCode.OK, retainedDownload.StatusCode);

        using var deleteCharacterReference = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{id}/files/{fileId}?version={styleDraft["version"]!.GetValue<int>()}", csrf);
        Assert.Equal(HttpStatusCode.OK, deleteCharacterReference.StatusCode);
        var referenceRemovedDraft = JsonNode.Parse(await deleteCharacterReference.Content.ReadAsStringAsync())!.AsObject();
        var creativeAfterReferenceRemoval = referenceRemovedDraft["creative"]!.DeepClone().AsObject();
        creativeAfterReferenceRemoval["characters"] = new JsonArray();
        using var removeCharacterAfterReference = await Send(ownerClient, HttpMethod.Put, $"/api/projects/{id}/creative", csrf,
            JsonContent.Create(new { version = referenceRemovedDraft["version"]!.GetValue<int>(), creative = creativeAfterReferenceRemoval }));
        Assert.Equal(HttpStatusCode.OK, removeCharacterAfterReference.StatusCode);
        var removedDraft = JsonNode.Parse(await removeCharacterAfterReference.Content.ReadAsStringAsync())!.AsObject();
        Assert.Empty(removedDraft["creative"]!["characters"]!.AsArray());
        using var removedDownload = await ownerClient.GetAsync($"/api/projects/{id}/files/{fileId}");
        Assert.Equal(HttpStatusCode.NotFound, removedDownload.StatusCode);
        Assert.DoesNotContain(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories), path => Path.GetFileName(path).Contains(fileId, StringComparison.Ordinal));

        version = removedDraft["version"]!.GetValue<int>();
        using var deleteStyle = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{id}/files/{styleFileId}?version={version}", csrf);
        Assert.Equal(HttpStatusCode.OK, deleteStyle.StatusCode);
    }

    [Fact]
    public async Task OrganizationWordmarksRequirePermissionAndRefreshAfterRename()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);
        using var created=await Send(ownerClient,HttpMethod.Post,"/api/admin/organizations",csrf,JsonContent.Create(new CreateOrganizationRequest("lifewood wordmark")));
        Assert.Equal(HttpStatusCode.OK,created.StatusCode);var org=(await created.Content.ReadFromJsonAsync<AdminOrganizationDto>())!;
        using var image=await ownerClient.GetAsync(org.AvatarUrl);Assert.Equal(HttpStatusCode.OK,image.StatusCode);Assert.Equal("image/svg+xml",image.Content.Headers.ContentType!.MediaType);
        Assert.True(image.Headers.CacheControl!.NoStore);Assert.Contains("LIFEWOOD WORDMARK",await image.Content.ReadAsStringAsync());
        using var customer=await CreateCustomerClient(csrf);Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync(org.AvatarUrl)).StatusCode);
        using var anonymous=factory.CreateClient(new WebApplicationFactoryClientOptions {HandleCookies=false});Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync(org.AvatarUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await ownerClient.GetAsync("/api/admin/organizations/missing/avatar")).StatusCode);
        using var update=await Send(ownerClient,HttpMethod.Put,$"/api/admin/organizations/{org.Id}",csrf,JsonContent.Create(new UpdateOrganizationRequest("新组织名称",true)));
        Assert.Equal(HttpStatusCode.OK,update.StatusCode);var renamed=(await update.Content.ReadFromJsonAsync<AdminOrganizationDto>())!;Assert.NotEqual(org.AvatarUrl,renamed.AvatarUrl);
        Assert.Contains("新组织名称",await ownerClient.GetStringAsync(renamed.AvatarUrl));
    }

    [Fact]
    public async Task OwnerCanCreateDownloadAndDeleteVerifiedBackup()
    {
        await BootstrapOwner(); var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/backups")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/backups/restore")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/backups/restore/history")).StatusCode);
        var customerCsrf=await GetCsrf(customer);
        using var blockedPreflight=await Send(customer,HttpMethod.Post,"/api/admin/backups/not-owned/preflight",customerCsrf,JsonContent.Create(new {}));
        Assert.Equal(HttpStatusCode.Forbidden,blockedPreflight.StatusCode);
        using var blockedRestore=await Send(customer,HttpMethod.Post,"/api/admin/backups/restore",customerCsrf,JsonContent.Create(new RestoreRequest("invalid","RESTORE")));
        Assert.Equal(HttpStatusCode.Forbidden,blockedRestore.StatusCode);
        using var blockedVerify=await Send(customer,HttpMethod.Post,"/api/admin/backups/not-owned/verify",customerCsrf,JsonContent.Create(new {}));
        Assert.Equal(HttpStatusCode.Forbidden,blockedVerify.StatusCode);
        var initial = await ownerClient.GetFromJsonAsync<BackupPage>("/api/admin/backups"); Assert.False(initial!.Schedule.Policy.Enabled);
        using var request = await Send(ownerClient, HttpMethod.Post, "/api/admin/backups", csrf, JsonContent.Create(new {}));
        Assert.Equal(HttpStatusCode.Accepted, request.StatusCode); var job = (await request.Content.ReadFromJsonAsync<BackupRecord>())!;
        BackupRecord? result = null;
        for (var i = 0; i < 200; i++) {
            var list = (await ownerClient.GetFromJsonAsync<BackupPage>("/api/admin/backups/"))!; result = list.Items.Single(x => x.Id == job.Id);
            if (result.Status is "completed" or "failed") break; await Task.Delay(100);
        }
        Assert.Equal("completed", result!.Status); Assert.True(result.Size > 0);
        var previousCheck=result.VerifiedAt;
        using var verification=await Send(ownerClient,HttpMethod.Post,$"/api/admin/backups/{job.Id}/verify",csrf,JsonContent.Create(new {}));Assert.Equal(HttpStatusCode.Accepted,verification.StatusCode);
        for(var i=0;i<200;i++){var list=(await ownerClient.GetFromJsonAsync<BackupPage>("/api/admin/backups"))!;result=list.Items.Single(x=>x.Id==job.Id);if(list.Current is null && result.VerifiedAt>previousCheck)break;await Task.Delay(100);}
        Assert.Equal("passed",result.VerificationStatus);Assert.True(result.VerifiedAt>previousCheck);
        Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/me")).StatusCode);
        var me=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var historical=new RestoreJournal(new RestoreState(Guid.NewGuid().ToString("N"),job.Id,"completed",DateTimeOffset.UtcNow,job.Id),root,root+".backups",null,1,"hidden-executable",[],"hidden-directory",DateTimeOffset.UtcNow,job.CreatedAt,me.Id);
        Lifewood.PlatformApi.Features.RestoreHistory.Save(historical);
        var history=(await ownerClient.GetFromJsonAsync<RestoreHistoryPage>("/api/admin/backups/restore/history"))!;
        Assert.Equal(me.DisplayName,Assert.Single(history.Items).ActorName);Assert.Equal(job.Id,history.Items[0].SafetyBackup!.Id);
        var historyJson=await ownerClient.GetStringAsync("/api/admin/backups/restore/history");Assert.DoesNotContain("hidden-executable",historyJson);Assert.DoesNotContain("actorId",historyJson);

        using var download = await ownerClient.GetAsync($"/api/admin/backups/{job.Id}/download");Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(await download.Content.ReadAsByteArrayAsync()));
        Assert.NotNull(zip.GetEntry("platform.db"));Assert.NotNull(zip.GetEntry(Lifewood.PlatformApi.Features.BackupArchive.ManifestName));
        using var deletion = await Send(ownerClient, HttpMethod.Delete, $"/api/admin/backups/{job.Id}", csrf, null);Assert.Equal(HttpStatusCode.NoContent, deletion.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await ownerClient.GetAsync($"/api/admin/backups/{job.Id}/download")).StatusCode);
        var afterDelete=(await ownerClient.GetFromJsonAsync<RestoreHistoryPage>("/api/admin/backups/restore/history"))!;Assert.Null(Assert.Single(afterDelete.Items).SafetyBackup);

    }

    [Fact]
    public async Task SnapshotGateBlocksWritesButBackupStatusRemainsReadable()
    {
        await BootstrapOwner(); var gate = Microsoft.Extensions.DependencyInjection.ServiceProviderServiceExtensions.GetRequiredService<Lifewood.PlatformApi.Features.BackupGate>(factory.Services);
        using (await gate.PauseAsync(CancellationToken.None)) {
            Assert.Equal(HttpStatusCode.ServiceUnavailable,(await ownerClient.GetAsync("/api/me")).StatusCode);
            Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/admin/backups/")).StatusCode);
            Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/admin/backups/restore/")).StatusCode);
            Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/admin/backups/restore/history/")).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task OwnerCanPersistValidatedRuntimeSettings()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);

        using var initial = await ownerClient.GetAsync("/api/admin/runtime-settings");
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);

        using var invalid = await Send(ownerClient, HttpMethod.Put, "/api/admin/runtime-settings", csrf,
            JsonContent.Create(new { listenAddress = "not a valid address", port = 70000 }));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        using var saved = await Send(ownerClient, HttpMethod.Put, "/api/admin/runtime-settings", csrf,
            JsonContent.Create(new { scheme = "https", listenAddress = "0.0.0.0", port = 5088 }));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        using var payload = JsonDocument.Parse(await saved.Content.ReadAsStringAsync());
        Assert.Equal("https", payload.RootElement.GetProperty("scheme").GetString());
        Assert.Equal("0.0.0.0", payload.RootElement.GetProperty("listenAddress").GetString());
        Assert.Equal(5088, payload.RootElement.GetProperty("port").GetInt32());
        Assert.True(payload.RootElement.GetProperty("restartRequired").GetBoolean());

        using var stored = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, "runtime-settings.json")));
        Assert.Equal("https", stored.RootElement.GetProperty("scheme").GetString());
        Assert.Equal("0.0.0.0", stored.RootElement.GetProperty("listenAddress").GetString());
        Assert.Equal(5088, stored.RootElement.GetProperty("port").GetInt32());
    }

    [Fact]
    public async Task BookIntakeLocksCreatorFieldsAndPreservesDeletedPresets()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new {}));
        var draft = (await create.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal(7, draft.Creative.Characters.Length);
        using var optionsJson = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/form-options"));
        Assert.False(optionsJson.RootElement.GetProperty("bookRecognitionEnabled").GetBoolean());
        Assert.Equal(3, optionsJson.RootElement.GetProperty("sourceCategories").GetArrayLength());
        Assert.Equal(6, optionsJson.RootElement.GetProperty("sourceCategories")[0].GetProperty("maxFiles").GetInt32());
        using var disabled = await Send(ownerClient, HttpMethod.Post, $"/api/projects/{draft.Id}/recognize-book", csrf, JsonContent.Create(new { assetIds = new[] {"not-a-file"} }));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, disabled.StatusCode);
        var tampered = draft.Project with { ClientName="Impersonation", ContactName="Other person", Email="other@example.test", Phone="999", ProjectName="Book project" };
        using var save = await Send(ownerClient, HttpMethod.Put, $"/api/projects/{draft.Id}/draft", csrf, JsonContent.Create(new SaveDraftRequest(draft.Version,tampered,draft.Book)));
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        var saved=(await save.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal(draft.Project.ClientName,saved.Project.ClientName);
        Assert.Equal(draft.Project.ContactName,saved.Project.ContactName);
        Assert.Equal(draft.Project.Email,saved.Project.Email);
        Assert.Equal(draft.Project.Phone,saved.Project.Phone);
        Assert.Equal("Book project",saved.Project.ProjectName);
        using var remove = await Send(ownerClient, HttpMethod.Put, $"/api/projects/{draft.Id}/creative", csrf, JsonContent.Create(new SaveCreativeRequest(saved.Version,saved.Creative with { Characters=[] })));
        Assert.Equal(HttpStatusCode.OK,remove.StatusCode);
        var reloaded = await ownerClient.GetFromJsonAsync<TaskDraftDto>($"/api/projects/{draft.Id}");
        Assert.Empty(reloaded!.Creative.Characters);
    }

    [Theory]
    [InlineData("Step five project", "Step five project")]
    [InlineData("", "Default book title")]
    public async Task StepFiveSavesProjectBasicsAtomicallyAndKeepsCreatorIdentity(string projectName, string expectedName)
    {
        await BootstrapOwner();
        var csrf=await GetCsrf(ownerClient);
        using var create=await Send(ownerClient,HttpMethod.Post,"/api/projects",csrf,JsonContent.Create(new {}));
        var draft=(await create.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        using var bookSave=await Send(ownerClient,HttpMethod.Put,$"/api/projects/{draft.Id}/draft",csrf,
            JsonContent.Create(new SaveDraftRequest(draft.Version,draft.Project,draft.Book with { Title="Default book title" })));
        Assert.Equal(HttpStatusCode.OK, bookSave.StatusCode);
        draft=(await bookSave.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal("Default book title",draft.Project.ProjectName);
        var options=(await ownerClient.GetFromJsonAsync<FormOptionsDto>("/api/form-options"))!;
        var basics=draft.Project with { ProjectName=projectName, BrandId=options.Brands[0].Id,
            VideoGoalId=options.VideoGoals[0].Id, AudienceIds=[options.Audiences[0].Id], Email="spoof@example.test" };
        var voice=draft.VoiceAndReferences with {
            Voiceover=draft.VoiceAndReferences.Voiceover with { NarrationEnabled=false },
            CreativeDirection=draft.VoiceAndReferences.CreativeDirection with { CoreMessage="Test direction" }
        };
        var body=new SaveVoiceAndReferencesRequest(draft.Version,voice,true,basics);
        using var save=await Send(ownerClient,HttpMethod.Put,$"/api/projects/{draft.Id}/voice-and-references",csrf,JsonContent.Create(body));
        Assert.Equal(HttpStatusCode.OK,save.StatusCode);
        var saved=(await save.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal(draft.Version+1,saved.Version);
        Assert.Equal(expectedName,saved.Project.ProjectName);
        Assert.Equal(draft.Project.Email,saved.Project.Email);
        Assert.Equal("Test direction",saved.VoiceAndReferences.CreativeDirection.CoreMessage);
        using var stale=await Send(ownerClient,HttpMethod.Put,$"/api/projects/{draft.Id}/voice-and-references",csrf,JsonContent.Create(body with { Project=basics with { ProjectName="Stale overwrite" }}));
        Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
        var read=(await ownerClient.GetFromJsonAsync<TaskDraftDto>($"/api/projects/{draft.Id}"))!;
        Assert.Equal(saved.Project, read.Project with { AudienceIds=saved.Project.AudienceIds });
        using var voiceOnly=await Send(ownerClient,HttpMethod.Put,$"/api/projects/{draft.Id}/voice-and-references",csrf,JsonContent.Create(new SaveVoiceAndReferencesRequest(saved.Version,voice)));
        Assert.Equal(HttpStatusCode.OK,voiceOnly.StatusCode);
        var updated=(await voiceOnly.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal(expectedName,updated.Project.ProjectName);
    }

    [Fact]
    public async Task RevisionRoundSupportsReplyOnlyResubmissionAndEnforcesAccess()
    {
        await BootstrapOwner();
        var adminCsrf=await GetCsrf(ownerClient);
        using var customer=await CreateCustomerClient(adminCsrf);
        var csrf=await GetCsrf(customer);
        var customerInfo=(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        using var create=await Send(customer,HttpMethod.Post,"/api/projects",csrf,JsonContent.Create(new {}));
        var draft=(await create.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        var repository=new ProjectRepository($"Data Source={Path.Combine(root,"platform.db")}");
        var submitted=repository.Submit(customerInfo.Id,draft.Id,draft.Version,Guid.NewGuid().ToString("N"),null).Draft!;
        var route=$"/api/projects/{draft.Id}";
        var adminDetail=(await ownerClient.GetFromJsonAsync<AdminProjectDetailDto>($"/api/admin/projects/{draft.Id}"))!;
        var request=new {version=submitted.Version,expectedWorkflowUpdatedAt=adminDetail.WorkflowUpdatedAt,reasons=new[]{new {unit="style",body="Clarify"},new {unit="voice",body="Confirm narration"}}};
        using var forbidden=await Send(customer,HttpMethod.Post,$"/api/admin/projects/{draft.Id}/return",csrf,JsonContent.Create(request));
        Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);
        using var returned=await Send(ownerClient,HttpMethod.Post,$"/api/admin/projects/{draft.Id}/return",adminCsrf,JsonContent.Create(request));
        Assert.Equal(HttpStatusCode.OK,returned.StatusCode);
        using var foreign=await ownerClient.GetAsync(route+"/revisions");
        Assert.Equal(HttpStatusCode.OK,foreign.StatusCode);
        Assert.False((await foreign.Content.ReadFromJsonAsync<Lifewood.PlatformApi.Features.RevisionView>())!.CanEdit);
        var view=(await customer.GetFromJsonAsync<Lifewood.PlatformApi.Features.RevisionView>(route+"/revisions"))!;
        var round=Assert.Single(view.Rounds);
        Assert.Null(round.BeforeSnapshot);
        Assert.Equal(2,round.Reasons.Length);
        using var avatar=await customer.GetAsync(round.Messages[0].AvatarUrl);
        Assert.Equal(HttpStatusCode.OK,avatar.StatusCode);
        using var replied=await Send(customer,HttpMethod.Post,route+$"/revisions/{round.Id}/messages",csrf,
            JsonContent.Create(new {id=Guid.NewGuid().ToString("N"),unit="style",body="Please keep the current approach."}));
        Assert.Equal(HttpStatusCode.OK,replied.StatusCode);
        draft=(await customer.GetFromJsonAsync<TaskDraftDto>(route))!;
        using var validate=await Send(customer,HttpMethod.Post,route+"/validate",csrf,JsonContent.Create(new {version=draft.Version}));
        var validation=(await validate.Content.ReadFromJsonAsync<ValidationResultDto>())!;
        Assert.Empty(validation.FieldErrors);
        using var resubmit=await Send(customer,HttpMethod.Post,route+"/submit",csrf,
            JsonContent.Create(new {version=draft.Version,idempotencyKey=Guid.NewGuid().ToString("N")}));
        Assert.Equal(HttpStatusCode.OK,resubmit.StatusCode);
        var history=(await ownerClient.GetFromJsonAsync<Lifewood.PlatformApi.Features.RevisionView>($"/api/admin/projects/{draft.Id}/revisions"))!;
        Assert.NotNull(Assert.Single(history.Rounds).AfterSnapshot);
        Assert.Equal(3,history.Rounds[0].Messages.Length);
    }

    [Fact]
    public async Task CharacterPresetConfigurationEnforcesPermissionsAndKeepsHistoricalImages()
    {
        await BootstrapOwner(); var csrf=await GetCsrf(ownerClient);
        using var customer=await CreateCustomerClient(csrf);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/character-presets")).StatusCode);
        var preset=(await ownerClient.GetFromJsonAsync<AdminCharacterPresetDto[]>("/api/admin/character-presets"))![0];
        var request=new UpsertCharacterPresetRequest(preset.ZhCn with{Name="配置角色"},preset.EnUs with{Name="Configured hero"},true,999,preset.UpdatedAt);
        Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.PutAsJsonAsync("/api/admin/character-presets/"+preset.Id,request)).StatusCode);
        using var savedResponse=await Send(ownerClient,HttpMethod.Put,"/api/admin/character-presets/"+preset.Id,csrf,JsonContent.Create(request));
        Assert.Equal(HttpStatusCode.OK,savedResponse.StatusCode);
        var saved=(await savedResponse.Content.ReadFromJsonAsync<AdminCharacterPresetDto>())!;
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Put,"/api/admin/character-presets/"+preset.Id,csrf,JsonContent.Create(request))).StatusCode);
        var png=Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        MultipartFormDataContent Image(string version, byte[] bytes) {var body=new MultipartFormDataContent();body.Add(new StringContent(version),"expectedUpdatedAt");var file=new ByteArrayContent(bytes);file.Headers.ContentType=new MediaTypeHeaderValue("image/png");body.Add(file,"file","portrait.png");return body;}
        using var invalid=await Send(ownerClient,HttpMethod.Post,$"/api/admin/character-presets/{preset.Id}/image",csrf,Image(saved.UpdatedAt!,[1,2,3]));
        Assert.Equal(HttpStatusCode.BadRequest,invalid.StatusCode);
        using var uploaded=await Send(ownerClient,HttpMethod.Post,$"/api/admin/character-presets/{preset.Id}/image",csrf,Image(saved.UpdatedAt!,png));
        Assert.Equal(HttpStatusCode.OK,uploaded.StatusCode); var first=(await uploaded.Content.ReadFromJsonAsync<AdminCharacterPresetDto>())!;
        using var created=await Send(ownerClient,HttpMethod.Post,"/api/projects?locale=en-US",csrf);
        Assert.Equal(HttpStatusCode.OK,created.StatusCode);var draft=(await created.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        Assert.Equal(first.ImageUrl,draft.Creative.Characters.Single(c=>c.PresetId==preset.Id).PresetImageUrl);
        using var replaced=await Send(ownerClient,HttpMethod.Post,$"/api/admin/character-presets/{preset.Id}/image",csrf,Image(first.UpdatedAt!,png));
        Assert.Equal(HttpStatusCode.OK,replaced.StatusCode); var second=(await replaced.Content.ReadFromJsonAsync<AdminCharacterPresetDto>())!;
        Assert.NotEqual(first.ImageUrl,second.ImageUrl);
        Assert.Equal(png,await customer.GetByteArrayAsync(first.ImageUrl));
        var old=(await ownerClient.GetFromJsonAsync<TaskDraftDto>($"/api/projects/{draft.Id}"))!;
        Assert.Equal(first.ImageUrl,old.Creative.Characters.Single(c=>c.PresetId==preset.Id).PresetImageUrl);
        using var forbidden=await Send(customer,HttpMethod.Post,$"/api/admin/character-presets/{preset.Id}/image",await GetCsrf(customer),Image(second.UpdatedAt!,png));
        Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);
    }

    [Fact]
    public async Task FormOptionDeletionRequiresPermissionCsrfAndCurrentVersion()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);
        using var customer=await CreateCustomerClient(csrf);
        var body=new UpsertFormOptionRequest("待删除","Remove me",null,null,null,null,true,500);
        using var create=await Send(ownerClient,HttpMethod.Put,"/api/admin/form-options/video-goals/removal-test",csrf,JsonContent.Create(body));
        Assert.Equal(HttpStatusCode.OK,create.StatusCode);var option=(await create.Content.ReadFromJsonAsync<AdminFormOptionDto>())!;
        var url="/api/admin/form-options/video-goals/removal-test?expectedUpdatedAt="+Uri.EscapeDataString(option.UpdatedAt.ToString("O"));
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Delete,url,await GetCsrf(customer))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Delete,"/api/admin/form-options/video-goals/removal-test",csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Delete,url,csrf)).StatusCode);
        Assert.DoesNotContain((await ownerClient.GetFromJsonAsync<AdminFormOptionDto[]>("/api/admin/form-options/video-goals"))!,x=>x.Id==option.Id);
        var role=(await ownerClient.GetFromJsonAsync<AdminFormOptionDto[]>("/api/admin/form-options/role-types"))!.Single(x=>x.Id=="protagonist");
        using var referenced=await Send(ownerClient,HttpMethod.Delete,"/api/admin/form-options/role-types/protagonist?expectedUpdatedAt="+Uri.EscapeDataString(role.UpdatedAt.ToString("O")),csrf);
        Assert.Equal(HttpStatusCode.Conflict,referenced.StatusCode);Assert.Equal("config.referenced",await ErrorCode(referenced));
    }

    [Theory]
    [InlineData("/api/admin/file-categories/source")]
    [InlineData("/api/admin/character-presets")]
    [InlineData("/api/admin/voices")]
    public async Task ConfigurationDeletionEnforcesPermissionCsrfVersionAndAudit(string collection)
    {
        await BootstrapOwner(); var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf);
        using var document = JsonDocument.Parse(await ownerClient.GetStringAsync(collection));
        var item = document.RootElement[0]; var id = item.GetProperty("id").GetString();
        var path = collection + "/" + id;
        var url = path + "?expectedUpdatedAt=" + Uri.EscapeDataString(item.GetProperty("updatedAt").GetString()!);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(customer, HttpMethod.Delete, url, await GetCsrf(customer))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.DeleteAsync(url)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(ownerClient, HttpMethod.Delete, path, csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(ownerClient, HttpMethod.Delete, url, csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(ownerClient, HttpMethod.Delete, url, csrf)).StatusCode);
        using var updated = JsonDocument.Parse(await ownerClient.GetStringAsync(collection));
        Assert.DoesNotContain(updated.RootElement.EnumerateArray(), x => x.GetProperty("id").GetString() == id);
        using var db = new SqliteConnection("Data Source=" + Path.Combine(root, "platform.db")); db.Open();
        using var command = db.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM audit_events WHERE action_id=$action";
        command.Parameters.AddWithValue("$action", collection.EndsWith("source") ? "file_category.remove" : collection.EndsWith("voices") ? "voice.remove" : "preset.remove");
        Assert.Equal(1, Convert.ToInt32(command.ExecuteScalar()));
    }

    [Fact]
    public async Task CustomerJourneyFromDraftThroughRevisionToFinalDownload()
    {
        await BootstrapOwner(); var adminCsrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(adminCsrf); var csrf = await GetCsrf(customer);
        var options = (await customer.GetFromJsonAsync<FormOptionsDto>("/api/form-options"))!;
        using var created = await Send(customer, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var draft = (await created.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        var route = $"/api/projects/{draft.Id}";
        async Task Refresh() => draft = (await customer.GetFromJsonAsync<TaskDraftDto>(route))!;
        async Task Write(string endpoint, object payload)
        {
            using var result = await Send(customer, HttpMethod.Put, route + endpoint, csrf, JsonContent.Create(payload));
            Assert.True(result.IsSuccessStatusCode, await result.Content.ReadAsStringAsync()); await Refresh();
        }
        await Write("/draft", new SaveDraftRequest(draft.Version,
            draft.Project with { ClientName = "Customer", ContactName = "Customer", Email = "customer@example.test", ProjectName = "Journey test", VideoGoalId = options.VideoGoals[0].Id, AudienceIds = [options.Audiences[0].Id] },
            draft.Book with { Title = "Journey book", AuthorName = "Author", GenreId = options.Genres[0].Id, ContentLanguageId = options.ContentLanguages[0].Id, VideoDurationId = options.VideoDurations[0].Id }));
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        using (var cover = ReferenceRequest(png, "cover.png", "image/png", draft.Version, "book-cover"))
        using (var uploaded = await Send(customer, HttpMethod.Post, route + "/files?categoryId=book-cover", csrf, cover))
            Assert.True(uploaded.IsSuccessStatusCode, await uploaded.Content.ReadAsStringAsync());
        await Refresh();
        await Write("/creative", new SaveCreativeRequest(draft.Version, draft.Creative with { VisualStyleId = options.VisualStyles[0].Id }));
        await Write("/voice-and-references", new SaveVoiceAndReferencesRequest(draft.Version, draft.VoiceAndReferences with {
            Voiceover = draft.VoiceAndReferences.Voiceover with { NarrationEnabled = false },
            CreativeDirection = draft.VoiceAndReferences.CreativeDirection with { CoreMessage = "A story about discovery" }
        }));
        async Task Submit()
        {
            using var validation = await Send(customer, HttpMethod.Post, route + "/validate", csrf, JsonContent.Create(new { version = draft.Version }));
            var result = (await validation.Content.ReadFromJsonAsync<ValidationResultDto>())!;
            Assert.Empty(result.FieldErrors);
            using var submitted = await Send(customer, HttpMethod.Post, route + "/submit", csrf, JsonContent.Create(new { version = draft.Version, idempotencyKey = Guid.NewGuid().ToString("N") }));
            Assert.True(submitted.IsSuccessStatusCode, await submitted.Content.ReadAsStringAsync()); await Refresh();
        }
        await Submit(); Assert.Equal("submitted", draft.Status);
        var detail = (await ownerClient.GetFromJsonAsync<AdminProjectDetailDto>($"/api/admin/projects/{draft.Id}"))!;
        using var returned = await Send(ownerClient, HttpMethod.Post, $"/api/admin/projects/{draft.Id}/return", adminCsrf,
            JsonContent.Create(new { version = draft.Version, expectedWorkflowUpdatedAt = detail.WorkflowUpdatedAt, reasons = new[] { new { unit = "project", body = "Please clarify the subtitle" } } }));
        Assert.True(returned.IsSuccessStatusCode, await returned.Content.ReadAsStringAsync()); await Refresh();
        await Write("/draft", new SaveDraftRequest(draft.Version, draft.Project, draft.Book with { Subtitle = "Clarified after review" }));
        var view = (await customer.GetFromJsonAsync<Lifewood.PlatformApi.Features.RevisionView>(route + "/revisions"))!;
        var round = Assert.Single(view.Rounds);
        using var reply = await Send(customer, HttpMethod.Post, route + $"/revisions/{round.Id}/messages", csrf,
            JsonContent.Create(new { id = Guid.NewGuid().ToString("N"), unit = "project", body = "Subtitle updated" }));
        Assert.Equal(HttpStatusCode.OK, reply.StatusCode); await Refresh(); await Submit();
        var video = MinimalMp4(); using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(video); file.Headers.ContentType = new MediaTypeHeaderValue("video/mp4"); content.Add(file, "file", "final.mp4");
        using var published = await Send(ownerClient, HttpMethod.Post, $"/api/admin/projects/{draft.Id}/deliveries", adminCsrf, content);
        Assert.True(published.IsSuccessStatusCode, await published.Content.ReadAsStringAsync());
        using var delivery = JsonDocument.Parse(await published.Content.ReadAsStringAsync());
        var deliveryId = delivery.RootElement.GetProperty("id").GetString();
        using var download = await customer.GetAsync(route + $"/deliveries/{deliveryId}/file");
        Assert.Equal(HttpStatusCode.OK, download.StatusCode); Assert.Equal(video, await download.Content.ReadAsByteArrayAsync());
        var history = (await ownerClient.GetFromJsonAsync<Lifewood.PlatformApi.Features.RevisionView>($"/api/admin/projects/{draft.Id}/revisions"))!;
        Assert.NotNull(Assert.Single(history.Rounds).AfterSnapshot);
        Assert.Equal("Clarified after review", draft.Book.Subtitle);
        var notificationRepository=new NotificationRepository("Data Source="+Path.Combine(root,"platform.db"));notificationRepository.Dispatch();
        var adminNotices=(await ownerClient.GetFromJsonAsync<NotificationPage>("/api/notifications"))!.Items;
        var customerNotices=(await customer.GetFromJsonAsync<NotificationPage>("/api/notifications"))!.Items;
        Assert.Contains(adminNotices,n=>n.Kind=="submitted");Assert.Contains(adminNotices,n=>n.Kind=="resubmitted");Assert.Contains(adminNotices,n=>n.Kind=="customer_reply");
        Assert.Contains(customerNotices,n=>n.Kind=="returned"&&n.State=="done");Assert.Contains(customerNotices,n=>n.Kind=="delivery");
        Assert.DoesNotContain(customerNotices,n=>n.Kind=="customer_reply");Assert.DoesNotContain(adminNotices,n=>n.Kind=="returned");

    }

    [Fact]
    public async Task AnnouncementPublicationRequiresAdminAndDismissalBelongsToAccount()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(csrf);var customerCsrf=await GetCsrf(customer);
        var id=Guid.NewGuid().ToString("N");var input=new AnnouncementInput("公告","正文","Notice","Body","personal","all",[],[],null,null);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Put,"/api/admin/announcements/"+id,customerCsrf,JsonContent.Create(input))).StatusCode);
        var saved=await Send(ownerClient,HttpMethod.Put,"/api/admin/announcements/"+id,csrf,JsonContent.Create(input));Assert.Equal(HttpStatusCode.OK,saved.StatusCode);
        var d=await saved.Content.ReadFromJsonAsync<AnnouncementDocument>();
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/announcements/"+id+"/preview?version=1")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Delete,"/api/admin/announcements/"+id+"?version=1",customerCsrf)).StatusCode);
        Assert.Equal(2,(await ownerClient.GetFromJsonAsync<AnnouncementPreview>("/api/admin/announcements/"+id+"/preview?version=1"))!.Count);

        Assert.Equal(HttpStatusCode.OK,(await Send(ownerClient,HttpMethod.Post,"/api/admin/announcements/"+id+"/publish",csrf,JsonContent.Create(new AnnouncementVersion(d!.Version)))).StatusCode);
        using var anonymous=factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/announcements")).StatusCode);
        Assert.Empty((await anonymous.GetFromJsonAsync<AnnouncementFeed>("/api/announcements/public"))!.Items);
        Assert.Single((await customer.GetFromJsonAsync<AnnouncementFeed>("/api/announcements?unread=true"))!.Items);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/announcements/"+id+"/dismiss",customerCsrf)).StatusCode);
        Assert.Empty((await customer.GetFromJsonAsync<AnnouncementFeed>("/api/announcements?unread=true"))!.Items);
        Assert.Single((await customer.GetFromJsonAsync<AnnouncementFeed>("/api/announcements"))!.Items);
        Assert.Single((await ownerClient.GetFromJsonAsync<AnnouncementFeed>("/api/announcements?unread=true"))!.Items);
    }

    [Fact]
    public async Task NotificationEndpointsEnforceSessionCsrfAndManagementPermissions()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(csrf);var token=await GetCsrf(customer);using var anonymous=factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/notifications")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await customer.GetAsync("/api/notifications")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/notifications/rules")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/notifications/logs")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await customer.PostAsJsonAsync("/api/notifications/state",new NotificationSelection([1],null,"read"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/notifications/state",token,JsonContent.Create(new NotificationSelection([1],null,"read")))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await Send(customer,HttpMethod.Put,"/api/notifications/preferences",token,JsonContent.Create(new NotificationPreferences()))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await customer.GetAsync("/api/notifications/1/target?admin=true")).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/admin/notifications/rules")).StatusCode);
    }

    [Fact]
    public async Task PresenceUsesAuthenticatedIdentityAndProtectsDirectoryDetails()
    {
        await BootstrapOwner();var ownerCsrf=await GetCsrf(ownerClient);
        using var customer=await CreateCustomerClient(ownerCsrf);var token=await GetCsrf(customer);
        var account=(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var tab=Guid.NewGuid().ToString("D");
        using var heartbeat=await Send(customer,HttpMethod.Post,"/api/me/presence",token,JsonContent.Create(new{tabId=tab,visible=true,interacted=true,userId="forged"}));
        Assert.Equal(HttpStatusCode.NoContent,heartbeat.StatusCode);
        var directory=(await ownerClient.GetFromJsonAsync<PagedAdminUsersDto>("/api/admin/users?status=online"))!;
        Assert.Equal(account.Id,Assert.Single(directory.Items).Id);Assert.Equal(1,directory.Statistics!.Online);
        var assignable=(await ownerClient.GetFromJsonAsync<PagedAdminUsersDto>("/api/admin/users?assignableOnly=true&pageSize=1"))!;
        Assert.Equal(1,assignable.Total);Assert.Equal("owner",Assert.Single(assignable.Items).Role);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/users?assignableOnly=true")).StatusCode);
        var detail=(await ownerClient.GetFromJsonAsync<AdminUserDetailsDto>($"/api/admin/users/{account.Id}/details"))!;
        Assert.NotNull(detail.User.Presence!.LastLoginAt);Assert.NotNull(detail.User.Presence.LastActiveAt);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/users?status=online")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/admin/users/{account.Id}/details")).StatusCode);
        using var anonymous=factory.CreateClient();Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/admin/users")).StatusCode);
        using var malformed=await Send(customer,HttpMethod.Post,"/api/me/presence",token,JsonContent.Create(new{tabId="bad",visible=true,interacted=true}));Assert.Equal(HttpStatusCode.BadRequest,malformed.StatusCode);
        using var noCsrf=await customer.PostAsJsonAsync("/api/me/presence",new{tabId=tab,visible=true,interacted=true});Assert.False(noCsrf.IsSuccessStatusCode);
        using var mismatch=new HttpRequestMessage(HttpMethod.Post,"/api/me/presence"){Content=JsonContent.Create(new{tabId=tab,visible=true,interacted=true})};mismatch.Headers.Add("X-CSRF-TOKEN",token);mismatch.Headers.Add("X-LW-Account","another-account");
        using var mismatched=await customer.SendAsync(mismatch);Assert.Equal(HttpStatusCode.Conflict,mismatched.StatusCode);
        using var logout=await Send(customer,HttpMethod.Post,"/api/auth/logout",token,JsonContent.Create(new{}));Assert.Equal(HttpStatusCode.NoContent,logout.StatusCode);
        Assert.Empty((await ownerClient.GetFromJsonAsync<PagedAdminUsersDto>("/api/admin/users?status=online"))!.Items);
    }

    [Fact]
    public async Task AccountClosureEnforcesConfirmationPermissionsAndRevokesOldSessions()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(csrf);var customerCsrf=await GetCsrf(customer);
        var account=(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        var preview=(await ownerClient.GetFromJsonAsync<AccountClosurePreview>($"/api/admin/users/{account.Id}/closure"))!;
        var path=$"/api/admin/users/{account.Id}";var body=new CloseAccountRequest(preview.Email,preview.UpdatedAt);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Delete,path,customerCsrf,JsonContent.Create(body))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.SendAsync(new HttpRequestMessage(HttpMethod.Delete,path){Content=JsonContent.Create(body)})).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Delete,path,csrf,JsonContent.Create(body with{ConfirmEmail="wrong@example.test"}))).StatusCode);
        var owner=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;var ownerPreview=(await ownerClient.GetFromJsonAsync<AccountClosurePreview>($"/api/admin/users/{owner.Id}/closure"))!;
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Delete,$"/api/admin/users/{owner.Id}",csrf,JsonContent.Create(new CloseAccountRequest(ownerPreview.Email,ownerPreview.UpdatedAt)))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Delete,path,csrf,JsonContent.Create(body))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await customer.GetAsync("/api/me")).StatusCode);
        Assert.DoesNotContain((await ownerClient.GetFromJsonAsync<PagedAdminUsersDto>("/api/admin/users"))!.Items,u=>u.Id==account.Id);
        Assert.Equal(HttpStatusCode.NotFound,(await Send(ownerClient,HttpMethod.Put,path,csrf,JsonContent.Create(new UpdateUserRequest("Revived","customer",true,null)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await Send(ownerClient,HttpMethod.Put,path+"/password",csrf,JsonContent.Create(new ResetPasswordRequest("another-password-123")))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await Send(ownerClient,HttpMethod.Delete,path,csrf,JsonContent.Create(body))).StatusCode);
        var events=(await ownerClient.GetFromJsonAsync<PagedAuditEventsDto>("/api/admin/audit-events?actionId=user.close"))!;Assert.Contains(events.Items,e=>e.ActionId=="user.close"&&e.TargetId==account.Id);
    }

    [Fact]
    public async Task ProjectCopyRequiresOwnershipCsrfAndIdempotentRequest()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);
        var created=await Send(ownerClient,HttpMethod.Post,"/api/projects",csrf,JsonContent.Create(new {}));created.EnsureSuccessStatusCode();
        var source=(await created.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        var path=$"/api/projects/{source.Id}/copy";var request=new CopyProjectRequest(Guid.NewGuid());
        Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.PostAsJsonAsync(path,request)).StatusCode);
        using var customer=await CreateCustomerClient(csrf);var otherCsrf=await GetCsrf(customer);
        Assert.Equal(HttpStatusCode.NotFound,(await Send(customer,HttpMethod.Post,path,otherCsrf,JsonContent.Create(request))).StatusCode);
        var response=await Send(ownerClient,HttpMethod.Post,path,csrf,JsonContent.Create(request));response.EnsureSuccessStatusCode();
        var draft=(await response.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        var replay=await Send(ownerClient,HttpMethod.Post,path,csrf,JsonContent.Create(request));replay.EnsureSuccessStatusCode();
        Assert.Equal(draft.Id,(await replay.Content.ReadFromJsonAsync<TaskDraftDto>())!.Id);Assert.NotEqual(source.Id,draft.Id);
    }

    [Fact]
    public async Task LoginDevicesRevokeOtherCookieAndSavedSwitchWithoutAffectingCurrent()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);var me=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        using var other=factory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=true});
        Assert.Equal(HttpStatusCode.OK,(await Send(other,HttpMethod.Post,"/api/auth/login",await GetCsrf(other),JsonContent.Create(new{email="owner@example.test",password="owner-password-123",rememberMe=true}))).StatusCode);
        var sessions=(await ownerClient.GetFromJsonAsync<LoginDevicesDto>("/api/me/sessions"))!;Assert.Equal(2,sessions.Total);
        var current=Assert.Single(sessions.Items,x=>x.Current);var remote=Assert.Single(sessions.Items,x=>!x.Current);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Delete,"/api/me/sessions/"+current.Id,csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Delete,"/api/me/sessions/"+remote.Id,csrf)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await other.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await Send(other,HttpMethod.Post,"/api/auth/accounts/switch",await GetCsrf(other),JsonContent.Create(new{id=me.Id}))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await ownerClient.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Post,"/api/me/sessions/revoke-others",csrf)).StatusCode);
    }

    [Fact]
    public async Task BatchPreviewAndPartialResultsEnforceVersionsAndPermissions()
    {
        await BootstrapOwner();var csrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(csrf);var customerCsrf=await GetCsrf(customer);
        var cs="Data Source="+Path.Combine(root,"platform.db");var repo=new ProjectRepository(cs);var user=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        TaskDraftDto Make(){var d=repo.Create(user.Id);return repo.Submit(user.Id,d.Id,d.Version,Guid.NewGuid().ToString(),null).Draft!;}
        var first=Make();var second=Make();var preview=(await ownerClient.GetFromJsonAsync<BatchProjectPreview[]>("/api/admin/projects/batch-preview?ids="+first.Id+","+second.Id))!;
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/projects/batch-preview?ids="+first.Id)).StatusCode);
        var admin=new AdminRepository(cs);var before=admin.GetProject(first.Id)!;
        Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateWorkflow(first.Id,new(before.WorkflowStatus,"high",null,before.WorkflowUpdatedAt),user.Id).Outcome);
        var items=preview.Select(x=>new BatchProjectVersion(x.Id,x.WorkflowVersion,x.FollowupVersion)).ToArray();
        using var response=await Send(ownerClient,HttpMethod.Post,"/api/admin/projects/batch",csrf,JsonContent.Create(new BatchProjectRequest("priority",items,"normal")));
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);var results=(await response.Content.ReadFromJsonAsync<BatchProjectResult[]>())!;Assert.Equal("Conflict",results.Single(x=>x.Id==first.Id).Outcome);Assert.Equal("Saved",results.Single(x=>x.Id==second.Id).Outcome);
        Assert.Equal("high",admin.GetProject(first.Id)!.Priority);Assert.Equal(before.WorkflowStatus,admin.GetProject(second.Id)!.WorkflowStatus);
        Assert.Equal(HttpStatusCode.BadRequest,(await Send(ownerClient,HttpMethod.Post,"/api/admin/projects/batch",csrf,JsonContent.Create(new BatchProjectRequest("priority",[items[0],items[0]],"normal")))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Post,"/api/admin/projects/batch",customerCsrf,JsonContent.Create(new BatchProjectRequest("priority",items,"normal")))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/reports?from=2026-01-01&to=2026-01-02")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.GetAsync("/api/admin/reports?from=2026-01-01&to=2028-01-01")).StatusCode);
    }

    [Fact]
    public async Task SlidingCookieRenewalExtendsTheMatchingStoredLoginOnly()
    {
        await BootstrapOwner();var user=(await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;var devices=(await ownerClient.GetFromJsonAsync<LoginDevicesDto>("/api/me/sessions"))!;var id=Assert.Single(devices.Items).Id;
        using(var db=new SqliteConnection("Data Source="+Path.Combine(root,"platform.db"))){db.Open();using var cmd=db.CreateCommand();cmd.CommandText="UPDATE saved_account_sessions SET expires_at=$expiry WHERE session_id=$id";cmd.Parameters.AddWithValue("$expiry",DateTimeOffset.UtcNow.AddHours(3).ToString("O"));cmd.Parameters.AddWithValue("$id",id);cmd.ExecuteNonQuery();}

        var options=Microsoft.Extensions.DependencyInjection.ServiceProviderServiceExtensions.GetRequiredService<Microsoft.Extensions.Options.IOptionsMonitor<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>>(factory.Services).Get("Cookies");
        var users=new UserRepository("Data Source="+Path.Combine(root,"platform.db"),root);var version=users.GetSessionVersion(user.Id)!.Value;
        var identity=new System.Security.Claims.ClaimsIdentity([new(System.Security.Claims.ClaimTypes.NameIdentifier,user.Id),new("lw_session_version",version.ToString()),new("lw_login_session",id)],"Cookies");
        var properties=new Microsoft.AspNetCore.Authentication.AuthenticationProperties{IssuedUtc=DateTimeOffset.UtcNow.AddHours(-5),ExpiresUtc=DateTimeOffset.UtcNow.AddHours(3),AllowRefresh=true};
        var ticket=new Microsoft.AspNetCore.Authentication.AuthenticationTicket(new System.Security.Claims.ClaimsPrincipal(identity),properties,"Cookies");
        using var active=factory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=false});active.DefaultRequestHeaders.Add("Cookie","lw_session="+options.TicketDataFormat.Protect(ticket));
        Assert.Equal(HttpStatusCode.OK,(await active.GetAsync("/api/me")).StatusCode);
        var updated=(await ownerClient.GetFromJsonAsync<LoginDevicesDto>("/api/me/sessions"))!;Assert.True(updated.Items[0].ExpiresAt>DateTimeOffset.UtcNow.AddHours(7));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PasswordResetAllowsFreshLoginInTheSameBrowser(bool persistent)
    {
        await BootstrapOwner();var adminCsrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(adminCsrf);
        var account=(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        Assert.Equal(HttpStatusCode.OK,(await Send(customer,HttpMethod.Post,"/api/auth/login",await GetCsrf(customer),JsonContent.Create(new{email=account.Email,password="customer-password-123",rememberMe=persistent}))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Put,$"/api/admin/users/{account.Id}/password",adminCsrf,JsonContent.Create(new ResetPasswordRequest("reset-password-456")))).StatusCode);
        // Keep every browser cookie. Only the server-side session version changed.
        Assert.Equal(HttpStatusCode.Unauthorized,(await customer.GetAsync("/api/me")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,(await Send(customer,HttpMethod.Post,"/api/auth/login",await GetCsrf(customer),JsonContent.Create(new{email=account.Email,password="customer-password-123",rememberMe=persistent}))).StatusCode);
        Assert.Equal(HttpStatusCode.OK,(await Send(customer,HttpMethod.Post,"/api/auth/login",await GetCsrf(customer),JsonContent.Create(new{email=account.Email,password="reset-password-456",rememberMe=persistent}))).StatusCode);
        Assert.Equal(account.Id,(await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!.Id);
        Assert.Single((await customer.GetFromJsonAsync<LoginDevicesDto>("/api/me/sessions"))!.Items);
    }

    private async Task BootstrapOwner(bool withOrganization = true)
    {
        var csrf = await GetCsrf(ownerClient);
        using var response = await Send(ownerClient, HttpMethod.Post, "/api/auth/bootstrap", csrf,
            JsonContent.Create(new { displayName = "Test Owner", email = "owner@example.test", password = "owner-password-123", organizationName = withOrganization ? "Test Organization" : null }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private sealed class LoopbackConnectionStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
        {
            app.Use(nextMiddleware => async context =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Loopback;
                await nextMiddleware(context);
            });
            next(app);
        };
    }

    private sealed class RemoteConnectionStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
        {
            app.Use(nextMiddleware => async context =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.10");
                await nextMiddleware(context);
            });
            next(app);
        };
    }

    private sealed class MappedRemoteConnectionStartupFilter : Microsoft.AspNetCore.Hosting.IStartupFilter
    {
        public Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> Configure(Action<Microsoft.AspNetCore.Builder.IApplicationBuilder> next) => app =>
        {
            app.Use(nextMiddleware => async context =>
            {
                context.Connection.RemoteIpAddress = IPAddress.Parse("::ffff:203.0.113.10");
                await nextMiddleware(context);
            });
            next(app);
        };
    }

    [Fact]
    public async Task AiSettingsRequireOwnerAndCsrfAndApplyWithoutReturningSecrets()
    {
        using var anonymous = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/admin/ai-settings")).StatusCode);
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/ai-settings")).StatusCode);
        var payload = new { enabled = true, endpoint = "https://example.test/chat", model = "vision", apiKey = "test-secret-value" };
        using var denied = await ownerClient.PutAsJsonAsync("/api/admin/ai-settings", payload);
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        using var saved = await Send(ownerClient, HttpMethod.Put, "/api/admin/ai-settings", csrf, JsonContent.Create(payload));
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var body = await saved.Content.ReadAsStringAsync();
        Assert.DoesNotContain("test-secret-value", body);
        using var json = JsonDocument.Parse(body);
        Assert.True(json.RootElement.GetProperty("hasApiKey").GetBoolean());
        using var options = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/form-options"));
        Assert.True(options.RootElement.GetProperty("bookRecognitionEnabled").GetBoolean());
        using var added = await Send(ownerClient, HttpMethod.Post, "/api/admin/ai-settings/providers", csrf,
            JsonContent.Create(new { name = "Claude provider", protocol = "anthropic", endpoint = "https://example.test/v1/messages", model = "", models = new[] { "claude-a", "claude-b" }, apiKey = "second-test-key" }));
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        var addedBody = await added.Content.ReadAsStringAsync();
        Assert.DoesNotContain("second-test-key", addedBody);
        using var providerJson = JsonDocument.Parse(addedBody);
        var providerId = providerJson.RootElement.GetProperty("providers").EnumerateArray().Single(p => p.GetProperty("name").GetString() == "Claude provider").GetProperty("id").GetString();
        using var bound = await Send(ownerClient, HttpMethod.Put, "/api/admin/ai-settings/bindings", csrf,
            JsonContent.Create(new { featureId = "book-recognition", providerId, model = "claude-b", enabled = true }));
        Assert.Equal(HttpStatusCode.OK, bound.StatusCode);
        using var invalidModel = await Send(ownerClient, HttpMethod.Put, "/api/admin/ai-settings/bindings", csrf,
            JsonContent.Create(new { featureId = "book-recognition", providerId, model = "not-in-catalog", enabled = true }));
        Assert.Equal(HttpStatusCode.BadRequest, invalidModel.StatusCode);
        using var cannotDelete = await Send(ownerClient, HttpMethod.Delete, $"/api/admin/ai-settings/providers/{providerId}", csrf);
        Assert.Equal(HttpStatusCode.BadRequest, cannotDelete.StatusCode);
        using var blocked = await Send(customer, HttpMethod.Put, "/api/admin/ai-settings", await GetCsrf(customer), JsonContent.Create(payload));
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        using var blockedBinding = await Send(customer, HttpMethod.Put, "/api/admin/ai-settings/bindings", await GetCsrf(customer),
            JsonContent.Create(new { featureId = "book-recognition", providerId, model = "claude-a", enabled = true }));
        Assert.Equal(HttpStatusCode.Forbidden, blockedBinding.StatusCode);
    }

    private async Task<HttpClient> CreateCustomerClient(string ownerCsrf)
    {
        var organizationId = (await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!.Organization?.Id;
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", ownerCsrf,
            JsonContent.Create(new { displayName = "Customer", email = "customer@example.test", password = "customer-password-123", role = "customer", organizationId }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);

        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        var csrf = await GetCsrf(client);
        using var login = await Send(client, HttpMethod.Post, "/api/auth/login", csrf,
            JsonContent.Create(new { email = "customer@example.test", password = "customer-password-123", rememberMe = false }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }

    private static async Task<JsonElement> FindAdminVoice(HttpClient client, string id)
    {
        using var document = JsonDocument.Parse(await client.GetStringAsync("/api/admin/voices"));
        return document.RootElement.EnumerateArray().Single(item => item.GetProperty("id").GetString() == id).Clone();
    }

    private static async Task<string> GetCsrf(HttpClient client)
    {
        using var document = JsonDocument.Parse(await client.GetStringAsync("/api/auth/csrf"));
        return document.RootElement.GetProperty("token").GetString()!;
    }

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, string csrf, HttpContent? content = null)
    {
        using var request = new HttpRequestMessage(method, path) { Content = content };
        request.Headers.Add("X-CSRF-TOKEN", csrf);
        return await client.SendAsync(request);
    }

    private static MultipartFormDataContent AudioRequest(byte[] bytes, string fileName, string contentType)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(file, "file", fileName);
        return content;
    }

    private static byte[] MinimalMp4()
    {
        var ftyp = Box("ftyp", "isom"u8.ToArray(), new byte[4], "isom"u8.ToArray());
        var mdat = Box("mdat", [1]);
        var handler = Box("hdlr", new byte[8], "vide"u8.ToArray());
        var sampleDescription = Box("stsd", new byte[4], BigEndian(1), Box("avc1"));
        var sampleSizes = Box("stsz", new byte[4], BigEndian(1), BigEndian(1));
        var sampleTable = Box("stbl", sampleDescription, sampleSizes);
        var mediaInfo = Box("minf", sampleTable);
        var media = Box("mdia", handler, mediaInfo);
        var track = Box("trak", media);
        var movie = Box("moov", track);
        return [.. ftyp, .. mdat, .. movie];
    }

    private static byte[] Box(string type, params byte[][] payloads)
    {
        var payloadLength = payloads.Sum(payload => payload.Length);
        var result = new byte[8 + payloadLength];
        BinaryPrimitives.WriteUInt32BigEndian(result.AsSpan(0, 4), (uint)result.Length);
        Encoding.ASCII.GetBytes(type, result.AsSpan(4, 4));
        var offset = 8;
        foreach (var payload in payloads)
        {
            payload.CopyTo(result, offset);
            offset += payload.Length;
        }
        return result;
    }

    private static byte[] BigEndian(uint value)
    {
        var result = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(result, value);
        return result;
    }

    private static MultipartFormDataContent AvatarRequest(byte[] bytes, string fileName, string contentType)
    {
        var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(file, "avatar", fileName);
        return content;
    }

    private static MultipartFormDataContent ReferenceRequest(byte[] bytes, string fileName, string contentType, int version, string categoryId, string? characterId = null)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(version.ToString(System.Globalization.CultureInfo.InvariantCulture)), "version");
        content.Add(new StringContent(categoryId), "categoryId");
        if (characterId is not null) content.Add(new StringContent(characterId), "characterId");
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        content.Add(file, "file", fileName);
        return content;
    }

    private static byte[] MinimalWav() =>
    [
        0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
        0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00,
        0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
        0x02, 0x00, 0x00, 0x00, 0x00, 0x00
    ];

    private static byte[] MinimalMp3(int frameCount = 2)
    {
        const int frameLength = 417;
        var bytes = new byte[frameLength * frameCount];
        byte[] header = [0xff, 0xfb, 0x90, 0x64];
        for (var offset = 0; offset < bytes.Length; offset += frameLength) header.CopyTo(bytes, offset);
        return bytes;
    }
    private static async Task<string?> ErrorCode(HttpResponseMessage response)
    {
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return document.RootElement.GetProperty("code").GetString();
    }

    [Fact]
    public async Task OperatorsAreScopedAcrossProjectReadsWritesFilesAndReassignment()
    {
        await BootstrapOwner();
        var ownerCsrf = await GetCsrf(ownerClient);
        async Task<(HttpClient Client, string Id, string Csrf)> Operator(string name)
        {
            using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", ownerCsrf,
                JsonContent.Create(new { displayName = name, email = name + "@example.test", password = "operator-password-123", role = "operator" }));
            Assert.Equal(HttpStatusCode.OK, create.StatusCode);
            var account = (await create.Content.ReadFromJsonAsync<AdminUserDto>())!;
            var client = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
            var token = await GetCsrf(client);
            using var login = await Send(client, HttpMethod.Post, "/api/auth/login", token,
                JsonContent.Create(new { email = account.Email, password = "operator-password-123", rememberMe = false }));
            Assert.Equal(HttpStatusCode.OK, login.StatusCode);
            var user = (await login.Content.ReadFromJsonAsync<CurrentUserDto>())!;
            Assert.Contains("operator", user.Roles);
            Assert.Contains("admin.projects.deliver", user.Permissions);
            Assert.DoesNotContain("admin.projects.assign", user.Permissions);
            Assert.DoesNotContain("admin.users.manage", user.Permissions);
            return (client, account.Id, await GetCsrf(client));
        }
        var first = await Operator("OperatorOne");
        var second = await Operator("OperatorTwo");
        using var firstClient = first.Client;
        using var secondClient = second.Client;
        var connectionString = $"Data Source={Path.Combine(root, "platform.db")}";
        var projects = new ProjectRepository(connectionString);
        var admin = new AdminRepository(connectionString);
        var ownerId = admin.ListUsers(null, "owner", 1, 20).Items.Single().Id;
        TaskDraftDto Submitted()
        {
            var draft = projects.Create(ownerId);
            return projects.Submit(ownerId, draft.Id, draft.Version, Guid.NewGuid().ToString(), null).Draft!;
        }
        var assigned = Submitted();
        var another = Submitted();
        var unassigned = Submitted();
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateWorkflow(assigned.Id, new("contacting", "normal", first.Id, admin.GetProject(assigned.Id)!.WorkflowUpdatedAt)).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateWorkflow(another.Id, new("contacting", "normal", second.Id, admin.GetProject(another.Id)!.WorkflowUpdatedAt)).Outcome);
        var fileId = Guid.NewGuid().ToString("N");
        var asset = new ReferenceAssetDto(fileId, "book-cover", "cover.png", "image/png", 3, $"/api/projects/{assigned.Id}/files/{fileId}");
        using (var db = new SqliteConnection(connectionString))
        {
            db.Open(); using var command = db.CreateCommand();
            command.CommandText = "UPDATE projects SET book_json=json_set(book_json,'$.sourceAssets',json($assets)), submission_snapshot_json=$snapshot WHERE id=$id";
            command.Parameters.AddWithValue("$id", assigned.Id);
            command.Parameters.AddWithValue("$assets", JsonSerializer.Serialize(new[] { asset }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            command.Parameters.AddWithValue("$snapshot", "{\"schemaVersion\":1,\"capturedAt\":\"2026-01-01T00:00:00Z\",\"formOptions\":[],\"voices\":[],\"fileCategories\":[]}");
            command.ExecuteNonQuery();
        }
        var folder = Path.Combine(root, "uploads", ownerId, assigned.Id);
        Directory.CreateDirectory(folder); File.WriteAllBytes(Path.Combine(folder, fileId + "_cover.png"), [1,2,3]);
        var listing = (await firstClient.GetFromJsonAsync<PagedAdminProjectsDto>("/api/admin/projects?pageSize=1"))!;
        Assert.Equal(1, listing.Total); Assert.Equal(assigned.Id, Assert.Single(listing.Items).Id);
        Assert.Empty((await firstClient.GetFromJsonAsync<PagedAdminProjectsDto>("/api/admin/projects?page=2&pageSize=1"))!.Items);
        foreach (var suffix in new[] { "", "/followup", "/revisions", "/deliveries", "/voices", "/submission-snapshot", $"/files/{fileId}" })
        {
            Assert.Equal(HttpStatusCode.OK, (await firstClient.GetAsync($"/api/admin/projects/{assigned.Id}{suffix}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await secondClient.GetAsync($"/api/admin/projects/{assigned.Id}{suffix}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await firstClient.GetAsync($"/api/admin/projects/{unassigned.Id}{suffix}")).StatusCode);
        }
        var workbench=(await firstClient.GetFromJsonAsync<WorkbenchDto>("/api/admin/workbench"))!;
        Assert.Equal(1,workbench.Total);Assert.Equal(assigned.Id,Assert.Single(workbench.Items).Id);
        using var followup=await Send(firstClient,HttpMethod.Put,$"/api/admin/projects/{assigned.Id}/followup",first.Csrf,JsonContent.Create(new {dueAt=DateTimeOffset.UtcNow.AddHours(1),expectedVersion=0}));
        Assert.Equal(HttpStatusCode.OK,followup.StatusCode);
        using var staleFollowup=await Send(firstClient,HttpMethod.Put,$"/api/admin/projects/{assigned.Id}/followup",first.Csrf,JsonContent.Create(new {dueAt=DateTimeOffset.UtcNow.AddHours(2),expectedVersion=0}));
        Assert.Equal(HttpStatusCode.Conflict,staleFollowup.StatusCode);
        using var otherFollowup=await Send(secondClient,HttpMethod.Put,$"/api/admin/projects/{assigned.Id}/followup",second.Csrf,JsonContent.Create(new {dueAt=DateTimeOffset.UtcNow.AddHours(1),expectedVersion=1}));
        Assert.Equal(HttpStatusCode.NotFound,otherFollowup.StatusCode);
        using var export=await Send(firstClient,HttpMethod.Post,$"/api/admin/projects/{assigned.Id}/export",first.Csrf);
        Assert.Equal(HttpStatusCode.OK,export.StatusCode);Assert.Equal("application/zip",export.Content.Headers.ContentType!.MediaType);
        using(var zip=new System.IO.Compression.ZipArchive(await export.Content.ReadAsStreamAsync())) {Assert.Equal(3,zip.Entries.Count);Assert.NotNull(zip.GetEntry("brief.html"));Assert.NotNull(zip.GetEntry("project.json"));}
        using var otherExport=await Send(secondClient,HttpMethod.Post,$"/api/admin/projects/{assigned.Id}/export",second.Csrf);
        Assert.Equal(HttpStatusCode.NotFound,otherExport.StatusCode);
        File.Move(Path.Combine(folder,fileId+"_cover.png"),Path.Combine(folder,fileId+"_cover.png.pending"));
        using var missingExport=await Send(firstClient,HttpMethod.Post,$"/api/admin/projects/{assigned.Id}/export",first.Csrf);
        Assert.Equal(HttpStatusCode.Conflict,missingExport.StatusCode);Assert.Equal("export.files",await ErrorCode(missingExport));
        File.Move(Path.Combine(folder,fileId+"_cover.png.pending"),Path.Combine(folder,fileId+"_cover.png"));
        Assert.Empty(Directory.GetFiles(Path.Combine(root,"exports")));
        foreach (var path in new[] { "overview", "users", "roles", "organizations", "assignees", "audit-events", "audit-actions", "voices", "runtime-settings" })
            Assert.Equal(HttpStatusCode.Forbidden, (await firstClient.GetAsync("/api/admin/" + path)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(firstClient, HttpMethod.Post, "/api/admin/users", first.Csrf, JsonContent.Create(new { displayName = "Unauthorized", email = "unauthorized@example.test", password = "password-123", role = "admin" }))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await firstClient.GetAsync("/api/projects")).StatusCode);
        var detail = admin.GetProject(assigned.Id)!;
        using var forbiddenAssignment = await Send(firstClient, HttpMethod.Put, $"/api/admin/projects/{assigned.Id}/workflow", first.Csrf,
            JsonContent.Create(new { workflowStatus = "contacting", priority = "high", assigneeUserId = second.Id, expectedWorkflowUpdatedAt = detail.WorkflowUpdatedAt }));
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenAssignment.StatusCode);
        using var workflow = await Send(firstClient, HttpMethod.Put, $"/api/admin/projects/{assigned.Id}/workflow", first.Csrf,
            JsonContent.Create(new { workflowStatus = "in_production", priority = "high", assigneeUserId = first.Id, expectedWorkflowUpdatedAt = detail.WorkflowUpdatedAt }));
        Assert.Equal(HttpStatusCode.OK, workflow.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(firstClient, HttpMethod.Post, $"/api/admin/projects/{assigned.Id}/notes", first.Csrf, JsonContent.Create(new { body = "Scoped note" }))).StatusCode);
        using var content = new MultipartFormDataContent(); var video = new ByteArrayContent(MinimalMp4()); video.Headers.ContentType = new("video/mp4"); content.Add(video, "file", "final.mp4");
        using var publish = await Send(firstClient, HttpMethod.Post, $"/api/admin/projects/{assigned.Id}/deliveries", first.Csrf, content);
        Assert.Equal(HttpStatusCode.OK, publish.StatusCode);
        var delivery = (await publish.Content.ReadFromJsonAsync<FinalDeliveryDto>())!;
        Assert.Equal(HttpStatusCode.OK, (await firstClient.GetAsync($"/api/admin/projects/{assigned.Id}/deliveries/{delivery.Id}/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await secondClient.GetAsync($"/api/admin/projects/{assigned.Id}/deliveries/{delivery.Id}/file")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await Send(firstClient, HttpMethod.Delete, $"/api/admin/projects/{assigned.Id}/deliveries/{delivery.Id}", first.Csrf)).StatusCode);
        detail = admin.GetProject(assigned.Id)!;
        using var returned = await Send(firstClient, HttpMethod.Post, $"/api/admin/projects/{assigned.Id}/return", first.Csrf,
            JsonContent.Create(new { version = detail.Project.Version, expectedWorkflowUpdatedAt = detail.WorkflowUpdatedAt, reasons = new[] { new { unit = "style", body = "Please clarify" } } }));
        Assert.Equal(HttpStatusCode.OK, returned.StatusCode);
        var revisions = new Lifewood.PlatformApi.Features.RevisionStore(connectionString);
        var round = revisions.View(assigned.Id, true, "en-US").Rounds.Single();
        Assert.Equal(HttpStatusCode.NotFound, (await secondClient.GetAsync($"/api/projects/{assigned.Id}/revision-avatar/{round.Messages[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await firstClient.GetAsync($"/api/projects/{assigned.Id}/revision-avatar/{round.Messages[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Send(firstClient, HttpMethod.Post, $"/api/admin/projects/{assigned.Id}/revisions/{round.Id}/messages", first.Csrf,
            JsonContent.Create(new { id = Guid.NewGuid().ToString("N"), unit = "style", body = "Additional guidance" }))).StatusCode);
        var draftAgain = projects.Get(ownerId, assigned.Id)!;
        projects.Submit(ownerId, assigned.Id, draftAgain.Version, Guid.NewGuid().ToString(), null);
        detail = admin.GetProject(assigned.Id)!;
        using var reassign = await Send(ownerClient, HttpMethod.Put, $"/api/admin/projects/{assigned.Id}/workflow", ownerCsrf,
            JsonContent.Create(new { workflowStatus = "contacting", priority = "normal", assigneeUserId = second.Id, expectedWorkflowUpdatedAt = detail.WorkflowUpdatedAt }));
        Assert.Equal(HttpStatusCode.OK, reassign.StatusCode);
        Assert.Empty((await firstClient.GetFromJsonAsync<PagedAdminProjectsDto>("/api/admin/projects"))!.Items);
        foreach (var suffix in new[] { "", "/followup", "/revisions", "/deliveries", "/voices", "/submission-snapshot", $"/files/{fileId}" })
            Assert.Equal(HttpStatusCode.NotFound, (await firstClient.GetAsync($"/api/admin/projects/{assigned.Id}{suffix}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(firstClient, HttpMethod.Post, $"/api/admin/projects/{assigned.Id}/notes", first.Csrf, JsonContent.Create(new { body = "Stale note" }))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await Send(firstClient,HttpMethod.Post,$"/api/admin/projects/{assigned.Id}/export",first.Csrf)).StatusCode);
        Assert.Empty((await firstClient.GetFromJsonAsync<WorkbenchDto>("/api/admin/workbench"))!.Items);
        // Model a mutation which passed its HTTP precheck before assignment changed.
        Assert.Equal(AdminWriteOutcome.NotFound, admin.AddNote(assigned.Id, first.Id, new("Stale"), out _, first.Id).Outcome);
        Assert.Equal(AdminWriteOutcome.NotFound, admin.UpdateWorkflow(assigned.Id, new("contacting", "normal", first.Id, detail.WorkflowUpdatedAt), first.Id, first.Id, false).Outcome);
        var deliveries = new DeliveryRepository(connectionString);
        Assert.Equal(AdminWriteOutcome.NotFound, deliveries.Publish(Guid.NewGuid().ToString("N"), assigned.Id, first.Id, "late.mp4", "video/mp4", 5, null, out _, first.Id).Outcome);
        Assert.Equal(AdminWriteOutcome.NotFound, deliveries.Revoke(assigned.Id, delivery.Id, first.Id).Outcome);
        var staleUser = new UserRepository(connectionString, root).Get(first.Id, 0)!;
        detail = admin.GetProject(assigned.Id)!;
        Assert.False(revisions.Return(assigned.Id, new(detail.Project.Version, [new("style", "Stale")], detail.WorkflowUpdatedAt), staleUser, first.Id));
        Assert.False(revisions.Reply(assigned.Id, round.Id, new(Guid.NewGuid().ToString("N"), "style", "Stale"), staleUser, true, first.Id));
        using var demote = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{second.Id}", ownerCsrf,
            JsonContent.Create(new { displayName = "OperatorTwo", role = "customer", active = true }));
        Assert.Equal(HttpStatusCode.OK, demote.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await secondClient.GetAsync($"/api/admin/projects/{assigned.Id}")).StatusCode);
        Assert.Null(admin.GetProject(assigned.Id, second.Id));
        using var disable = await Send(ownerClient, HttpMethod.Put, $"/api/admin/users/{first.Id}", ownerCsrf,
            JsonContent.Create(new { displayName = "OperatorOne", role = "operator", active = false }));
        Assert.Equal(HttpStatusCode.OK, disable.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await firstClient.GetAsync("/api/admin/projects")).StatusCode);
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public async Task DisposeAsync()
    {
        ownerClient.Dispose();
        await factory.DisposeAsync();
        SqliteConnection.ClearAllPools();
        await DeleteTestDirectoryAsync(root);
        if (Directory.Exists(root + ".backups")) await DeleteTestDirectoryAsync(root + ".backups");
    }

    private static async Task DeleteTestDirectoryAsync(string directory)
    {
        // The in-process entry point can finish its using declarations just after
        // host shutdown. Wait briefly for Windows to release those file handles.
        for (var attempt = 0; Directory.Exists(directory); attempt++)
        {
            try { Directory.Delete(directory, recursive: true); break; }
            catch (IOException) when (attempt < 39) { await Task.Delay(50); }
        }
    }
}
