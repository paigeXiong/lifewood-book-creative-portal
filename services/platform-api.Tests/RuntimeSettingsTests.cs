using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Contracts;
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

    [Fact]
    public void IndependentListenersPersistAndBecomeActiveOnlyOnRestart()
    {
        var store = new RuntimeSettingsStore(root, "http://127.0.0.1:5077");
        Assert.Single(store.ActiveUrls);
        Assert.True(store.Save("http", "127.0.0.1", 5077, new("0.0.0.0", 5173), new("::1", 5174), out _));
        var pending = store.Get(true, true);
        Assert.True(pending.RestartRequired);
        Assert.Equal(5077, pending.ActiveCustomer.Port);
        var restarted = new RuntimeSettingsStore(root, null);
        Assert.Equal(3, restarted.ActiveUrls.Length);
        Assert.Contains("http://[::1]:5174", restarted.ActiveUrls);
        Assert.False(restarted.Get(true, true).RestartRequired);
        Assert.Equal("http://example.test:5173/en-US/tasks", restarted.PortalUrl(false, "example.test", "en-US"));
    }

    [Theory]
    [InlineData(5077, 5174)]
    [InlineData(5173, 5173)]
    [InlineData(0, 5174)]
    [InlineData(5173, 65536)]
    public void InvalidOrConflictingWebPortsDoNotPersist(int customerPort, int adminPort)
    {
        var store = new RuntimeSettingsStore(root, "http://127.0.0.1:5077");
        Assert.False(store.Save("http", "127.0.0.1", 5077, new("127.0.0.1", customerPort), new("127.0.0.1", adminPort), out _));
        Assert.False(File.Exists(Path.Combine(root, "runtime-settings.json")));
    }

    [Fact]
    public void ExternalListenersReportActualLaunchAddressesUntilLauncherRestarts()
    {
        var store = new RuntimeSettingsStore(root, "http://127.0.0.1:5077", "http://127.0.0.1:5173", "http://127.0.0.1:5174");
        Assert.True(store.Save("http", "127.0.0.1", 5077, new("0.0.0.0", 5273), null, out _));
        var restartedBackend = new RuntimeSettingsStore(root, "http://127.0.0.1:5077", "http://127.0.0.1:5173", "http://127.0.0.1:5174");
        var pending = restartedBackend.Get(true, true);
        Assert.True(pending.RestartRequired);
        Assert.Equal(5173, pending.ActiveCustomer.Port);
        Assert.Equal(5273, pending.Customer.Port);
        Assert.False(pending.CanRestart);
        Assert.False(pending.CanShutdown);
        Assert.Single(restartedBackend.ActiveUrls);
        var restartedAll = new RuntimeSettingsStore(root, "http://127.0.0.1:5077", "http://0.0.0.0:5273", "http://127.0.0.1:5174");
        Assert.False(restartedAll.Get(true, true).RestartRequired);
        Assert.Equal("http://[::1]:5174/en-US/projects", restartedAll.PortalUrl(true, "[::1]", "en-US"));
        Assert.Equal("http://example.test:5174/zh-CN/projects", restartedAll.PortalUrl(true, "example.test", "zh-CN"));
    }

    [Fact]
    public void SharedPublishedPortalsKeepRelativeUrlsForReverseProxies()
    {
        var store = new RuntimeSettingsStore(root, "http://127.0.0.1:5077");
        Assert.Equal("/admin/zh-CN/projects", store.PortalUrl(true, "public.example", "zh-CN"));
        Assert.Equal("/en-US/tasks", store.PortalUrl(false, "public.example", "en-US"));
        Assert.True(store.Save("http", "0.0.0.0", 5088, out _));
        var restarted = new RuntimeSettingsStore(root, null);
        Assert.Equal(5088, restarted.Get(true, true).ActiveCustomer.Port);
        Assert.Single(restarted.ActiveUrls);
    }

    [Fact]
    public void MixedSharedAndIndependentNavigationUsesTheTargetListener()
    {
        var store = new RuntimeSettingsStore(root, "http://127.0.0.1:5077");
        Assert.True(store.Save("http", "127.0.0.1", 5077, new("127.0.0.1", 5173), null, out _));
        var restarted = new RuntimeSettingsStore(root, null);
        Assert.Equal("http://example.test:5077/admin/en-US/projects", restarted.PortalUrl(true, "example.test", "en-US", 5173));
        Assert.Equal("/admin/en-US/projects", restarted.PortalUrl(true, "example.test", "en-US", 5077));
        Assert.True(restarted.Save("http", "127.0.0.1", 5077, new("127.0.0.1", 5077, "http", true), new("127.0.0.1", 5174), out _));
        var reverse = new RuntimeSettingsStore(root, null);
        Assert.Equal("http://example.test:5077/en-US/tasks", reverse.PortalUrl(false, "example.test", "en-US", 5174));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
