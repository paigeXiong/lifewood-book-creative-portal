using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class RuntimeSettingsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-runtime-settings-tests-" + Guid.NewGuid().ToString("N"));

    public RuntimeSettingsTests() => Directory.CreateDirectory(root);

    [Fact]
    public void PreservesConfiguredHttpsUrl()
    {
        var settings = new RuntimeSettingsStore(root, "https://0.0.0.0:5443");

        Assert.Equal("https://0.0.0.0:5443", settings.ActiveUrl);
        var value = settings.Get(canRestart: true, canShutdown: true);
        Assert.Equal("https", value.Scheme);
        Assert.Equal("https", value.ActiveScheme);
    }

    [Fact]
    public void LoadsLegacySettingsAsHttpWithoutLosingAddressOrPort()
    {
        File.WriteAllText(Path.Combine(root, "runtime-settings.json"), "{\"listenAddress\":\"0.0.0.0\",\"port\":5088}");

        var settings = new RuntimeSettingsStore(root, null);

        Assert.Equal("http://0.0.0.0:5088", settings.ActiveUrl);
        var value = settings.Get(canRestart: true, canShutdown: true);
        Assert.Equal("http", value.Scheme);
        Assert.Equal("0.0.0.0", value.ListenAddress);
        Assert.Equal(5088, value.Port);
    }

    [Fact]
    public void RejectsUnsupportedProtocol()
    {
        var settings = new RuntimeSettingsStore(root, "http://127.0.0.1:5077");

        Assert.False(settings.Save("ftp", "0.0.0.0", 5077, out var field));
        Assert.Equal("scheme", field);
    }

    [Fact]
    public void OmittedProtocolPreservesCurrentHttpsSetting()
    {
        var settings = new RuntimeSettingsStore(root, "https://127.0.0.1:5443");

        Assert.True(settings.Save(null, "0.0.0.0", 5444, out var field));
        Assert.Null(field);
        var value = settings.Get(canRestart: true, canShutdown: true);
        Assert.Equal("https", value.Scheme);
        Assert.Equal("0.0.0.0", value.ListenAddress);
        Assert.Equal(5444, value.Port);
    }

    [Fact]
    public void EmptyProtocolCannotDowngradeCurrentHttpsSetting()
    {
        var settings = new RuntimeSettingsStore(root, "https://127.0.0.1:5443");

        Assert.False(settings.Save(" ", "0.0.0.0", 5444, out var field));
        Assert.Equal("scheme", field);
        Assert.Equal("https", settings.Get(canRestart: true, canShutdown: true).Scheme);
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
