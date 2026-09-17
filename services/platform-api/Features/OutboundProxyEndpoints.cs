using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using System.Security.Authentication;

namespace Lifewood.PlatformApi.Features;

internal static class OutboundProxyEndpoints
{
    private static (string Id, string Label)[] Scopes(BookRecognitionSettingsStore ai, OidcStore oidc, string locale) =>
        new[] { ("global", locale == "en-US" ? "Global default" : "全局默认") }
            .Concat(ai.Get(locale).Providers.Select(p => ("ai:" + p.Id, "AI · " + p.Name)))
            .Concat(oidc.List().Select(p => ("oidc:" + p.Id, "OIDC · " + (locale == "en-US" ? p.NameEn : p.NameZh)))).ToArray();
    private static IResult Error(HttpContext c, string code, int status = 400) => Results.Json(new ApiErrorDto("proxy." + code, "outboundProxy.errors." + code, "Unable to complete outbound proxy request.", null, false, c.TraceIdentifier), AppJsonContext.Default.ApiErrorDto, statusCode: status);
    public static void MapOutboundProxy(this RouteGroupBuilder api, Func<HttpContext, CurrentUserDto?> currentUser)
    {
        var group = api.MapGroup("/admin/outbound-proxy");
        group.AddEndpointFilter(async (context, next) => {
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            return currentUser(context.HttpContext)?.Roles.Contains("owner") == true ? await next(context) : Results.Forbid();
        });
        group.MapGet("", (string? locale, OutboundProxyStore store, BookRecognitionSettingsStore ai, OidcStore oidc) => Results.Ok(store.Read(Scopes(ai, oidc, locale ?? "zh-CN"), locale ?? "zh-CN")));
        group.MapPut("", (SaveProxyRequest input, string? locale, HttpContext c, OutboundProxyStore store, BookRecognitionSettingsStore ai, OidcStore oidc) => {
            var scopes = Scopes(ai, oidc, locale ?? "zh-CN");
            var error = store.Save(input, scopes.Select(p => p.Id).ToHashSet());
            return error is null ? Results.Ok(store.Read(scopes, locale ?? "zh-CN")) : Error(c, error, error == "conflict" ? 409 : 400);
        });
        group.MapPost("/test", async (ProxyTestRequest input, HttpContext c, OutboundProxyStore store, BookRecognitionSettingsStore ai, OidcStore oidc) => {
            if (!store.IsCurrent(input.Revision)) return Error(c, "conflict", 409);
            var isOidc = input.Scope?.StartsWith("oidc:", StringComparison.Ordinal) == true;
            var target = isOidc ? oidc.List().FirstOrDefault(p => "oidc:" + p.Id == input.Scope)?.Issuer
                : ai.Get("en-US").Providers.FirstOrDefault(p => "ai:" + p.Id == input.Scope)?.Endpoint;
            if (target is null) return Error(c, "target");
            try {
                var route = store.Resolve(input.Scope!);
                if (!store.IsCurrent(input.Revision)) return Error(c, "conflict", 409);
                using var client = new HttpClient(new OutboundProxyHandler(store, isOidc)) { Timeout = TimeSpan.FromSeconds(15) };
                using var request = new HttpRequestMessage(HttpMethod.Head, target);
                request.Options.Set(OutboundProxyHandler.Snapshot, route);
                using var response = await client.SendAsync(request, c.RequestAborted);
                return store.IsCurrent(input.Revision) ? Results.Ok(new ProxyTestResult((int)response.StatusCode)) : Error(c, "conflict", 409);
            } catch (Exception ex) {
                for (Exception? cause = ex; cause is not null; cause = cause.InnerException) {
                    if (cause is ProxyConnectionException proxy) return Error(c, proxy.Code);
                    if (cause is HttpRequestException { StatusCode: System.Net.HttpStatusCode.ProxyAuthenticationRequired }) return Error(c, "authentication");
                    if (cause is AuthenticationException) return Error(c, "tls");
                }
                return Error(c, ex is OperationCanceledException ? "timeout" : "connection");
            }
        }).RequireRateLimiting("authentication");
    }
}
