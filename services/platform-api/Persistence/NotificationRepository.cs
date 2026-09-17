using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Persistence;
internal sealed partial class NotificationRepository(string connectionString)
{
 public static readonly NotificationRule[] Defaults=[
  new("feedback_reply","您的平台反馈有了回复","Your platform feedback has a reply","important",true,false),
  new("backup_failed","自动备份失败，请检查备份状态","Automatic backup failed. Check backup status.","action",true,false,"owners"),
  new("backup_damaged","备份校验发现损坏，请检查备份","A backup failed integrity verification.","action",true,false,"owners"),
  new("backup_stale","长时间没有成功备份，请检查定时备份","No recent successful backup. Check the backup schedule.","action",true,false,"owners"),
  new("followup_due","项目跟进即将到期：{project}","Project follow-up due soon: {project}","important"),
  new("followup_overdue","项目跟进已逾期：{project}","Project follow-up overdue: {project}","action"),
  new("submitted","项目已提交：{project}","Project submitted: {project}","action"),
  new("resubmitted","资料已重新提交：{project}","Changes resubmitted: {project}","action"),
  new("returned","请修改项目资料：{project}","Changes requested: {project}","action",true,false),
  new("customer_reply","客户有新回复：{project}","Customer replied: {project}","normal"),
  new("admin_reply","管理员有新回复：{project}","Administrator replied: {project}","normal"),
  new("workflow","项目进度已更新：{project}","Project progress updated: {project}","important"),
  new("completed","项目已完成：{project}","Project completed: {project}","important",true,false),
  new("delivery","成品已交付：{project}","Final delivery available: {project}","important",true,false),
  new("account","账号权限或组织信息已更新","Account access or organization updated","important",true,false)
 ];
 private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();return c;}
 private static SqliteCommand Cmd(SqliteConnection c,string sql,params (string,object?)[] args){var q=c.CreateCommand();q.CommandText=sql;foreach(var (k,v) in args)q.Parameters.AddWithValue(k,v??DBNull.Value);return q;}
 public void Initialize(){new FeedbackRepository(connectionString).Initialize();using var c=Open();using var tx=c.BeginTransaction();using var q=Cmd(c,"""
 CREATE TABLE IF NOT EXISTS notification_rules(kind TEXT PRIMARY KEY,document TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_settings(id INTEGER PRIMARY KEY CHECK(id=1),retention_days INTEGER NOT NULL);
 INSERT OR IGNORE INTO notification_settings VALUES(1,365);
 CREATE TABLE IF NOT EXISTS backup_alerts(kind TEXT PRIMARY KEY,fingerprint TEXT,event_key TEXT,since TEXT);
 CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY,document TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notification_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,project_id TEXT NOT NULL,actor_id TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt TEXT,error TEXT);
 CREATE INDEX IF NOT EXISTS ix_notification_pending ON notification_events(status,next_attempt,id);
 CREATE TABLE IF NOT EXISTS notification_targets(event_id INTEGER NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(event_id,user_id));
 CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,user_id TEXT NOT NULL,read_at TEXT,archived INTEGER NOT NULL DEFAULT 0,UNIQUE(event_id,user_id));
 CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id,archived,id DESC);
 CREATE INDEX IF NOT EXISTS ix_notifications_unread ON notifications(user_id,id) WHERE read_at IS NULL AND archived=0;
 DROP TRIGGER IF EXISTS notification_targets_snapshot;
 CREATE TRIGGER notification_targets_snapshot AFTER INSERT ON notification_events BEGIN
  INSERT INTO notification_targets SELECT NEW.id,u.id FROM users u JOIN projects p ON p.id=NEW.project_id
  WHERE u.is_active=1 AND u.id<>NEW.actor_id AND (
   (NEW.kind IN ('submitted','resubmitted','customer_reply','followup_due','followup_overdue') AND (u.role IN ('admin','owner') OR (u.role='operator' AND u.id=p.assignee_user_id)) AND
    (COALESCE((SELECT json_extract(document,'$.audience') FROM notification_rules WHERE kind=NEW.kind),'responsible')='allAdmins' OR p.assignee_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM users a WHERE a.id=p.assignee_user_id AND a.is_active=1 AND a.role IN ('admin','owner','operator')) OR u.id=p.assignee_user_id))
   OR (NEW.kind IN ('returned','admin_reply','workflow','completed','delivery') AND u.id=p.owner_id))
  AND COALESCE((SELECT json_extract(document,'$.enabled') FROM notification_rules WHERE kind=NEW.kind),1)=1;
 END;
 CREATE TRIGGER IF NOT EXISTS notification_backup_snapshot AFTER INSERT ON notification_events WHEN NEW.kind IN ('backup_failed','backup_damaged','backup_stale') BEGIN
  INSERT INTO notification_targets SELECT NEW.id,id FROM users WHERE role='owner' AND is_active=1 AND closed_at IS NULL
  AND COALESCE((SELECT json_extract(document,'$.enabled') FROM notification_rules WHERE kind=NEW.kind),1)=1;
 END;
 CREATE TRIGGER IF NOT EXISTS notification_feedback_snapshot AFTER INSERT ON notification_events WHEN NEW.kind='feedback_reply' BEGIN
  INSERT INTO notification_targets SELECT NEW.id,u.id FROM feedback_responses r JOIN platform_feedback f ON f.id=r.feedback_id JOIN users u ON u.id=f.user_id
  WHERE r.id=NEW.target_id AND u.is_active=1 AND u.closed_at IS NULL;
 END;
 CREATE TRIGGER IF NOT EXISTS notification_account_snapshot AFTER INSERT ON notification_events WHEN NEW.kind='account' BEGIN
  INSERT INTO notification_targets SELECT NEW.id,id FROM users WHERE id=NEW.target_id AND is_active=1 AND id<>NEW.actor_id AND COALESCE((SELECT json_extract(document,'$.enabled') FROM notification_rules WHERE kind='account'),1)=1;
 END;
 CREATE TRIGGER IF NOT EXISTS notification_submit AFTER UPDATE OF status ON projects WHEN OLD.status='draft' AND NEW.status='submitted' BEGIN
  INSERT OR IGNORE INTO notification_events(event_key,kind,project_id,actor_id,target_id)
  VALUES('submit:'||NEW.id||':'||NEW.version,CASE WHEN OLD.task_number IS NULL THEN 'submitted' ELSE 'resubmitted' END,NEW.id,NEW.owner_id,'');
 END;
 CREATE TRIGGER IF NOT EXISTS notification_reply AFTER INSERT ON revision_messages
 WHEN NEW.created_at<>(SELECT created_at FROM revision_rounds WHERE id=NEW.round_id) BEGIN
  INSERT OR IGNORE INTO notification_events(event_key,kind,project_id,actor_id,target_id)
  SELECT 'reply:'||NEW.id,CASE WHEN NEW.is_admin=1 THEN 'admin_reply' ELSE 'customer_reply' END,project_id,NEW.author_id,NEW.id FROM revision_rounds WHERE id=NEW.round_id;
 END;
 CREATE TRIGGER IF NOT EXISTS notification_delivery AFTER INSERT ON project_deliveries BEGIN
  INSERT OR IGNORE INTO notification_events(event_key,kind,project_id,actor_id,target_id) VALUES('delivery:'||NEW.id,'delivery',NEW.project_id,NEW.uploader_user_id,NEW.id);
 END;
 """);q.Transaction=tx;q.ExecuteNonQuery();foreach(var rule in Defaults){using var insert=Cmd(c,"INSERT OR IGNORE INTO notification_rules VALUES($kind,$doc)",("$kind",rule.Kind),("$doc",JsonSerializer.Serialize(rule,AppJsonContext.Default.NotificationRule)));insert.Transaction=tx;insert.ExecuteNonQuery();}tx.Commit();}
 // Called inside the same transaction as the business mutation. Optional table check supports isolated legacy repository tests.
 public static void Capture(SqliteConnection c,SqliteTransaction tx,string key,string kind,string project,string actor,string target=""){
  using var exists=Cmd(c,"SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notification_events'");exists.Transaction=tx;if(Convert.ToInt32(exists.ExecuteScalar())==0)return;
  using var q=Cmd(c,"INSERT OR IGNORE INTO notification_events(event_key,kind,project_id,actor_id,target_id) VALUES($key,$kind,$project,$actor,$target)",("$key",key),("$kind",kind),("$project",project),("$actor",actor),("$target",target));q.Transaction=tx;q.ExecuteNonQuery();
 }
 public void Dispatch(){using var c=Open();using var ids=Cmd(c,"SELECT id FROM notification_events WHERE status='pending' AND (next_attempt IS NULL OR julianday(next_attempt)<=julianday('now')) ORDER BY id LIMIT 50");var batch=new List<long>();using(var rd=ids.ExecuteReader())while(rd.Read())batch.Add(rd.GetInt64(0));foreach(var id in batch){try{using var tx=c.BeginTransaction();using var write=Cmd(c,"""
 INSERT OR IGNORE INTO notifications(event_id,user_id) SELECT t.event_id,t.user_id FROM notification_targets t JOIN users u ON u.id=t.user_id AND u.is_active=1 WHERE t.event_id=$id AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.event_id=t.event_id AND n.user_id=t.user_id) LIMIT 500;
 UPDATE notification_events SET status=CASE WHEN EXISTS(SELECT 1 FROM notification_targets t JOIN users u ON u.id=t.user_id AND u.is_active=1 WHERE t.event_id=$id AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.event_id=t.event_id AND n.user_id=t.user_id)) THEN 'pending' ELSE 'sent' END,attempts=0,next_attempt=NULL,error=NULL WHERE id=$id;
 """,("$id",id));write.Transaction=tx;write.ExecuteNonQuery();tx.Commit();}catch(SqliteException){using var fail=Cmd(c,"UPDATE notification_events SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,next_attempt=strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 seconds'),error='storage_unavailable' WHERE id=$id",("$id",id));fail.ExecuteNonQuery();}}}
 private const string Access="((e.kind='feedback_reply' AND EXISTS(SELECT 1 FROM users self JOIN platform_feedback f ON f.user_id=self.id JOIN feedback_responses r ON r.feedback_id=f.id WHERE self.id=$user AND self.is_active=1 AND self.closed_at IS NULL AND r.id=e.target_id)) OR (e.kind IN ('backup_failed','backup_damaged','backup_stale') AND EXISTS(SELECT 1 FROM users self WHERE self.id=$user AND self.is_active=1 AND self.closed_at IS NULL AND self.role='owner')) OR (e.kind='account' AND EXISTS(SELECT 1 FROM users self WHERE self.id=$user AND self.is_active=1)) OR EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=$user AND u.is_active=1 WHERE p.id=e.project_id AND ((p.owner_id=$user AND u.role='customer' AND e.kind NOT IN ('followup_due','followup_overdue')) OR u.role IN ('admin','owner') OR (u.role='operator' AND p.assignee_user_id=$user))))";
 private const string Joins=" FROM notifications n JOIN notification_events e ON e.id=n.event_id LEFT JOIN projects p ON p.id=e.project_id LEFT JOIN users a ON a.id=e.actor_id ";
 private const string State="CASE WHEN e.kind IN ('backup_failed','backup_damaged','backup_stale') THEN CASE WHEN EXISTS(SELECT 1 FROM backup_alerts alert WHERE alert.kind=e.kind AND alert.event_key=e.event_key AND alert.fingerprint IS NOT NULL) THEN 'pending' ELSE 'done' END WHEN e.kind IN ('followup_due','followup_overdue') THEN CASE WHEN p.followup_due_at IS NULL OR p.workflow_status IN ('completed','closed') OR e.target_id<>(CAST(p.followup_version AS TEXT)||':'||COALESCE(p.assignee_user_id,'')) OR (e.kind='followup_due' AND julianday(p.followup_due_at)<=julianday('now')) THEN 'expired' ELSE 'pending' END WHEN e.kind='admin_reply' AND NOT EXISTS(SELECT 1 FROM revision_messages m JOIN revision_rounds r ON r.id=m.round_id WHERE m.id=e.target_id AND r.submitted_at IS NULL AND p.status='draft') THEN 'expired' WHEN e.kind='returned' THEN CASE WHEN EXISTS(SELECT 1 FROM revision_rounds r WHERE r.id=e.target_id AND r.submitted_at IS NULL) THEN 'pending' ELSE 'done' END WHEN e.kind IN ('submitted','resubmitted') THEN CASE WHEN p.status='submitted' AND p.workflow_status='new' AND NOT EXISTS(SELECT 1 FROM notification_events newer WHERE newer.project_id=e.project_id AND newer.kind IN ('submitted','resubmitted') AND newer.id>e.id) THEN 'pending' ELSE 'done' END WHEN e.kind='delivery' AND NOT EXISTS(SELECT 1 FROM project_deliveries d WHERE d.id=e.target_id AND d.revoked_at IS NULL) THEN 'expired' ELSE 'info' END";
 public NotificationCounts Counts(string user){using var c=Open();using var q=Cmd(c,"SELECT COALESCE(SUM(CASE WHEN n.read_at IS NULL AND n.archived=0 THEN 1 ELSE 0 END),0),COALESCE(MAX(n.id),0)"+Joins+" WHERE n.user_id=$user AND "+Access,("$user",user));using var rd=q.ExecuteReader();rd.Read();return new(rd.GetInt32(0),rd.GetInt64(1));}
 public NotificationPage List(string user,string locale,long? before,string? search,string? kind,string? state,string? project,string? from,string? to,bool unread=false,bool archived=false){
  using var c=Open();using var tx=c.BeginTransaction();using var q=Cmd(c,"SELECT n.id,e.kind,e.project_id,COALESCE(json_extract(p.project_json,'$.projectName'),p.task_number,''),CASE WHEN a.closed_at IS NOT NULL THEN $closed ELSE COALESCE(a.display_name,'') END,e.created_at,n.read_at IS NOT NULL,n.archived,"+State+",e.target_id"+Joins+"""
  WHERE n.user_id=$user AND n.id<$before AND n.archived=$archived AND ($unread=0 OR n.read_at IS NULL)
  AND ($kind='' OR e.kind=$kind) AND ($project='' OR e.project_id=$project)
  AND ($from='' OR julianday(e.created_at)>=julianday($from)) AND ($to='' OR julianday(e.created_at)<=julianday($to))
  AND ($search='' OR instr(lower(p.project_json),lower($search))>0 OR instr(lower(COALESCE(a.display_name,'')),lower($search))>0)
 """+" AND "+Access+" AND ($state='' OR ("+State+")=$state) ORDER BY n.id DESC LIMIT 31",("$user",user),("$closed",locale=="en-US"?"Closed account":"已注销账号"),("$before",before??long.MaxValue),("$search",(search??"")[..Math.Min(search?.Length??0,160)]),("$kind",kind??""),("$state",state??""),("$project",project??""),("$from",from??""),("$to",to??""),("$unread",unread?1:0),("$archived",archived?1:0));q.Transaction=tx;
  var rules=Rules().Items.ToDictionary(x=>x.Kind);var list=new List<NotificationItem>();using(var rd=q.ExecuteReader())while(rd.Read()){var rule=rules[rd.GetString(1)];var title=rd.GetString(3);list.Add(new(rd.GetInt64(0),rd.GetString(1),rd.GetString(2),title,rd.GetString(4),rd.GetString(5),rd.GetBoolean(6),rd.GetBoolean(7),rd.GetString(8),rd.GetString(9),(locale=="en-US"?rule.TitleEn:rule.TitleZh).Replace("{project}",title).Replace("{actor}",rd.GetString(4)),rule.Level));}
  using var count=Cmd(c,"SELECT COALESCE(SUM(CASE WHEN n.read_at IS NULL AND n.archived=0 THEN 1 ELSE 0 END),0),COALESCE(MAX(n.id),0)"+Joins+" WHERE n.user_id=$user AND "+Access,("$user",user));count.Transaction=tx;using var counts=count.ExecuteReader();counts.Read();return new(list.Take(30).ToArray(),list.Count>30?list[29].Id:null,counts.GetInt64(1),counts.GetInt32(0));
 }
 public NotificationTarget? Target(string user,long id,string locale,bool admin){using var c=Open();using var q=Cmd(c,"SELECT e.project_id,e.kind,e.target_id,COALESCE(p.status,''),u.role,"+State+" FROM notifications n JOIN notification_events e ON e.id=n.event_id LEFT JOIN projects p ON p.id=e.project_id JOIN users u ON u.id=$user WHERE n.id=$id AND n.user_id=$user AND "+Access,("$id",id),("$user",user));using var rd=q.ExecuteReader();if(!rd.Read())return null;var project=rd.GetString(0);var kind=rd.GetString(1);var target=rd.GetString(2);var role=rd.GetString(4);if(rd.GetString(5)=="expired")return null;if(admin&&role is not ("admin" or "owner" or "operator"))return null;var draft=rd.GetString(3)=="draft";rd.Close();
 if(kind=="feedback_reply")return new($"/{locale}/notifications");
 if(IsBackupKind(kind))return new(admin?$"/{locale}/settings/backups":$"/api/portals/backups?locale={locale}");
 if(kind=="account")return new(admin?(role=="operator"?$"/{locale}/projects":$"/{locale}/users"):$"/{locale}/profile");
 if(admin && kind is "followup_due" or "followup_overdue")return new($"/{locale}/projects?project={Uri.EscapeDataString(project)}");
 if(admin)return new($"/{locale}/projects?project={Uri.EscapeDataString(project)}&notification={Uri.EscapeDataString(target)}");
 using var owner=Cmd(c,"SELECT owner_id FROM projects WHERE id=$id",("$id",project));if(owner.ExecuteScalar() as string!=user)return null;
 var unit="review";if(draft&&kind=="admin_reply"){using var m=Cmd(c,"SELECT unit FROM revision_messages WHERE id=$id",("$id",target));unit=m.ExecuteScalar() as string??"review";}
 return new($"/{locale}/tasks/{Uri.EscapeDataString(project)}"+(draft?$"/edit/{Uri.EscapeDataString(unit)}":"")+(target.Length>0?$"?notification={Uri.EscapeDataString(target)}":""));
 }
 public bool Update(string user,NotificationSelection input){if(input.Action is not ("read" or "unread" or "archive" or "restore") || (input.Through is null && input.Ids is not {Length:>=1 and <=500}) || input.Ids?.Any(x=>x<1)==true || input.Through<0)return false;
  using var c=Open();var set=input.Action switch {"read"=>"read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')","unread"=>"read_at=NULL","archive"=>"archived=1",_=>"archived=0"};using var q=Cmd(c,"UPDATE notifications SET "+set+" WHERE user_id=$user AND "+(input.Through is not null?"id<=$through":"id IN (SELECT value FROM json_each($ids))"),("$user",user),("$through",input.Through),("$ids",JsonSerializer.Serialize(input.Ids??[],AppJsonContext.Default.Int64Array)));q.ExecuteNonQuery();return true;}
 public NotificationPreferences Preferences(string user){using var c=Open();using var q=Cmd(c,"SELECT document FROM notification_preferences WHERE user_id=$user",("$user",user));return q.ExecuteScalar() is string s?JsonSerializer.Deserialize(s,AppJsonContext.Default.NotificationPreferences)!:new();}
 public bool SavePreferences(string user,NotificationPreferences p){bool Time(string? s)=>s is null || TimeOnly.TryParseExact(s,"HH:mm",out _);if(!Time(p.QuietStart)||!Time(p.QuietEnd)||(p.QuietStart is null)!=(p.QuietEnd is null)||p.MutedKinds is {Length:>20}||p.MutedKinds?.Any(k=>!Rules().Items.Any(d=>d.Kind==k&&d.AllowMute))==true)return false;try{TimeZoneInfo.FindSystemTimeZoneById(p.TimeZone);}catch{return false;}using var c=Open();using var q=Cmd(c,"INSERT INTO notification_preferences SELECT $user,$doc WHERE EXISTS(SELECT 1 FROM users WHERE id=$user AND is_active=1 AND closed_at IS NULL) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document",("$user",user),("$doc",JsonSerializer.Serialize(p,AppJsonContext.Default.NotificationPreferences)));return q.ExecuteNonQuery()>0;}
 public NotificationRules Rules(){using var c=Open();using var q=Cmd(c,"SELECT document FROM notification_rules ORDER BY kind");var list=new List<NotificationRule>();using(var rd=q.ExecuteReader())while(rd.Read())list.Add(JsonSerializer.Deserialize(rd.GetString(0),AppJsonContext.Default.NotificationRule)!);using var days=Cmd(c,"SELECT retention_days FROM notification_settings WHERE id=1");return new([..list],Convert.ToInt32(days.ExecuteScalar()));}
 public bool SaveRule(NotificationRule r){if(r.Kind=="feedback_reply"&&(!r.Enabled||r.AllowMute||r.Audience!="responsible"))return false;if(!Defaults.Any(x=>x.Kind==r.Kind)||r.TitleZh is null||r.TitleEn is null||r.TitleZh.Length is <1 or >300||r.TitleEn.Length is <1 or >300||r.Level is not ("normal" or "important" or "action")||(IsBackupKind(r.Kind) ? r.Audience!="owners" : r.Audience is not ("responsible" or "allAdmins")))return false;foreach(var template in new[]{r.TitleZh,r.TitleEn})if(template.Replace("{project}","").Replace("{actor}","").Contains('{')||template.Replace("{project}","").Replace("{actor}","").Contains('}'))return false;using var c=Open();using var q=Cmd(c,"UPDATE notification_rules SET document=$doc WHERE kind=$kind AND json_extract(document,'$.version')=$version",("$kind",r.Kind),("$version",r.Version),("$doc",JsonSerializer.Serialize(r with {Version=r.Version+1},AppJsonContext.Default.NotificationRule)));return q.ExecuteNonQuery()==1;}
 public bool Retention(int days){if(days is <30 or >3650)return false;using var c=Open();using var q=Cmd(c,"UPDATE notification_settings SET retention_days=$days",("$days",days));q.ExecuteNonQuery();return true;}
 public void Cleanup(){using var c=Open();using var tx=c.BeginTransaction();using var q=Cmd(c,$"""
 DELETE FROM notifications WHERE archived=1 AND read_at IS NOT NULL AND event_id NOT IN (SELECT e.id FROM notification_events e LEFT JOIN projects p ON p.id=e.project_id WHERE ({State})='pending') AND event_id IN (SELECT id FROM notification_events WHERE status='sent' AND julianday(created_at)<julianday('now')-(SELECT retention_days FROM notification_settings WHERE id=1));
 DELETE FROM notification_targets WHERE event_id IN (SELECT id FROM notification_events WHERE status='sent' AND julianday(created_at)<julianday('now')-(SELECT retention_days FROM notification_settings WHERE id=1) AND NOT EXISTS(SELECT 1 FROM notifications WHERE event_id=notification_events.id));
 DELETE FROM notification_events WHERE status='sent' AND julianday(created_at)<julianday('now')-(SELECT retention_days FROM notification_settings WHERE id=1) AND NOT EXISTS(SELECT 1 FROM notifications WHERE event_id=notification_events.id);
 """);q.Transaction=tx;q.ExecuteNonQuery();tx.Commit();}
 public NotificationLogPage Logs(long? before){using var c=Open();using var q=Cmd(c,"SELECT e.id,e.kind,e.project_id,e.created_at,e.status,e.attempts,(SELECT COUNT(*) FROM notifications n WHERE n.event_id=e.id),e.error FROM notification_events e WHERE e.id<$before ORDER BY e.id DESC LIMIT 31",("$before",before??long.MaxValue));var list=new List<NotificationLog>();using(var rd=q.ExecuteReader())while(rd.Read())list.Add(new(rd.GetInt64(0),rd.GetString(1),rd.GetString(2),rd.GetString(3),rd.GetString(4),rd.GetInt32(5),rd.GetInt32(6),rd.IsDBNull(7)?null:rd.GetString(7)));using var counts=Cmd(c,"SELECT SUM(status='pending'),SUM(status='failed') FROM notification_events");using var cr=counts.ExecuteReader();cr.Read();return new(list.Take(30).ToArray(),list.Count>30?list[29].Id:null,cr.IsDBNull(0)?0:cr.GetInt32(0),cr.IsDBNull(1)?0:cr.GetInt32(1));}
 public bool Retry(long id){using var c=Open();using var q=Cmd(c,"UPDATE notification_events SET status='pending',attempts=0,next_attempt=NULL WHERE id=$id AND status='failed'",("$id",id));return q.ExecuteNonQuery()==1;}
}
