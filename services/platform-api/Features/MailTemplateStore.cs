using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Features;
internal sealed record SaveMailTemplate(string Revision, string Subject, string Introduction, bool Enabled, bool Reset = false);
internal sealed class MailTemplateStore(string connectionString)
{
    private SqliteConnection Open() { var c=new SqliteConnection(connectionString); c.Open(); return c; }
    public void Initialize() { using var c=Open(); using var q=c.CreateCommand(); q.CommandText="CREATE TABLE IF NOT EXISTS mail_templates(kind TEXT NOT NULL,locale TEXT NOT NULL,subject TEXT NOT NULL,introduction TEXT NOT NULL,enabled INTEGER NOT NULL,revision TEXT NOT NULL,PRIMARY KEY(kind,locale))";q.ExecuteNonQuery(); }
    public static bool Valid(string kind,string locale)=>new[]{"verify","reset","notice","security"}.Contains(kind)&&new[]{"zh-CN","en-US"}.Contains(locale);
    public MailTemplate Render(string kind,string locale,string? url=null,bool preview=false)
    {
        using var c=Open();using var q=c.CreateCommand();q.CommandText="SELECT subject,introduction,enabled,revision FROM mail_templates WHERE kind=$kind AND locale=$locale";q.Parameters.AddWithValue("$kind",kind);q.Parameters.AddWithValue("$locale",locale);
        using var r=q.ExecuteReader();return r.Read()?MailTemplates.Render(kind,locale,url,preview,r.GetString(0),r.GetString(1)) with {Enabled=kind!="notice"||r.GetBoolean(2),Revision=r.GetString(3)}:MailTemplates.Render(kind,locale,url,preview);
    }
    public MailTemplate[] Preview(string locale)=>new[]{"verify","reset","notice","security"}.Select(kind=>Render(kind,locale,kind=="security"?null:$"https://portal.example.test/{locale}/"+(kind=="notice"?"notifications":$"email-action#purpose={kind}&token=preview-only"),true)).ToArray();
    public static bool Validate(string kind,string locale,SaveMailTemplate input)
    {
        if(!Valid(kind,locale)||input.Revision is null||input.Subject is null||input.Introduction is null) return false;
        if(!input.Reset&&(string.IsNullOrWhiteSpace(input.Subject)||input.Subject.Length>160||input.Subject.Contains('\r')||input.Subject.Contains('\n')||string.IsNullOrWhiteSpace(input.Introduction)||input.Introduction.Length>4000||kind!="notice"&&!input.Enabled))return false;
        return true;
    }
    public static MailTemplate PreviewDraft(string kind,string locale,SaveMailTemplate input) =>
        MailTemplates.Render(kind,locale,kind=="security"?null:$"https://portal.example.test/{locale}/"+(kind=="notice"?"notifications":$"email-action#purpose={kind}&token=preview-only"),true,input.Subject.Trim(),input.Introduction.Trim()) with {Enabled=input.Enabled};
    public string? Save(string kind,string locale,SaveMailTemplate input)
    {
        if (!Validate(kind,locale,input)) return "invalid";
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="SELECT revision FROM mail_templates WHERE kind=$kind AND locale=$locale";q.Parameters.AddWithValue("$kind",kind);q.Parameters.AddWithValue("$locale",locale);
        if((q.ExecuteScalar() as string??"default")!=input.Revision)return "conflict";
        var defaults=MailTemplates.Preview(locale).Single(t=>t.Kind==kind);
        q.CommandText="INSERT INTO mail_templates VALUES($kind,$locale,$subject,$intro,$enabled,$revision) ON CONFLICT(kind,locale) DO UPDATE SET subject=excluded.subject,introduction=excluded.introduction,enabled=excluded.enabled,revision=excluded.revision";
        q.Parameters.AddWithValue("$subject",input.Reset?defaults.Subject:input.Subject.Trim());q.Parameters.AddWithValue("$intro",input.Reset?defaults.Introduction:input.Introduction.Trim());q.Parameters.AddWithValue("$enabled",input.Reset||input.Enabled);q.Parameters.AddWithValue("$revision",Guid.NewGuid().ToString("N"));q.ExecuteNonQuery();tx.Commit();return null;
    }
}
