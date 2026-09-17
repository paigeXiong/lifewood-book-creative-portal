using System.Security.Claims;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Lifewood.PlatformApi.Features;
internal static class OidcFeature
{
    internal const string Scheme="enterprise";
    internal const string Callback="/api/auth/oidc/callback";
    internal static string SchemeFor(string id)=>id=="default"?Scheme:Scheme+":"+id;
    internal static string CallbackFor(string id)=>id=="default"?Callback:Callback+"/"+id;
    private const string BrowserCookie="lw_oidc_start";
    public static void Register(IServiceCollection services,string connection,Func<HttpContext,CurrentUserDto,int,Task<bool>> signIn) {
        services.AddSingleton(sp=>{var store=new OidcStore(connection,sp.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>());store.Initialize();return store;});
        services.AddHttpClient("oidc",client=>{client.Timeout=TimeSpan.FromSeconds(20);client.MaxResponseContentBufferSize=1024*1024;}).ConfigurePrimaryHttpMessageHandler(sp=>new OutboundProxyHandler(sp.GetRequiredService<OutboundProxyStore>(),true));
        services.AddAuthentication().AddOpenIdConnect(Scheme,_=>{});
        services.AddSingleton<IAuthenticationSchemeProvider,OidcSchemes>();
        services.AddSingleton<IConfigureOptions<OpenIdConnectOptions>>(sp=>new OidcNamedOptions((id,options)=>{
            var store=sp.GetRequiredService<OidcStore>();var http=sp.GetRequiredService<IHttpClientFactory>();
            var saved=store.Get(id);var config=saved.Public;
            options.ClientId=config.ClientId.Length>0?config.ClientId:"disabled";options.ClientSecret=saved.Secret;
            options.Authority=config.Issuer.Length>0?config.Issuer:"https://disabled.invalid";
            options.CallbackPath=CallbackFor(id);options.ResponseType="code";options.ResponseMode="query";options.UsePkce=true;options.RequireHttpsMetadata=true;
            options.Scope.Clear();options.Scope.Add("openid");options.SaveTokens=false;options.MapInboundClaims=false;options.GetClaimsFromUserInfoEndpoint=false;
            options.Backchannel=ProxyScopeHandler.Wrap(http.CreateClient("oidc"),"oidc:"+id); options.PushedAuthorizationBehavior=PushedAuthorizationBehavior.Disable;
            options.CorrelationCookie.SameSite=SameSiteMode.Lax;options.CorrelationCookie.SecurePolicy=CookieSecurePolicy.SameAsRequest;
            options.NonceCookie.SameSite=SameSiteMode.Lax;options.NonceCookie.SecurePolicy=CookieSecurePolicy.SameAsRequest;
            options.RemoteAuthenticationTimeout=TimeSpan.FromMinutes(10);
            options.TokenValidationParameters=new TokenValidationParameters{ValidateIssuer=true,ValidIssuer=config.Issuer,ValidateAudience=true,ValidAudience=config.ClientId,ValidateIssuerSigningKey=true,RequireSignedTokens=true,RequireExpirationTime=true,ValidateLifetime=true,ClockSkew=TimeSpan.FromMinutes(1),ValidAlgorithms=["RS256","ES256"]};
            options.Events=new OpenIdConnectEvents {
                OnTokenValidated=context=>{context.Properties!.Items["validatedIssuer"]=context.SecurityToken.Issuer;return Task.CompletedTask;},
                OnRedirectToIdentityProvider=context=>{
                    if(!store.Get(id).Public.Enabled||store.Get(id).Public.Version!=config.Version)throw new InvalidOperationException("OIDC configuration changed.");
                    if(!OidcBackchannel.Https(context.ProtocolMessage.IssuerAddress))throw new InvalidOperationException("Invalid authorization endpoint.");
                    context.ProtocolMessage.RedirectUri=new Uri(Origin(config,context.Properties.Items["portal"]??"customer")).GetLeftPart(UriPartial.Authority)+CallbackFor(id);
                    context.ProtocolMessage.Prompt="select_account";
                    return Task.CompletedTask;
                },
                OnTicketReceived=async context=>{
                    context.HandleResponse();
                    var flow=store.Consume(Item(context.Properties,"flow"),id);
                    var current=store.Get(id).Public;
                    if(flow is null||flow.ProviderId!=id||flow.Version!=current.Version||!current.Enabled){context.Response.Redirect(Failure(current));return;}
                    var subject=context.Principal?.FindFirstValue("sub");var issuer=Item(context.Properties,"validatedIssuer");
                    if(string.IsNullOrEmpty(subject)||subject.Length>512||issuer!=current.Issuer){context.Response.Redirect(Failure(current,flow));return;}
                    var services=context.HttpContext.RequestServices;var users=services.GetRequiredService<UserRepository>();
                    if(flow.UserId is not null) {
                        var active=users.Get(flow.UserId,flow.SessionVersion);
                        var sessions=services.GetRequiredService<AccountSwitchStore>();
                        if(active is null||flow.LoginSession is null||!sessions.IsSessionActive(active.Id,flow.LoginSession,flow.SessionVersion,false)||!store.Bind(flow,current,subject)) { context.Response.Redirect(Failure(current,flow,"binding"));return; }
                        context.Response.Redirect(Origin(current,"customer")+"/"+flow.Locale+"/profile?oidc=bound");return;
                    }
                    var userId=store.Resolve(current,subject);var user=userId is null?null:users.Get(userId);var version=userId is null?null:users.GetSessionVersion(userId);
                    if(user is null||version is null||flow.Portal=="admin"&&!user.Permissions.Contains("admin.access")){context.Response.Redirect(Failure(current,flow,"unbound"));return;}
                    if(!await signIn(context.HttpContext,user,version.Value)){context.Response.Redirect(Failure(current,flow));return;}
                    services.GetRequiredService<UserPresenceRepository>().Login(user.Id);
                    context.Response.Redirect(Origin(current,flow.Portal)+"/"+(user.Locale??flow.Locale)+(flow.Portal=="admin"?"/":"/tasks"));
                },
                OnRemoteFailure=context=>{ context.HandleResponse();var flow=store.Consume(Item(context.Properties,"flow"),id);context.Response.Redirect(Failure(store.Get(id).Public,flow));return Task.CompletedTask; }
            };
        }));
    }
    private static string Origin(OidcConfiguration config,string portal)=>portal=="admin"?config.AdminOrigin:config.PublicOrigin;
    private static string Item(AuthenticationProperties? properties,string name)=>properties?.Items.TryGetValue(name,out var value)==true?value??"":"";
    private static string Failure(OidcConfiguration config,OidcFlow? flow=null,string code="failed") => Origin(config,flow?.Portal??"customer")+"/"+(flow?.Locale??"zh-CN")+(flow?.UserId is not null?"/profile":"/login")+"?oidc="+code;
    private static bool Owner(CurrentUserDto? user)=>user?.Roles.Contains("owner")==true;
    private static IResult Error(HttpContext c,int status,string code)=>Results.Json(new ApiErrorDto("oidc."+code,"oidc.errors."+code,"Unable to complete enterprise login.",null,false,c.TraceIdentifier),AppJsonContext.Default.ApiErrorDto,statusCode:status);
    public static void MapOidc(this RouteGroupBuilder api,Func<HttpContext,CurrentUserDto?> currentUser) {
        var group=api.MapGroup("");group.AddEndpointFilter(async (c,next)=>{c.HttpContext.Response.Headers.CacheControl="no-store";return await next(c);});
        group.MapGet("/admin/settings/oidc",(HttpContext c,OidcStore store)=>!Owner(currentUser(c))?Results.Forbid():Results.Ok(new OidcConfigurations(store.List())));
        group.MapPost("/admin/settings/oidc",(SaveOidcConfiguration input,HttpContext c)=>Save(input with {Id=Guid.NewGuid().ToString("N"),Version=0},c,false,currentUser(c)));
        group.MapPut("/admin/settings/oidc/{id}",(string id,SaveOidcConfiguration input,HttpContext c)=>Save(input with {Id=id},c,true,currentUser(c)));
        // Preserve the initial single-provider API for existing local clients.
        group.MapPut("/admin/settings/oidc",(SaveOidcConfiguration input,HttpContext c)=>Save(input with {Id="default"},c,false,currentUser(c)));
        group.MapDelete("/admin/settings/oidc/{id}",(string id,long version,HttpContext c,OidcStore store,IAuthenticationSchemeProvider schemes,IOptionsMonitorCache<OpenIdConnectOptions> cache)=>{
            if(!Owner(currentUser(c)))return Results.Forbid();
            if(!store.Delete(id,version))return Error(c,409,"conflict");
            ((OidcSchemes)schemes).Refresh();cache.TryRemove(SchemeFor(id));return Results.NoContent();
        });
        group.MapPost("/admin/settings/oidc/test",async (SaveOidcConfiguration input,HttpContext c,IHttpClientFactory http)=>{
            if(!Owner(currentUser(c)))return Results.Forbid();if(!OidcBackchannel.Valid(input))return Error(c,400,"invalid");
            try{using var client=ProxyScopeHandler.Wrap(http.CreateClient("oidc"),"oidc:"+input.Id);await OidcBackchannel.Test(client,input.Issuer,c.RequestAborted);return Results.NoContent();}catch{return Error(c,400,"connection");}
        }).RequireRateLimiting("authentication");
        group.MapGet("/auth/oidc/providers",(OidcStore store)=>Results.Ok(new OidcProviders(store.List().Where(config=>config.Enabled).Select(config=>new OidcProvider(config.NameZh,config.NameEn,config.Id)).ToArray())));
        group.MapGet("/me/oidc",(HttpContext c,OidcStore store)=>{
            var user=currentUser(c);if(user is null)return Results.Unauthorized();
            var items=store.List().Select(config=>new OidcBindingStatus(config.Enabled,store.IsBound(user.Id,config),config.NameZh,config.NameEn,config.Id)).Where(item=>item.Available||item.Bound).ToArray();
            return Results.Ok(new OidcBindings(items));
        });
        group.MapPost("/auth/oidc/start",(OidcStartRequest input,HttpContext c,OidcStore store,UserRepository users)=>{
            var config=store.Get(input.ProviderId??"").Public;
            if(!config.Enabled)return Error(c,409,"unavailable");
            if(input.Locale is not ("zh-CN" or "en-US")||input.Portal is not ("customer" or "admin"))return Error(c,400,"invalid");
            CurrentUserDto? user=null;int version=0;string? session=null;
            if(input.Bind) {
                user=currentUser(c);if(user is null)return Results.Unauthorized();
                version=users.GetSessionVersion(user.Id)??-1;session=c.User.FindFirstValue("lw_login_session");
                if(input.Portal!="customer"||users.Authenticate(user.Email??"",input.Password??"").User?.Id!=user.Id||users.Get(user.Id,version) is null)return Error(c,400,"password");
            }
            var browser=OidcStore.Random();var ticket=store.Start(config,browser,input.Locale,input.Portal,user?.Id,version,session);
            c.Response.Cookies.Append(BrowserCookie,browser,new CookieOptions{HttpOnly=true,Secure=c.Request.IsHttps,SameSite=SameSiteMode.Lax,Path="/api/auth/oidc",MaxAge=TimeSpan.FromMinutes(10),IsEssential=true});
            return Results.Ok(new OidcStartResult("/api/auth/oidc/authorize?ticket="+ticket));
        }).RequireRateLimiting("authentication");
        group.MapGet("/auth/oidc/authorize",async (string ticket,HttpContext c,OidcStore store)=>{
            if(ticket.Length!=64||c.Request.Cookies[BrowserCookie] is not {} browser||store.Authorize(ticket,browser) is not {} flow){await Error(c,400,"failed").ExecuteAsync(c);return;}
            c.Response.Cookies.Delete(BrowserCookie,new CookieOptions{Path="/api/auth/oidc"});
            var properties=new AuthenticationProperties();properties.Items["flow"]=flow.Id;properties.Items["portal"]=flow.Portal;
            try{await c.ChallengeAsync(SchemeFor(flow.ProviderId),properties);}catch{store.Consume(flow.Id,flow.ProviderId);c.Response.Redirect(Failure(store.Get(flow.ProviderId).Public,flow));}
        }).RequireRateLimiting("authentication");
        group.MapPost("/me/oidc/unbind",(OidcUnbindRequest input,HttpContext c,OidcStore store,UserRepository users)=>{
            var user=currentUser(c);if(user is null)return Results.Unauthorized();if(users.Authenticate(user.Email??"",input.Password??"").User?.Id!=user.Id)return Error(c,400,"password");
            store.Unbind(user.Id,store.Get(input.ProviderId??"").Public);return Results.NoContent();
        }).RequireRateLimiting("authentication");
    }
    private static async Task<IResult> Save(SaveOidcConfiguration input,HttpContext c,bool requireExisting,CurrentUserDto? actor) {
        if(!Owner(actor))return Results.Forbid();
        if(!OidcBackchannel.Valid(input))return Error(c,400,"invalid");
        var store=c.RequestServices.GetRequiredService<OidcStore>();var previous=store.Get(input.Id);
        if(requireExisting&&previous.Public.Version==0)return Error(c,409,"conflict");
        var secret=input.Secret??(previous.Public.Issuer==input.Issuer&&previous.Public.ClientId==input.ClientId?previous.Secret:"");
        if(input.Enabled){try{using var client=ProxyScopeHandler.Wrap(c.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("oidc"),"oidc:"+input.Id);await OidcBackchannel.Test(client,input.Issuer,c.RequestAborted);}catch{return Error(c,400,"connection");}}
        try{if(!store.Save(input,secret))return Error(c,409,"conflict");}catch(OidcDuplicateProviderException){return Error(c,409,"duplicate");}
        ((OidcSchemes)c.RequestServices.GetRequiredService<IAuthenticationSchemeProvider>()).Refresh();
        c.RequestServices.GetRequiredService<IOptionsMonitorCache<OpenIdConnectOptions>>().TryRemove(SchemeFor(input.Id));
        return Results.Ok(store.Get(input.Id).Public);
    }

}
