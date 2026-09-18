using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Features;
public sealed record MailRateStatus(int MinuteUsed,int DayUsed,int PerMinute,int PerDay,long? ResumeAt);
internal sealed class MailRateLimitedException(long resumeAt):Exception("Mail sending quota reached.") { public long ResumeAt {get;}=resumeAt; }
internal sealed class MailRateLimiter
{
    private readonly string connection;
    public MailRateLimiter(string directory) {
        Directory.CreateDirectory(directory);
        connection=new SqliteConnectionStringBuilder{DataSource=Path.Combine(directory,"mail-rate.db"),Pooling=false}.ToString();
        using var c=Open();using var q=c.CreateCommand();
        q.CommandText="CREATE TABLE IF NOT EXISTS mail_attempts(at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS mail_attempts_at ON mail_attempts(at);";q.ExecuteNonQuery();
    }
    private SqliteConnection Open(){var c=new SqliteConnection(connection);c.Open();return c;}
    public MailRateStatus Check(MailConfiguration config,bool reserve=false,long? timestamp=null) {
        var now=timestamp??DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var c=Open();using var tx=c.BeginTransaction(deferred:false);
        using var q=c.CreateCommand();q.Transaction=tx;
        q.CommandText="DELETE FROM mail_attempts WHERE at<=$cutoff";q.Parameters.AddWithValue("$cutoff",now-86400);q.ExecuteNonQuery();
        q.CommandText="SELECT at FROM mail_attempts ORDER BY at";q.Parameters.Clear();
        var times=new List<long>();using(var r=q.ExecuteReader()){while(r.Read())times.Add(r.GetInt64(0));}
        var minute=times.Where(t=>t>now-60).ToArray();
        long? resume=null;
        if(minute.Length>=config.PerMinute)resume=minute[minute.Length-config.PerMinute]+60;
        if(times.Count>=config.PerDay)resume=Math.Max(resume??0,times[times.Count-config.PerDay]+86400);
        if(reserve && resume is null){q.CommandText="INSERT INTO mail_attempts VALUES($now)";q.Parameters.AddWithValue("$now",now);q.ExecuteNonQuery();}
        tx.Commit();
        return new(minute.Length,times.Count,config.PerMinute,config.PerDay,resume);
    }
}
