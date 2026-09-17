using System.Globalization;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class AdminAnalyticsRepository(string connectionString)
{
    // Completion timestamps are immutable. WorkflowUpdatedAt also changes on notes/assignment.
    public void Initialize()
    {
        using var db = Open(); using var tx = db.BeginTransaction();
        using var cmd = db.CreateCommand(); cmd.Transaction = tx;
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS admin_analytics_coverage(id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT NOT NULL);
            INSERT OR IGNORE INTO admin_analytics_coverage VALUES(1,$now);
            CREATE TABLE IF NOT EXISTS admin_project_completions(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, occurred_at TEXT NULL);
            INSERT OR IGNORE INTO admin_project_completions SELECT id,NULL FROM projects WHERE workflow_status='completed';
            CREATE TRIGGER IF NOT EXISTS admin_completion_capture AFTER UPDATE OF workflow_status ON projects
            WHEN NEW.workflow_status='completed' AND OLD.workflow_status!='completed' AND NEW.status='submitted'
            BEGIN INSERT OR IGNORE INTO admin_project_completions VALUES(NEW.id,NEW.workflow_updated_at); END;
            CREATE TRIGGER IF NOT EXISTS admin_completion_cleanup AFTER DELETE ON projects
            BEGIN DELETE FROM admin_project_completions WHERE project_id=OLD.id; END;
            CREATE INDEX IF NOT EXISTS ix_admin_completion_time ON admin_project_completions(julianday(occurred_at));
            CREATE INDEX IF NOT EXISTS ix_customer_first_submission_time ON customer_first_submissions(julianday(occurred_at));
            """;
        cmd.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O")); cmd.ExecuteNonQuery(); tx.Commit();
    }

    public AdminAnalyticsDto Get(int days, TimeZoneInfo zone, DateTimeOffset? time = null)
    {
        if (days is not (7 or 30 or 90)) throw new ArgumentOutOfRangeException(nameof(days));
        var now = time ?? DateTimeOffset.UtcNow;
        var today = TimeZoneInfo.ConvertTime(now, zone).Date;
        var firstDay = today.AddDays(1 - days);
        var from = CustomerDashboardRepository.DayStart(firstDay, zone);
        using var db = Open(); using var tx = db.BeginTransaction(deferred: true);
        SqliteCommand Query(string sql)
        {
            var cmd = db.CreateCommand(); cmd.Transaction = tx; cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("$from", from.ToString("O"));
            cmd.Parameters.AddWithValue("$now", now.ToString("O")); return cmd;
        }
        DateTimeOffset coverage;
        using (var cmd = Query("SELECT started_at FROM admin_analytics_coverage WHERE id=1")) coverage = DateTimeOffset.Parse((string)cmd.ExecuteScalar()!, CultureInfo.InvariantCulture);
        var trend = new List<AdminAnalyticsDay>();
        using (var cmd = Query("""
            SELECT
            (SELECT COUNT(*) FROM customer_first_submissions WHERE julianday(occurred_at)>=julianday($start) AND julianday(occurred_at)<julianday($end) AND julianday(occurred_at)<=julianday($now)),
            (SELECT COUNT(*) FROM admin_project_completions WHERE julianday(occurred_at)>=julianday($start) AND julianday(occurred_at)<julianday($end) AND julianday(occurred_at)<=julianday($now))
            """))
        {
            var start = cmd.Parameters.Add("$start", SqliteType.Text); var end = cmd.Parameters.Add("$end", SqliteType.Text);
            for (var i = 0; i < days; i++)
            {
                var date = firstDay.AddDays(i);
                start.Value = CustomerDashboardRepository.DayStart(date, zone).ToString("O");
                end.Value = CustomerDashboardRepository.DayStart(date.AddDays(1), zone).ToString("O");
                using var reader = cmd.ExecuteReader(); reader.Read();
                trend.Add(new(date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), reader.GetInt32(0), reader.GetInt32(1)));
            }
        }
        int samples; double? average; double? median;
        using (var cmd = Query("""
            WITH durations AS (
              SELECT julianday(c.occurred_at)-julianday(s.occurred_at) AS duration
              FROM admin_project_completions c JOIN customer_first_submissions s ON s.project_id=c.project_id
              WHERE julianday(c.occurred_at)>=julianday($from) AND julianday(c.occurred_at)<=julianday($now)
              AND julianday(s.occurred_at)<=julianday(c.occurred_at)
            ), ranked AS (SELECT duration,ROW_NUMBER() OVER(ORDER BY duration) AS position,COUNT(*) OVER() AS total FROM durations)
            SELECT COUNT(*),AVG(duration),(SELECT AVG(duration) FROM ranked WHERE position IN ((total+1)/2,(total+2)/2)) FROM durations
            """))
        {
            using var reader = cmd.ExecuteReader(); reader.Read(); samples = reader.GetInt32(0);
            average = reader.IsDBNull(1) ? null : reader.GetDouble(1); median = reader.IsDBNull(2) ? null : reader.GetDouble(2);
        }
        int untracked;
        using (var cmd = Query("SELECT COUNT(*) FROM projects p LEFT JOIN admin_project_completions c ON c.project_id=p.id WHERE p.workflow_status='completed' AND c.occurred_at IS NULL")) untracked = Convert.ToInt32(cmd.ExecuteScalar());
        var queues = new List<AdminCountDto>(); var aging = new List<AdminCountDto>();
        using (var cmd = Query("""
            WITH active AS (
              SELECT p.*,julianday($now)-julianday(s.occurred_at) AS age
              FROM projects p JOIN users u ON u.id=p.owner_id LEFT JOIN customer_first_submissions s ON s.project_id=p.id
              WHERE (p.status='submitted' OR EXISTS(SELECT 1 FROM revision_rounds r WHERE r.project_id=p.id)) AND p.workflow_status NOT IN ('completed','closed')
            )
            SELECT COUNT(*),COALESCE(SUM(workflow_status='awaiting_customer'),0),COALESCE(SUM(assignee_user_id IS NULL),0),COALESCE(SUM(julianday(followup_due_at)<=julianday($now)),0),
              COALESCE(SUM(age>=0 AND age<=7),0),COALESCE(SUM(age>7 AND age<=14),0),COALESCE(SUM(age>14 AND age<=30),0),COALESCE(SUM(age>30),0),COALESCE(SUM(age IS NULL OR age<0),0)
            FROM active
            """))
        {
            using var reader = cmd.ExecuteReader(); reader.Read();
            var queueIds = new[] { "active", "waiting_customer", "unassigned", "overdue" };
            for (var i = 0; i < queueIds.Length; i++) queues.Add(new(queueIds[i], reader.GetInt32(i)));
            var ageIds = new[] { "week", "fortnight", "month", "older", "unknown" };
            for (var i = 0; i < ageIds.Length; i++) aging.Add(new(ageIds[i], reader.GetInt32(i + 4)));
        }
        tx.Commit();
        return new(days, zone.Id, now, coverage, trend.Sum(d => d.Submitted), trend.Sum(d => d.Completed), samples, average, median, untracked, [.. queues], [.. aging], [.. trend]);
    }
    private SqliteConnection Open() { var db = new SqliteConnection(connectionString); db.Open(); return db; }
}
