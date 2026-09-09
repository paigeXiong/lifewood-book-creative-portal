using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed class PersonalWorkspaceRepository(string connectionString){
 private static readonly Dictionary<string,string[]> Keys=new(){["tasks"]=["q","status","sort","direction"],["workbench"]=["q","queue","mine"],["projects"]=["q","workflow","priority"]};
 private static readonly string[] Steps=["project","characters","voice","style","references","review"];
 private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();return c;}
 private static SqliteCommand Cmd(SqliteConnection c,string sql,params(string,object?)[] args){var q=c.CreateCommand();q.CommandText=sql;foreach(var(k,v)in args)q.Parameters.AddWithValue(k,v??DBNull.Value);return q;}
 public void Initialize(){using var c=Open();using var q=Cmd(c,"""
 CREATE TABLE IF NOT EXISTS user_saved_views(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,area TEXT NOT NULL,name TEXT NOT NULL,filters_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,UNIQUE(user_id,area,name));
 CREATE INDEX IF NOT EXISTS ix_saved_views_user ON user_saved_views(user_id,area);
 CREATE TABLE IF NOT EXISTS project_resume(user_id TEXT NOT NULL,project_id TEXT NOT NULL,step TEXT NOT NULL,PRIMARY KEY(user_id,project_id),FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
 """);q.ExecuteNonQuery();}
 public SavedViewDto[] List(string user,string area){using var c=Open();using var q=Cmd(c,"SELECT id,name,filters_json,version FROM user_saved_views WHERE user_id=$u AND area=$a ORDER BY name LIMIT 20",("$u",user),("$a",area));using var r=q.ExecuteReader();var list=new List<SavedViewDto>();while(r.Read())list.Add(new(r.GetString(0),area,r.GetString(1),JsonSerializer.Deserialize(r.GetString(2),AppJsonContext.Default.DictionaryStringString)!,r.GetInt32(3)));return list.ToArray();}
 public bool Save(string user,string area,string id,SaveViewRequest request){
  if(!Keys.TryGetValue(area,out var keys)||request.Name?.Trim() is not {Length:>=1 and <=40} name||request.Filters is null||request.Filters.Any(p=>!keys.Contains(p.Key)||p.Value is null||p.Value.Length>300)||!Guid.TryParseExact(id,"N",out _))return false;
  using var c=Open();using var tx=c.BeginTransaction(deferred:false);using var q=Cmd(c,"SELECT COUNT(*) FROM users WHERE id=$u AND is_active=1",("$u",user));q.Transaction=tx;if(Convert.ToInt32(q.ExecuteScalar())!=1)return false;
  q.CommandText="SELECT COUNT(*) FROM user_saved_views WHERE user_id=$u AND area=$a";q.Parameters.AddWithValue("$a",area);if(request.Version==0&&Convert.ToInt32(q.ExecuteScalar())>=20)return false;
  q.CommandText=request.Version==0?"INSERT INTO user_saved_views(id,user_id,area,name,filters_json) VALUES($id,$u,$a,$name,$json)":"UPDATE user_saved_views SET name=$name,filters_json=$json,version=version+1 WHERE id=$id AND user_id=$u AND area=$a AND version=$v";
  q.Parameters.AddWithValue("$id",id);q.Parameters.AddWithValue("$name",name);q.Parameters.AddWithValue("$json",JsonSerializer.Serialize(request.Filters,AppJsonContext.Default.DictionaryStringString));q.Parameters.AddWithValue("$v",request.Version);
  try{var saved=q.ExecuteNonQuery()==1;tx.Commit();return saved;}catch(SqliteException e)when(e.SqliteErrorCode==19){return false;}
 }
 public bool Delete(string user,string id,int version){using var c=Open();using var q=Cmd(c,"DELETE FROM user_saved_views WHERE id=$id AND user_id=$u AND version=$v",("$u",user),("$id",id),("$v",version));return q.ExecuteNonQuery()==1;}
 public bool Resume(string user,string id,string step){if(!Steps.Contains(step))return false;using var c=Open();using var q=Cmd(c,"""
 INSERT INTO project_resume(user_id,project_id,step) SELECT $u,$id,$s FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$id AND p.owner_id=$u AND p.status='draft' AND u.is_active=1
 ON CONFLICT(user_id,project_id) DO UPDATE SET step=excluded.step;
 """,("$u",user),("$id",id),("$s",step));return q.ExecuteNonQuery()==1;}
 public ResumeStepDto[] ResumeSteps(string user,string[] ids){if(ids.Length>20)return [];using var c=Open();using var q=Cmd(c,"""
 SELECT p.id,COALESCE(r.step,'project'),(SELECT reasons FROM revision_rounds WHERE project_id=p.id AND submitted_at IS NULL LIMIT 1) FROM projects p LEFT JOIN project_resume r ON r.project_id=p.id AND r.user_id=$u
 WHERE p.owner_id=$u AND p.status='draft' AND p.id IN (SELECT value FROM json_each($ids));
 """,("$u",user),("$ids",JsonSerializer.Serialize(ids,AppJsonContext.Default.StringArray)));using var reader=q.ExecuteReader();var result=new List<ResumeStepDto>();while(reader.Read()){
  var step=reader.GetString(1);if(!reader.IsDBNull(2)){using var reasons=JsonDocument.Parse(reader.GetString(2));var allowed=reasons.RootElement.EnumerateArray().Select(x=>x.GetProperty("unit").GetString()!).Where(Steps.Contains).ToArray();if(step!="review"&&!allowed.Contains(step))step=allowed.FirstOrDefault()??"review";}
  result.Add(new(reader.GetString(0),step));}return result.ToArray();}
}
