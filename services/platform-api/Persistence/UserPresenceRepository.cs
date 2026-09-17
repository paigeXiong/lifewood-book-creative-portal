using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class UserPresenceRepository(string connectionString, TimeProvider? clock = null)
{
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private long nextCleanup;
    private long Now => time.GetUtcNow().ToUnixTimeSeconds();
    public void Initialize()
    {
        using var c = Open();
        using var q = c.CreateCommand();
        q.CommandText = """
            CREATE TABLE IF NOT EXISTS user_activity(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, last_login INTEGER NULL, last_active INTEGER NULL);
            CREATE TABLE IF NOT EXISTS user_presence(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_id TEXT NOT NULL, tab_id TEXT NOT NULL, session_version INTEGER NOT NULL, visible INTEGER NOT NULL, last_seen INTEGER NOT NULL, last_active INTEGER NULL, PRIMARY KEY(user_id,session_id,tab_id));
            CREATE TABLE IF NOT EXISTS presence_session_activity(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL,session_version INTEGER NOT NULL,last_active INTEGER NOT NULL,PRIMARY KEY(user_id,session_id));
            CREATE TABLE IF NOT EXISTS ended_presence_sessions(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL,ended_at INTEGER NOT NULL,PRIMARY KEY(user_id,session_id));
            CREATE INDEX IF NOT EXISTS ix_presence_seen ON user_presence(last_seen);
            CREATE TABLE IF NOT EXISTS user_activity_daily(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL, logins INTEGER NOT NULL DEFAULT 0, active_periods INTEGER NOT NULL DEFAULT 0, last_slot INTEGER NOT NULL DEFAULT -1, PRIMARY KEY(user_id,day));
            DELETE FROM user_activity_daily WHERE user_id IN (SELECT id FROM users WHERE closed_at IS NOT NULL);
            CREATE TABLE IF NOT EXISTS activity_collection(id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL);
            INSERT OR IGNORE INTO activity_collection(id,started_at) VALUES(1,$now);
            DELETE FROM user_presence;
            """;
        q.Parameters.AddWithValue("$now", Now); q.ExecuteNonQuery();
    }
    public bool Heartbeat(string userId, string sessionId, int version, PresenceHeartbeatRequest input)
    {
        var now = Now;
        using var c = Open(); using var tx = c.BeginTransaction();
        if (now >= Interlocked.Read(ref nextCleanup))
        {
            using var clean = Command(c, "DELETE FROM user_presence WHERE last_seen<$old; DELETE FROM presence_session_activity WHERE last_active<$idle; DELETE FROM ended_presence_sessions WHERE ended_at<$expired;", ("$old", now-120),("$idle",now-300),("$expired",now-31L*86400));
            clean.Transaction=tx; clean.ExecuteNonQuery(); Interlocked.Exchange(ref nextCleanup, now+60);
        }
        using var q = Command(c, """
            INSERT INTO user_presence(user_id,session_id,tab_id,session_version,visible,last_seen,last_active)
            SELECT $user,$session,$tab,$version,$visible,$now,CASE WHEN $active=1 THEN $now ELSE (SELECT last_active FROM presence_session_activity WHERE user_id=$user AND session_id=$session AND session_version=$version AND last_active>=$now-300) END
            WHERE EXISTS(SELECT 1 FROM users WHERE id=$user AND is_active=1 AND session_version=$version)
              AND NOT EXISTS(SELECT 1 FROM ended_presence_sessions WHERE user_id=$user AND session_id=$session)
              AND ((SELECT COUNT(*) FROM user_presence WHERE user_id=$user)<64 OR EXISTS(SELECT 1 FROM user_presence WHERE user_id=$user AND session_id=$session AND tab_id=$tab))
            ON CONFLICT(user_id,session_id,tab_id) DO UPDATE SET session_version=$version,visible=$visible,last_seen=$now,last_active=CASE WHEN $active=1 THEN $now WHEN user_presence.session_version=$version THEN user_presence.last_active ELSE excluded.last_active END;
            """, ("$user",userId),("$session",sessionId),("$tab",input.TabId),("$version",version),("$visible",input.Visible?1:0),("$active",input.Interacted&&input.Visible?1:0),("$now",now));
        q.Transaction=tx;
        if(q.ExecuteNonQuery()==0)return false;
        if(input.Interacted&&input.Visible)
        {
            // Retain genuine activity across page reloads without creating a new activity time.
            using var sessionActivity=Command(c,"INSERT INTO presence_session_activity(user_id,session_id,session_version,last_active) VALUES($user,$session,$version,$now) ON CONFLICT(user_id,session_id) DO UPDATE SET session_version=$version,last_active=$now",("$user",userId),("$session",sessionId),("$version",version),("$now",now));
            sessionActivity.Transaction=tx;sessionActivity.ExecuteNonQuery();
            using var activity=Command(c,"INSERT INTO user_activity(user_id,last_active) VALUES($user,$now) ON CONFLICT(user_id) DO UPDATE SET last_active=$now WHERE last_active IS NULL OR last_active<=$now-20",("$user",userId),("$now",now));
            activity.Transaction=tx;activity.ExecuteNonQuery();
            using var daily=Command(c,"INSERT INTO user_activity_daily(user_id,day,active_periods,last_slot) VALUES($user,$day,1,$slot) ON CONFLICT(user_id,day) DO UPDATE SET active_periods=active_periods+CASE WHEN $slot>last_slot THEN 1 ELSE 0 END,last_slot=MAX(last_slot,$slot)",("$user",userId),("$day",ActivityDay(now)),("$slot",now/900));
            daily.Transaction=tx;daily.ExecuteNonQuery();
        }
        tx.Commit(); return true;
    }
    public void Login(string userId)
    {
        var now=Now;
        using var c=Open();using var tx=c.BeginTransaction();
        using var q=Command(c,"INSERT INTO user_activity(user_id,last_login) SELECT $user,$now WHERE EXISTS(SELECT 1 FROM users WHERE id=$user AND is_active=1 AND closed_at IS NULL) ON CONFLICT(user_id) DO UPDATE SET last_login=$now",("$user",userId),("$now",now));
        q.Transaction=tx;
        if(q.ExecuteNonQuery()>0){
            using var daily=Command(c,"INSERT INTO user_activity_daily(user_id,day,logins) VALUES($user,$day,1) ON CONFLICT(user_id,day) DO UPDATE SET logins=logins+1",("$user",userId),("$day",ActivityDay(now)));
            daily.Transaction=tx;daily.ExecuteNonQuery();
        }
        tx.Commit();
    }
    private static string ActivityDay(long timestamp)=>DateTimeOffset.FromUnixTimeSeconds(timestamp).ToOffset(TimeSpan.FromHours(8)).ToString("yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
    internal static MemberActivityCalendar ReadCalendar(SqliteConnection db, SqliteTransaction tx, string id, long now)
    {
        var today=DateOnly.ParseExact(ActivityDay(now),"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);
        var start=new DateOnly(today.Year,today.Month,1).AddMonths(-2);
        using var coverage=Command(db,"SELECT started_at FROM activity_collection WHERE id=1");coverage.Transaction=tx;
        var tracked=ActivityDay(Convert.ToInt64(coverage.ExecuteScalar()));
        using var command=Command(db,"SELECT day,logins,active_periods FROM user_activity_daily WHERE user_id=$id AND day >= $start AND day <= $end",("$id",id),("$start",start.ToString("yyyy-MM-dd")),("$end",today.ToString("yyyy-MM-dd")));command.Transaction=tx;
        var stored=new Dictionary<string,(int Logins,int Periods)>();
        using(var reader=command.ExecuteReader())while(reader.Read())stored[reader.GetString(0)]=(reader.GetInt32(1),reader.GetInt32(2));
        var days=new List<MemberActivityDay>();
        for(var day=start;day<=today;day=day.AddDays(1)){
            var date=day.ToString("yyyy-MM-dd");stored.TryGetValue(date,out var data);
            days.Add(new(date,string.CompareOrdinal(date,tracked)>=0,data.Logins,data.Periods));
        }
        return new(tracked,days.ToArray());
    }
    public void EndSession(string userId,string sessionId)
    {
        using var c=Open();using var tx=c.BeginTransaction();
        using var q=Command(c,"INSERT INTO ended_presence_sessions(user_id,session_id,ended_at) SELECT $user,$session,$now WHERE EXISTS(SELECT 1 FROM users WHERE id=$user AND closed_at IS NULL) ON CONFLICT(user_id,session_id) DO UPDATE SET ended_at=$now; DELETE FROM user_presence WHERE user_id=$user AND session_id=$session; DELETE FROM presence_session_activity WHERE user_id=$user AND session_id=$session",("$user",userId),("$session",sessionId),("$now",Now));q.Transaction=tx;q.ExecuteNonQuery();tx.Commit();
    }
    public void LeaveTab(string userId,string sessionId,string tabId)
    {
        using var c=Open();using var q=Command(c,"DELETE FROM user_presence WHERE user_id=$user AND session_id=$session AND tab_id=$tab",("$user",userId),("$session",sessionId),("$tab",tabId));q.ExecuteNonQuery();
    }
    private const string Source = """
        WITH directory AS (
          SELECT u.*, o.name AS organization_name, a.last_login, a.last_active,
          CASE WHEN u.is_active=0 THEN 'offline'
          WHEN EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=u.id AND p.session_version=u.session_version AND p.last_seen>=$now-120 AND p.visible=1 AND p.last_active>=$now-300) THEN 'online'
          WHEN EXISTS(SELECT 1 FROM user_presence p WHERE p.user_id=u.id AND p.session_version=u.session_version AND p.last_seen>=$now-120) THEN 'away'
          ELSE 'offline' END AS presence_status
          FROM users u LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN user_activity a ON a.user_id=u.id WHERE u.closed_at IS NULL
        )
        """;
    private const string Where = """
        WHERE ($search='' OR display_name LIKE '%'||$search||'%' OR email LIKE '%'||$search||'%' OR phone LIKE '%'||$search||'%' OR organization_name LIKE '%'||$search||'%')
          AND ($assignable=0 OR (is_active=1 AND role IN ('owner','admin','operator')))
          AND ($role='' OR role=$role) AND ($presence='' OR presence_status=$presence)
          AND ($organization='' OR ($organization='unassigned' AND organization_id IS NULL) OR organization_id=$organization)
          AND ($enabled='' OR is_active=CASE WHEN $enabled='enabled' THEN 1 ELSE 0 END)
        """;
    public PagedAdminUsersDto List(string? search,string? role,string? presence,string? organization,string? enabled,int page,int pageSize,DateTimeOffset todayStart,bool assignableOnly=false)
    {
        using var c=Open();using var tx=c.BeginTransaction();var now=Now;
        SqliteCommand Query(string sql)
        {
            var q=Command(c,Source+sql,("$now",now),("$assignable",assignableOnly?1:0),("$search",search??""),("$role",role??""),("$presence",presence??""),("$organization",organization??""),("$enabled",enabled??""));q.Transaction=tx;return q;
        }
        int total;UserPresenceStatsDto stats;
        using(var q=Query("SELECT COUNT(*),COALESCE(SUM(presence_status='online'),0),COALESCE(SUM(last_active>=$today),0),COALESCE(SUM(is_active=1),0),COALESCE(SUM(organization_id IS NULL),0) FROM directory "+Where))
        {
            q.Parameters.AddWithValue("$today",todayStart.ToUnixTimeSeconds());using var r=q.ExecuteReader();r.Read();total=r.GetInt32(0);stats=new(r.GetInt32(1),r.GetInt32(2),r.GetInt32(3),r.GetInt32(4));
        }
        var items=new List<AdminUserDto>();
        using(var q=Query("SELECT id,email,display_name,role,is_active,organization_id,organization_name,created_at,updated_at,phone,presence_status,last_active,last_login FROM directory "+Where+" ORDER BY CASE presence_status WHEN 'online' THEN 0 WHEN 'away' THEN 1 ELSE 2 END,last_active DESC,created_at DESC,id LIMIT $size OFFSET $offset"))
        {
            q.Parameters.AddWithValue("$size",pageSize);q.Parameters.AddWithValue("$offset",(long)(page-1)*pageSize);using var r=q.ExecuteReader();while(r.Read())items.Add(Read(r));
        }
        tx.Commit();return new([..items],page,pageSize,total,stats);
    }
    public AdminUserDetailsDto? Details(string id)
    {
        using var c=Open();using var tx=c.BeginTransaction();AdminUserDto user;
        using(var q=Command(c,Source+"SELECT id,email,display_name,role,is_active,organization_id,organization_name,created_at,updated_at,phone,presence_status,last_active,last_login FROM directory WHERE id=$id",("$now",Now),("$id",id)))
        {q.Transaction=tx;using var r=q.ExecuteReader();if(!r.Read())return null;user=Read(r);}
        using var count=Command(c,"""
            SELECT COALESCE(SUM(owner_id=$id),0),COALESCE(SUM((owner_id=$id AND workflow_status='awaiting_customer') OR (assignee_user_id=$id AND workflow_status IN ('new','contacting'))),0)
            FROM projects p WHERE status='submitted' OR EXISTS(SELECT 1 FROM revision_rounds r WHERE r.project_id=p.id)
            """,("$id",id));count.Transaction=tx;
        using var counts=count.ExecuteReader();counts.Read();var result=new AdminUserDetailsDto(user,counts.GetInt32(0),counts.GetInt32(1));counts.Close();tx.Commit();return result;
    }
    internal static UserPresenceDto? ReadPresence(SqliteConnection connection, SqliteTransaction transaction, string id, long now)
    {
        using var command = Command(connection, Source + "SELECT presence_status,last_active,last_login FROM directory WHERE id=$id", ("$now", now), ("$id", id));
        command.Transaction = transaction;
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(reader.GetString(0), Date(reader, 1), Date(reader, 2)) : null;
    }
    private static AdminUserDto Read(SqliteDataReader r)=>new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetInt32(4)==1,r.IsDBNull(5)||r.IsDBNull(6)?null:new(r.GetString(5),r.GetString(6)),DateTimeOffset.Parse(r.GetString(7)),DateTimeOffset.Parse(r.GetString(8)),r.IsDBNull(9)?null:r.GetString(9),new(r.GetString(10),Date(r,11),Date(r,12)));
    private static DateTimeOffset? Date(SqliteDataReader r,int index)=>r.IsDBNull(index)?null:DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(index));
    private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();using var q=c.CreateCommand();q.CommandText="PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;";q.ExecuteNonQuery();return c;}
    private static SqliteCommand Command(SqliteConnection c,string sql,params (string,object)[] parameters){var q=c.CreateCommand();q.CommandText=sql;foreach(var (key,value) in parameters)q.Parameters.AddWithValue(key,value);return q;}
}
