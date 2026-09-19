using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed partial class AnnouncementRepository(string connectionString)
{
    private SqliteConnection Open() { var db = new SqliteConnection(connectionString); db.Open(); return db; }
    public void Initialize() {
        using var db=Open(); using var c=db.CreateCommand(); c.CommandText="""
        CREATE TABLE IF NOT EXISTS announcements(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,document TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS announcement_recipients(announcement_id TEXT NOT NULL,user_id TEXT NOT NULL,dismissed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(announcement_id,user_id));
        CREATE TABLE IF NOT EXISTS announcement_jobs(id TEXT PRIMARY KEY,announcement_id TEXT NOT NULL,version INTEGER NOT NULL,run_at TEXT NOT NULL,status TEXT NOT NULL,finished_at TEXT,error TEXT,title_zh TEXT,title_en TEXT);
        CREATE INDEX IF NOT EXISTS ix_announcement_jobs_due ON announcement_jobs(status,run_at);
        CREATE UNIQUE INDEX IF NOT EXISTS ix_announcement_job_pending ON announcement_jobs(announcement_id) WHERE status='pending';
        CREATE INDEX IF NOT EXISTS ix_announcement_recipient ON announcement_recipients(user_id,announcement_id);
        """; c.ExecuteNonQuery();
        using var columns=db.CreateCommand();columns.CommandText="PRAGMA table_info(announcement_jobs)";
        var names=new HashSet<string>();using(var reader=columns.ExecuteReader())while(reader.Read())names.Add(reader.GetString(1));
        foreach(var name in new[]{"title_zh","title_en"})if(!names.Contains(name)){using var add=db.CreateCommand();add.CommandText=$"ALTER TABLE announcement_jobs ADD COLUMN {name} TEXT";add.ExecuteNonQuery();}
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
        (p.Title is not null || p.Body is not null
            ? !string.IsNullOrWhiteSpace(p.Title) && p.Title.Length<=160 && !string.IsNullOrWhiteSpace(p.Body) && p.Body.Length<=12000
            : !string.IsNullOrWhiteSpace(p.TitleZh) && p.TitleZh.Length<=160 && !string.IsNullOrWhiteSpace(p.TitleEn) && p.TitleEn.Length<=160 &&
              !string.IsNullOrWhiteSpace(p.BodyZh) && p.BodyZh.Length<=12000 && !string.IsNullOrWhiteSpace(p.BodyEn) && p.BodyEn.Length<=12000) &&
        (p.DisplayDays is null || p.DisplayDays is >=1 and <=3650) &&
        p.Placement is "login" or "personal" or "banner" && p.Audience is "all" or "specified" && p.Languages is {Length:<=2} && p.OrganizationIds is {Length:<=200} &&
        p.Languages.All(x=>x is "zh-CN" or "en-US") && p.OrganizationIds.All(x=>!string.IsNullOrWhiteSpace(x) && x.Length<=64) &&
        (p.Audience!="all" || p.Languages.Length+p.OrganizationIds.Length==0) &&
        (p.Audience!="specified" || p.Languages.Length+p.OrganizationIds.Length>0) && (p.Placement!="login" || p.OrganizationIds.Length==0) &&
        (p.DisplayDays is not null || ((p.StartsAt is null || DateTimeOffset.TryParse(p.StartsAt,out _)) && (p.EndsAt is null || DateTimeOffset.TryParse(p.EndsAt,out _)) &&
        (p.EndsAt is null || DateTimeOffset.Parse(p.EndsAt)>(p.StartsAt is null ? DateTimeOffset.UtcNow : DateTimeOffset.Parse(p.StartsAt)))));
    public string? Save(string id,AnnouncementInput? input,out AnnouncementDocument? result) {
        result=null; if(!Valid(input)) return "invalid"; var p=input!;
        if(p.DisplayDays is not null)p=p with {StartsAt=null,EndsAt=null};
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
    public string? Transition(string id,long version,bool publish,out AnnouncementDocument? result,bool automated=false) {
        result=null;using var db=Open();using var tx=db.BeginTransaction(deferred:false);var old=Read(db,id,tx);
        if(old is null)return "missing";if(old.Version!=version || (publish ? old.Status is not ("draft" or "scheduled") : old.Status!="published"))return "conflict";
        if(automated && (old.Status!="scheduled" || old.ScheduledAt>DateTimeOffset.UtcNow))return "conflict";
        if(publish)old=old with {Content=old.Content with {DisplayDays=old.Content.DisplayDays??30,StartsAt=null,EndsAt=null}};
        if(publish && !Valid(old.Content))return "invalid";
        var count=0;
        if(publish && old.Content.Placement is "personal" or "banner") {
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
        var publishedAt=DateTimeOffset.UtcNow;
        var content=publish && old.Content.DisplayDays is int days ? old.Content with {StartsAt=null,EndsAt=publishedAt.AddDays(days).ToString("O")} : old.Content;
        result=old with {ScheduledAt=null,Content=content,Sequence=sequence,Status=publish?"published":"withdrawn",Version=old.Version+1,CreatedAt=publish?publishedAt.ToString("O"):old.CreatedAt,Recipients=publish?count:old.Recipients};
        Write(db,tx,result);
        if(publish && old.Status=="scheduled") { using var done=db.CreateCommand();done.Transaction=tx;done.CommandText="UPDATE announcement_jobs SET status='completed',finished_at=$now WHERE announcement_id=$id AND status='pending'";done.Parameters.AddWithValue("$now",publishedAt.ToString("O"));done.Parameters.AddWithValue("$id",id);done.ExecuteNonQuery(); }
        if(automated) {
            using var audit=db.CreateCommand();audit.Transaction=tx;
            audit.CommandText="INSERT INTO audit_events(id,actor_user_id,actor_name,actor_email,action_id,target_type,target_id,occurred_at,trace_id) VALUES($event,'system','System','','announcement.publish','announcement',$id,$now,$event)";
            audit.Parameters.AddWithValue("$event",Guid.NewGuid().ToString("N"));audit.Parameters.AddWithValue("$id",id);audit.Parameters.AddWithValue("$now",publishedAt.ToString("O"));audit.ExecuteNonQuery();
        }
        tx.Commit();return null;
    }
    public string? Preview(string id,long version,out AnnouncementPreview? preview) {
        preview=null;using var db=Open();using var tx=db.BeginTransaction();var d=Read(db,id,tx);
        if(d is null)return "missing";if(d.Version!=version || d.Status is not ("draft" or "scheduled"))return "conflict";
        if(d.Content.Placement=="login"){preview=new(null);return null;}
        using var c=db.CreateCommand();c.Transaction=tx;c.CommandText="""
        SELECT COUNT(*) FROM users WHERE is_active=1
        AND ($langs='[]' OR COALESCE(locale,'zh-CN') IN (SELECT value FROM json_each($langs)))
        AND ($orgs='[]' OR organization_id IN (SELECT value FROM json_each($orgs)));
        """;
        c.Parameters.AddWithValue("$langs",JsonSerializer.Serialize(d.Content.Languages,AppJsonContext.Default.StringArray));c.Parameters.AddWithValue("$orgs",JsonSerializer.Serialize(d.Content.OrganizationIds,AppJsonContext.Default.StringArray));
        preview=new(Convert.ToInt32(c.ExecuteScalar()));return null;
    }
    public string? DeleteDraft(string id,long version) {
        using var db=Open();using var tx=db.BeginTransaction(deferred:false);var d=Read(db,id,tx);
        if(d is null)return "missing";if(d.Status!="draft" || d.Version!=version)return "conflict";
        using var c=db.CreateCommand();c.Transaction=tx;c.CommandText="DELETE FROM announcements WHERE id=$id";c.Parameters.AddWithValue("$id",id);c.ExecuteNonQuery();tx.Commit();return null;
    }
    public AnnouncementPage List(long? before,string? search,string? status=null,string? placement=null,string? notice=null) {
        using var db=Open();using var c=db.CreateCommand();c.CommandText="SELECT document FROM announcements WHERE seq<$before AND ($notice='' OR id=$notice) AND ($status='' OR json_extract(document,'$.status')=$status) AND ($placement='' OR json_extract(document,'$.content.placement')=$placement) AND ($q='' OR instr(lower(json_extract(document,'$.content.title')),lower($q))>0 OR instr(lower(json_extract(document,'$.content.titleZh')),lower($q))>0 OR instr(lower(json_extract(document,'$.content.titleEn')),lower($q))>0) ORDER BY seq DESC LIMIT 21";
        c.Parameters.AddWithValue("$notice",notice??"");c.Parameters.AddWithValue("$status",status??"");c.Parameters.AddWithValue("$placement",placement??"");c.Parameters.AddWithValue("$before",before??long.MaxValue);c.Parameters.AddWithValue("$q",(search??"")[..Math.Min((search??"").Length,160)]);
        using var reader=c.ExecuteReader();var list=new List<AnnouncementDocument>();while(reader.Read())list.Add(JsonSerializer.Deserialize(reader.GetString(0),AppJsonContext.Default.AnnouncementDocument)!);
        return new(list.Take(20).ToArray(),list.Count>20?list[19].Sequence:null);
    }
    public AnnouncementFeed Feed(string? userId,string locale,long? before,bool unread=false,bool bannerOnly=false) {
        using var db=Open();using var c=db.CreateCommand();
        c.CommandText="""
        SELECT a.document,COALESCE(r.dismissed,0) FROM announcements a
        LEFT JOIN announcement_recipients r ON r.announcement_id=a.id AND r.user_id=$user
        WHERE a.seq<$before AND json_extract(a.document,'$.status')='published'
        AND (json_extract(a.document,'$.content.startsAt') IS NULL OR julianday(json_extract(a.document,'$.content.startsAt'))<=julianday('now'))
        AND (($user IS NULL AND json_extract(a.document,'$.content.placement')='login'
             AND (json_array_length(a.document,'$.content.languages')=0 OR $locale IN (SELECT value FROM json_each(a.document,'$.content.languages')))
             AND (json_extract(a.document,'$.content.endsAt') IS NULL OR julianday(json_extract(a.document,'$.content.endsAt'))>julianday('now')))
             OR ($user IS NOT NULL AND r.user_id IS NOT NULL AND json_extract(a.document,'$.content.placement') IN ('personal','banner')))
        AND ($banner=0 OR json_extract(a.document,'$.content.placement')='banner')
        AND ($unread=0 OR $banner=1 OR json_extract(a.document,'$.content.placement')!='banner')
        AND ($unread=0 OR (r.dismissed=0 AND (json_extract(a.document,'$.content.endsAt') IS NULL OR julianday(json_extract(a.document,'$.content.endsAt'))>julianday('now'))))
        ORDER BY a.seq DESC LIMIT 21;
        """;
        c.Parameters.AddWithValue("$user",(object?)userId??DBNull.Value);c.Parameters.AddWithValue("$before",before??long.MaxValue);c.Parameters.AddWithValue("$locale",locale);c.Parameters.AddWithValue("$unread",unread?1:0);c.Parameters.AddWithValue("$banner",bannerOnly?1:0);
        using var reader=c.ExecuteReader();var list=new List<AnnouncementItem>();while(reader.Read()) {var d=JsonSerializer.Deserialize(reader.GetString(0),AppJsonContext.Default.AnnouncementDocument)!;var dismissed=reader.GetInt32(1)==1;list.Add(new(d.Id,d.Sequence,d.Content.Title ?? (locale=="en-US"?d.Content.TitleEn:d.Content.TitleZh) ?? "",d.Content.Body ?? (locale=="en-US"?d.Content.BodyEn:d.Content.BodyZh) ?? "",d.CreatedAt,dismissed,d.Content.Placement!="banner" && !dismissed && (d.Content.EndsAt is null || DateTimeOffset.Parse(d.Content.EndsAt)>DateTimeOffset.UtcNow),d.Content.Placement=="banner"));}
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
