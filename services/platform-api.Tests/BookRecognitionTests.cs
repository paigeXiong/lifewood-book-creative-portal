using System.Net;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class BookRecognitionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ReadsBoundedManuscriptContext(bool docx)
    {
        var folder = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        var id = Guid.NewGuid().ToString("N");
        var path = Path.Combine(folder, id + "_excerpt");
        try
        {
            if (docx)
            {
                using var zip = System.IO.Compression.ZipFile.Open(path, System.IO.Compression.ZipArchiveMode.Create);
                using var writer = new StreamWriter(zip.CreateEntry("word/document.xml").Open());
                writer.Write("<document><p><t>Composition and colour</t></p></document>");
            }
            else await File.WriteAllTextAsync(path, "Composition and colour" + new string('a', 20000));
            var asset = new ReferenceAssetDto(id, "manuscript", "excerpt", docx ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain", new FileInfo(path).Length, "unused");
            var book = new BookInfoDto("Visual storytelling", "Design", "", null, "", "", null, null, [], [asset]);
            var context = await BookRecognitionContext.BuildAsync(book, folder, default);
            Assert.Contains("Visual storytelling", context);
            Assert.Contains("Composition and colour", context);
            Assert.True(context.Length < 12500);
        }
        finally { File.Delete(path); Directory.Delete(folder); }
    }

    [Fact]
    public async Task SendsBookContextAsReferenceDataForOptionalClassification()
    {
        var handler = new ProviderHandler();
        using var client = new HttpClient(handler);
        var service = new BookRecognitionService(client, new(true, new Uri("https://example.test/chat/completions"), "vision-model", "test-key"));
        await service.RecognizeAsync([new("image/png", [1])], [new("art", "艺术与文化")], "zh-CN", default, "Title: Visual storytelling\nSubtitle: Colour and composition");
        using var request = JsonDocument.Parse(handler.Body!);
        var prompt = request.RootElement.GetProperty("messages")[0].GetProperty("content")[0].GetProperty("text").GetString()!;
        Assert.Contains("Visual storytelling", prompt);
        Assert.Contains("classification is optional", prompt);
        Assert.Contains("untrusted reference data", prompt);
        Assert.Contains("Simplified Chinese", prompt);
    }

    [Fact]
    public void ResolvesLocalizedLabelsButRejectsAmbiguousOrUnknownCategories()
    {
        Assert.Equal("art", BookRecognitionService.ParseResult("{\"genreId\":\"艺术与文化\"}", [new("art", "艺术与文化")]).GenreId);
        Assert.Equal("art", BookRecognitionService.ParseResult("{\"genreId\":\"Arts\"}", [new("art", "Arts")]).GenreId);
        Assert.Equal("", BookRecognitionService.ParseResult("{\"genreId\":\"Arts\"}", [new("art", "Arts"), new("other", "Arts")]).GenreId);
        Assert.Equal("", BookRecognitionService.ParseResult("{\"genreId\":\"\"}", [new("art", "Arts")]).GenreId);
    }

    [Fact]
    public async Task MissingConfigurationDisablesRecognitionWithoutCallingProvider()
    {
        var settings = BookRecognitionSettings.FromConfiguration(new ConfigurationBuilder().Build());
        var handler = new ProviderHandler();
        using var client = new HttpClient(handler);
        var service = new BookRecognitionService(client, settings);
        Assert.False(service.Enabled);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.RecognizeAsync([], [], "en-US", default));
        Assert.Equal(0, handler.Calls);
    }

    [Fact]
    public void IncompleteOrInsecureConfigurationRemainsDisabled()
    {
        var values = new Dictionary<string, string?> {
            ["Lifewood:BookRecognition:Enabled"]="true", ["Lifewood:BookRecognition:Endpoint"]="http://example.test/chat/completions",
            ["Lifewood:BookRecognition:Model"]="vision-model", ["Lifewood:BookRecognition:ApiKey"]="test-key"
        };
        Assert.False(BookRecognitionSettings.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(values).Build()).Enabled);
        values["Lifewood:BookRecognition:Endpoint"]="https://example.test/chat/completions";
        Assert.True(BookRecognitionSettings.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(values).Build()).Enabled);
        values["Lifewood:BookRecognition:ApiKey"]="";
        Assert.False(BookRecognitionSettings.FromConfiguration(new ConfigurationBuilder().AddInMemoryCollection(values).Build()).Enabled);
    }

    [Fact]
    public async Task SendsAllPhotosAndValidatesStructuredResultWithoutLeakingProviderDetails()
    {
        var handler = new ProviderHandler();
        using var client = new HttpClient(handler);
        var service = new BookRecognitionService(client, new(true, new Uri("https://example.test/chat/completions"), "vision-model", "test-key"));
        var result = await service.RecognizeAsync([new("image/png", [1,2]), new("image/jpeg", [3,4])], [new("fiction", "Fiction")], "en-US", default);
        Assert.Equal("Book", result.Title);
        Assert.Equal("fiction", result.GenreId);
        Assert.Equal("Bearer test-key", handler.Authorization);
        using var request = JsonDocument.Parse(handler.Body!);
        var parts = request.RootElement.GetProperty("messages")[0].GetProperty("content");
        Assert.Equal(3, parts.GetArrayLength());
        Assert.Equal("data:image/png;base64,AQI=", parts[1].GetProperty("image_url").GetProperty("url").GetString());
        Assert.Equal("data:image/jpeg;base64,AwQ=", parts[2].GetProperty("image_url").GetProperty("url").GetString());
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public void InvalidGenresAreNotInventedAndMalformedOrOversizedFieldsFail()
    {
        Assert.Equal("", BookRecognitionService.ParseResult("{\"genreId\":\"invented\"}", [new("fiction", "Fiction")]).GenreId);
        Assert.Throws<JsonException>(() => BookRecognitionService.ParseResult("{\"title\":42}", []));
        Assert.Throws<JsonException>(() => BookRecognitionService.ParseResult("[]", []));
        Assert.Throws<JsonException>(() => BookRecognitionService.ParseResult("{\"synopsis\":\"" + new string('a',601) + "\"}", []));
    }

    [Fact]
    public void PresetsHaveLocalizedCompleteDefinitionsAndIndependentIds()
    {
        var zh = CharacterPresetCatalog.Create("zh-CN");
        var en = CharacterPresetCatalog.Create("en-US");
        Assert.Equal(7, zh.Length);
        Assert.Equal(FormOptionCatalog.RoleTypeIds.Order(), zh.Select(c => c.PresetId).Order());
        Assert.Empty(zh.Select(c => c.Id).Intersect(en.Select(c => c.Id)));
        foreach (var (a,b) in zh.Zip(en))
        {
            Assert.NotEqual(a.Name,b.Name);
            Assert.NotEmpty(a.StoryRole); Assert.NotEmpty(b.StoryRole);
            Assert.NotEmpty(a.Personality); Assert.NotEmpty(a.Appearance); Assert.NotEmpty(a.Clothing!);
            Assert.Equal(a.RoleTypeId, a.PresetId);
            Assert.Contains(a.AgeRangeId!, FormOptionCatalog.AgeRangeIds);
            Assert.Contains(a.GenderId!, FormOptionCatalog.GenderIds);
            Assert.Equal(a.AgeRangeId, b.AgeRangeId);
            Assert.Equal(a.GenderId, b.GenderId);
            Assert.DoesNotContain(FormOptionCatalog.ForLocale("zh-CN").RoleTypes, role => role.Label == a.Name);
            Assert.Empty(a.ReferenceImages!);
        }
    }

    [Fact]
    public void LegacyPresetUpgradePreservesCustomNamesAndDemographics()
    {
        var original = CharacterPresetCatalog.Create("en-US")[0];
        var legacy = original with { Name = "Protagonist", AgeRangeId = null, GenderId = null };
        Assert.Equal(original, CharacterPresetCatalog.UpgradeLegacy(legacy));
        var custom = original with { Name = "My hero", AgeRangeId = "senior", GenderId = "neutral" };
        Assert.Equal(custom, CharacterPresetCatalog.UpgradeLegacy(custom));
        Assert.Equal(legacy with { PresetId = null }, CharacterPresetCatalog.UpgradeLegacy(legacy with { PresetId = null }));
    }

    [Fact]
    public void LegacyCreatorDetailsAreBackfilledWithoutOverwritingCapturedIdentity()
    {
        var user = new CurrentUserDto("owner", null, "Creator", null, "creator@example.test", new("org", "Organization"), [], [], "en-US", null, Phone:"123", ClientName:"Client");
        var missing = new ProjectInfoDto("", "", "", null, null, "Project", null, null, []);
        var repaired = CreatorInfo.FillMissing(missing, user);
        Assert.Equal("Client", repaired.ClientName); Assert.Equal("Creator", repaired.ContactName); Assert.Equal(user.Email, repaired.Email); Assert.Equal("123",repaired.Phone);
        var snapshot = missing with { ClientName="Captured company",ContactName="Captured name", Email="captured@example.test", Phone="456" };
        Assert.Equal(snapshot,CreatorInfo.FillMissing(snapshot,user));
    }

    [Fact]
    public async Task AnthropicUsesMessagesHeadersAndBase64ImageBlocks()
    {
        var handler = new AnthropicHandler();
        using var client = new HttpClient(handler);
        var service = new BookRecognitionService(client, new(true, new Uri("https://example.test/v1/messages"), "vision", "test-key", "anthropic"));
        var result = await service.RecognizeAsync([new("image/jpeg", [1,2,3])], [], "zh-CN", default);
        Assert.Equal("Book", result.Title);
    }

    private sealed class AnthropicHandler : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Assert.Null(request.Headers.Authorization);
            Assert.Equal("test-key", request.Headers.GetValues("x-api-key").Single());
            Assert.Equal("2023-06-01", request.Headers.GetValues("anthropic-version").Single());
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
            Assert.True(json.RootElement.TryGetProperty("max_tokens", out _));
            Assert.False(json.RootElement.TryGetProperty("response_format", out _));
            var image = json.RootElement.GetProperty("messages")[0].GetProperty("content")[1];
            Assert.Equal("image", image.GetProperty("type").GetString());
            Assert.Equal("image/jpeg", image.GetProperty("source").GetProperty("media_type").GetString());
            Assert.Equal("AQID", image.GetProperty("source").GetProperty("data").GetString());
            return new(HttpStatusCode.OK) { Content = new StringContent("{\"stop_reason\":\"end_turn\",\"content\":[{\"type\":\"text\",\"text\":\"{\\\"title\\\":\\\"Book\\\"}\"}]}") };
        }
    }

    private sealed class ProviderHandler : HttpMessageHandler
    {
        public int Calls; public string? Body; public string? Authorization;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Calls++; Body=await request.Content!.ReadAsStringAsync(token); Authorization=request.Headers.Authorization?.ToString();
            var content = "{\"title\":\"Book\",\"authorName\":\"Author\",\"subtitle\":\"\",\"genreId\":\"fiction\",\"sellingPoint\":\"\",\"synopsis\":\"\"}";
            return new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { choices = new[] { new { finish_reason="stop", message = new { content } } } })) };
        }
    }
}
