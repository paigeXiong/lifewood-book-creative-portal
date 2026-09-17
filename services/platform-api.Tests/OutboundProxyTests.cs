using System.Net;
using System.Net.Sockets;
using System.Text;
using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.DataProtection;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed class OutboundProxyTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "portal-proxy-" + Guid.NewGuid().ToString("N"));
    private readonly EphemeralDataProtectionProvider protection = new();
    private static readonly HashSet<string> Scopes = ["global", "oidc:old", "oidc:new", "ai:one"];
    private static ProxySettingsDto Read(OutboundProxyStore store) => store.Read(Scopes.Select(id => (id, id)).ToArray(), "en-US");
    [Fact] public void MigrationInheritanceOverridesEncryptionAndRestart()
    {
        var store = new OutboundProxyStore(root, protection, ["old"]);
        Assert.Equal("direct", store.Resolve("oidc:old").Mode);
        Assert.Equal("system", store.Resolve("oidc:new").Mode);
        var input = new SaveProxyRequest(Read(store).Revision, "global", "custom", "http://localhost:8080", "proxy-user", "private-proxy-secret");
        Assert.Null(store.Save(input, Scopes));
        Assert.Equal("private-proxy-secret", store.Resolve("ai:one").Credential!.Password);
        Assert.Equal("direct", store.Resolve("oidc:old").Mode);
        Assert.DoesNotContain("private-proxy-secret", File.ReadAllText(Path.Combine(root, "outbound-proxy.json")));
        Assert.Equal("conflict", store.Save(input, Scopes));
        Assert.Equal("credentialsChanged", store.Save(input with { Revision = Read(store).Revision, Address = "http://other:8080", Password = "" }, Scopes));
        Assert.Null(store.Save(input with { Revision = Read(store).Revision, Scope = "ai:one", Mode = "direct" }, Scopes));
        var restored = new OutboundProxyStore(root, protection, ["new"]);
        Assert.Equal("direct", restored.Resolve("ai:one").Mode);
        Assert.Equal("custom", restored.Resolve("oidc:new").Mode); // Migration must run only once.
        Assert.Null(restored.Save(input with { Revision = Read(restored).Revision, Scope = "ai:one", Mode = "inherit" }, Scopes));
        Assert.Equal("private-proxy-secret", restored.Resolve("ai:one").Credential!.Password);
        Assert.Null(restored.Save(input with { Revision = Read(restored).Revision, Username = "", Password = "", ClearPassword = true }, Scopes));
        Assert.Null(restored.Resolve("global").Credential);
    }
    [Theory]
    [InlineData("socks5://localhost:1080")]
    [InlineData("http://user:secret@localhost:8080")]
    [InlineData("http://localhost:8080/path")]
    [InlineData("http://localhost:8080?secret=1")]
    [InlineData("http://localhost:8080#fragment")]
    public void InvalidProxyNeverReplacesWorkingConfiguration(string address)
    {
        var store = new OutboundProxyStore(root, protection, []);
        Assert.Equal("invalid", store.Save(new(Read(store).Revision, "global", "custom", address, "", ""), Scopes));
        Assert.Equal("system", store.Resolve("global").Mode);
    }
    [Fact] public async Task ConnectPinsDestinationAndDoesNotConsumeTunnelBytes()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var server = Task.Run(async () => {
            using var accepted = await listener.AcceptTcpClientAsync(timeout.Token); using var stream = accepted.GetStream();
            var bytes = new List<byte>(); var one = new byte[1];
            while (!Encoding.ASCII.GetString(bytes.ToArray()).EndsWith("\r\n\r\n")) { Assert.Equal(1, await stream.ReadAsync(one, timeout.Token)); bytes.Add(one[0]); }
            await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 Connection established\r\n\r\nT"), timeout.Token);
            return Encoding.ASCII.GetString(bytes.ToArray());
        });
        await using var tunnel = await ProxyTunnel.Connect(new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}"), new("user", "secret"), [IPAddress.Parse("93.184.215.14")], 443, timeout.Token);
        var marker = new byte[1]; Assert.Equal(1, await tunnel.ReadAsync(marker, timeout.Token)); Assert.Equal((byte)'T', marker[0]);
        var request = await server; Assert.StartsWith("CONNECT 93.184.215.14:443 HTTP/1.1", request);
        Assert.Contains("Proxy-Authorization: Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("user:secret")), request);
    }
    [Theory]
    [InlineData(407, "authentication")]
    [InlineData(502, "connection")]
    public async Task ProxyRejectionNeverFallsBackToDirect(int status, string code)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
        var server = Task.Run(async () => { using var accepted = await listener.AcceptTcpClientAsync(timeout.Token); using var stream = accepted.GetStream(); var bytes = new List<byte>(); var one = new byte[1]; while (!Encoding.ASCII.GetString(bytes.ToArray()).EndsWith("\r\n\r\n")) { Assert.Equal(1, await stream.ReadAsync(one, timeout.Token)); bytes.Add(one[0]); } await stream.WriteAsync(Encoding.ASCII.GetBytes($"HTTP/1.1 {status} Rejected\r\n\r\n"), timeout.Token); });
        var exception = await Assert.ThrowsAsync<ProxyConnectionException>(() => ProxyTunnel.Connect(new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}"), null, [IPAddress.Loopback], 1, timeout.Token));
        Assert.Equal(code, exception.Code); await server;
    }
    [Fact] public async Task OidcPrivateTargetRejectedBeforeProxyConnection()
    {
        var store = new OutboundProxyStore(root, protection, []);
        Assert.Null(store.Save(new(Read(store).Revision, "global", "custom", "http://127.0.0.1:1", "", ""), Scopes));
        using var client = new HttpClient(new OutboundProxyHandler(store, true));
        var error = await Assert.ThrowsAsync<ProxyConnectionException>(() => client.GetAsync("https://127.0.0.1/token"));
        Assert.Equal("target", error.Code);
    }
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
