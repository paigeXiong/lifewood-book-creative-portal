using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Persistence;
internal sealed partial class AnnouncementRepository
{
    public string? Schedule(string id, ScheduleAnnouncementRequest input, out AnnouncementDocument? result)
    {
        result=null;
        if(input.RunAt<=DateTimeOffset.UtcNow || input.RunAt>DateTimeOffset.UtcNow.AddYears(1))return "invalid";
        using var db=Open();using var tx=db.BeginTransaction(deferred:false);var old=Read(db,id,tx);
        if(old is null)return "missing";
        if(old.Version!=input.Version || old.Status!="draft")return "conflict";
        if(!Valid(old.Content))return "invalid";
        result=old with {Status="scheduled",Version=old.Version+1,ScheduledAt=input.RunAt.ToUniversalTime()};
        Write(db,tx,result);
        using var command=db.CreateCommand();command.Transaction=tx;
        command.CommandText="INSERT INTO announcement_jobs(id,announcement_id,version,run_at,status,title_zh,title_en) VALUES($job,$id,$version,$time,'pending',$zh,$en)";
        command.Parameters.AddWithValue("$job",Guid.NewGuid().ToString("N"));command.Parameters.AddWithValue("$id",id);
        command.Parameters.AddWithValue("$zh",old.Content.Title??old.Content.TitleZh??"");command.Parameters.AddWithValue("$en",old.Content.Title??old.Content.TitleEn??"");
        command.Parameters.AddWithValue("$version",result.Version);command.Parameters.AddWithValue("$time",input.RunAt.ToUniversalTime().ToString("O"));command.ExecuteNonQuery();
        tx.Commit();return null;
    }
    public string? CancelSchedule(string id,long version,out AnnouncementDocument? result)
    {
        result=null;using var db=Open();using var tx=db.BeginTransaction(deferred:false);var old=Read(db,id,tx);
        if(old is null)return "missing";if(old.Version!=version || old.Status!="scheduled")return "conflict";
        result=old with {Status="draft",Version=old.Version+1,ScheduledAt=null};Write(db,tx,result);
        using var command=db.CreateCommand();command.Transaction=tx;command.CommandText="UPDATE announcement_jobs SET status='cancelled',finished_at=$now WHERE announcement_id=$id AND status='pending'";
        command.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));command.Parameters.AddWithValue("$id",id);command.ExecuteNonQuery();tx.Commit();return null;
    }
    public (string Id,long Version)[] Due(DateTimeOffset now)
    {
        using var db=Open();using var c=db.CreateCommand();c.CommandText="SELECT announcement_id,version FROM announcement_jobs WHERE status='pending' AND julianday(run_at)<=julianday($now) ORDER BY run_at LIMIT 20";c.Parameters.AddWithValue("$now",now.ToString("O"));
        using var reader=c.ExecuteReader();var items=new List<(string,long)>();while(reader.Read())items.Add((reader.GetString(0),reader.GetInt64(1)));return items.ToArray();
    }
    public void FailSchedule(string id,long version)
    {
        using var db=Open();using var tx=db.BeginTransaction(deferred:false);var old=Read(db,id,tx);
        if(old is null || old.Version!=version || old.Status!="scheduled")return;
        Write(db,tx,old with {Status="draft",Version=old.Version+1,ScheduledAt=null});
        using var c=db.CreateCommand();c.Transaction=tx;c.CommandText="UPDATE announcement_jobs SET status='failed',error='publish_failed',finished_at=$now WHERE announcement_id=$id AND status='pending'";
        c.Parameters.AddWithValue("$id",id);c.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));c.ExecuteNonQuery();tx.Commit();
    }
    public AnnouncementJobsPage Jobs(int page,string locale,string? search=null,string? status=null)
    {
        page=Math.Clamp(page,1,100000);
        using var db=Open();using var tx=db.BeginTransaction();
        const string title="COALESCE(CASE WHEN $locale='en-US' THEN j.title_en ELSE j.title_zh END,json_extract(a.document,'$.content.title'),json_extract(a.document,$title),'')";
        var from=" FROM announcement_jobs j LEFT JOIN announcements a ON a.id=j.announcement_id WHERE ($status='' OR j.status=$status) AND ($q='' OR instr(lower("+title+"),lower($q))>0)";
        using var c=db.CreateCommand();c.Transaction=tx;
        c.Parameters.AddWithValue("$locale",locale);c.Parameters.AddWithValue("$title",locale=="en-US"?"$.content.titleEn":"$.content.titleZh");
        c.Parameters.AddWithValue("$status",status??"");c.Parameters.AddWithValue("$q",(search??"").Trim());
        c.CommandText="SELECT COUNT(*)"+from;var total=Convert.ToInt32(c.ExecuteScalar());
        page=Math.Min(page,Math.Max(1,(total+19)/20));
        c.CommandText="SELECT j.id,j.announcement_id,"+title+",j.status,j.run_at,j.finished_at,j.error"+from+" ORDER BY j.rowid DESC LIMIT 20 OFFSET $offset";
        c.Parameters.AddWithValue("$offset",(page-1)*20);
        var items=new List<AnnouncementJob>();using(var r=c.ExecuteReader())while(r.Read())items.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),DateTimeOffset.Parse(r.GetString(4)),r.IsDBNull(5)?null:DateTimeOffset.Parse(r.GetString(5)),r.IsDBNull(6)?null:r.GetString(6)));
        using var count=db.CreateCommand();count.Transaction=tx;count.CommandText="SELECT COALESCE(SUM(status='pending'),0),MIN(CASE WHEN status='pending' THEN run_at END) FROM announcement_jobs";
        using var counts=count.ExecuteReader();counts.Read();return new(items.ToArray(),page,total,counts.GetInt32(0),counts.IsDBNull(1)?null:DateTimeOffset.Parse(counts.GetString(1)));
    }
}
