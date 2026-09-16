using System.Net;
using System.Net.Sockets;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;
internal static class OidcBackchannel
{
    internal static bool PublicAddress(IPAddress value) {
        var address=value.IsIPv4MappedToIPv6?value.MapToIPv4():value;
        if(IPAddress.IsLoopback(address)) return false;
        var b=address.GetAddressBytes();
        if(b.Length==16) return (b[0]&0xe0)==0x20 && !(b[0]==0x20 && b[1]==1 && b[2]==0x0d && b[3]==0xb8);
        return b[0] is >0 and <224 && b[0]!=10 && b[0]!=127 && !(b[0]==169&&b[1]==254) && !(b[0]==172&&b[1]>=16&&b[1]<=31) && !(b[0]==192&&b[1]==168) && !(b[0]==100&&b[1]>=64&&b[1]<=127) && !(b[0]==198&&b[1] is 18 or 19);
    }
    internal static bool Https(string? value) => Uri.TryCreate(value,UriKind.Absolute,out var u)&&u.Scheme=="https"&&u.UserInfo.Length==0&&u.Fragment.Length==0&&u.HostNameType!=UriHostNameType.Unknown&&!u.IsLoopback&&(!IPAddress.TryParse(u.Host,out var ip)||PublicAddress(ip));
    internal static bool Origin(string? value) => Uri.TryCreate(value,UriKind.Absolute,out var u)&&u.UserInfo.Length==0&&u.Query.Length==0&&u.Fragment.Length==0&&u.AbsolutePath=="/"&&(u.Scheme=="https"||u.Scheme=="http"&&u.IsLoopback);
    internal static bool AdminOrigin(string? value) => Uri.TryCreate(value,UriKind.Absolute,out var u)&&u.UserInfo.Length==0&&u.Query.Length==0&&u.Fragment.Length==0&&u.AbsolutePath.TrimEnd('/') is "" or "/admin"&&(u.Scheme=="https"||u.Scheme=="http"&&u.IsLoopback);
    internal static async Task<IPAddress[]> Addresses(string host,CancellationToken cancellation) {
        var addresses=await Dns.GetHostAddressesAsync(host,cancellation);
        if(addresses.Length==0||addresses.Any(a=>!PublicAddress(a)))throw new InvalidOperationException("The identity endpoint must use a public address.");
        return addresses;
    }
    public static HttpMessageHandler Handler() => new RequireHttpsHandler(new SocketsHttpHandler {
        AllowAutoRedirect=false,UseCookies=false,UseProxy=false,ConnectTimeout=TimeSpan.FromSeconds(10),
        ConnectCallback=async (context,cancellation)=>{
            var addresses=await Addresses(context.DnsEndPoint.Host,cancellation);
            var socket=new Socket(SocketType.Stream,ProtocolType.Tcp);
            try { await socket.ConnectAsync(addresses,context.DnsEndPoint.Port,cancellation);return new NetworkStream(socket,ownsSocket:true); }
            catch { socket.Dispose();throw; }
        }
    });
    private sealed class RequireHttpsHandler(HttpMessageHandler inner):DelegatingHandler(inner) {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellation) {
            if(!Https(request.RequestUri?.AbsoluteUri))throw new InvalidOperationException("HTTPS is required.");
            return base.SendAsync(request,cancellation);
        }
    }
    public static bool Valid(SaveOidcConfiguration input) => input.NameZh?.Trim() is {Length:>0 and <=60} && input.NameEn?.Trim() is {Length:>0 and <=60}
        && input.ClientId?.Trim() is {Length:>0 and <=256} && input.Secret?.Length is not >4096
        && input.Issuer?.Length<=500 && Https(input.Issuer) && !new Uri(input.Issuer).Query.Any()
        && input.PublicOrigin?.Length<=500 && Origin(input.PublicOrigin) && input.AdminOrigin?.Length<=500 && AdminOrigin(input.AdminOrigin);
    public static async Task<OpenIdConnectConfiguration> Test(HttpClient client,string issuer,CancellationToken cancellation) {
        var document=await OpenIdConnectConfigurationRetriever.GetAsync(issuer.TrimEnd('/')+"/.well-known/openid-configuration",new HttpDocumentRetriever(client){RequireHttps=true},cancellation);
        if(document.Issuer!=issuer||!Https(document.AuthorizationEndpoint)||!Https(document.TokenEndpoint)||!Https(document.JwksUri)||document.SigningKeys.Count==0||!document.ResponseTypesSupported.Contains("code"))throw new InvalidOperationException("Invalid OIDC metadata.");
        return document;
    }
}
