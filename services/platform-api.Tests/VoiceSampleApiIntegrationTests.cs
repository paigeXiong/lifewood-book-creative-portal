using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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
        });
        ownerClient = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
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
    private async Task BootstrapOwner()
    {
        var csrf = await GetCsrf(ownerClient);
        using var response = await Send(ownerClient, HttpMethod.Post, "/api/auth/bootstrap", csrf,
            JsonContent.Create(new { displayName = "Test Owner", email = "owner@example.test", password = "owner-password-123" }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
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