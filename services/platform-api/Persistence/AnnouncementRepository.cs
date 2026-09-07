using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed class AnnouncementRepository(string connectionString)
{
    private SqliteConnection Open() { var db = new SqliteConnection(connectionString); db.Open(); return db; }
    public void Initialize() {
        using var db=Open(); using var c=db.CreateCommand(); c.CommandText="""
        CREATE TABLE IF NOT EXISTS announcements(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS announcement_recipients(announcement_id TEXT NOT NULL,user_id TEXT NOT NULL,dismissed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(announcement_id,user_id));
        CREATE INDEX IF NOT EXISTS ix_announcement_recipient ON announcement_recipients(user_id,announcement_id);
        """; c.ExecuteNonQuery();
    }
    private static AnnouncementDocument? Read(SqliteConnection db,string id,SqliteTransaction? tx=null) {
        using var c=db.CreateCommand(); c.Transaction=tx; c.CommandText="SELECT document FROM announcements WHERE id=$id"; c.Parameters.AddWithValue("$id",id);
        return c.ExecuteScalar() is string s ? JsonSerializer.Deserialize(s,AppJsonContext.Default.AnnouncementDocument) : null;
    }
    private static void Write(SqliteConnection db,SqliteTransaction tx,AnnouncementDocument d) {
        using var c=db.CreateCommand(); c.Transaction=tx; c.CommandText="UPDATE announcements SET document=$doc WHERE id=$id";
        c.Parameters.AddWithValue("$id",d.Id); c.Parameters.AddWithValue("$doc",JsonSerializer.Serialize(d,AppJsonContext.Default.AnnouncementDocument)); c.ExecuteNonQuery();
    }
    private static bool Valid(AnnouncementInput? p) => p is not null &&
        !string.IsNullOrWhiteSpace(p.TitleZh) && p.TitleZh.Length<=160 && !string.IsNullOrWhiteSpace(p.TitleEn) && p.TitleEn.Length<=160 &&
        !string.IsNullOrWhiteSpace(p.BodyZh) && p.BodyZh.Length<=12000 && !string.IsNullOrWhiteSpace(p.BodyEn) && p.BodyEn.Length<=12000 &&
        p.Placement is "login" or "personal" && p.Audience is "all" or "specified" && p.Languages is {Length:<=2} && p.OrganizationIds is {Length:<=200} &&
        p.Languages.All(x=>x is "zh-CN" or "en-US") && p.OrganizationIds.All(x=>!string.IsNullOrWhiteSpace(x) && x.Length<=64) &&
        (p.Audience!="all" || p.Languages.Length+p.OrganizationIds.Length==0) &&
        (p.Audience!="specified" || p.Languages.Length+p.OrganizationIds.Length>0) && (p.Placement!="login" || p.OrganizationIds.Length==0) &&
        (p.StartsAt is null || DateTimeOffset.TryParse(p.StartsAt,out _)) && (p.EndsAt is null || DateTimeOffset.TryParse(p.EndsAt,out _)) &&
        (p.EndsAt is null || DateTimeOffset.Parse(p.EndsAt)>(p.StartsAt is null ? DateTimeOffset.UtcNow : DateTimeOffset.Parse(p.StartsAt)));
    public string? Save(string id,AnnouncementInput? input,out AnnouncementDocument? result) {
        result=null; if(!Valid(input)) return "invalid"; var p=input!;
        using var db=Open(); using var tx=db.BeginTransaction(deferred:false); var old=Read(db,id,tx);
        if(old is null ? p.Version!=0 : old.Version!=p.Version) return "conflict";
        // Published audiences are immutable; copy a notice to deliberately send a new one.
        if(old is not null && old.Status!="draft") return "conflict";
        foreach(var org in p.OrganizationIds) {using var check=db.CreateCommand();check.Transaction=tx;check.CommandText="SELECT COUNT(*) FROM organizations WHERE id=$id AND is_active=1";check.Parameters.AddWithValue("$id",org);if(Convert.ToInt32(check.ExecuteScalar())!=1)return "invalid";}
        long seq=old?.Sequence??0;
        if(old is null) {using var c=db.CreateCommand(); c.Transaction=tx;c.CommandText="INSERT INTO announcements(id,document) VALUES($id,''); SELECT last_insert_rowid();";c.Parameters.AddWithValue("$id",id);seq=Convert.ToInt64(c.ExecuteScalar());}
        result=new(id,seq,p,"draft",(old?.Version??0)+1,old?.CreatedAt??DateTimeOffset.UtcNow.ToString("O"),0);
        Write(db,tx,result);tx.Commit();return null;
    }
    public string? Transition(string id,long version,bool publish,out AnnouncementDocument? result) {
        result=null;using var db=Open();using var tx=db.BeginTransaction(deferred:false);var old=Read(db,id,tx);
        if(old is null)return "missing";if(old.Version!=version || (publish ? old.Status!="draft" : old.Status!="published"))return "conflict";
        if(publish && !Valid(old.Content))return "invalid";
        var count=0;
        if(publish && old.Content.Placement=="personal") {
            using var c=db.CreateCommand();c.Transaction=tx;
            // Snapshot recipients at publication. History belongs to these accounts, even if they later change organization/language.
            c.CommandText="""
            INSERT INTO announcement_recipients(announcement_id,user_id)
            SELECT $id,id FROM users WHERE is_active=1
            AND ($langs='[]' OR COALESCE(locale,'zh-CN') IN (SELECT value FROM json_each($langs)))
            AND ($orgs='[]' OR organization_id IN (SELECT value FROM json_each($orgs)));
            """;
            c.Parameters.AddWithValue("$id",id);c.Parameters.AddWithValue("$langs",JsonSerializer.Serialize(old.Content.Languages,AppJsonContext.Default.StringArray));c.Parameters.AddWithValue("$orgs",JsonSerializer.Serialize(old.Content.OrganizationIds,AppJsonContext.Default.StringArray));count=c.ExecuteNonQuery();
        }
        var sequence=old.Sequence;
        if(publish){using var sequenceCommand=db.CreateCommand();sequenceCommand.Transaction=tx;sequenceCommand.CommandText="UPDATE announcements SET seq=(SELECT COALESCE(MAX(seq),0)+1 FROM announcements) WHERE id=$id RETURNING seq";sequenceCommand.Parameters.AddWithValue("$id",id);sequence=Convert.ToInt64(sequenceCommand.ExecuteScalar());}
        result=old with {Sequence=sequence,Status=publish?"published":"withdrawn",Version=old.Version+1,CreatedAt=publish?DateTimeOffset.UtcNow.ToString("O"):old.CreatedAt,Recipients=publish?count:old.Recipients};
        Write(db,tx,result);tx.Commit();return null;
    }
    public AnnouncementPage List(long? before,string? search) {
        using var db=Open();using var c=db.CreateCommand();c.CommandText="SELECT document FROM announcements WHERE seq<$before AND ($q='' OR instr(lower(json_extract(document,'$.content.titleZh')),lower($q))>0 OR instr(lower(json_extract(document,'$.content.titleEn')),lower($q))>0) ORDER BY seq DESC LIMIT 21";
        c.Parameters.AddWithValue("$before",before??long.MaxValue);c.Parameters.AddWithValue("$q",(search??"")[..Math.Min((search??"").Length,160)]);
        using var reader=c.ExecuteReader();var list=new List<AnnouncementDocument>();while(reader.Read())list.Add(JsonSerializer.Deserialize(reader.GetString(0),AppJsonContext.Default.AnnouncementDocument)!);
        return new(list.Take(20).ToArray(),list.Count>20?list[19].Sequence:null);
    }
    public AnnouncementFeed Feed(string? userId,string locale,long? before,bool unread=false) {
        using var db=Open();using var c=db.CreateCommand();
        c.CommandText="""
        SELECT a.document,COALESCE(r.dismissed,0) FROM announcements a
        LEFT JOIN announcement_recipients r ON r.announcement_id=a.id AND r.user_id=$user
        WHERE a.seq<$before AND json_extract(a.document,'$.status')='published'
        AND (json_extract(a.document,'$.content.startsAt') IS NULL OR julianday(json_extract(a.document,'$.content.startsAt'))<=julianday('now'))
        AND (($user IS NULL AND json_extract(a.document,'$.content.placement')='login'
             AND (json_array_length(a.document,'$.content.languages')=0 OR $locale IN (SELECT value FROM json_each(a.document,'$.content.languages')))
             AND (json_extract(a.document,'$.content.endsAt') IS NULL OR julianday(json_extract(a.document,'$.content.endsAt'))>julianday('now')))
             OR ($user IS NOT NULL AND r.user_id IS NOT NULL AND json_extract(a.document,'$.content.placement')='personal'))
        AND ($unread=0 OR (r.dismissed=0 AND (json_extract(a.document,'$.content.endsAt') IS NULL OR julianday(json_extract(a.document,'$.content.endsAt'))>julianday('now'))))
        ORDER BY a.seq DESC LIMIT 21;
        """;
        c.Parameters.AddWithValue("$user",(object?)userId??DBNull.Value);c.Parameters.AddWithValue("$before",before??long.MaxValue);c.Parameters.AddWithValue("$locale",locale);c.Parameters.AddWithValue("$unread",unread?1:0);
        using var reader=c.ExecuteReader();var list=new List<AnnouncementItem>();while(reader.Read()) {var d=JsonSerializer.Deserialize(reader.GetString(0),AppJsonContext.Default.AnnouncementDocument)!;var dismissed=reader.GetInt32(1)==1;list.Add(new(d.Id,d.Sequence,locale=="en-US"?d.Content.TitleEn:d.Content.TitleZh,locale=="en-US"?d.Content.BodyEn:d.Content.BodyZh,d.CreatedAt,dismissed,!dismissed && (d.Content.EndsAt is null || DateTimeOffset.Parse(d.Content.EndsAt)>DateTimeOffset.UtcNow)));}
        return new(list.Take(20).ToArray(),list.Count>20?list[19].Sequence:null);
    }
    public bool DismissMany(string userId,string[]? ids) {
        if(ids is null || ids.Length is <1 or >500 || ids.Any(id=>!Guid.TryParseExact(id,"N",out _)))return false;
        using var db=Open();using var c=db.CreateCommand();
        c.CommandText="UPDATE announcement_recipients SET dismissed=1 WHERE user_id=$user AND announcement_id IN (SELECT value FROM json_each($ids))";
        c.Parameters.AddWithValue("$user",userId);c.Parameters.AddWithValue("$ids",JsonSerializer.Serialize(ids,AppJsonContext.Default.StringArray));c.ExecuteNonQuery();return true;
    }
    public bool Dismiss(string userId,string id) {
        using var db=Open();using var c=db.CreateCommand();c.CommandText="UPDATE announcement_recipients SET dismissed=1 WHERE user_id=$user AND announcement_id=$id";c.Parameters.AddWithValue("$user",userId);c.Parameters.AddWithValue("$id",id);return c.ExecuteNonQuery()>0;
    }
}
