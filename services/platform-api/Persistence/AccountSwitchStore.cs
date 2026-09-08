using System.Security.Cryptography;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;

internal sealed record SavedAccountDto(string Id, string DisplayName, string? Email, bool Current, DateTimeOffset ExpiresAt);
internal sealed record SavedAccountsDto(SavedAccountDto[] Items, int Limit = 5);
internal sealed record SwitchAccountRequest(string Id);
internal sealed record SavedLogin(string UserId, int Version, DateTimeOffset ExpiresAt, bool Persistent);

internal sealed class AccountSwitchStore(string connectionString, UserRepository users)
{
    private const string CookieName = "lw_accounts";
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    public void Initialize() {
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "CREATE TABLE IF NOT EXISTS saved_account_sessions(device_hash TEXT NOT NULL,user_id TEXT NOT NULL,session_version INTEGER NOT NULL,expires_at TEXT NOT NULL,persistent INTEGER NOT NULL,browser_hash TEXT,PRIMARY KEY(device_hash,user_id)); CREATE INDEX IF NOT EXISTS ix_saved_account_expiry ON saved_account_sessions(expires_at);";
        q.ExecuteNonQuery();
        q.CommandText="PRAGMA table_info(saved_account_sessions)";
        bool hasBinder=false;using(var reader=q.ExecuteReader())while(reader.Read())if(reader.GetString(1)=="browser_hash")hasBinder=true;
        if(!hasBinder){q.CommandText="ALTER TABLE saved_account_sessions ADD COLUMN browser_hash TEXT";q.ExecuteNonQuery();}
    }
    private static string? Token(HttpContext context, bool create = false, string cookieName = CookieName) {
        if (context.Items[cookieName] is string cached) return cached;
        var token = context.Request.Cookies[cookieName];
        if (token?.Length != 64 || !token.All(char.IsAsciiHexDigit)) token = null;
        if (token is null && create) token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        if (token is not null) context.Items[cookieName] = token;
        return token;
    }
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private List<SavedLogin> Read(HttpContext context) {
        var token = Token(context); if (token is null) return [];
        using var c = Open(); using var q = c.CreateCommand();
        q.CommandText = "SELECT user_id,session_version,expires_at,persistent FROM saved_account_sessions WHERE device_hash=$device AND julianday(expires_at)>julianday('now') AND (persistent=1 OR browser_hash=$browser) ORDER BY user_id";
        q.Parameters.AddWithValue("$device", Hash(token));
        var browser=Token(context,false,"lw_account_browser");q.Parameters.AddWithValue("$browser",browser is null?DBNull.Value:Hash(browser));
        var result = new List<SavedLogin>(); using var reader = q.ExecuteReader();
        while (reader.Read()) result.Add(new(reader.GetString(0),reader.GetInt32(1),DateTimeOffset.Parse(reader.GetString(2)),reader.GetBoolean(3)));
        return result.Where(s => users.Get(s.UserId,s.Version) is not null).ToList();
    }
    public SavedAccountsDto List(HttpContext context, CurrentUserDto current) {
        var items = new List<SavedAccountDto>();
        foreach (var session in Read(context)) if (users.Get(session.UserId,session.Version) is {} u) items.Add(new(u.Id,u.DisplayName,u.Email,u.Id==current.Id,session.ExpiresAt));
        if (!items.Any(x=>x.Id==current.Id)) items.Insert(0,new(current.Id,current.DisplayName,current.Email,true,DateTimeOffset.UtcNow.AddHours(8)));
        return new(items.OrderByDescending(x=>x.Current).ToArray());
    }
    public bool HasRoom(HttpContext context,string userId, string currentId) => Read(context).Select(x=>x.UserId).Append(currentId).Append(userId).Distinct().Count() <= 5;
    public void Remember(HttpContext context, CurrentUserDto user, int version, DateTimeOffset expiresAt, bool persistent) {
        var token = Token(context,true)!;
        var browser = persistent ? null : Token(context,true,"lw_account_browser");
        if(browser is not null)context.Response.Cookies.Append("lw_account_browser",browser,new CookieOptions {HttpOnly=true,Secure=context.Request.IsHttps,SameSite=SameSiteMode.Strict,IsEssential=true,Path="/"});
        using var c=Open(); using var tx=c.BeginTransaction(); using var q=c.CreateCommand(); q.Transaction=tx;
        q.CommandText="DELETE FROM saved_account_sessions WHERE julianday(expires_at)<=julianday('now'); INSERT INTO saved_account_sessions(device_hash,user_id,session_version,expires_at,persistent,browser_hash) VALUES($device,$user,$version,$expires,$persistent,$browser) ON CONFLICT(device_hash,user_id) DO UPDATE SET session_version=excluded.session_version,expires_at=excluded.expires_at,persistent=excluded.persistent,browser_hash=excluded.browser_hash;";
        q.Parameters.AddWithValue("$device",Hash(token));q.Parameters.AddWithValue("$user",user.Id);q.Parameters.AddWithValue("$version",version);q.Parameters.AddWithValue("$expires",expiresAt.ToString("O"));q.Parameters.AddWithValue("$persistent",persistent?1:0);q.Parameters.AddWithValue("$browser",browser is null?DBNull.Value:Hash(browser));q.ExecuteNonQuery();
        using var cap=c.CreateCommand();cap.Transaction=tx;
        cap.CommandText="DELETE FROM saved_account_sessions WHERE device_hash=$device AND (NOT EXISTS(SELECT 1 FROM users WHERE users.id=saved_account_sessions.user_id AND users.is_active=1 AND users.session_version=saved_account_sessions.session_version) OR (persistent=0 AND (browser_hash IS NULL OR browser_hash IS NOT $browser))); DELETE FROM saved_account_sessions WHERE rowid IN (SELECT rowid FROM saved_account_sessions WHERE device_hash=$device AND user_id<>$user ORDER BY expires_at DESC LIMIT -1 OFFSET 4)";
        var activeBrowser=Token(context,false,"lw_account_browser");cap.Parameters.AddWithValue("$browser",activeBrowser is null?DBNull.Value:Hash(activeBrowser));
        cap.Parameters.AddWithValue("$device",Hash(token));cap.Parameters.AddWithValue("$user",user.Id);cap.ExecuteNonQuery();tx.Commit();
        var max = Read(context).Where(x=>x.Persistent).Select(x=>(DateTimeOffset?)x.ExpiresAt).Max();
        context.Response.Cookies.Append(CookieName,token,new CookieOptions { HttpOnly=true,Secure=context.Request.IsHttps,SameSite=SameSiteMode.Strict,IsEssential=true,Path="/",Expires=max });
    }
    public SavedLogin? Find(HttpContext context,string id) => Read(context).FirstOrDefault(x=>x.UserId==id);
    public void Remove(HttpContext context,string? id=null) {
        var token=Token(context);if(token is null)return;
        using var c=Open();using var q=c.CreateCommand();q.CommandText="DELETE FROM saved_account_sessions WHERE device_hash=$device AND ($id IS NULL OR user_id=$id)";q.Parameters.AddWithValue("$device",Hash(token));q.Parameters.AddWithValue("$id",(object?)id??DBNull.Value);q.ExecuteNonQuery();
        if(id is null) {context.Response.Cookies.Delete(CookieName,new CookieOptions {Path="/"});context.Response.Cookies.Delete("lw_account_browser",new CookieOptions {Path="/"});}
    }
}
