using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed class TrendRepository(string connectionString){
 public TrendReport Read(string actor,DateOnly from,DateOnly to,int offset,string? organization,string? assignee){
  using var c=new SqliteConnection(connectionString);c.Open();using var tx=c.BeginTransaction(deferred:true);
  var days=Enumerable.Range(0,to.DayNumber-from.DayNumber+1).ToDictionary(i=>from.AddDays(i).ToString("yyyy-MM-dd"),_=>new int[3]);
  var metrics=new[]{("p.first_submitted_at","1=1"),("(SELECT d.published_at FROM project_deliveries d WHERE d.project_id=p.id AND d.revoked_at IS NULL)","1=1"),("p.followup_due_at","p.workflow_status NOT IN ('completed','closed') AND julianday(p.followup_due_at)<=julianday('now')")};
  for(var index=0;index<metrics.Length;index++){
   using var q=c.CreateCommand();q.Transaction=tx;q.CommandText=$"""
    SELECT date(julianday({metrics[index].Item1})+$offset/1440.0),COUNT(*) FROM projects p JOIN users owner ON owner.id=p.owner_id LEFT JOIN organizations org ON org.id=owner.organization_id LEFT JOIN users assigned ON assigned.id=p.assignee_user_id
    WHERE (p.status='submitted' OR EXISTS(SELECT 1 FROM revision_rounds r WHERE r.project_id=p.id))
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=$actor AND u.is_active=1 AND (u.role IN ('owner','admin') OR (u.role='operator' AND p.assignee_user_id=u.id)))
    AND ($org='' OR instr(lower(COALESCE(org.name,'')),lower($org))>0)
    AND ($assignee='' OR instr(lower(COALESCE(assigned.display_name,'')),lower($assignee))>0 OR instr(lower(COALESCE(assigned.email,'')),lower($assignee))>0)
    AND {metrics[index].Item2} AND date(julianday({metrics[index].Item1})+$offset/1440.0) BETWEEN $from AND $to GROUP BY 1;
   """;
   q.Parameters.AddWithValue("$actor",actor);q.Parameters.AddWithValue("$offset",offset);q.Parameters.AddWithValue("$org",organization?.Trim()??"");q.Parameters.AddWithValue("$assignee",assignee?.Trim()??"");q.Parameters.AddWithValue("$from",from.ToString("yyyy-MM-dd"));q.Parameters.AddWithValue("$to",to.ToString("yyyy-MM-dd"));
   using var r=q.ExecuteReader();while(r.Read())if(days.TryGetValue(r.GetString(0),out var counts))counts[index]=r.GetInt32(1);
  }
  tx.Commit();return new(days.Select(p=>new TrendPoint(p.Key,p.Value[0],p.Value[1],p.Value[2])).ToArray(),DateTimeOffset.UtcNow);
 }
}
