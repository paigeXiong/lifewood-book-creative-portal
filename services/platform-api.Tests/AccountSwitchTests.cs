using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class AccountSwitchTests : IDisposable {
    readonly string root=Path.Combine(Path.GetTempPath(),"account-switch-"+Guid.NewGuid().ToString("N"));
    readonly string connection;readonly UserRepository users;readonly AccountSwitchStore store;
    public AccountSwitchTests(){Directory.CreateDirectory(root);connection=$"Data Source={Path.Combine(root,"test.db")};Pooling=False";new ProjectRepository(connection).Initialize();users=new(connection,root);users.Initialize();var result=users.CreateOwner("Owner","owner@test.example","password-12345",null,null,"en-US");Assert.NotNull(result.User);store=new(connection,users);store.Initialize();}
    string AddUser(string id){Sql($"INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,is_active,created_at,updated_at) SELECT '{id}','{id}@test.example','{id.ToUpper()}@TEST.EXAMPLE','{id}',password_hash,'customer',1,created_at,updated_at FROM users LIMIT 1");return id;}
    void Sql(string sql){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=sql;q.ExecuteNonQuery();}
    static DefaultHttpContext Next(HttpContext previous,bool browserRestart=false){var c=new DefaultHttpContext();var cookies=previous.Response.Headers.SetCookie.Select(x=>x!.Split(';')[0]).Where(x=>!browserRestart||!x.StartsWith("lw_account_browser=")).ToArray();c.Request.Headers.Cookie=string.Join("; ",cookies);return c;}
    [Fact] public void NonpersistentAccountsRequireBrowserSessionEvenWithPersistentAccount(){
        var a=AddUser("a");var b=AddUser("b");var context=new DefaultHttpContext();
        store.Remember(context,users.Get(a,0)!,0,DateTimeOffset.UtcNow.AddDays(30),true);
        store.Remember(context,users.Get(b,0)!,0,DateTimeOffset.UtcNow.AddHours(8),false);
        var same=Next(context);Assert.NotNull(store.Find(same,a));Assert.NotNull(store.Find(same,b));
        var restarted=Next(context,true);Assert.NotNull(store.Find(restarted,a));Assert.Null(store.Find(restarted,b));
        Assert.Contains(context.Response.Headers.SetCookie,x=>x!.StartsWith("lw_account_browser=")&&!x.Contains("expires=",StringComparison.OrdinalIgnoreCase));
    }
    [Fact] public void ExpiredRevokedAndDisabledAccountsCannotBeSelected(){
        var a=AddUser("a");var b=AddUser("b");var c=AddUser("c");var context=new DefaultHttpContext();
        foreach(var id in new[]{a,b,c})store.Remember(context,users.Get(id,0)!,0,DateTimeOffset.UtcNow.AddHours(1),true);
        Sql("UPDATE users SET session_version=1 WHERE id='a'; UPDATE users SET is_active=0 WHERE id='b'; UPDATE saved_account_sessions SET expires_at='2000-01-01T00:00:00Z' WHERE user_id='c';");
        var next=Next(context);Assert.Null(store.Find(next,a));Assert.Null(store.Find(next,b));Assert.Null(store.Find(next,c));
    }
    [Fact] public void DeviceScopesAreIsolatedAndRememberingNeverExceedsFive(){
        var context=new DefaultHttpContext();for(var i=0;i<7;i++){var id=AddUser("user"+i);store.Remember(context,users.Get(id,0)!,0,DateTimeOffset.UtcNow.AddHours(i+1),true);}
        var next=Next(context);Assert.Equal(5,store.List(next,users.Get("user6",0)!).Items.Length);
        var other=new DefaultHttpContext();store.Remember(other,users.Get("user6",0)!,0,DateTimeOffset.UtcNow.AddHours(1),true);
        Assert.Null(store.Find(Next(other),"user5"));store.Remove(next);Assert.Null(store.Find(next,"user6"));Assert.NotNull(store.Find(Next(other),"user6"));
    }
    [Fact] public void InvalidSavedSlotsDoNotEvictValidAccountsWhenAddingFifth(){
        var context=new DefaultHttpContext();for(var i=0;i<5;i++){var id=AddUser("user"+i);store.Remember(context,users.Get(id,0)!,0,DateTimeOffset.UtcNow.AddHours(i+1),true);}
        Sql("UPDATE users SET session_version=1 WHERE id='user4'");
        var next=Next(context);var added=AddUser("new-user");Assert.False(store.HasRoom(next,added,"user0"));store.Remove(next,"user4");Assert.True(store.HasRoom(next,added,"user0"));
        store.Remember(next,users.Get(added,0)!,0,DateTimeOffset.UtcNow.AddHours(8),true);
        foreach(var id in new[]{"user0","user1","user2","user3",added})Assert.NotNull(store.Find(next,id));
        Assert.Null(store.Find(next,"user4"));
    }
    [Fact] public void RememberedIdentitiesSurviveExpiryRestartAndLogoutWithoutRestoringSessions(){
        var a=AddUser("a");var b=AddUser("b");var context=new DefaultHttpContext();
        store.Remember(context,users.Get(a)!,0,DateTimeOffset.UtcNow.AddHours(8),false);store.Remember(context,users.Get(b)!,0,DateTimeOffset.UtcNow.AddDays(30),true);
        var restarted=Next(context,true);Assert.Null(store.Find(restarted,a));Assert.Contains(store.List(restarted,users.Get(b)!).Items,x=>x.Id==a&&x.RequiresLogin);
        store.LogoutCurrent(restarted,b);Assert.Null(store.Find(restarted,b));
        store.Remember(restarted,users.Get(b)!,0,DateTimeOffset.UtcNow.AddDays(30),true);
        Assert.Contains(store.List(restarted,users.Get(b)!).Items,x=>x.Id==a&&x.RequiresLogin);
        store.Remove(restarted,a);Assert.DoesNotContain(store.List(restarted,users.Get(b)!).Items,x=>x.Id==a);
        store.Remove(restarted);Assert.Null(store.Find(restarted,b));
    }
    public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
