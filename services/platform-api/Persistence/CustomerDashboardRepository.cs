using System.Globalization;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

// Current ownership is applied at read time, including to all historical events.
internal sealed class CustomerDashboardRepository(string connectionString)
{
    public void Initialize()
    {
        using var db = Open(); using var tx = db.BeginTransaction();
        using var cmd = db.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS customer_activity_coverage(id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL);
            INSERT OR IGNORE INTO customer_activity_coverage VALUES(1,$now);
            CREATE TABLE IF NOT EXISTS customer_first_submissions(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, occurred_at TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS customer_first_submission AFTER UPDATE OF status ON projects
            WHEN OLD.status='draft' AND NEW.status='submitted' AND OLD.task_number IS NULL
            BEGIN INSERT OR IGNORE INTO customer_first_submissions VALUES(NEW.id,NEW.updated_at); END;
            CREATE TRIGGER IF NOT EXISTS customer_submission_cleanup AFTER DELETE ON projects
            BEGIN DELETE FROM customer_first_submissions WHERE project_id=OLD.id; END;
            CREATE INDEX IF NOT EXISTS ix_revision_submitted_activity ON revision_rounds(project_id,submitted_at) WHERE submitted_at IS NOT NULL;
            CREATE VIEW IF NOT EXISTS customer_activity_events AS
                SELECT 'submission:'||project_id AS id,project_id,'submission' AS kind,occurred_at FROM customer_first_submissions
                UNION ALL SELECT 'resubmission:'||id,project_id,'resubmission',submitted_at FROM revision_rounds WHERE submitted_at IS NOT NULL
                UNION ALL SELECT 'delivery:'||id,project_id,'delivery',published_at FROM project_deliveries;
            """;
        cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O")); cmd.ExecuteNonQuery(); tx.Commit();
    }

    internal static DateTimeOffset DayStart(DateTime day, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(day.Date, DateTimeKind.Unspecified);
        // Some zones advance at midnight or skip a whole calendar day.
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(1);
        var offset = zone.IsAmbiguousTime(local) ? zone.GetAmbiguousTimeOffsets(local).Max() : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    public CustomerDashboardDto Get(string ownerId, DateTime month, TimeZoneInfo zone, int selectedDay, int page)
    {
        const int pageSize = 20;
        var now = DateTimeOffset.UtcNow;
        using var db = Open(); using var tx = db.BeginTransaction(deferred: true);
        SqliteCommand Query(string sql)
        {
            var cmd = db.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("$owner", ownerId); return cmd;
        }
        string coverage;
        using (var cmd = Query("SELECT started_at FROM customer_activity_coverage WHERE id=1")) coverage = (string)cmd.ExecuteScalar()!;
        DashboardCounts counts;
        using (var cmd = Query("""
            SELECT COUNT(*),COALESCE(SUM(status='draft' AND workflow_status='awaiting_customer'),0),
              COALESCE(SUM(status='submitted' AND workflow_status NOT IN ('completed','closed')),0),
              COALESCE(SUM(EXISTS(SELECT 1 FROM project_deliveries d WHERE d.project_id=p.id AND d.revoked_at IS NULL)),0)
            FROM projects p WHERE owner_id=$owner
            """))
        { using var r = cmd.ExecuteReader(); r.Read(); counts = new(r.GetInt32(0),r.GetInt32(1),r.GetInt32(2),r.GetInt32(3)); }
        var statuses = new List<DashboardStatus>();
        using (var cmd = Query("""
            SELECT CASE WHEN status='draft' AND workflow_status!='awaiting_customer' THEN 'draft' ELSE workflow_status END AS state,COUNT(*)
            FROM projects WHERE owner_id=$owner GROUP BY state ORDER BY COUNT(*) DESC,state
            """))
        { using var r = cmd.ExecuteReader(); while(r.Read()) statuses.Add(new(r.GetString(0),r.GetInt32(1))); }

        // Day boundaries are UTC instants computed for the requested IANA time zone, including DST.
        var days = new List<DashboardDay>();
        var values = new List<string>();
        using (var cmd = Query(""))
        {
            for (var day=1; day<=DateTime.DaysInMonth(month.Year,month.Month); day++)
            {
                var date=month.AddDays(day-1); values.Add($"($date{day},$from{day},$to{day})");
                cmd.Parameters.AddWithValue($"$date{day}",date.ToString("yyyy-MM-dd",CultureInfo.InvariantCulture));
                cmd.Parameters.AddWithValue($"$from{day}",DayStart(date,zone).ToString("O"));
                cmd.Parameters.AddWithValue($"$to{day}",DayStart(date.AddDays(1),zone).ToString("O"));
            }
            cmd.CommandText = $"""
                WITH days(date,start,finish) AS (VALUES {string.Join(",",values)}),
                owned AS (SELECT e.* FROM customer_activity_events e JOIN projects p ON p.id=e.project_id WHERE p.owner_id=$owner AND e.occurred_at>=$monthStart AND e.occurred_at<$monthEnd)
                SELECT days.date,COALESCE(SUM(e.kind='submission'),0),COALESCE(SUM(e.kind='resubmission'),0),
                  COALESCE(SUM(e.kind='delivery'),0),COUNT(DISTINCT e.project_id)
                FROM days LEFT JOIN owned e ON e.occurred_at>=days.start AND e.occurred_at<days.finish AND e.occurred_at<=$now
                GROUP BY days.date ORDER BY days.date
                """;
            cmd.Parameters.AddWithValue("$monthStart",DayStart(month,zone).ToString("O"));
            cmd.Parameters.AddWithValue("$monthEnd",DayStart(month.AddMonths(1),zone).ToString("O"));
            cmd.Parameters.AddWithValue("$now",now.ToString("O"));
            using var r=cmd.ExecuteReader(); while(r.Read()) days.Add(new(r.GetString(0),r.GetInt32(1),r.GetInt32(2),r.GetInt32(3),r.GetInt32(4)));
        }
        var selected=month.AddDays(selectedDay-1);
        var from=DayStart(selected,zone).ToString("O"); var to=DayStart(selected.AddDays(1),zone).ToString("O");
        const string scope="FROM customer_activity_events e JOIN projects p ON p.id=e.project_id WHERE p.owner_id=$owner AND e.occurred_at>=$from AND e.occurred_at<$to AND e.occurred_at<=$now";
        void Range(SqliteCommand cmd) {cmd.Parameters.AddWithValue("$from",from);cmd.Parameters.AddWithValue("$to",to);cmd.Parameters.AddWithValue("$now",now.ToString("O"));}
        int total;
        using(var cmd=Query("SELECT COUNT(*) "+scope)){Range(cmd);total=Convert.ToInt32(cmd.ExecuteScalar());}
        page=Math.Clamp(page,1,Math.Max(1,(total+pageSize-1)/pageSize));
        const string columns="p.id,COALESCE(json_extract(p.project_json,'$.projectName'),''),COALESCE(json_extract(p.book_json,'$.title'),''),p.task_number,p.status,p.workflow_status,p.updated_at";
        var events=new List<DashboardActivity>();
        using(var cmd=Query("SELECT e.id,e.kind,e.occurred_at,"+columns+" "+scope+" ORDER BY e.occurred_at DESC,e.id LIMIT $limit OFFSET $offset"))
        {
            Range(cmd);cmd.Parameters.AddWithValue("$limit",pageSize);cmd.Parameters.AddWithValue("$offset",(page-1)*pageSize);
            using var r=cmd.ExecuteReader();while(r.Read())events.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),ReadProject(r,3)));
        }
        var recent=new List<DashboardProject>();
        using(var cmd=Query("SELECT "+columns+" FROM projects p WHERE owner_id=$owner ORDER BY updated_at DESC,id LIMIT 5"))
        {using var r=cmd.ExecuteReader();while(r.Read())recent.Add(ReadProject(r,0));}
        tx.Commit();
        return new(month.ToString("yyyy-MM",CultureInfo.InvariantCulture),zone.Id,coverage,now.ToString("O"),counts,[..statuses],[..days],new([..events],total,page,pageSize),[..recent]);
    }
    private static DashboardProject ReadProject(SqliteDataReader r,int i)=>new(r.GetString(i),r.GetString(i+1),r.GetString(i+2),r.IsDBNull(i+3)?null:r.GetString(i+3),r.GetString(i+4),r.GetString(i+5),r.GetString(i+6));
    private SqliteConnection Open(){var db=new SqliteConnection(connectionString);db.Open();return db;}
}
