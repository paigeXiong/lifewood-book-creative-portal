using System.Security.Cryptography;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;
internal sealed record OidcSaved(OidcConfiguration Public, string Secret);
internal sealed record OidcFlow(string Id, long Version, string Locale, string Portal, string? UserId, int SessionVersion, string? LoginSession, string ProviderId = "default");
internal sealed class OidcDuplicateProviderException : Exception;
internal sealed class OidcStore(string connectionString, IDataProtectionProvider protection)
{
    private readonly IDataProtector protector = protection.CreateProtector("Oidc.Secret.v1");
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    private static SqliteCommand Command(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] args) {
        var q = c.CreateCommand(); q.Transaction = tx; q.CommandText = sql; foreach(var (k,v) in args) q.Parameters.AddWithValue(k,v ?? DBNull.Value); return q;
    }
    private static void Execute(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] args) { using var q=Command(c,tx,sql,args); q.ExecuteNonQuery(); }
    public void Initialize() {
        using var c=Open(); using var tx=c.BeginTransaction();
        Execute(c,tx,"""
        CREATE TABLE IF NOT EXISTS oidc_providers(id TEXT PRIMARY KEY,version INTEGER NOT NULL,name_zh TEXT NOT NULL,name_en TEXT NOT NULL,issuer TEXT NOT NULL,client_id TEXT NOT NULL,public_origin TEXT NOT NULL,admin_origin TEXT NOT NULL,enabled INTEGER NOT NULL,secret TEXT NOT NULL,UNIQUE(issuer,client_id));
        CREATE TABLE IF NOT EXISTS oidc_external_bindings(provider_id TEXT NOT NULL,issuer TEXT NOT NULL,client_id TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(provider_id,issuer,client_id,subject),UNIQUE(provider_id,issuer,client_id,user_id));
        """);
        using(var legacy=Command(c,tx,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='oidc_configuration'")) {
            if(legacy.ExecuteScalar() is not null) {
                // Preserve the original callback, encrypted secret and bindings; expire pending legacy flows.
                Execute(c,tx,"""
                INSERT INTO oidc_providers SELECT 'default',version,name_zh,name_en,issuer,client_id,public_origin,admin_origin,enabled,secret FROM oidc_configuration;
                INSERT INTO oidc_external_bindings SELECT 'default',issuer,client_id,subject,user_id FROM oidc_bindings;
                DROP TRIGGER IF EXISTS oidc_closed;
                DROP TRIGGER IF EXISTS oidc_revoked;
                DROP TABLE oidc_configuration;
                DROP TABLE oidc_bindings;
                DROP TABLE oidc_flows;
                """);
            }
        }
        Execute(c,tx,"""
        CREATE TABLE IF NOT EXISTS oidc_flows(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,browser_hash TEXT NOT NULL,version INTEGER NOT NULL,locale TEXT NOT NULL,portal TEXT NOT NULL,user_id TEXT,session_version INTEGER NOT NULL,login_session TEXT,expires INTEGER NOT NULL,started INTEGER NOT NULL DEFAULT 0);
        CREATE TRIGGER IF NOT EXISTS oidc_closed AFTER UPDATE OF closed_at ON users WHEN NEW.closed_at IS NOT NULL BEGIN DELETE FROM oidc_external_bindings WHERE user_id=NEW.id; DELETE FROM oidc_flows WHERE user_id=NEW.id; END;
        CREATE TRIGGER IF NOT EXISTS oidc_revoked AFTER UPDATE OF session_version ON users WHEN OLD.session_version<>NEW.session_version BEGIN DELETE FROM oidc_flows WHERE user_id=NEW.id; END;
        """); tx.Commit();
    }
    public OidcConfiguration[] List() {
        using var c=Open();using var tx=c.BeginTransaction();var ids=new List<string>();
        using(var q=Command(c,tx,"SELECT id FROM oidc_providers ORDER BY rowid"))using(var r=q.ExecuteReader())while(r.Read())ids.Add(r.GetString(0));
        return ids.Select(id=>Read(c,tx,id).Public).ToArray();
    }
    public OidcSaved Get(string id="default") {
        using var c=Open(); return Read(c,null,id);
    }
    private OidcSaved Read(SqliteConnection c,SqliteTransaction? tx,string id) {
        using var q=Command(c,tx,"SELECT version,name_zh,name_en,issuer,client_id,public_origin,admin_origin,enabled,secret FROM oidc_providers WHERE id=$id",("$id",id)); using var r=q.ExecuteReader();
        if(!r.Read()) return new(new(0,"","","","","","",false,false,id),"");
        var encrypted=r.GetString(8);
        var config=new OidcConfiguration(r.GetInt64(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),r.GetString(5),r.GetString(6),r.GetBoolean(7),encrypted.Length>0,id);
        try { return new(config,encrypted.Length>0?protector.Unprotect(encrypted):""); }
        catch(CryptographicException) { return new(config with {Enabled=false},""); }
    }
    public bool Save(SaveOidcConfiguration input,string secret) {
        using var c=Open();using var tx=c.BeginTransaction();if(Read(c,tx,input.Id).Public.Version!=input.Version)return false;
        using(var q=Command(c,tx,"SELECT 1 FROM oidc_providers WHERE id<>$id AND issuer=$issuer AND client_id=$client",("$id",input.Id),("$issuer",input.Issuer.Trim()),("$client",input.ClientId.Trim())))if(q.ExecuteScalar() is not null)throw new OidcDuplicateProviderException();
        Execute(c,tx,"""
        INSERT INTO oidc_providers VALUES($id,$version,$zh,$en,$issuer,$client,$public,$admin,$enabled,$secret)
        ON CONFLICT(id) DO UPDATE SET version=excluded.version,name_zh=excluded.name_zh,name_en=excluded.name_en,issuer=excluded.issuer,client_id=excluded.client_id,public_origin=excluded.public_origin,admin_origin=excluded.admin_origin,enabled=excluded.enabled,secret=excluded.secret
        """,("$id",input.Id),("$version",input.Version+1),("$zh",input.NameZh.Trim()),("$en",input.NameEn.Trim()),("$issuer",input.Issuer.Trim()),("$client",input.ClientId.Trim()),("$public",input.PublicOrigin.TrimEnd('/')),("$admin",input.AdminOrigin.TrimEnd('/')),("$enabled",input.Enabled?1:0),("$secret",secret.Length>0?protector.Protect(secret):""));
        Execute(c,tx,"DELETE FROM oidc_flows WHERE provider_id=$id",("$id",input.Id));tx.Commit();return true;
    }
    public bool Delete(string id,long version) {
        using var c=Open();using var tx=c.BeginTransaction();using var q=Command(c,tx,"DELETE FROM oidc_providers WHERE id=$id AND version=$version",("$id",id),("$version",version));
        if(q.ExecuteNonQuery()!=1)return false;
        Execute(c,tx,"DELETE FROM oidc_flows WHERE provider_id=$id; DELETE FROM oidc_external_bindings WHERE provider_id=$id",("$id",id));tx.Commit();return true;
    }
    public static string Random() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public string Start(OidcConfiguration config,string browser,string locale,string portal,string? user,int version,string? session) {
        using var c=Open(); using var tx=c.BeginTransaction(); if(Read(c,tx,config.Id).Public is not {Enabled:true} current || current.Version!=config.Version) throw new InvalidOperationException("Configuration changed.");
        Execute(c,tx,"DELETE FROM oidc_flows WHERE expires<=$now",("$now",Now));
        var id=Random(); Execute(c,tx,"INSERT INTO oidc_flows(id,provider_id,browser_hash,version,locale,portal,user_id,session_version,login_session,expires) VALUES($id,$provider,$browser,$version,$locale,$portal,$user,$sessionVersion,$session,$expires)",("$id",id),("$provider",config.Id),("$browser",Hash(browser)),("$version",config.Version),("$locale",locale),("$portal",portal),("$user",user),("$sessionVersion",version),("$session",session),("$expires",Now+600)); tx.Commit(); return id;
    }
    public OidcFlow? Authorize(string id,string browser) {
        using var c=Open(); using var tx=c.BeginTransaction();
        var flow=ReadFlow(c,tx,id,0); if(flow is null) return null;
        using var q=Command(c,tx,"UPDATE oidc_flows SET started=1 WHERE id=$id AND browser_hash=$browser",("$id",id),("$browser",Hash(browser))); if(q.ExecuteNonQuery()!=1) return null;
        tx.Commit(); return flow;
    }
    private static OidcFlow? ReadFlow(SqliteConnection c,SqliteTransaction tx,string id,int started) {
        using var q=Command(c,tx,"SELECT f.version,f.locale,f.portal,f.user_id,f.session_version,f.login_session,f.provider_id FROM oidc_flows f JOIN oidc_providers o ON o.id=f.provider_id AND o.version=f.version AND o.enabled=1 WHERE f.id=$id AND f.expires>$now AND f.started=$started",("$id",id),("$now",Now),("$started",started)); using var r=q.ExecuteReader();
        return r.Read()?new(id,r.GetInt64(0),r.GetString(1),r.GetString(2),r.IsDBNull(3)?null:r.GetString(3),r.GetInt32(4),r.IsDBNull(5)?null:r.GetString(5),r.GetString(6)):null;
    }
    public OidcFlow? Consume(string id,string providerId="default") { using var c=Open();using var tx=c.BeginTransaction();var f=ReadFlow(c,tx,id,1);if(f?.ProviderId!=providerId)return null;if(f is not null)Execute(c,tx,"UPDATE oidc_flows SET started=2 WHERE id=$id",("$id",id));tx.Commit();return f; }
    public bool IsBound(string user,OidcConfiguration config) { using var c=Open();using var q=Command(c,null,"SELECT 1 FROM oidc_external_bindings WHERE provider_id=$provider AND user_id=$user AND issuer=$issuer AND client_id=$client",("$provider",config.Id),("$user",user),("$issuer",config.Issuer),("$client",config.ClientId));return q.ExecuteScalar() is not null; }
    public bool Bind(OidcFlow flow,OidcConfiguration config,string subject) {
        if(flow.ProviderId!=config.Id||flow.Version!=config.Version)return false;
        using var c=Open();using var tx=c.BeginTransaction();
        using var q=Command(c,tx,"INSERT OR IGNORE INTO oidc_external_bindings SELECT $provider,$issuer,$client,$subject,id FROM users WHERE id=$user AND session_version=$version AND is_active=1 AND closed_at IS NULL AND EXISTS(SELECT 1 FROM oidc_providers WHERE id=$provider AND version=$config AND enabled=1 AND issuer=$issuer AND client_id=$client) AND EXISTS(SELECT 1 FROM oidc_flows WHERE id=$flow AND provider_id=$provider AND user_id=$user AND login_session=$session AND version=$config AND started=2 AND expires>$now) AND EXISTS(SELECT 1 FROM saved_account_sessions WHERE user_id=$user AND session_id=$session AND session_version=$version AND julianday(expires_at)>julianday('now'))",("$provider",config.Id),("$issuer",config.Issuer),("$client",config.ClientId),("$subject",subject),("$user",flow.UserId),("$version",flow.SessionVersion),("$config",flow.Version),("$flow",flow.Id),("$session",flow.LoginSession),("$now",Now));
        var result=q.ExecuteNonQuery()==1;Execute(c,tx,"DELETE FROM oidc_flows WHERE id=$flow",("$flow",flow.Id));tx.Commit();return result;
    }
    public string? Resolve(OidcConfiguration config,string subject) {using var c=Open();using var q=Command(c,null,"SELECT b.user_id FROM oidc_external_bindings b JOIN users u ON u.id=b.user_id WHERE b.provider_id=$provider AND b.issuer=$issuer AND b.client_id=$client AND b.subject=$subject AND u.is_active=1 AND u.closed_at IS NULL",("$provider",config.Id),("$issuer",config.Issuer),("$client",config.ClientId),("$subject",subject));return q.ExecuteScalar() as string;}
    public void Unbind(string user,OidcConfiguration config) {using var c=Open();using var tx=c.BeginTransaction();Execute(c,tx,"DELETE FROM oidc_external_bindings WHERE provider_id=$provider AND user_id=$user AND issuer=$issuer AND client_id=$client",("$provider",config.Id),("$user",user),("$issuer",config.Issuer),("$client",config.ClientId));Execute(c,tx,"DELETE FROM oidc_flows WHERE user_id=$user AND provider_id=$provider",("$user",user),("$provider",config.Id));tx.Commit();}
}
