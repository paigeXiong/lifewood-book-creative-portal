using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed class AccountClosureRepository(string connectionString)
{
 public AccountClosurePreview? Preview(string id){
  using var c=Open();using var q=Command(c,"SELECT email,updated_at,(SELECT COUNT(*) FROM projects WHERE owner_id=$id),(SELECT COUNT(*) FROM projects WHERE assignee_user_id=$id) FROM users WHERE id=$id AND closed_at IS NULL",("$id",id));
  using var r=q.ExecuteReader();return r.Read()?new(r.GetString(0),DateTimeOffset.Parse(r.GetString(1)),r.GetInt32(2),r.GetInt32(3)):null;
 }
 public AdminWriteResult Close(string id,string actorId,CloseAccountRequest? request,out string? avatar){
  avatar=null;if(request is null||string.IsNullOrWhiteSpace(request.ConfirmEmail))return new(AdminWriteOutcome.Invalid);
  using var c=Open();using var tx=c.BeginTransaction(deferred:false);
  using(var actor=Command(c,"SELECT COUNT(*) FROM users WHERE id=$actor AND is_active=1 AND closed_at IS NULL AND role IN ('owner','admin')",("$actor",actorId))){actor.Transaction=tx;if(Convert.ToInt32(actor.ExecuteScalar())!=1)return new(AdminWriteOutcome.Protected);}
  using(var q=Command(c,"SELECT role,email,updated_at,avatar_file_name FROM users WHERE id=$id AND closed_at IS NULL",("$id",id))){
   q.Transaction=tx;using var r=q.ExecuteReader();if(!r.Read())return new(AdminWriteOutcome.NotFound);
   if(id==actorId||r.GetString(0)=="owner")return new(AdminWriteOutcome.Protected);
   if(!string.Equals(r.GetString(1),request.ConfirmEmail.Trim(),StringComparison.OrdinalIgnoreCase)||DateTimeOffset.Parse(r.GetString(2))!=request.ExpectedUpdatedAt)return new(AdminWriteOutcome.Conflict);
   avatar=r.IsDBNull(3)?null:r.GetString(3);
  }
  var now=DateTimeOffset.UtcNow.ToString("O");
  using(var q=Command(c,"""
   UPDATE users SET email='',normalized_email='closed:'||id,display_name='',client_name=NULL,phone=NULL,locale=NULL,password_hash='',is_active=0,failed_attempts=0,locked_until=NULL,session_version=session_version+1,avatar_file_name=NULL,organization_id=NULL,task_background_motion=0,updated_at=$now,closed_at=$now WHERE id=$id;
   UPDATE projects SET assignee_user_id=NULL,workflow_updated_at=$now WHERE assignee_user_id=$id;
   """,("$id",id),("$now",now))){q.Transaction=tx;q.ExecuteNonQuery();}
  // Optional tables permit upgrades and repository tests before all features initialize.
  foreach(var table in new[]{"user_saved_views","project_resume","saved_account_sessions","user_presence","presence_session_activity","ended_presence_sessions","user_activity","user_activity_daily","notification_preferences","notifications","notification_targets","announcement_recipients"}){
   using var exists=Command(c,"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$table",("$table",table));exists.Transaction=tx;
   if(Convert.ToInt32(exists.ExecuteScalar())==0)continue;
   using var clear=Command(c,$"DELETE FROM {table} WHERE user_id=$id",("$id",id));clear.Transaction=tx;clear.ExecuteNonQuery();
  }
  tx.Commit();return new(AdminWriteOutcome.Saved);
 }
 private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();using var q=c.CreateCommand();q.CommandText="PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;";q.ExecuteNonQuery();return c;}
 private static SqliteCommand Command(SqliteConnection c,string sql,params (string,object)[] args){var q=c.CreateCommand();q.CommandText=sql;foreach(var (key,value) in args)q.Parameters.AddWithValue(key,value);return q;}
}
