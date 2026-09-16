using Lifewood.PlatformApi.Features;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed class MailSettingsTests
{
    private static MailSettings Settings(string key, string? value) {
        var values = new Dictionary<string, string?> {
            ["Lifewood:Mail:Enabled"] = "true", ["Lifewood:Mail:Host"] = "smtp.example.test",
            ["Lifewood:Mail:From"] = "portal@example.test", ["Lifewood:Mail:PublicUrl"] = "https://portal.example.test"
        };
        values["Lifewood:Mail:" + key] = value;
        return new(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
    }
    [Theory]
    [InlineData("Enabled", "false", "enabled")]
    [InlineData("Host", " ", "host")]
    [InlineData("Host", "smtp.example.test:587", "host")]
    [InlineData("Host", "https://smtp.example.test", "host")]
    [InlineData("Port", "typo", "port")]
    [InlineData("Port", "0", "port")]
    [InlineData("Port", "65536", "port")]
    [InlineData("Port", "465", "port")]
    [InlineData("From", "Name <portal@example.test>", "sender")]
    [InlineData("PublicUrl", "http://portal.example.test", "portal")]
    [InlineData("PublicUrl", "https://portal.example.test/zh-CN/tasks", "portal")]
    [InlineData("PublicUrl", "https://portal.example.test/?token=secret", "portal")]
    [InlineData("PublicUrl", "https://user:password@portal.example.test", "portal")]
    [InlineData("Username", "private-username", "credentials")]
    [InlineData("Password", "private-password", "credentials")]
    public void InvalidConfigurationFailsWithOnlyStableCheckCodes(string key, string value, string expected) {
        var settings = Settings(key, value); Assert.False(settings.Ready);
        Assert.Equal(expected, Assert.Single(settings.ConfigurationChecks, check => !check.Passed).Code); Assert.Equal(6, settings.ConfigurationChecks.Count);
    }
    [Theory]
    [InlineData(null, 587)] [InlineData("", 587)] [InlineData("587", 587)] [InlineData("2525", 2525)]
    public void ValidPortsAndOmittedDefaultAreAccepted(string? port, int expected) {
        var settings = Settings("Port", port); Assert.True(settings.Ready); Assert.Equal(expected, settings.Port);
    }
    [Fact] public void InvalidPortNeverSilentlyFallsBackToDefault() {
        var settings = Settings("Port", "not-a-port"); Assert.Equal(0, settings.Port); Assert.False(settings.Ready);
    }
    [Fact] public void LocalPortalRemainsSupported() => Assert.True(Settings("PublicUrl", "http://127.0.0.1:5173").Ready);
    [Fact] public void CompleteCredentialsRemainSupported() {
        var settings = new MailSettings(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> {
            ["Lifewood:Mail:Enabled"] = "true", ["Lifewood:Mail:Host"] = "smtp.example.test", ["Lifewood:Mail:From"] = "portal@example.test",
            ["Lifewood:Mail:PublicUrl"] = "https://portal.example.test", ["Lifewood:Mail:Username"] = "smtp-user", ["Lifewood:Mail:Password"] = "smtp-password"
        }).Build());
        Assert.True(settings.Ready); Assert.All(settings.ConfigurationChecks, check => Assert.True(check.Passed));
    }
}
