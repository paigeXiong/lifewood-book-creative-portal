using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class MailSettingsStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "portal-mail-settings-" + Guid.NewGuid().ToString("N"));
    private readonly EphemeralDataProtectionProvider protection = new();
    private static MailSettings Empty() => new(new ConfigurationBuilder().Build());
    private static SaveMailSettings Input(string revision) => new(revision, true, "smtp.example.test", 587, "sender@example.test", "sender@example.test", "test-credential", false, "https://portal.example.test");

    [Fact] public void SavesEncryptedAndLoadsOverEnvironmentWithoutReturningCredential()
    {
        var settings = Empty(); var store = new MailSettingsStore(root, settings, protection);
        Assert.Null(store.Save(Input(store.Read("en-US").Revision)));
        Assert.True(settings.Ready);
        var file = File.ReadAllText(Path.Combine(root, "mail-settings.json"));
        Assert.DoesNotContain("test-credential", file);
        var value = store.Read("en-US"); Assert.True(value.HasPassword); Assert.Equal("Email service", value.Labels["title"]);
        var restored = Empty(); var second = new MailSettingsStore(root, restored, protection);
        Assert.Equal("test-credential", restored.Password); Assert.Equal(value.Revision, second.Read("zh-CN").Revision);
        Assert.Equal("邮件服务", second.Read("zh-CN").Labels["title"]);
    }
    [Fact] public void PreventsStaleSaveAndCredentialForwardingToNewHostPortOrAccount()
    {
        var settings = Empty(); var store = new MailSettingsStore(root, settings, protection);
        var original = Input(store.Read(null).Revision); Assert.Null(store.Save(original));
        Assert.Equal("conflict", store.Save(original));
        var retained = original with { Revision = store.Read(null).Revision, Password = "" };
        Assert.Equal("credentialsChanged", store.Save(retained with { Host = "elsewhere.example.test" }));
        Assert.Equal("credentialsChanged", store.Save(retained with { Port = 2525 }));
        Assert.Equal("credentialsChanged", store.Save(retained with { Username = "other" }));
        Assert.Null(store.Save(retained)); Assert.Equal("test-credential", settings.Password);
        Assert.Null(store.Save(retained with { Revision = store.Read(null).Revision, Enabled = false, ClearPassword = true }));
        Assert.Equal("", settings.Password); Assert.False(settings.Ready);
    }
    [Theory]
    [InlineData("smtp://host", 587, "https://portal.example.test")]
    [InlineData("smtp.example.test", 465, "https://portal.example.test")]
    [InlineData("smtp.example.test", 587, "http://public.example.test")]
    [InlineData("smtp.example.test", 587, "https://portal.example.test/path")]
    public void RejectsInvalidEnabledSettingsWithoutWriting(string host, int port, string url)
    {
        var settings = Empty(); var store = new MailSettingsStore(root, settings, protection);
        Assert.Equal("invalid", store.Save(Input(store.Read(null).Revision) with { Host = host, Port = port, PublicUrl = url }));
        Assert.False(settings.Ready); Assert.False(File.Exists(Path.Combine(root, "mail-settings.json")));
    }
    [Fact] public void AllowsDisablingIncompleteSettingsAndLimitsTestsToSavedSenderOncePerMinute()
    {
        var settings = Empty(); var store = new MailSettingsStore(root, settings, protection);
        Assert.Null(store.Save(Input(store.Read(null).Revision) with { Enabled = false, Host = "", Password = "" }));
        Assert.Equal("unavailable", store.BeginTest(store.Read(null).Revision, out _));
        Assert.Null(store.Save(Input(store.Read(null).Revision)));
        Assert.Equal("conflict", store.BeginTest("old", out _));
        Assert.Null(store.BeginTest(store.Read(null).Revision, out var recipient)); Assert.Equal("sender@example.test", recipient);
        Assert.Equal("cooldown", store.BeginTest(store.Read(null).Revision, out _));
    }
    [Fact] public void FailedPersistenceDoesNotActivateSettings()
    {
        Directory.CreateDirectory(root); Directory.CreateDirectory(Path.Combine(root, "mail-settings.json"));
        var settings = Empty(); var store = new MailSettingsStore(root, settings, protection);
        var revision = store.Read(null).Revision;
        var exception = Record.Exception(() => store.Save(Input(revision)));
        Assert.True(exception is IOException or UnauthorizedAccessException);
        Assert.Equal(revision, store.Read(null).Revision); Assert.False(settings.Ready);
    }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
