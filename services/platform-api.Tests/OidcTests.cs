using System.Net;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class OidcTests : IDisposable {
    private readonly string root=Path.Combine(Path.GetTempPath(),"oidc-store-"+Guid.NewGuid().ToString("N"));
    private readonly string connection;private readonly AccountSwitchStore sessions;private readonly OidcStore store;private readonly UserRepository users;private readonly string id;
    internal static SaveOidcConfiguration Config(long version=0,bool enabled=true)=>new(version,"企业账号","Enterprise account","https://idp.example.test","client","https://portal.example.test","https://portal.example.test/admin",enabled,"secret");
    public OidcTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";new ProjectRepository(connection).Initialize();users=new(connection,root);users.Initialize();id=users.CreateOwner("Owner","owner@example.test","password-123").User!.Id;sessions=new(connection,users);sessions.Initialize();store=new(connection,new EphemeralDataProtectionProvider());store.Initialize();Assert.True(store.Save(Config(),"secret"));}
    private OidcFlow BindingFlow(string provider="default"){var config=store.Get(provider).Public;var version=users.GetSessionVersion(id)!.Value;var session=sessions.Remember(new Microsoft.AspNetCore.Http.DefaultHttpContext(),users.Get(id)!,version,DateTimeOffset.UtcNow.AddHours(1),false);var ticket=store.Start(config,"browser","en-US","customer",id,version,session);store.Authorize(ticket,"browser");return store.Consume(ticket,provider)!;}
    [Fact] public void FlowsRequireBrowserProofAndAreSingleUse(){var config=store.Get().Public;var ticket=store.Start(config,"browser","en-US","customer",null,0,null);Assert.Null(store.Authorize(ticket,"wrong"));var flow=store.Authorize(ticket,"browser");Assert.NotNull(flow);Assert.Null(store.Authorize(ticket,"browser"));Assert.NotNull(store.Consume(ticket));Assert.Null(store.Consume(ticket));}
    [Fact] public void ConfigurationEditsInvalidateFlowsAndUseVersionChecks(){var ticket=store.Start(store.Get().Public,"browser","en-US","customer",null,0,null);Assert.False(store.Save(Config(),"overwrite"));Assert.True(store.Save(Config(1,false),"changed"));Assert.Null(store.Authorize(ticket,"browser"));Assert.Equal("changed",store.Get().Secret);}
    [Fact] public void IdentityBindingIsExplicitAndScopedToIssuerAndClient(){var config=store.Get().Public;Assert.Null(store.Resolve(config,"subject"));var flow=BindingFlow();Assert.True(store.Bind(flow,config,"subject"));Assert.Equal(id,store.Resolve(config,"subject"));Assert.False(store.Bind(flow,config,"other-subject"));Assert.Null(store.Resolve(config with{Issuer="https://other.example.test"},"subject"));Assert.Null(store.Resolve(config with{ClientId="other-client"},"subject"));store.Unbind(id,config);Assert.Null(store.Resolve(config,"subject"));}
    [Fact] public void PasswordResetInvalidatesPendingBinding(){var config=store.Get().Public;var version=users.GetSessionVersion(id)!.Value;var ticket=store.Start(config,"browser","en-US","customer",id,version,"session");users.ResetPassword(id,"new-password-123");Assert.Null(store.Authorize(ticket,"browser"));Assert.False(store.Bind(new("flow",config.Version,"en-US","customer",id,version,"session"),config,"subject"));}
    [Theory] [InlineData("127.0.0.1")] [InlineData("10.1.2.3")] [InlineData("169.254.169.254")] [InlineData("172.16.0.1")] [InlineData("192.168.1.1")] [InlineData("::1")] [InlineData("fc00::1")] [InlineData("::ffff:127.0.0.1")]
    public void BackchannelRejectsPrivateAddresses(string address)=>Assert.False(OidcBackchannel.PublicAddress(IPAddress.Parse(address)));
    [Fact] public void ConfigurationRequiresHttpsAndSafePortalDestinations(){Assert.True(OidcBackchannel.Valid(Config()));Assert.False(OidcBackchannel.Valid(Config() with{Issuer="http://idp.example.test"}));Assert.False(OidcBackchannel.Valid(Config() with{Issuer="https://127.0.0.1"}));Assert.False(OidcBackchannel.Valid(Config() with{PublicOrigin="https://portal.example.test/?next=evil"}));Assert.False(OidcBackchannel.Valid(Config() with{AdminOrigin="https://portal.example.test/admin/../../evil"}));}
    [Fact] public void RevokedSessionCannotFinishBinding(){var flow=BindingFlow();using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText="DELETE FROM saved_account_sessions";q.ExecuteNonQuery();Assert.False(store.Bind(flow,store.Get().Public,"subject"));}
    [Fact] public void UnbindCancelsCallbackAlreadyInProgress(){var flow=BindingFlow();store.Unbind(id,store.Get().Public);Assert.False(store.Bind(flow,store.Get().Public,"subject"));}
    [Fact] public void LostEncryptionKeysDisableOidcWithoutBreakingLocalAccounts(){var unreadable=new OidcStore(connection,new EphemeralDataProtectionProvider());Assert.False(unreadable.Get().Public.Enabled);Assert.NotNull(users.Authenticate("owner@example.test","password-123").User);}
    [Fact] public void EditingOneProviderDoesNotInvalidateOthers()
    {
        Assert.True(store.Save(Config() with {Id="second",ClientId="second-client"},"second-secret"));
        var first=store.Start(store.Get().Public,"browser","en-US","customer",null,0,null);
        var second=store.Start(store.Get("second").Public,"browser","en-US","customer",null,0,null);
        Assert.True(store.Save(Config(1,false),"changed"));Assert.Null(store.Authorize(first,"browser"));
        Assert.NotNull(store.Authorize(second,"browser"));Assert.Null(store.Consume(second,"default"));Assert.NotNull(store.Consume(second,"second"));
        Assert.Equal("second-secret",store.Get("second").Secret);
    }
    [Fact] public void SameSubjectIsScopedByProviderAndUnlinkAffectsOnlyOne()
    {
        Assert.True(store.Save(Config() with {Id="second",ClientId="second-client"},"second-secret"));
        var first=store.Get().Public;var second=store.Get("second").Public;
        Assert.True(store.Bind(BindingFlow(),first,"same-subject"));Assert.Null(store.Resolve(second,"same-subject"));
        Assert.True(store.Bind(BindingFlow("second"),second,"same-subject"));store.Unbind(id,first);
        Assert.Null(store.Resolve(first,"same-subject"));Assert.Equal(id,store.Resolve(second,"same-subject"));
        Assert.True(store.Delete("second",1));Assert.Null(store.Resolve(second,"same-subject"));
    }
    [Fact] public void LegacyMigrationPreservesSecretAndLinksAndIsIdempotent()
    {
        Assert.True(store.Bind(BindingFlow(),store.Get().Public,"old-subject"));
        using(var c=new SqliteConnection(connection)) {c.Open();using var q=c.CreateCommand();q.CommandText="""
            CREATE TABLE oidc_configuration AS SELECT 1 AS id,version,name_zh,name_en,issuer,client_id,public_origin,admin_origin,enabled,secret FROM oidc_providers;
            CREATE TABLE oidc_bindings AS SELECT issuer,client_id,subject,user_id FROM oidc_external_bindings;
            DROP TABLE oidc_providers;
            DROP TABLE oidc_external_bindings;
            """;q.ExecuteNonQuery();}
        store.Initialize();store.Initialize();Assert.Single(store.List());Assert.Equal("secret",store.Get().Secret);
        Assert.Equal(id,store.Resolve(store.Get().Public,"old-subject"));Assert.Equal("default",store.List()[0].Id);
    }
    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
