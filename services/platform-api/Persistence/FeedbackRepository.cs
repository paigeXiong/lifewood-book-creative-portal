using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed class FeedbackRepository(string connectionString)
{
    public const int ScreenshotMaxBytes = 1_000_000;
    public const int ScreenshotSourceMaxBytes = 10_000_000;
    public static readonly string[] Categories = ["bug", "suggestion", "other"];
    public static readonly string[] Statuses = ["pending", "processing", "resolved"];
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    private static SqliteCommand Cmd(SqliteConnection c, string sql, params (string, object?)[] args) {
        var q = c.CreateCommand(); q.CommandText = sql;
        foreach (var (k,v) in args) q.Parameters.AddWithValue(k,v??DBNull.Value);
        return q;
    }
    public void Initialize() {
        using var c = Open(); using var q = Cmd(c,"""
        CREATE TABLE IF NOT EXISTS platform_feedback (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL,
          page_path TEXT NOT NULL, screenshot BLOB, screenshot_type TEXT,
          status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE INDEX IF NOT EXISTS ix_feedback_created ON platform_feedback(created_at DESC,id);
        CREATE INDEX IF NOT EXISTS ix_feedback_user ON platform_feedback(user_id,created_at);
        CREATE TABLE IF NOT EXISTS feedback_responses (
          id TEXT PRIMARY KEY, feedback_id TEXT NOT NULL, actor_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE INDEX IF NOT EXISTS ix_feedback_responses ON feedback_responses(feedback_id,created_at);
        """); q.ExecuteNonQuery();
    }
    // A stable client id makes a retry after a lost response safe. Different payloads never overwrite an existing submission.
    public string Create(string user, CreateFeedbackRequest input, byte[]? screenshot) {
        using var c = Open(); using var tx = c.BeginTransaction(deferred:false);
        using var q = Cmd(c,"SELECT user_id,category,description,page_path,screenshot,screenshot_type FROM platform_feedback WHERE id=$id",("$id",input.Id)); q.Transaction=tx;
        using (var r=q.ExecuteReader()) if(r.Read()) return r.GetString(0)==user && r.GetString(1)==input.Category && r.GetString(2)==input.Description.Trim() && r.GetString(3)==input.PagePath && (r.IsDBNull(4)?screenshot is null:screenshot is not null && ((byte[])r[4]).AsSpan().SequenceEqual(screenshot)) && (r.IsDBNull(5)?null:r.GetString(5))==input.ScreenshotType ? "ok" : "conflict";
        q.CommandText="SELECT COUNT(*) FROM users WHERE id=$u AND is_active=1 AND closed_at IS NULL"; q.Parameters.AddWithValue("$u",user);
        if(Convert.ToInt32(q.ExecuteScalar())!=1) return "forbidden";
        q.CommandText="SELECT COUNT(*) FROM platform_feedback WHERE user_id=$u AND julianday(created_at)>julianday('now')-1";
        if(Convert.ToInt32(q.ExecuteScalar())>=20) return "limited";
        q.CommandText="SELECT COUNT(*) FROM platform_feedback WHERE user_id=$u AND julianday(created_at)>julianday('now')-1.0/24";
        if(Convert.ToInt32(q.ExecuteScalar())>=5) return "limited";
        q.CommandText="INSERT INTO platform_feedback(id,user_id,category,description,page_path,screenshot,screenshot_type) VALUES($id,$u,$category,$description,$path,$image,$type)";
        q.Parameters.AddWithValue("$category",input.Category); q.Parameters.AddWithValue("$description",input.Description.Trim()); q.Parameters.AddWithValue("$path",input.PagePath);
        q.Parameters.AddWithValue("$image",(object?)screenshot??DBNull.Value); q.Parameters.AddWithValue("$type",(object?)input.ScreenshotType??DBNull.Value);
        q.ExecuteNonQuery(); tx.Commit(); return "ok";
    }
    private const string Columns="f.id,f.category,f.description,f.page_path,f.status,f.created_at,f.updated_at,f.version,CASE WHEN u.closed_at IS NULL THEN COALESCE(u.display_name,'') ELSE '' END,CASE WHEN u.closed_at IS NULL THEN u.email ELSE NULL END,f.screenshot IS NOT NULL";
    private static FeedbackItem Read(SqliteDataReader r)=>new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),r.GetString(5),r.GetString(6),r.GetInt32(7),r.GetString(8),r.IsDBNull(9)?null:r.GetString(9),r.GetBoolean(10));
    public FeedbackPage List(int page,string? search,string? status) {
        page=Math.Clamp(page,1,100000); search=(search??"").Trim(); if(search.Length>160)search=search[..160];
        using var c=Open(); using var tx=c.BeginTransaction();
        const string where=" FROM platform_feedback f LEFT JOIN users u ON u.id=f.user_id WHERE ($status='' OR f.status=$status) AND ($q='' OR instr(lower(f.description),lower($q))>0 OR (u.closed_at IS NULL AND (instr(lower(u.display_name),lower($q))>0 OR instr(lower(u.email),lower($q))>0)))";
        using var q=Cmd(c,"SELECT COUNT(*)"+where,("$q",search),("$status",status??""));q.Transaction=tx;
        var total=Convert.ToInt32(q.ExecuteScalar());q.CommandText="SELECT "+Columns+where+" ORDER BY f.created_at DESC,f.id LIMIT 20 OFFSET $offset";q.Parameters.AddWithValue("$offset",(page-1)*20);
        using var r=q.ExecuteReader();var list=new List<FeedbackItem>();while(r.Read())list.Add(Read(r));return new([..list],total,page,20);
    }
    public FeedbackDetail? Detail(string id) {
        using var c=Open();using var tx=c.BeginTransaction();using var q=Cmd(c,"SELECT "+Columns+" FROM platform_feedback f LEFT JOIN users u ON u.id=f.user_id WHERE f.id=$id",("$id",id));q.Transaction=tx;
        FeedbackItem item;using(var r=q.ExecuteReader()){if(!r.Read())return null;item=Read(r);}
        q.CommandText="SELECT r.body,r.status,r.created_at,CASE WHEN u.closed_at IS NULL THEN COALESCE(u.display_name,'') ELSE '' END FROM feedback_responses r LEFT JOIN users u ON u.id=r.actor_id WHERE r.feedback_id=$id ORDER BY r.created_at DESC LIMIT 50";
        using var responses=q.ExecuteReader();var list=new List<FeedbackResponse>();while(responses.Read())list.Add(new(responses.GetString(0),responses.GetString(1),responses.GetString(2),responses.GetString(3)));return new(item,[..list]);
    }
    // Reply and notification event are committed together; version checks prevent duplicate notification delivery on retries.
    public bool Update(string id,string actor,UpdateFeedbackRequest input) {
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);
        using var q=Cmd(c,"UPDATE platform_feedback SET status=$status,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=$id AND version=$version",("$id",id),("$version",input.Version),("$status",input.Status));q.Transaction=tx;
        if(q.ExecuteNonQuery()!=1)return false;
        if(!string.IsNullOrWhiteSpace(input.Reply)) {
            var responseId=Guid.NewGuid().ToString("N");
            q.CommandText="INSERT INTO feedback_responses(id,feedback_id,actor_id,body,status) VALUES($response,$id,$actor,$body,$status)";
            q.Parameters.AddWithValue("$response",responseId);q.Parameters.AddWithValue("$actor",actor);q.Parameters.AddWithValue("$body",input.Reply.Trim());q.ExecuteNonQuery();
            NotificationRepository.Capture(c,tx,"feedback:"+responseId,"feedback_reply","",actor,responseId);
        }
        tx.Commit();return true;
    }
    public (byte[] Data,string Type)? Screenshot(string id) {
        using var c=Open();using var q=Cmd(c,"SELECT screenshot,screenshot_type FROM platform_feedback WHERE id=$id AND screenshot IS NOT NULL",("$id",id));using var r=q.ExecuteReader();return r.Read()?((byte[])r[0],r.GetString(1)):null;
    }
    public FeedbackNotice? Notice(string user,long notificationId) {
        using var c=Open();using var q=Cmd(c,"""
        SELECT f.description,r.body,r.status FROM notifications n JOIN notification_events e ON e.id=n.event_id AND e.kind='feedback_reply'
        JOIN feedback_responses r ON r.id=e.target_id JOIN platform_feedback f ON f.id=r.feedback_id
        JOIN users u ON u.id=$u AND u.is_active=1 AND u.closed_at IS NULL
        WHERE n.id=$id AND n.user_id=$u AND f.user_id=$u
        """,("$id",notificationId),("$u",user));using var r=q.ExecuteReader();return r.Read()?new(r.GetString(0),r.GetString(1),r.GetString(2)):null;
    }
}
