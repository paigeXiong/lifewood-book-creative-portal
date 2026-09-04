using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class AiSettingsTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "ai-settings-tests-" + Guid.NewGuid().ToString("N"));
    private readonly EphemeralDataProtectionProvider protection = new();
    private BookRecognitionSettingsStore Store() => new(directory, new ConfigurationBuilder().Build(), protection);

    [Fact]
    public void OpenAiRootUsesVersionedEndpoint()
    {
        var store = Store();
        Assert.True(store.Upsert(new(null, "OpenAI", "openai", "https://api.openai.com", "", "test-key", Models: ["vision"])));
        Assert.Equal("https://api.openai.com/v1/chat/completions", store.Get("en-US").Providers[0].Endpoint);
    }

    [Fact]
    public void SavesEncryptedKeyAndReloadsWithoutReturningItToClient()
    {
        var store = Store();
        Assert.True(store.Save(new(true, "https://example.test/v1/chat/completions", "vision", "secret-test-key")));
        Assert.DoesNotContain("secret-test-key", File.ReadAllText(Path.Combine(directory, "book-recognition.json")));
        Assert.True(store.Get("en-US").HasApiKey);
        Assert.DoesNotContain("secret-test-key", store.Get("en-US").ToString());
        Assert.Equal("secret-test-key", Store().Current.ApiKey);
        Assert.True(Store().Current.Enabled);
    }

    [Fact]
    public void RetainsKeyForModelChangeAndClearsItExplicitly()
    {
        var store = Store();
        Assert.True(store.Save(new(true, "https://example.test/chat", "vision", "secret")));
        Assert.True(store.Save(new(true, "https://example.test/chat", "other", "")));
        Assert.Equal("secret", store.Current.ApiKey);
        Assert.Equal("other", store.Current.Model);
        Assert.True(store.Save(new(false, "https://example.test/chat", "other", "", true)));
        Assert.False(Store().Get("zh-CN").HasApiKey);
    }

    [Fact]
    public void InvalidOrChangedEndpointCannotReceiveExistingKey()
    {
        var store = Store();
        Assert.False(store.Save(new(true, "http://example.test/chat", "vision", "secret")));
        Assert.False(store.Save(new(true, "https://example.test/chat", "vision", "")));
        Assert.True(store.Save(new(true, "https://example.test/chat", "vision", "secret")));
        Assert.False(store.Save(new(true, "https://other.test/chat", "vision", "")));
        Assert.Equal("example.test", store.Current.Endpoint!.Host);
        Assert.True(store.Save(new(false, "https://other.test/chat", "vision", "")));
        Assert.False(store.Get("en-US").HasApiKey);
    }

    [Fact]
    public void ProvidersOwnModelListsAndFeaturesCanOnlyChooseTheirModels()
    {
        var store = Store();
        Assert.True(store.Upsert(new(null, "Provider A", "openai", "https://a.test/v1", "", "key-a", Models: ["vision-a", "vision-b"])));
        Assert.True(store.Upsert(new(null, "Provider B", "anthropic", "https://b.test", "", "key-b", Models: ["claude-vision"])));
        var providers = store.Get("en-US").Providers;
        var a = providers.Single(p => p.Name == "Provider A");
        var b = providers.Single(p => p.Name == "Provider B");
        Assert.Equal("https://a.test/v1/chat/completions", a.Endpoint);
        Assert.Equal("https://b.test/v1/messages", b.Endpoint);
        Assert.False(store.Bind(new("book-recognition", a.Id, "claude-vision", true)));
        Assert.True(store.Bind(new("book-recognition", a.Id, "vision-b", true)));
        Assert.Equal("vision-b", store.Current.Model);
        Assert.Equal("key-a", store.Current.ApiKey);
        Assert.False(store.Remove(a.Id));
        Assert.False(store.Upsert(new(a.Id, a.Name, a.Protocol, a.Endpoint, "", "", Models: ["vision-a"])));
        Assert.True(store.Bind(new("book-recognition", b.Id, "claude-vision", true)));
        Assert.Equal("anthropic", Store().Current.Protocol);
        Assert.Equal("key-b", Store().Current.ApiKey);
        Assert.True(store.Remove(a.Id));
        Assert.False(store.Bind(new("unimplemented-feature", b.Id, "claude-vision", true)));
        Assert.True(store.Bind(new("book-recognition", b.Id, "claude-vision", false)));
        Assert.False(Store().Current.Enabled);
    }

    [Fact]
    public void LegacySettingsMigrateWithoutLosingModelKeyOrEnabledState()
    {
        Directory.CreateDirectory(directory);
        var encrypted = protection.CreateProtector("BookRecognition.ApiKey.v1").Protect("legacy-secret");
        var legacy = new AiSettingsDocument(true, "https://example.test/chat/completions", "old-vision", encrypted);
        File.WriteAllText(Path.Combine(directory, "book-recognition.json"), System.Text.Json.JsonSerializer.Serialize(legacy, Lifewood.PlatformApi.Serialization.AppJsonContext.Default.AiSettingsDocument));
        var store = Store();
        var provider = Assert.Single(store.Get("zh-CN").Providers);
        Assert.Equal(["old-vision"], provider.Models);
        Assert.Equal("legacy-secret", store.Current.ApiKey);
        Assert.True(store.Upsert(new(provider.Id, "Renamed", provider.Protocol, provider.Endpoint, "", "", Models: provider.Models)));
        Assert.Equal("old-vision", Store().Current.Model);
        Assert.True(Store().Current.Enabled);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
