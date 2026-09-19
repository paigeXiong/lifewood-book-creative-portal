using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;
internal sealed record CreateInvitation(string OrganizationId, string Note, int Days, int Limit);
internal sealed record InvitationItem(string Id, string OrganizationId, string Organization, string Note, string Creator, long CreatedAt, long Expires, int Limit, long Used, string Status, string Suffix);
internal sealed record InvitationPage(InvitationItem[] Items, long Total, int Page, int PageSize);
internal sealed record InvitationSecret(string Code, string? Id = null, string? PublicUrl = null);
internal sealed record InvitationMember(string Id, string Name, string Email, long JoinedAt);
internal sealed record InvitationMembers(InvitationMember[] Items, long Total, int Page, int PageSize);
internal sealed record InvitationLookup(string Organization, string? Email = null, string? DisplayName = null);
internal sealed record InvitationCodeRequest(string Code);
internal sealed record InvitationEmailRequest(string Code, string Email, string Locale, string? DisplayName = null);
internal sealed record InvitationRegistration(string Token, string DisplayName, string Password);
internal sealed record InvitationChallenge(string Token, string Email, string Locale);
internal sealed class InvitationRepository(string connectionString, IDataProtectionProvider protection) {
    private readonly IDataProtector protector = protection.CreateProtector("BookPortal.Invitations.v1");
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Normalize(string? code) => (code ?? "").Trim().Replace("-", "").ToUpperInvariant();
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    private static SqliteCommand Cmd(SqliteConnection c, SqliteTransaction? tx, string sql, params (string, object?)[] values) { var q=c.CreateCommand(); q.Transaction=tx; q.CommandText=sql; foreach(var (k,v) in values) q.Parameters.AddWithValue(k,v??DBNull.Value); return q; }
    public void Initialize() { using var c=Open(); EnsureSchema(c); }
    internal static void EnsureSchema(SqliteConnection c) {
        using var q=Cmd(c,null,"""
        CREATE TABLE IF NOT EXISTS invitations(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,note TEXT NOT NULL,creator_id TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,capacity INTEGER NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,code_hash TEXT NOT NULL UNIQUE,code_secret TEXT NOT NULL,suffix TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS invitation_members(invitation_id TEXT NOT NULL,user_id TEXT NOT NULL UNIQUE,joined INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_invitation_members_invite ON invitation_members(invitation_id);
        CREATE TABLE IF NOT EXISTS invitation_challenges(hash TEXT PRIMARY KEY,invitation_id TEXT NOT NULL,email TEXT NOT NULL,locale TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_invitation_challenges_email ON invitation_challenges(email,created);
        """); q.ExecuteNonQuery();
        using var columns=Cmd(c,null,"SELECT COUNT(*) FROM pragma_table_info('invitation_challenges') WHERE name='display_name'");
        if(Convert.ToInt64(columns.ExecuteScalar())==0) { using var migrate=Cmd(c,null,"ALTER TABLE invitation_challenges ADD COLUMN display_name TEXT NOT NULL DEFAULT ''"); migrate.ExecuteNonQuery(); }
    }
    private const string Source="""
    WITH records AS (SELECT i.*,COALESCE(o.name,'') organization,COALESCE(u.display_name,'') creator,
    (SELECT COUNT(*) FROM invitation_members m WHERE m.invitation_id=i.id) used,
    CASE WHEN i.disabled=1 OR COALESCE(o.is_active,0)=0 THEN 'disabled' WHEN i.expires<=$now THEN 'expired' WHEN (SELECT COUNT(*) FROM invitation_members m WHERE m.invitation_id=i.id)>=i.capacity THEN 'used' ELSE 'active' END state
    FROM invitations i LEFT JOIN organizations o ON o.id=i.organization_id LEFT JOIN users u ON u.id=i.creator_id)
    """;
    public InvitationPage List(string? search,string? status,string? organization,int page) {
        using var c=Open(); using var tx=c.BeginTransaction(deferred:true);
        const string filter=" WHERE ($q='' OR instr(lower(note || ' ' || organization || ' ' || creator),lower($q))>0) AND ($state='' OR state=$state) AND ($org='' OR organization_id=$org)";
        (string,object?)[] args=[("$now",Now),("$q",search?.Trim()??""),("$state",status??""),("$org",organization??"")];
        using var count=Cmd(c,tx,Source+"SELECT COUNT(*) FROM records"+filter,args);var total=Convert.ToInt64(count.ExecuteScalar());page=(int)Math.Clamp(page,1,Math.Max(1,(total+19)/20));
        using var q=Cmd(c,tx,Source+"SELECT id,organization_id,organization,note,creator,created,expires,capacity,used,state,suffix FROM records"+filter+" ORDER BY created DESC,id LIMIT 20 OFFSET $offset",[..args,("$offset",(page-1)*20)]);
        using var r=q.ExecuteReader();var items=new List<InvitationItem>();while(r.Read())items.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),r.GetInt64(5),r.GetInt64(6),r.GetInt32(7),r.GetInt64(8),r.GetString(9),r.GetString(10)));r.Close();tx.Commit();return new(items.ToArray(),total,page,20);
    }
    public InvitationSecret? Create(CreateInvitation input,string actor) {
        if(input.Note is null || input.Note.Length>100 || input.Days is <1 or >90 || input.Limit is <1 or >100)return null;
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);
        using var org=Cmd(c,tx,"SELECT 1 FROM organizations WHERE id=$id AND is_active=1",("$id",input.OrganizationId));if(org.ExecuteScalar() is null)return null;
        // The write transaction serializes allocation; the unique hash index remains a final guard.
        string code;
        while (true) {
            code = new string(Enumerable.Range(0, 6).Select(_ => (char)('A' + RandomNumberGenerator.GetInt32(26))).ToArray());
            using var duplicate = Cmd(c, tx, "SELECT 1 FROM invitations WHERE code_hash=$hash", ("$hash", Hash(code)));
            if (duplicate.ExecuteScalar() is null) break;
        }
        var id=Guid.NewGuid().ToString("N");
        using var q=Cmd(c,tx,"INSERT INTO invitations VALUES($id,$org,$note,$actor,$now,$expires,$limit,0,$hash,$secret,$suffix)",("$id",id),("$org",input.OrganizationId),("$note",input.Note.Trim()),("$actor",actor),("$now",Now),("$expires",Now+input.Days*86400L),("$limit",input.Limit),("$hash",Hash(code)),("$secret",protector.Protect(code)),("$suffix",code[^4..]));q.ExecuteNonQuery();tx.Commit();return new(code,id);
    }
    public InvitationSecret? Reveal(string id) { using var c=Open();using var q=Cmd(c,null,Source+"SELECT code_secret FROM records WHERE id=$id AND state='active'",("$now",Now),("$id",id));return q.ExecuteScalar() is string value?new(protector.Unprotect(value)):null; }
    public bool Disable(string id) { using var c=Open();using var q=Cmd(c,null,"UPDATE invitations SET disabled=1 WHERE id=$id",("$id",id));return q.ExecuteNonQuery()==1; }
    public InvitationMembers Members(string id,int page) {
        using var c=Open();using var tx=c.BeginTransaction(deferred:true);using var count=Cmd(c,tx,"SELECT COUNT(*) FROM invitation_members WHERE invitation_id=$id",("$id",id));var total=Convert.ToInt64(count.ExecuteScalar());page=(int)Math.Clamp(page,1,Math.Max(1,(total+19)/20));
        using var q=Cmd(c,tx,"SELECT m.user_id,CASE WHEN u.closed_at IS NULL THEN COALESCE(u.display_name,'') ELSE '' END,CASE WHEN u.closed_at IS NULL THEN COALESCE(u.email,'') ELSE '' END,m.joined FROM invitation_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.invitation_id=$id ORDER BY m.joined DESC,m.user_id LIMIT 20 OFFSET $offset",("$id",id),("$offset",(page-1)*20));using var r=q.ExecuteReader();var items=new List<InvitationMember>();while(r.Read())items.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetInt64(3)));r.Close();tx.Commit();return new(items.ToArray(),total,page,20);
    }
    public InvitationLookup? Lookup(string code) { using var c=Open();using var q=Cmd(c,null,Source+"SELECT organization FROM records WHERE code_hash=$hash AND state='active'",("$now",Now),("$hash",Hash(Normalize(code))));return q.ExecuteScalar() is string name?new(name):null; }
    public InvitationChallenge? Challenge(InvitationEmailRequest input) {
        if(input.DisplayName is not null && input.DisplayName.Trim().Length is <2 or >100)return null;
        var email=input.Email?.Trim()??"";if(email.Length is <3 or >254 || !MailAddress.TryCreate(email,out var address) || address.Address!=email || input.Locale is not ("zh-CN" or "en-US"))return null;
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);
        using var cleanup=Cmd(c,tx,"DELETE FROM invitation_challenges WHERE expires<$now",("$now",Now));cleanup.ExecuteNonQuery();
        using var invite=Cmd(c,tx,Source+"SELECT id FROM records WHERE code_hash=$hash AND state='active'",("$now",Now),("$hash",Hash(Normalize(input.Code))));if(invite.ExecuteScalar() is not string id)return null;
        using var exists=Cmd(c,tx,"SELECT 1 FROM users WHERE normalized_email=$email",("$email",email.ToUpperInvariant()));if(exists.ExecuteScalar() is not null)return null;
        using var recent=Cmd(c,tx,"SELECT email FROM invitation_challenges WHERE created>$recent",("$recent",Now-60));
        using(var reader=recent.ExecuteReader())while(reader.Read())if(reader.GetString(0).ToUpperInvariant()==email.ToUpperInvariant())return null;
        // Per-address cooldown spans all invitations; the SMTP service also applies global quotas.
        var token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        using var q=Cmd(c,tx,"INSERT INTO invitation_challenges(hash,invitation_id,email,locale,created,expires,display_name) VALUES($hash,$id,$email,$locale,$now,$expires,$name)",("$hash",Hash(token)),("$id",id),("$email",email),("$locale",input.Locale),("$now",Now),("$expires",Now+600),("$name",input.DisplayName?.Trim()??""));q.ExecuteNonQuery();tx.Commit();return new(token,email,input.Locale);
    }
    public void RevokeChallenge(string token) { using var c=Open();using var q=Cmd(c,null,"DELETE FROM invitation_challenges WHERE hash=$hash",("$hash",Hash(token)));q.ExecuteNonQuery(); }
    public InvitationLookup? InspectToken(string token) { using var c=Open();using var q=Cmd(c,null,Source+"SELECT organization,c.email,c.display_name FROM records i JOIN invitation_challenges c ON c.invitation_id=i.id WHERE c.hash=$hash AND c.expires>$now AND i.state='active'",("$hash",Hash(token)),("$now",Now));using var r=q.ExecuteReader();return r.Read()?new(r.GetString(0),r.GetString(1),r.GetString(2)):null; }
    public bool Register(InvitationRegistration input) {
        if(input.Token is null || input.Token.Length!=64 || string.IsNullOrWhiteSpace(input.DisplayName) || input.DisplayName.Trim().Length is <2 or >100 || input.Password is null || input.Password.Length is <8 or >128)return false;
        var userId=Guid.NewGuid().ToString("N");var passwordHash=new PasswordHasher<string>().HashPassword(userId,input.Password);
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);
        using var get=Cmd(c,tx,Source+"SELECT i.id,i.organization_id,c.email,c.locale FROM records i JOIN invitation_challenges c ON c.invitation_id=i.id WHERE c.hash=$hash AND c.expires>$now AND i.state='active'",("$hash",Hash(input.Token)),("$now",Now));using var r=get.ExecuteReader();if(!r.Read())return false;var id=r.GetString(0);var org=r.GetString(1);var email=r.GetString(2);var locale=r.GetString(3);r.Close();
        try {
            using var q=Cmd(c,tx,"INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,is_active,organization_id,locale,created_at,updated_at) VALUES($id,$email,$normalized,$name,$password,'customer',1,$org,$locale,$now,$now)",("$id",userId),("$email",email),("$normalized",email.ToUpperInvariant()),("$name",input.DisplayName.Trim()),("$password",passwordHash),("$org",org),("$locale",locale),("$now",DateTimeOffset.UtcNow.ToString("O")));q.ExecuteNonQuery();
            using var verified=Cmd(c,tx,"INSERT INTO email_settings(user_id,email,verified) VALUES($id,$email,1)",("$id",userId),("$email",email));verified.ExecuteNonQuery();
            using var used=Cmd(c,tx,"INSERT INTO invitation_members VALUES($invite,$user,$now)",("$invite",id),("$user",userId),("$now",Now));used.ExecuteNonQuery();
            using var clear=Cmd(c,tx,"DELETE FROM invitation_challenges WHERE upper(email)=upper($email)",("$email",email));clear.ExecuteNonQuery();tx.Commit();return true;
        } catch(SqliteException e) when(e.SqliteErrorCode==19) { return false; }
    }
}
