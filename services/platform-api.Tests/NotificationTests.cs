using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class NotificationTests:IDisposable {
 readonly string root=Path.Combine(Path.GetTempPath(),"lw-notifications-"+Guid.NewGuid().ToString("N"));readonly string connection;readonly NotificationRepository repo;
 public NotificationTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";Sql("""
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,is_active INTEGER,display_name TEXT,closed_at TEXT);
 INSERT INTO users(id,role,is_active,display_name) VALUES('customer','customer',1,'Customer'),('other','customer',1,'Other'),('admin','admin',1,'Admin'),('owner','owner',1,'Owner'),('disabled','admin',0,'Disabled');
 CREATE TABLE projects(id TEXT PRIMARY KEY,owner_id TEXT,project_json TEXT,task_number TEXT,status TEXT,workflow_status TEXT,version INTEGER,assignee_user_id TEXT);
 INSERT INTO projects VALUES('p','customer','{"projectName":"Original 项目"}',NULL,'draft','new',1,NULL);
 CREATE TABLE revision_rounds(id TEXT PRIMARY KEY,project_id TEXT,created_at TEXT,submitted_at TEXT);
 CREATE TABLE revision_messages(id TEXT PRIMARY KEY,round_id TEXT,unit TEXT,body TEXT,author_id TEXT,is_admin INTEGER,created_at TEXT);
 CREATE TABLE project_deliveries(id TEXT PRIMARY KEY,project_id TEXT,uploader_user_id TEXT,revoked_at TEXT);
 """);Sql("ALTER TABLE projects ADD COLUMN followup_due_at TEXT;ALTER TABLE projects ADD COLUMN followup_version INTEGER NOT NULL DEFAULT 0");repo=new(connection);repo.Initialize();}
 void Sql(string sql){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=sql;q.ExecuteNonQuery();}
 [Fact] public void CompletionIsDeliveredToProjectOwnerAndRespectsEmailScope(){
  Capture("completed","completed");repo.Dispatch();Assert.Equal("completed",Assert.Single(Feed("customer").Items).Kind);
  Assert.True(repo.HasEmailCandidate("customer",0,long.MaxValue,["completed"]));
  Assert.False(repo.HasEmailCandidate("customer",0,long.MaxValue,["progress"]));
  Assert.False(repo.HasEmailCandidate("other",0,long.MaxValue,["completed"]));
 }
 NotificationPage Feed(string user="admin",long? before=null,string? state=null)=>repo.List(user,"zh-CN",before,null,null,state,null,null,null);
 void Capture(string key,string kind="workflow",string actor="admin",string target=""){using var c=new SqliteConnection(connection);c.Open();using var tx=c.BeginTransaction();NotificationRepository.Capture(c,tx,key,kind,"p",actor,target);tx.Commit();}
 [Fact] public void BackupAlertsAreOwnerOnlyDeduplicatedDurableAndResolved(){
  var now=DateTimeOffset.Parse("2026-09-11T00:00:00Z");var policy=new BackupPolicy(true);var failed=new BackupRecord("failed",now,"scheduled","failed");
  repo.CheckBackupAlerts(policy,[failed],now);repo.Dispatch();var first=Assert.Single(Feed("owner").Items);
  Assert.Equal("backup_failed",first.Kind);Assert.Equal("pending",first.State);Assert.Empty(Feed("admin").Items);Assert.Empty(Feed("customer").Items);
  Assert.Equal("/en-US/settings/backups",repo.Target("owner",first.Id,"en-US",true)!.Path);
  Assert.Equal("/api/portals/backups?locale=zh-CN",repo.Target("owner",first.Id,"zh-CN",false)!.Path);
  Assert.Contains("Automatic backup failed",repo.List("owner","en-US",null,null,null,null,null,null,null).Items[0].Title);
  var restarted=new NotificationRepository(connection);restarted.Initialize();restarted.CheckBackupAlerts(policy,[failed],now.AddMinutes(2));restarted.Dispatch();Assert.Single(Feed("owner").Items);
  var good=new BackupRecord("good",now.AddHours(1),"manual","completed",VerificationStatus:"passed");repo.CheckBackupAlerts(policy,[failed,good],now.AddHours(1));Assert.Equal("done",Feed("owner").Items[0].State);
  repo.CheckBackupAlerts(policy,[failed,good,failed with{Id="next",CreatedAt=now.AddHours(2)}],now.AddHours(2));repo.Dispatch();Assert.Equal(2,Feed("owner").Items.Length);
  Sql("UPDATE users SET role='admin' WHERE id='owner'");Assert.Empty(Feed("owner").Items);Assert.Equal(0,repo.Counts("owner").Unread);Assert.Null(repo.Target("owner",first.Id,"en-US",true));
 }
 [Theory][InlineData("daily",2)][InlineData("weekly",14)] public void MissingBackupAlertHonorsEnablementGracePeriodAndDoesNotRepeat(string frequency,int days){
  var now=DateTimeOffset.Parse("2026-09-11T00:00:00Z");var policy=new BackupPolicy(true,frequency);
  repo.CheckBackupAlerts(new(false,frequency),[],now.AddDays(-30));repo.CheckBackupAlerts(policy,[],now);
  repo.CheckBackupAlerts(policy,[new BackupRecord("old",now.AddDays(-60),"manual","completed")],now.AddDays(days).AddSeconds(-1));repo.Dispatch();Assert.Empty(Feed("owner").Items);
  repo.CheckBackupAlerts(policy,[],now.AddDays(days));repo.Dispatch();Assert.Equal("backup_stale",Assert.Single(Feed("owner").Items).Kind);
  repo.CheckBackupAlerts(policy,[],now.AddDays(days+1));repo.Dispatch();Assert.Single(Feed("owner").Items);
  repo.CheckBackupAlerts(policy with{Enabled=false},[],now.AddDays(days+2));Assert.Equal("done",Feed("owner").Items[0].State);
 }
 [Fact] public void DamagedBackupAlertsPersistThroughRecheckAndRespectRuleAndRecipientRestrictions(){
  var now=DateTimeOffset.UtcNow;var bad=new BackupRecord("bad",now,"manual","completed",VerificationStatus:"damaged");
  var rule=repo.Rules().Items.Single(x=>x.Kind=="backup_damaged");Assert.False(repo.SaveRule(rule with{Audience="allAdmins"}));
  repo.CheckBackupAlerts(new(),[bad],now);repo.Dispatch();Assert.Equal("backup_damaged",Assert.Single(Feed("owner").Items).Kind);
  foreach(var status in new[]{"checking","interrupted","unavailable","recordFailed"}){repo.CheckBackupAlerts(new(),[bad with{VerificationStatus=status}],now);Assert.Equal("pending",Feed("owner").Items[0].State);}
  repo.CheckBackupAlerts(new(),[bad],now);repo.Dispatch();Assert.Single(Feed("owner").Items);
  repo.CheckBackupAlerts(new(),[bad with{VerificationStatus="passed"}],now);Assert.Equal("done",Feed("owner").Items[0].State);
  Assert.True(repo.SaveRule(rule with{Enabled=false}));repo.CheckBackupAlerts(new(),[bad],now);repo.Dispatch();Assert.Single(Feed("owner").Items);
 }
 [Fact] public void PromotedOperatorDoesNotKeepCustomerNotificationAccessToUnassignedProjects(){
  Capture("owned");repo.Dispatch();var item=Assert.Single(Feed("customer").Items);
  Sql("UPDATE users SET role='operator' WHERE id='customer'");
  Assert.Empty(Feed("customer").Items);Assert.Null(repo.Target("customer",item.Id,"en-US",true));
 }
 [Fact] public void OperatorNotificationsFollowAssignmentAndRevokeHistoricalAccess(){
  Sql("INSERT INTO users(id,role,is_active,display_name) VALUES('op1','operator',1,'One'),('op2','operator',1,'Two');UPDATE projects SET assignee_user_id='op1'");
  repo.Initialize(); // The upgraded trigger must also replace an existing definition.
  Capture("assigned","customer_reply","customer");repo.Dispatch();
  var item=Assert.Single(Feed("op1").Items);Assert.Empty(Feed("op2").Items);Assert.Empty(Feed("admin").Items);
  Assert.Contains("/projects?project=p",repo.Target("op1",item.Id,"en-US",true)!.Path);
  Sql("UPDATE projects SET assignee_user_id='op2'");
  Assert.Empty(Feed("op1").Items);Assert.Equal(0,repo.Counts("op1").Unread);Assert.Null(repo.Target("op1",item.Id,"en-US",true));
  Capture("reassigned","customer_reply","customer");repo.Dispatch();Assert.Single(Feed("op2").Items);
  Sql("UPDATE projects SET assignee_user_id=NULL");Capture("fallback","customer_reply","customer");repo.Dispatch();
  Assert.Single(Feed("admin").Items);Assert.Empty(Feed("op1").Items);Assert.Empty(Feed("op2").Items);
 }
 [Fact] public void SuccessfulBatchesDoNotConsumeFailureRetries(){
  Sql("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<2501) INSERT INTO users(id,role,is_active,display_name) SELECT 'bulk-'||n,'admin',1,'Bulk' FROM ids");
  Capture("bulk","customer_reply","customer");
  for(var i=0;i<5;i++)repo.Dispatch();
  Assert.Equal(0,repo.Logs(null).Items[0].Attempts);
  Sql("CREATE TRIGGER fail_delivery BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;");
  repo.Dispatch();Assert.Equal(1,repo.Logs(null).Items[0].Attempts);Assert.Equal("pending",repo.Logs(null).Items[0].Status);
  for(var i=0;i<4;i++){Sql("UPDATE notification_events SET next_attempt=NULL");repo.Dispatch();}
  Assert.Equal("failed",repo.Logs(null).Items[0].Status);Assert.Equal(5,repo.Logs(null).Items[0].Attempts);
  Sql("DROP TRIGGER fail_delivery");Assert.True(repo.Retry(repo.Logs(null).Items[0].Id));repo.Dispatch();
  Assert.Equal("sent",repo.Logs(null).Items[0].Status);Assert.Equal(0,repo.Logs(null).Items[0].Attempts);Assert.Single(Feed("bulk-2501").Items);
 }
 [Fact] public void CompletedRoundRepliesExpireWithoutExposingHistory(){
  Sql("INSERT INTO revision_rounds VALUES('old','p','2026-01-01',NULL);INSERT INTO revision_messages VALUES('message','old','project','body','admin',1,'2026-01-02')");repo.Dispatch();
  var item=Assert.Single(Feed("customer").Items);Assert.Equal("info",item.State);Assert.Contains("/edit/project?notification=message",repo.Target("customer",item.Id,"en-US",false)!.Path);
  Sql("UPDATE revision_rounds SET submitted_at='2026-01-03';UPDATE projects SET status='submitted'");
  Assert.Equal("expired",Assert.Single(Feed("customer").Items).State);Assert.Null(repo.Target("customer",item.Id,"en-US",false));
  Sql("UPDATE projects SET status='draft';INSERT INTO revision_rounds VALUES('new','p','2026-01-04',NULL)");
  Assert.Equal("expired",Assert.Single(Feed("customer").Items).State);Assert.Null(repo.Target("customer",item.Id,"zh-CN",false));
 }
 [Fact] public void SubmissionIsDurableDeduplicatedAndSnapshotScoped(){Sql("UPDATE projects SET status='submitted',task_number='P1',version=2 WHERE id='p'");Assert.Equal(1,repo.Logs(null).Pending);Sql("INSERT INTO users(id,role,is_active,display_name) VALUES('late','admin',1,'Late')");repo.Dispatch();repo.Dispatch();Assert.Single(Feed().Items);Assert.Single(Feed("owner").Items);Assert.Empty(Feed("late").Items);Assert.Empty(Feed("customer").Items);Assert.Empty(Feed("other").Items);Assert.Empty(Feed("disabled").Items);Assert.Equal("项目已提交：Original 项目",Feed().Items[0].Title);Assert.Contains("Project submitted",repo.List("admin","en-US",null,null,null,null,null,null,null).Items[0].Title);}
 [Fact] public void RollbackDoesNotProduceNotifications(){using(var c=new SqliteConnection(connection)){c.Open();using var tx=c.BeginTransaction();using var q=c.CreateCommand();q.Transaction=tx;q.CommandText="UPDATE projects SET status='submitted',version=2";q.ExecuteNonQuery();tx.Rollback();}repo.Dispatch();Assert.Empty(Feed().Items);Assert.Empty(repo.Logs(null).Items);}
 [Fact] public void AssigneeAndActorExclusionAreEnforced(){Sql("UPDATE projects SET assignee_user_id='admin'");Capture("r","customer_reply","customer");repo.Dispatch();Assert.Single(Feed().Items);Assert.Empty(Feed("owner").Items);Capture("self","workflow","customer");repo.Dispatch();Assert.Empty(Feed("customer").Items);}
 [Fact] public void ReadAllHasWatermarkAndCannotAffectAnotherAccount(){Capture("1");repo.Dispatch();var page=Feed("customer");Capture("2");repo.Dispatch();Assert.True(repo.Update("other",new([page.Items[0].Id],null,"read")));Assert.Equal(2,repo.Counts("customer").Unread);Assert.True(repo.Update("customer",new(null,page.Watermark,"read")));Assert.Equal(1,repo.Counts("customer").Unread);Assert.True(repo.Update("customer",new([page.Items[0].Id],null,"archive")));Assert.Single(Feed("customer").Items);Assert.True(repo.Update("customer",new([page.Items[0].Id],null,"restore")));Assert.Equal(2,Feed("customer").Items.Length);}
 [Fact] public void ReturnReadAndActionStateAreIndependent(){Sql("INSERT INTO revision_rounds VALUES('round','p','2026-01-01',NULL)");Capture("return","returned","admin","round");repo.Dispatch();var item=Assert.Single(Feed("customer").Items);repo.Update("customer",new([item.Id],null,"read"));Assert.Equal("pending",Assert.Single(Feed("customer").Items).State);Sql("UPDATE revision_rounds SET submitted_at='2026-01-02'");Assert.Equal("done",Assert.Single(Feed("customer").Items).State);}
 [Fact] public void RepliesAndDeliveryTriggersAvoidInitialReasonsAndInvalidateRevokedDelivery(){Sql("INSERT INTO revision_rounds VALUES('round','p','2026-01-01',NULL);INSERT INTO revision_messages VALUES('initial','round','project','private','admin',1,'2026-01-01');INSERT INTO revision_messages VALUES('reply','round','project','body','admin',1,'2026-01-02');INSERT INTO project_deliveries VALUES('d','p','admin',NULL)");repo.Dispatch();Assert.Equal(2,Feed("customer").Items.Length);Assert.Empty(Feed("other").Items);Assert.NotNull(repo.Target("customer",Feed("customer").Items[0].Id,"zh-CN",false));Sql("UPDATE project_deliveries SET revoked_at='2026-01-03'");Assert.Equal("expired",Feed("customer").Items[0].State);Assert.Null(repo.Target("customer",Feed("customer").Items[0].Id,"zh-CN",false));}
 [Fact] public void PermissionsAreRecheckedAndTargetsArePrivate(){Sql("UPDATE projects SET status='submitted',version=2");repo.Dispatch();var item=Feed().Items[0];Assert.NotNull(repo.Target("admin",item.Id,"en-US",true));Assert.Null(repo.Target("other",item.Id,"en-US",true));Sql("UPDATE users SET role='customer' WHERE id='admin'");Assert.Empty(Feed().Items);Assert.Equal(0,repo.Counts("admin").Unread);Assert.Null(repo.Target("admin",item.Id,"en-US",true));}
 [Fact] public void RulesHaveVersionsAndTemplatesAreValidated(){var rule=repo.Rules().Items.Single(x=>x.Kind=="workflow");Assert.False(repo.SaveRule(rule with {TitleEn="{secret}"}));Assert.True(repo.SaveRule(rule with {Enabled=false}));Assert.False(repo.SaveRule(rule));Capture("disabled");repo.Dispatch();Assert.Empty(Feed("customer").Items);}
 [Fact] public void RetryDoesNotDuplicateRecipients(){Capture("event");repo.Dispatch();Sql("UPDATE notification_events SET status='failed'");var id=repo.Logs(null).Items[0].Id;Assert.True(repo.Retry(id));repo.Dispatch();Assert.Single(Feed("customer").Items);Assert.False(repo.Retry(id));}
 [Fact] public void PagingAndFiltersAreServerSide(){for(var i=0;i<35;i++)Capture("event"+i);repo.Dispatch();var first=Feed("customer");Assert.Equal(30,first.Items.Length);var second=Feed("customer",first.NextCursor);Assert.Equal(5,second.Items.Length);Assert.Empty(first.Items.Select(x=>x.Id).Intersect(second.Items.Select(x=>x.Id)));Assert.Empty(repo.List("customer","en-US",null,"no match",null,null,null,null,null).Items);Assert.Empty(repo.List("customer","en-US",null,null,"returned",null,null,null,null).Items);}
 [Fact] public void PreferencesAndRetentionValidateAndPreserveUnread(){Assert.False(repo.SavePreferences("customer",new(QuietStart:"bad")));Assert.False(repo.SavePreferences("customer",new(TimeZone:"not-a-timezone")));Assert.True(repo.SavePreferences("customer",new(QuietStart:"22:00",QuietEnd:"08:00",TimeZone:"Asia/Shanghai")));Assert.Equal("22:00",repo.Preferences("customer").QuietStart);Assert.False(repo.Retention(0));Capture("old");repo.Dispatch();Sql("UPDATE notification_events SET created_at='2000-01-01'");repo.Cleanup();Assert.Single(Feed("customer").Items);var id=Feed("customer").Items[0].Id;repo.Update("customer",new([id],null,"read"));repo.Update("customer",new([id],null,"archive"));repo.Cleanup();Assert.Empty(repo.Logs(null).Items);}
 [Fact] public void OnlyLatestSubmissionIsPendingAfterResubmission(){Sql("UPDATE projects SET status='submitted',task_number='P1',version=2");repo.Dispatch();Sql("UPDATE projects SET status='draft',workflow_status='awaiting_customer';UPDATE projects SET status='submitted',workflow_status='new',version=3");repo.Dispatch();Assert.Single(Feed("admin",state:"pending").Items);Assert.Equal("done",Feed().Items.Last().State);}
 [Fact] public void PreferenceValidationUsesCurrentRules(){var rule=repo.Rules().Items.Single(x=>x.Kind=="returned");Assert.True(repo.SaveRule(rule with {AllowMute=true}));Assert.True(repo.SavePreferences("customer",new(MutedKinds:["returned"])));var updated=repo.Rules().Items.Single(x=>x.Kind=="returned");Assert.True(repo.SaveRule(updated with {AllowMute=false}));Assert.False(repo.SavePreferences("customer",new(MutedKinds:["returned"])));}
 [Fact] public void AccountNotificationsArePrivateAndDoNotRequireAProject(){using(var c=new SqliteConnection(connection)){c.Open();using var tx=c.BeginTransaction();NotificationRepository.Capture(c,tx,"account-change","account","","admin","customer");tx.Commit();}repo.Dispatch();var item=Assert.Single(Feed("customer").Items);Assert.Equal("account",item.Kind);Assert.Empty(Feed("other").Items);Assert.Empty(Feed("admin").Items);Assert.Equal("/zh-CN/profile",repo.Target("customer",item.Id,"zh-CN",false)!.Path);}
 [Fact] public void RetentionNeverDeletesAnOpenAction(){Sql("INSERT INTO revision_rounds VALUES('open','p','2000-01-01',NULL)");Capture("pending","returned","admin","open");repo.Dispatch();var id=Feed("customer").Items[0].Id;repo.Update("customer",new([id],null,"read"));repo.Update("customer",new([id],null,"archive"));Sql("UPDATE notification_events SET created_at='2000-01-01'");repo.Cleanup();Assert.Single(repo.Logs(null).Items);}
 public void Dispose()=>Directory.Delete(root,true);
}
