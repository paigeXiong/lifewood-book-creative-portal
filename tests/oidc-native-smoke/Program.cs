// Isolated native executable. No test endpoint or fake identity service is included in the platform binary.
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

var directory = Path.Combine(Path.GetTempPath(), "oidc-native-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
var connection = "Data Source=" + Path.Combine(directory, "smoke.db") + ";Pooling=False";
new ProjectRepository(connection).Initialize();
var users = new UserRepository(connection, directory); users.Initialize();
var owner = users.CreateOwner("Native test", "native@example.test", "native-password-123").User!;
var sessions = new AccountSwitchStore(connection, users); sessions.Initialize();
var presence = new UserPresenceRepository(connection); presence.Initialize();
using var provider = new FakeIdentityProvider();
var builder = WebApplication.CreateSlimBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(directory, "keys")));
builder.Services.AddSingleton(users); builder.Services.AddSingleton(sessions); builder.Services.AddSingleton(presence);
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie();
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options => options.AddFixedWindowLimiter("authentication", limiter => { limiter.PermitLimit = 100; limiter.Window = TimeSpan.FromMinutes(1); }));
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
OidcFeature.Register(builder.Services, connection, SignIn);
builder.Services.AddHttpClient("oidc").ConfigurePrimaryHttpMessageHandler(() => provider);
await using var app = builder.Build();
app.UseAuthentication(); app.UseAuthorization(); app.UseRateLimiter();
app.MapGroup("/api").MapOidc(c => users.Get(c.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? ""));
app.MapGet("/test/session", async (HttpContext c) => { await SignIn(c, owner, users.GetSessionVersion(owner.Id)!.Value); return Results.NoContent(); });
app.MapGet("/test/who", (HttpContext c) => Results.Text(c.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous"));
await app.StartAsync();
try
{
    var origin = app.Urls.Single();
    var store = app.Services.GetRequiredService<OidcStore>();
    store.Save(new(0, "企业账号", "Enterprise account", FakeIdentityProvider.Issuer, "client", origin, origin + "/admin", true, "secret"), "secret");
    store.Save(new(0, "第二服务", "Second provider", FakeIdentityProvider.Issuer, "second-client", origin, origin + "/admin", true, "secret", "native-second"), "secret");
    ((OidcSchemes)app.Services.GetRequiredService<IAuthenticationSchemeProvider>()).Refresh();
    foreach (var providerId in new[] { "default", "native-second" }) {
    using var binding = Client();
    await binding.GetAsync("/test/session");
    var bound = await Finish(binding, await Authorize(binding, true, providerId: providerId));
    Check(bound.Headers.Location!.ToString().EndsWith("/profile?oidc=bound"), "Native identity binding failed.");
    foreach (var portal in new[] { "customer", "admin" })
    {
        using var fresh = Client();
        var success = await Finish(fresh, await Authorize(fresh, portal: portal, providerId: providerId));
        Check(success.Headers.Location!.ToString().EndsWith(portal == "customer" ? "/en-US/tasks" : "/admin/en-US/"), "Native login redirect failed.");
        Check(await fresh.GetStringAsync("/test/who") == owner.Id, "Native cookie session failed.");
    }
    }
    using var invalid = Client();
    var rejected = await Finish(invalid, await Authorize(invalid), true);
    Check(rejected.Headers.Location!.ToString().EndsWith("oidc=failed"), "Native token validation failed open.");
    Check(await invalid.GetStringAsync("/test/who") == "anonymous", "Invalid token created a session.");
    Check(store.Delete("default", 1), "Native provider deletion failed.");
    ((OidcSchemes)app.Services.GetRequiredService<IAuthenticationSchemeProvider>()).Refresh();
    using var remaining = Client();
    await Finish(remaining, await Authorize(remaining, providerId: "native-second"));
    Check(await remaining.GetStringAsync("/test/who") == owner.Id, "Deleting one provider broke another.");
    Console.WriteLine("PASS: NativeAOT OIDC discovery, PKCE, signed callback, multiple providers, isolated binding and callbacks, customer/admin login, provider deletion and invalid signature rejection.");

    HttpClient Client() => new(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = new Uri(origin) };
    async Task<string> Authorize(HttpClient client, bool bind = false, string portal = "customer", string providerId = "default")
    {
        var input = new OidcStartRequest("en-US", portal, bind, bind ? "native-password-123" : null, providerId);
        using var response = await client.PostAsync("/api/auth/oidc/start", new StringContent(JsonSerializer.Serialize(input, AppJsonContext.Default.OidcStartRequest), Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();
        var start = JsonSerializer.Deserialize(await response.Content.ReadAsStringAsync(), AppJsonContext.Default.OidcStartResult)!;
        var redirect = await client.GetAsync(start.Url);
        Check(redirect.StatusCode == HttpStatusCode.Redirect, "Native challenge failed.");
        return redirect.Headers.Location!.ToString();
    }
    async Task<HttpResponseMessage> Finish(HttpClient client, string authorization, bool badSignature = false)
    {
        var query = QueryHelpers.ParseQuery(new Uri(authorization).Query);
        Check(query["code_challenge_method"] == "S256", "PKCE missing.");
        Check(query["redirect_uri"].ToString().StartsWith(origin + OidcFeature.Callback), "Incorrect callback address.");
        var code = provider.Issue(query["nonce"]!, query["code_challenge"]!, badSignature, query["client_id"]!);
        return await client.GetAsync(new Uri(query["redirect_uri"]!).AbsolutePath + "?code=" + code + "&state=" + Uri.EscapeDataString(query["state"]!));
    }
}
finally
{
    await app.StopAsync();
    await app.DisposeAsync();
    Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
    Directory.Delete(directory, true);
}

async Task<bool> SignIn(HttpContext context, CurrentUserDto user, int version)
{
    var login = sessions.Remember(context, user, version, DateTimeOffset.UtcNow.AddHours(1), false);
    if (login is null) return false;
    var identity = new ClaimsIdentity([new(ClaimTypes.NameIdentifier, user.Id), new("lw_login_session", login)], CookieAuthenticationDefaults.AuthenticationScheme);
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity));
    return true;
}
static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }

sealed class FakeIdentityProvider : HttpMessageHandler
{
    public const string Issuer = "https://native-idp.example.test";
    private readonly RSA rsa = RSA.Create(2048);
    private readonly Dictionary<string, (string Nonce, string Challenge, bool BadSignature, string Client)> codes = new();
    public string Issue(string nonce, string challenge, bool badSignature, string client)
    {
        var code = Guid.NewGuid().ToString("N"); codes.Add(code, (nonce, challenge, badSignature, client)); return code;
    }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        if (request.RequestUri!.AbsolutePath.EndsWith("openid-configuration"))
            return Json("{\"issuer\":\"" + Issuer + "\",\"authorization_endpoint\":\"" + Issuer + "/authorize\",\"token_endpoint\":\"" + Issuer + "/token\",\"jwks_uri\":\"" + Issuer + "/keys\",\"response_types_supported\":[\"code\"],\"subject_types_supported\":[\"public\"],\"id_token_signing_alg_values_supported\":[\"RS256\"]}");
        if (request.RequestUri.AbsolutePath == "/keys")
        {
            var key = rsa.ExportParameters(false);
            return Json("{\"keys\":[{\"kty\":\"RSA\",\"kid\":\"native\",\"use\":\"sig\",\"n\":\"" + Base64UrlEncoder.Encode(key.Modulus!) + "\",\"e\":\"" + Base64UrlEncoder.Encode(key.Exponent!) + "\"}]}");
        }
        var form = QueryHelpers.ParseQuery("?" + await request.Content!.ReadAsStringAsync(cancellation));
        if (!codes.Remove(form["code"]!, out var flow) || flow.Challenge != Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"]!))))
            return new(HttpStatusCode.BadRequest);
        using var wrong = RSA.Create(2048);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer, Audience = flow.Client, Claims = new Dictionary<string, object> { ["sub"] = "native-subject", ["nonce"] = flow.Nonce },
            IssuedAt = DateTime.UtcNow, Expires = DateTime.UtcNow.AddMinutes(5),
            SigningCredentials = new(new RsaSecurityKey(flow.BadSignature ? wrong : rsa) { KeyId = "native" }, SecurityAlgorithms.RsaSha256)
        });
        return Json("{\"id_token\":\"" + token + "\",\"access_token\":\"unused\",\"token_type\":\"Bearer\",\"expires_in\":300}");
    }
    private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK) { Content = new StringContent(value, Encoding.UTF8, "application/json") };
    protected override void Dispose(bool disposing) { if (disposing) rsa.Dispose(); base.Dispose(disposing); }
}
