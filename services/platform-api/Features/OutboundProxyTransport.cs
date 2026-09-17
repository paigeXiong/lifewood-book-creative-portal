using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Text;

namespace Lifewood.PlatformApi.Features;

internal sealed class ProxyConnectionException(string code) : HttpRequestException("Outbound proxy connection failed.") { public string Code { get; } = code; }
internal sealed class OutboundProxyHandler(OutboundProxyStore store, bool oidc) : HttpMessageHandler
{
    internal static readonly HttpRequestOptionsKey<string> Scope = new("BookCreativePortal.ProxyScope");
    internal static readonly HttpRequestOptionsKey<ResolvedProxy> Snapshot = new("BookCreativePortal.ProxySnapshot");
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri is not { Scheme: "https" } target || oidc && !OidcBackchannel.Https(target.AbsoluteUri)) throw new ProxyConnectionException("target");
        var route = request.Options.TryGetValue(Snapshot, out var snapshot) ? snapshot : store.Resolve(request.Options.TryGetValue(Scope, out var scope) ? scope : "global");
        IWebProxy? proxy = route.Mode switch { "direct" => null, "system" => HttpClient.DefaultProxy, "custom" => new WebProxy(route.Address!) { Credentials = route.Credential }, _ => throw new ProxyConnectionException("invalid") };
        using var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, UseProxy = !oidc && proxy is not null, Proxy = !oidc ? proxy : null, ConnectTimeout = TimeSpan.FromSeconds(10) };
        if (oidc) handler.ConnectCallback = async (context, cancellation) => {
            // Resolve and pin the destination locally even when a proxy resolves DNS differently.
            var addresses = await OidcBackchannel.Addresses(context.DnsEndPoint.Host, cancellation);
            if (proxy is null || proxy.IsBypassed(target)) return await ProxyTunnel.Direct(addresses, context.DnsEndPoint.Port, cancellation);
            var proxyUri = proxy.GetProxy(target) ?? throw new ProxyConnectionException("invalid");
            return await ProxyTunnel.Connect(proxyUri, proxy.Credentials?.GetCredential(proxyUri, "Basic"), addresses, context.DnsEndPoint.Port, cancellation);
        };
        using var sender = new HttpMessageInvoker(handler, disposeHandler: false);
        var response = await sender.SendAsync(request, cancellationToken);
        try {
            if (response.StatusCode == HttpStatusCode.ProxyAuthenticationRequired) throw new ProxyConnectionException("authentication");
            // These integrations already have bounded JSON responses. Buffer before disposing the
            // per-request transport so changes apply immediately without orphaned connection pools.
            await response.Content.LoadIntoBufferAsync(oidc ? 1_048_576 : 64_000, cancellationToken);
            return response;
        } catch { response.Dispose(); throw; }
    }
}

internal static class ProxyTunnel
{
    internal static async Task<Stream> Direct(IPAddress[] addresses, int port, CancellationToken cancellation)
    {
        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
        try { await socket.ConnectAsync(addresses, port, cancellation); return new NetworkStream(socket, ownsSocket: true); }
        catch { socket.Dispose(); throw; }
    }
    internal static async Task<Stream> Connect(Uri proxy, NetworkCredential? credential, IPAddress[] destinations, int port, CancellationToken cancellation)
    {
        if (!OutboundProxyStore.ValidAddress(proxy.AbsoluteUri)) throw new ProxyConnectionException("unsupported");
        Stream stream = await Direct(await Dns.GetHostAddressesAsync(proxy.IdnHost, cancellation), proxy.Port, cancellation);
        try {
            if (proxy.Scheme == "https") {
                var tls = new SslStream(stream, leaveInnerStreamOpen: false); stream = tls;
                await tls.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = proxy.IdnHost }, cancellation);
            }
            var destination = destinations.FirstOrDefault(ip => ip.AddressFamily == AddressFamily.InterNetwork) ?? destinations[0];
            var authority = (destination.AddressFamily == AddressFamily.InterNetworkV6 ? $"[{destination}]" : destination.ToString()) + ":" + port;
            var authorization = credential is null || credential.UserName.Length == 0 ? "" : "Proxy-Authorization: Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes(credential.UserName + ":" + credential.Password)) + "\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n{authorization}\r\n"), cancellation);
            // Read only the bounded header, never consume bytes belonging to the TLS tunnel.
            var header = new List<byte>(); var one = new byte[1];
            while (header.Count < 8192) {
                if (await stream.ReadAsync(one, cancellation) == 0) throw new ProxyConnectionException("connection");
                header.Add(one[0]);
                if (header.Count >= 4 && header[^4] == 13 && header[^3] == 10 && header[^2] == 13 && header[^1] == 10) break;
            }
            if (header.Count >= 8192) throw new ProxyConnectionException("connection");
            var status = Encoding.ASCII.GetString(header.ToArray()).Split('\r')[0].Split(' ');
            if (status.Length < 2 || !status[0].StartsWith("HTTP/1.", StringComparison.Ordinal) || !int.TryParse(status[1], out var code)) throw new ProxyConnectionException("connection");
            if (code == 407) throw new ProxyConnectionException("authentication");
            if (code is < 200 or > 299) throw new ProxyConnectionException("connection");
            return stream;
        } catch { await stream.DisposeAsync(); throw; }
    }
}

internal sealed class ProxyScopeHandler(HttpClient client, string scope) : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        // HttpClient marks requests as sent before invoking this handler; forwarding the same
        // instance through a second HttpClient would be rejected before reaching the transport.
        using var forwarded = new HttpRequestMessage(request.Method, request.RequestUri) { Content = request.Content, Version = request.Version, VersionPolicy = request.VersionPolicy };
        foreach (var header in request.Headers) forwarded.Headers.TryAddWithoutValidation(header.Key, header.Value);
        foreach (var option in request.Options) forwarded.Options.Set(new HttpRequestOptionsKey<object?>(option.Key), option.Value);
        forwarded.Options.Set(OutboundProxyHandler.Scope, scope);
        try { return await client.SendAsync(forwarded, cancellationToken); }
        finally { forwarded.Content = null; }
    }
    protected override void Dispose(bool disposing) { if (disposing) client.Dispose(); base.Dispose(disposing); }
    internal static HttpClient Wrap(HttpClient client, string scope) => new(new ProxyScopeHandler(client, scope)) { Timeout = client.Timeout, MaxResponseContentBufferSize = client.MaxResponseContentBufferSize };
}
