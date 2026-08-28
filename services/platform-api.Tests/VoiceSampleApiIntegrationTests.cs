using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class VoiceSampleApiIntegrationTests : IDisposable
{
    private const string VoiceId = "warm-storyteller";
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-platform-http-tests-" + Guid.NewGuid().ToString("N"));
    private readonly WebApplicationFactory<Program> factory;
    private readonly HttpClient ownerClient;

    public VoiceSampleApiIntegrationTests()
    {
        var sampleDirectory = Path.Combine(root, "voice-samples");
        Directory.CreateDirectory(sampleDirectory);
        File.WriteAllText(Path.Combine(sampleDirectory, "interrupted.upload"), "orphan");
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
            remoteFactory?.Dispose();
            SqliteConnection.ClearAllPools();
            if (Directory.Exists(remoteRoot)) Directory.Delete(remoteRoot, recursive: true);
        }
    }

    [Fact]
    public async Task VoiceSampleEndpointsEnforceSecurityAndManageRealFiles()
    {
        Assert.False(File.Exists(Path.Combine(root, "voice-samples", "interrupted.upload")));
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
            JsonContent.Create(new { displayName = "Test Owner", phone = "+86 138 0000 0000", role = "owner", active = true, organizationId }));
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);

        using var created = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        using var draft = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var project = draft.RootElement.GetProperty("project");
        Assert.Equal("Lifewood Books", project.GetProperty("clientName").GetString());
        Assert.Equal("Test Owner", project.GetProperty("contactName").GetString());
        Assert.Equal("owner@example.test", project.GetProperty("email").GetString());
        Assert.Equal("+86 138 0000 0000", project.GetProperty("phone").GetString());
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

    [Fact]
    public async Task CreativeReferenceImagesUploadDownloadAndDeleteAsStoredAssets()
    {
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
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
        Assert.Equal(HttpStatusCode.OK, removeCharacter.StatusCode);
        var removedDraft = JsonNode.Parse(await removeCharacter.Content.ReadAsStringAsync())!.AsObject();
        Assert.Empty(removedDraft["creative"]!["characters"]!.AsArray());
        using var removedDownload = await ownerClient.GetAsync($"/api/projects/{id}/files/{fileId}");
        Assert.Equal(HttpStatusCode.NotFound, removedDownload.StatusCode);
        Assert.DoesNotContain(Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories), path => Path.GetFileName(path).Contains(fileId, StringComparison.Ordinal));

        version = removedDraft["version"]!.GetValue<int>();
        using var deleteStyle = await Send(ownerClient, HttpMethod.Delete, $"/api/projects/{id}/files/{styleFileId}?version={version}", csrf);
        Assert.Equal(HttpStatusCode.OK, deleteStyle.StatusCode);
    }
    private async Task BootstrapOwner()
    {
        var csrf = await GetCsrf(ownerClient);
        using var response = await Send(ownerClient, HttpMethod.Post, "/api/auth/bootstrap", csrf,
            JsonContent.Create(new { displayName = "Test Owner", email = "owner@example.test", password = "owner-password-123" }));
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

    private async Task<HttpClient> CreateCustomerClient(string ownerCsrf)
    {
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", ownerCsrf,
            JsonContent.Create(new { displayName = "Customer", email = "customer@example.test", password = "customer-password-123", role = "customer" }));
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

    public void Dispose()
    {
        ownerClient.Dispose();
        factory.Dispose();
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
