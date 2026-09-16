using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class OidcHttpTests : IAsyncLifetime {
    private readonly string root=Path.Combine(Path.GetTempPath(),"oidc-http-"+Guid.NewGuid().ToString("N"));
    private readonly WebApplicationFactory<Program> factory;private readonly FakeProvider provider=new();private readonly HttpClient owner;
    public OidcHttpTests(){factory=new WebApplicationFactory<Program>().WithWebHostBuilder(builder=>{builder.UseEnvironment("Development");builder.UseSetting("Lifewood:DataDirectory",root);builder.UseSetting("Lifewood:RequireWebAssets","false");builder.ConfigureServices(services=>{services.AddSingleton<IStartupFilter,Loopback>();services.AddHttpClient("oidc").ConfigurePrimaryHttpMessageHandler(()=>provider);services.PostConfigure<Microsoft.AspNetCore.Authentication.OpenIdConnect.OpenIdConnectOptions>(OidcFeature.Scheme, options=>{var ticket=options.Events.OnTicketReceived;options.Events.OnTicketReceived=context=>{provider.Diagnostics=string.Join(",",context.Principal!.Claims.Select(c=>c.Type+"="+c.Value))+" keys="+string.Join(",",context.Properties!.Items.Keys);return ticket(context);};var original=options.Events.OnRemoteFailure;options.Events.OnRemoteFailure=context=>{provider.Failure=context.Failure?.ToString();return original(context);};});});});owner=Client();}
    private HttpClient Client()=>factory.CreateClient(new WebApplicationFactoryClientOptions{AllowAutoRedirect=false,HandleCookies=true});
    public async Task InitializeAsync(){var result=await Write(owner,"/api/auth/bootstrap",new{displayName="Owner",email="owner@example.test",password="password-123"});Assert.Equal(HttpStatusCode.OK,result.StatusCode);}
    public async Task DisposeAsync(){owner.Dispose();await factory.DisposeAsync();Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();for(var i=0;i<20;i++){try{if(Directory.Exists(root))Directory.Delete(root,true);break;}catch(IOException)when(i<19){await Task.Delay(100);}}provider.Dispose();}
    private static async Task<HttpResponseMessage> Write(HttpClient client,string path,object body,HttpMethod? method=null){var csrf=await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");using var request=new HttpRequestMessage(method??HttpMethod.Post,path){Content=JsonContent.Create(body)};request.Headers.Add("X-CSRF-TOKEN",csrf.GetProperty("token").GetString());return await client.SendAsync(request);}
    private async Task Enable(){var response=await Write(owner,"/api/admin/settings/oidc",OidcTests.Config(),HttpMethod.Put);Assert.Equal(HttpStatusCode.OK,response.StatusCode);}
    private async Task<string> Authorization(HttpClient client,bool bind=false,string providerId="default"){var start=await Write(client,"/api/auth/oidc/start",new OidcStartRequest("en-US","customer",bind,bind?"password-123":null,providerId));Assert.Equal(HttpStatusCode.OK,start.StatusCode);var url=(await start.Content.ReadFromJsonAsync<OidcStartResult>())!.Url;var redirect=await client.GetAsync(url);Assert.Equal(HttpStatusCode.Redirect,redirect.StatusCode);return redirect.Headers.Location!.AbsoluteUri;}
    private async Task<HttpResponseMessage> Finish(HttpClient client,string authorization,string subject="subject",string? defect=null,string? callbackOverride=null){var query=QueryHelpers.ParseQuery(new Uri(authorization).Query);Assert.Equal("S256",query["code_challenge_method"].ToString());Assert.Equal("code",query["response_type"].ToString());Assert.StartsWith("https://portal.example.test/api/auth/oidc/callback",query["redirect_uri"].ToString());var code=provider.Issue(query["nonce"]!,query["code_challenge"]!,query["redirect_uri"]!,subject,defect,query["client_id"]!);var result=await client.GetAsync((callbackOverride??new Uri(query["redirect_uri"]!).AbsolutePath)+"?code="+code+"&state="+Uri.EscapeDataString(query["state"]!));if(defect is null&&callbackOverride is null){Assert.True(provider.Failure is null,provider.Failure);Assert.True(!result.Headers.Location!.ToString().EndsWith("oidc=failed"),provider.Diagnostics);}return result;}
    [Fact] public async Task ConfigurationIsOwnerOnlyAndNeverReturnsSecret(){using var anonymous=Client();Assert.Equal(HttpStatusCode.Forbidden,(await anonymous.GetAsync("/api/admin/settings/oidc")).StatusCode);Assert.Empty((await anonymous.GetFromJsonAsync<OidcProviders>("/api/auth/oidc/providers"))!.Items);await Enable();var response=await owner.GetStringAsync("/api/admin/settings/oidc");Assert.DoesNotContain("\"secret\"",response);Assert.True(JsonDocument.Parse(response).RootElement.GetProperty("items")[0].GetProperty("hasSecret").GetBoolean());Assert.Single((await anonymous.GetFromJsonAsync<OidcProviders>("/api/auth/oidc/providers"))!.Items);}
    [Fact] public async Task BoundIdentitySignsIntoExistingAccountAndUsesAccountLocale(){await Enable();var bound=await Finish(owner,await Authorization(owner,true));Assert.Contains("oidc=bound",bound.Headers.Location!.ToString());Assert.True((await owner.GetFromJsonAsync<OidcBindings>("/api/me/oidc"))!.Items.Single().Bound);using var login=Client();var success=await Finish(login,await Authorization(login));Assert.Equal("https://portal.example.test/en-US/tasks",success.Headers.Location!.ToString());Assert.Equal("owner@example.test",(await login.GetFromJsonAsync<CurrentUserDto>("/api/me"))!.Email);}
    [Fact] public async Task UnknownIdentityDoesNotAutoRegisterOrMatchEmail(){await Enable();using var anonymous=Client();var result=await Finish(anonymous,await Authorization(anonymous));Assert.Contains("oidc=unbound",result.Headers.Location!.ToString());Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/me")).StatusCode);}
    [Theory] [InlineData("nonce")] [InlineData("audience")] [InlineData("issuer")] [InlineData("expired")] [InlineData("signature")]
    public async Task InvalidIdentityTokensNeverCreateSessions(string defect){await Enable();using var anonymous=Client();var result=await Finish(anonymous,await Authorization(anonymous),defect:defect);Assert.Contains("oidc=failed",result.Headers.Location!.ToString());Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/me")).StatusCode);}
    [Fact] public async Task BindingNeedsPasswordAndStartNeedsCsrf(){await Enable();Assert.Equal(HttpStatusCode.BadRequest,(await owner.PostAsJsonAsync("/api/auth/oidc/start",new OidcStartRequest("en-US","customer"))).StatusCode);Assert.Equal(HttpStatusCode.BadRequest,(await Write(owner,"/api/auth/oidc/start",new OidcStartRequest("en-US","customer",true,"wrong"))).StatusCode);}
    [Fact] public async Task StartTicketCannotBeTransferredToAnotherBrowser(){await Enable();var start=await Write(owner,"/api/auth/oidc/start",new OidcStartRequest("en-US","customer",true,"password-123"));var url=(await start.Content.ReadFromJsonAsync<OidcStartResult>())!.Url;using var other=Client();Assert.Equal(HttpStatusCode.BadRequest,(await other.GetAsync(url)).StatusCode);Assert.Equal(HttpStatusCode.Redirect,(await owner.GetAsync(url)).StatusCode);}
    private async Task<OidcConfiguration> AddSecond()
    {
        var response=await Write(owner,"/api/admin/settings/oidc",OidcTests.Config() with {ClientId="second-client",NameZh="第二个服务",NameEn="Second provider"});
        Assert.Equal(HttpStatusCode.OK,response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OidcConfiguration>())!;
    }
    [Fact] public async Task MultipleProvidersBindAndSignInIndependently()
    {
        await Enable();var second=await AddSecond();
        var providers=(await owner.GetFromJsonAsync<OidcProviders>("/api/auth/oidc/providers"))!.Items;
        Assert.Equal(2,providers.Length);Assert.NotEqual(providers[0].Id,providers[1].Id);
        await Finish(owner,await Authorization(owner,true));
        using(var fresh=Client()) {var unbound=await Finish(fresh,await Authorization(fresh,providerId:second.Id));Assert.EndsWith("oidc=unbound",unbound.Headers.Location!.ToString());}
        var bind=await Finish(owner,await Authorization(owner,true,second.Id));Assert.EndsWith("oidc=bound",bind.Headers.Location!.ToString());
        Assert.All((await owner.GetFromJsonAsync<OidcBindings>("/api/me/oidc"))!.Items,item=>Assert.True(item.Bound));
        Assert.Equal(HttpStatusCode.OK,(await Write(owner,"/api/admin/settings/oidc/default",OidcTests.Config(1,false),HttpMethod.Put)).StatusCode);
        Assert.Single((await owner.GetFromJsonAsync<OidcProviders>("/api/auth/oidc/providers"))!.Items);
        using var login=Client();var result=await Finish(login,await Authorization(login,providerId:second.Id));
        Assert.EndsWith("/en-US/tasks",result.Headers.Location!.ToString());Assert.Equal(HttpStatusCode.OK,(await login.GetAsync("/api/me")).StatusCode);
    }
    [Fact] public async Task CallbackCannotUseAnotherProvidersProtectedState()
    {
        await Enable();var second=await AddSecond();using var login=Client();
        var authorization=await Authorization(login,providerId:second.Id);
        var rejected=await Finish(login,authorization,callbackOverride:OidcFeature.Callback);
        Assert.EndsWith("oidc=failed",rejected.Headers.Location!.ToString());Assert.Equal(HttpStatusCode.Unauthorized,(await login.GetAsync("/api/me")).StatusCode);
    }
    [Fact] public async Task DuplicateProviderRejectedAndDeletionIsVersioned()
    {
        await Enable();Assert.Equal(HttpStatusCode.Conflict,(await Write(owner,"/api/admin/settings/oidc",OidcTests.Config())).StatusCode);
        var second=await AddSecond();
        Assert.Equal(HttpStatusCode.Conflict,(await Write(owner,$"/api/admin/settings/oidc/{second.Id}?version=0",new{},HttpMethod.Delete)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Write(owner,$"/api/admin/settings/oidc/{second.Id}?version=1",new{},HttpMethod.Delete)).StatusCode);
        Assert.Single((await owner.GetFromJsonAsync<OidcProviders>("/api/auth/oidc/providers"))!.Items);
        Assert.Equal(HttpStatusCode.Conflict,(await Write(owner,"/api/auth/oidc/start",new OidcStartRequest("en-US","customer",ProviderId:second.Id))).StatusCode);
    }
    private sealed class Loopback:IStartupFilter{public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)=>app=>{app.Use((context,nextMiddleware)=>{context.Connection.RemoteIpAddress=IPAddress.Loopback;return nextMiddleware(context);});next(app);};}
    private sealed class FakeProvider:HttpMessageHandler {
        public string? Failure;public string? Diagnostics;
        private readonly RSA rsa=RSA.Create(2048);private readonly Dictionary<string,(string Nonce,string Challenge,string Redirect,string Subject,string? Defect,string Client)> codes=new();
        public string Issue(string nonce,string challenge,string redirect,string subject,string? defect,string client){var code=Guid.NewGuid().ToString("N");codes[code]=(nonce,challenge,redirect,subject,defect,client);return code;}
        private static HttpResponseMessage Json(object value)=>new(HttpStatusCode.OK){Content=JsonContent.Create(value)};
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellation){
            if(request.RequestUri!.AbsolutePath.EndsWith("openid-configuration"))return Json(new{issuer="https://idp.example.test",authorization_endpoint="https://idp.example.test/authorize",token_endpoint="https://idp.example.test/token",jwks_uri="https://idp.example.test/keys",response_types_supported=new[]{"code"},subject_types_supported=new[]{"public"},id_token_signing_alg_values_supported=new[]{"RS256"},code_challenge_methods_supported=new[]{"S256"}});
            if(request.RequestUri.AbsolutePath=="/keys"){var key=rsa.ExportParameters(false);return Json(new{keys=new[]{new{kty="RSA",kid="test",use="sig",alg="RS256",n=Base64UrlEncoder.Encode(key.Modulus!),e=Base64UrlEncoder.Encode(key.Exponent!)}}});}
            var form=QueryHelpers.ParseQuery("?"+await request.Content!.ReadAsStringAsync(cancellation));
            if(!codes.Remove(form["code"]!,out var issued))return new(HttpStatusCode.BadRequest);
            Assert.Equal(issued.Challenge,Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(form["code_verifier"]!))));Assert.Equal(issued.Redirect,form["redirect_uri"].ToString());Assert.Equal(issued.Client,form["client_id"].ToString());Assert.Equal("secret",form["client_secret"].ToString());
            using var other=RSA.Create(2048);var keyForToken=new RsaSecurityKey(issued.Defect=="signature"?other:rsa){KeyId="test"};
            var token=new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor{Issuer=issued.Defect=="issuer"?"https://wrong.example.test":"https://idp.example.test",Audience=issued.Defect=="audience"?"wrong":issued.Client,Claims=new Dictionary<string,object>{{"sub",issued.Subject},{"nonce",issued.Defect=="nonce"?"wrong":issued.Nonce},{"email","owner@example.test"}},IssuedAt=DateTime.UtcNow.AddHours(-2),NotBefore=DateTime.UtcNow.AddHours(-2),Expires=issued.Defect=="expired"?DateTime.UtcNow.AddHours(-1):DateTime.UtcNow.AddMinutes(5),SigningCredentials=new SigningCredentials(keyForToken,SecurityAlgorithms.RsaSha256)});
            return Json(new{id_token=token,access_token="unused",token_type="Bearer",expires_in=300});
        }
        protected override void Dispose(bool disposing){if(disposing)rsa.Dispose();base.Dispose(disposing);}
    }
}
