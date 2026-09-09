using System.Security.Cryptography;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;

internal sealed record SavedAccountDto(string Id, string DisplayName, string? Email, bool Current, DateTimeOffset ExpiresAt);
internal sealed record SavedAccountsDto(SavedAccountDto[] Items, int Limit = 5);
internal sealed record SwitchAccountRequest(string Id);
internal sealed record LoginDeviceDto(string Id,string Browser,string Platform,bool Current,DateTimeOffset? CreatedAt,DateTimeOffset? LastSeen,DateTimeOffset ExpiresAt);
internal sealed record LoginDevicesDto(LoginDeviceDto[] Items,int Page,int Total);
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
        foreach(var (name,type) in new[]{("session_id","TEXT"),("created_at","TEXT"),("last_seen","TEXT"),("browser","TEXT"),("platform","TEXT"),("presence_session","TEXT")}){
            q.CommandText="SELECT COUNT(*) FROM pragma_table_info('saved_account_sessions') WHERE name=$name";q.Parameters.Clear();q.Parameters.AddWithValue("$name",name);
            if(Convert.ToInt32(q.ExecuteScalar())==0){q.CommandText=$"ALTER TABLE saved_account_sessions ADD COLUMN {name} {type}";q.ExecuteNonQuery();}
        }
        q.CommandText="UPDATE saved_account_sessions SET session_id=lower(hex(randomblob(16))) WHERE session_id IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS ix_login_session_id ON saved_account_sessions(session_id);";q.ExecuteNonQuery();
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
    public string? Remember(HttpContext context, CurrentUserDto user, int version, DateTimeOffset expiresAt, bool persistent, bool requireExisting=false, string? presenceSession=null) {
        var token = Token(context,true)!;
        var existingBrowser = Token(context,false,"lw_account_browser");
        var browser = persistent ? null : Token(context,true,"lw_account_browser");
        if(browser is not null)context.Response.Cookies.Append("lw_account_browser",browser,new CookieOptions {HttpOnly=true,Secure=context.Request.IsHttps,SameSite=SameSiteMode.Strict,IsEssential=true,Path="/"});
        using var c=Open(); using var tx=c.BeginTransaction(deferred:false); using var q=c.CreateCommand(); q.Transaction=tx;
        q.CommandText="SELECT COUNT(*) FROM users WHERE id=$checkUser AND is_active=1 AND session_version=$checkVersion";q.Parameters.AddWithValue("$checkUser",user.Id);q.Parameters.AddWithValue("$checkVersion",version);if(Convert.ToInt32(q.ExecuteScalar())!=1)return null;
        if(requireExisting){q.CommandText="SELECT COUNT(*) FROM saved_account_sessions WHERE device_hash=$checkDevice AND user_id=$checkUser AND session_version=$checkVersion AND julianday(expires_at)>julianday('now') AND (persistent=1 OR browser_hash=$checkBrowser)";q.Parameters.AddWithValue("$checkBrowser",existingBrowser is null?DBNull.Value:Hash(existingBrowser));q.Parameters.AddWithValue("$checkDevice",Hash(token));if(Convert.ToInt32(q.ExecuteScalar())!=1)return null;}
        q.Parameters.Clear();
        q.CommandText="DELETE FROM saved_account_sessions WHERE julianday(expires_at)<=julianday('now'); INSERT INTO saved_account_sessions(device_hash,user_id,session_version,expires_at,persistent,browser_hash) VALUES($device,$user,$version,$expires,$persistent,$browser) ON CONFLICT(device_hash,user_id) DO UPDATE SET session_version=excluded.session_version,expires_at=excluded.expires_at,persistent=excluded.persistent,browser_hash=excluded.browser_hash;";
        q.Parameters.AddWithValue("$device",Hash(token));q.Parameters.AddWithValue("$user",user.Id);q.Parameters.AddWithValue("$version",version);q.Parameters.AddWithValue("$expires",expiresAt.ToString("O"));q.Parameters.AddWithValue("$persistent",persistent?1:0);q.Parameters.AddWithValue("$browser",browser is null?DBNull.Value:Hash(browser));q.ExecuteNonQuery();
        using var metadata=c.CreateCommand();metadata.Transaction=tx;
        var ua=context.Request.Headers.UserAgent.ToString();
        var browserName=ua.Contains("Edg/")?"edge":ua.Contains("Firefox/")?"firefox":ua.Contains("Chrome/")?"chrome":ua.Contains("Safari/")?"safari":"unknown";
        var platformName=ua.Contains("Android")?"android":ua.Contains("iPhone")||ua.Contains("iPad")?"ios":ua.Contains("Windows")?"windows":ua.Contains("Macintosh")?"macos":ua.Contains("Linux")?"linux":"unknown";
        metadata.CommandText="UPDATE saved_account_sessions SET session_id=COALESCE(session_id,$session),created_at=COALESCE(created_at,$now),last_seen=$now,browser=$browser,platform=$platform,presence_session=COALESCE($presence,presence_session) WHERE device_hash=$device AND user_id=$user RETURNING session_id";
        metadata.Parameters.AddWithValue("$session",Guid.NewGuid().ToString("N"));metadata.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));metadata.Parameters.AddWithValue("$browser",browserName);metadata.Parameters.AddWithValue("$platform",platformName);metadata.Parameters.AddWithValue("$presence",(object?)presenceSession??DBNull.Value);metadata.Parameters.AddWithValue("$device",Hash(token));metadata.Parameters.AddWithValue("$user",user.Id);
        var loginId=(string)metadata.ExecuteScalar()!;
        using var cap=c.CreateCommand();cap.Transaction=tx;
        cap.CommandText="DELETE FROM saved_account_sessions WHERE device_hash=$device AND (NOT EXISTS(SELECT 1 FROM users WHERE users.id=saved_account_sessions.user_id AND users.is_active=1 AND users.session_version=saved_account_sessions.session_version) OR (persistent=0 AND (browser_hash IS NULL OR browser_hash IS NOT $browser))); DELETE FROM saved_account_sessions WHERE rowid IN (SELECT rowid FROM saved_account_sessions WHERE device_hash=$device AND user_id<>$user ORDER BY expires_at DESC LIMIT -1 OFFSET 4)";
        var activeBrowser=Token(context,false,"lw_account_browser");cap.Parameters.AddWithValue("$browser",activeBrowser is null?DBNull.Value:Hash(activeBrowser));
        cap.Parameters.AddWithValue("$device",Hash(token));cap.Parameters.AddWithValue("$user",user.Id);cap.ExecuteNonQuery();tx.Commit();
        var max = Read(context).Where(x=>x.Persistent).Select(x=>(DateTimeOffset?)x.ExpiresAt).Max();
        context.Response.Cookies.Append(CookieName,token,new CookieOptions { HttpOnly=true,Secure=context.Request.IsHttps,SameSite=SameSiteMode.Strict,IsEssential=true,Path="/",Expires=max });
        return loginId;
    }
    public SavedLogin? Find(HttpContext context,string id) => Read(context).FirstOrDefault(x=>x.UserId==id);
    public void Remove(HttpContext context,string? id=null) {
        var token=Token(context);if(token is null)return;
        using var c=Open();using var q=c.CreateCommand();q.CommandText="DELETE FROM saved_account_sessions WHERE device_hash=$device AND ($id IS NULL OR user_id=$id)";q.Parameters.AddWithValue("$device",Hash(token));q.Parameters.AddWithValue("$id",(object?)id??DBNull.Value);q.ExecuteNonQuery();
        if(id is null) {context.Response.Cookies.Delete(CookieName,new CookieOptions {Path="/"});context.Response.Cookies.Delete("lw_account_browser",new CookieOptions {Path="/"});}
    }
    public bool IsSessionActive(string user,string session,int version){
        using var c=Open();using var q=c.CreateCommand();q.CommandText="SELECT COALESCE(last_seen,'') FROM saved_account_sessions WHERE user_id=$u AND session_id=$s AND session_version=$v AND julianday(expires_at)>julianday('now')";q.Parameters.AddWithValue("$u",user);q.Parameters.AddWithValue("$s",session);q.Parameters.AddWithValue("$v",version);var lastSeen=q.ExecuteScalar() as string;if(lastSeen is null)return false;if(DateTimeOffset.TryParse(lastSeen,out var seen)&&seen>DateTimeOffset.UtcNow.AddMinutes(-5))return true;
        q.CommandText="UPDATE saved_account_sessions SET last_seen=$now WHERE session_id=$s AND (last_seen IS NULL OR julianday(last_seen)<julianday('now','-5 minutes'))";q.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));q.ExecuteNonQuery();return true;
    }
    public bool RenewSession(HttpContext context,string user,string session,int version,DateTimeOffset expiry){
        using var c=Open();using var q=c.CreateCommand();q.CommandText="UPDATE saved_account_sessions SET expires_at=$expiry WHERE user_id=$user AND session_id=$session AND session_version=$version AND julianday(expires_at)>julianday('now') AND EXISTS(SELECT 1 FROM users u WHERE u.id=$user AND u.is_active=1 AND u.session_version=$version)";
        q.Parameters.AddWithValue("$expiry",expiry.ToString("O"));q.Parameters.AddWithValue("$user",user);q.Parameters.AddWithValue("$session",session);q.Parameters.AddWithValue("$version",version);
        if(q.ExecuteNonQuery()!=1)return false;
        var token=Token(context);if(token is not null){var max=Read(context).Where(x=>x.Persistent).Select(x=>(DateTimeOffset?)x.ExpiresAt).Max();context.Response.Cookies.Append(CookieName,token,new CookieOptions{HttpOnly=true,Secure=context.Request.IsHttps,SameSite=SameSiteMode.Strict,IsEssential=true,Path="/",Expires=max});}
        return true;
    }
    public LoginDevicesDto Devices(string user,string current,int page){
        using var c=Open();using var q=c.CreateCommand();q.CommandText="SELECT s.session_id,COALESCE(s.browser,'unknown'),COALESCE(s.platform,'unknown'),s.created_at,s.last_seen,s.expires_at,COUNT(*) OVER() FROM saved_account_sessions s JOIN users u ON u.id=s.user_id AND u.is_active=1 AND u.session_version=s.session_version WHERE s.user_id=$u AND julianday(expires_at)>julianday('now') ORDER BY (session_id=$current) DESC,last_seen DESC,session_id LIMIT 20 OFFSET $offset";q.Parameters.AddWithValue("$u",user);q.Parameters.AddWithValue("$current",current);q.Parameters.AddWithValue("$offset",(long)(page-1)*20);
        using var r=q.ExecuteReader();var result=new List<LoginDeviceDto>();var total=0;while(r.Read()){total=r.GetInt32(6);result.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(0)==current,r.IsDBNull(3)?null:DateTimeOffset.Parse(r.GetString(3)),r.IsDBNull(4)?null:DateTimeOffset.Parse(r.GetString(4)),DateTimeOffset.Parse(r.GetString(5))));}return new(result.ToArray(),page,total);
    }
    public bool Revoke(string user,string current,string? target,UserPresenceRepository presence){
        if(target==current)return false;using var c=Open();using var tx=c.BeginTransaction(deferred:false);using var q=c.CreateCommand();q.Transaction=tx;
        q.CommandText="SELECT presence_session FROM saved_account_sessions WHERE user_id=$u AND session_id<>$current AND ($target IS NULL OR session_id=$target)";q.Parameters.AddWithValue("$u",user);q.Parameters.AddWithValue("$current",current);q.Parameters.AddWithValue("$target",(object?)target??DBNull.Value);var sessions=new List<string>();using(var r=q.ExecuteReader())while(r.Read())if(!r.IsDBNull(0))sessions.Add(r.GetString(0));
        q.CommandText="DELETE FROM saved_account_sessions WHERE user_id=$u AND session_id<>$current AND ($target IS NULL OR session_id=$target)";var count=q.ExecuteNonQuery();tx.Commit();foreach(var session in sessions)presence.EndSession(user,session);return target is null||count>0;
    }

}
