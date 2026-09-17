using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.DataProtection;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class AccountClosureTests:IDisposable {
 private readonly string root=Path.Combine(Path.GetTempPath(),"account-closure-"+Guid.NewGuid().ToString("N"));
 private readonly string connection;private readonly UserRepository users;private readonly AdminRepository admin;private readonly ProjectRepository projects;private readonly UserPresenceRepository presence;private readonly AccountClosureRepository closure;private readonly string owner,customer;
 public AccountClosureTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";projects=new(connection);projects.Initialize();new RevisionStore(connection).Initialize();users=new(connection,root);users.Initialize();owner=users.CreateOwner("Owner","owner@closure.test","password-123",organizationName:"Organization").User!.Id;admin=new(connection);admin.Initialize();admin.CreateUser(new("Customer","customer@closure.test","password-123","customer",null,"123456"),out var target);customer=target!.Id;presence=new(connection);presence.Initialize();new AccountSwitchStore(connection,users).Initialize();new DeliveryRepository(connection).Initialize();new NotificationRepository(connection).Initialize();closure=new(connection);}
 private void Sql(string sql){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=sql;q.ExecuteNonQuery();}
 private long Count(string sql){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=sql;return Convert.ToInt64(q.ExecuteScalar());}
 private CloseAccountRequest Request(string id){var p=closure.Preview(id)!;return new(p.Email,p.UpdatedAt);}
 [Fact] public async Task ClosureRemovesProfileAndAccessButKeepsProjectMaterialAndHistory(){
  var draft=projects.Create(customer);var submitted=projects.Create(customer);projects.Submit(customer,submitted.Id,submitted.Version,Guid.NewGuid().ToString(),null);
  using var avatarData=new MemoryStream([1,2,3]);await users.SaveAvatar(customer,avatarData,".png",CancellationToken.None);Assert.Single(Directory.GetFiles(Path.Combine(root,"avatars")));
  presence.Login(customer);presence.Heartbeat(customer,"device",0,new(Guid.NewGuid().ToString("D"),true,true));
  var notifications=new NotificationRepository(connection);notifications.SavePreferences(customer,new());
  Sql($"INSERT INTO saved_account_sessions(device_hash,user_id,session_version,expires_at,persistent) VALUES('device','{customer}',0,'2099-01-01',1); INSERT INTO project_notes(id,project_id,author_user_id,body,created_at) VALUES('note','{submitted.Id}','{customer}','Keep this history','2026-09-09T00:00:00Z');");
  var preview=closure.Preview(customer)!;Assert.Equal(2,preview.OwnedProjects);
  Assert.Equal(AdminWriteOutcome.Saved,closure.Close(customer,owner,Request(customer),out var avatar).Outcome);users.CleanupClosedAvatar(avatar);
  Assert.Null(users.Get(customer));Assert.Null(admin.GetUser(customer));Assert.Null(closure.Preview(customer));Assert.Null(presence.Details(customer));Assert.Empty(admin.ListUsers(null,"customer",1,20).Items);
  Assert.Equal(AccountLoginOutcome.InvalidCredentials,users.Authenticate("customer@closure.test","password-123").Outcome);
  Assert.Equal(2,Count($"SELECT COUNT(*) FROM projects WHERE owner_id='{customer}'"));Assert.Equal(1,Count("SELECT COUNT(*) FROM project_notes WHERE body='Keep this history'"));Assert.NotNull(admin.GetProject(submitted.Id,owner));
  Assert.Equal(1,Count($"SELECT COUNT(*) FROM users WHERE id='{customer}' AND closed_at IS NOT NULL AND display_name='' AND email='' AND password_hash='' AND phone IS NULL AND organization_id IS NULL AND avatar_file_name IS NULL AND is_active=0 AND session_version=1"));
  Assert.Empty(Directory.GetFiles(Path.Combine(root,"avatars")));
  foreach(var table in new[]{"saved_account_sessions","user_presence","presence_session_activity","user_activity","notification_preferences"})Assert.Equal(0,Count($"SELECT COUNT(*) FROM {table} WHERE user_id='{customer}'"));
  Assert.False(notifications.SavePreferences(customer,new()));presence.EndSession(customer,"late-device");Assert.Equal(0,Count($"SELECT COUNT(*) FROM notification_preferences WHERE user_id='{customer}'"));Assert.Equal(0,Count($"SELECT COUNT(*) FROM ended_presence_sessions WHERE user_id='{customer}'"));
  presence.Login(customer);Assert.Equal(0,Count($"SELECT COUNT(*) FROM user_activity WHERE user_id='{customer}'"));Assert.False(presence.Heartbeat(customer,"device",0,new(Guid.NewGuid().ToString("D"),true,true)));
  Assert.Equal(AdminWriteOutcome.NotFound,admin.UpdateUser(customer,new("Revived","customer",true,null),out _).Outcome);Assert.Equal(PasswordUpdateOutcome.NotFound,users.ResetPassword(customer,"new-password-123").Outcome);
  Assert.Equal(AdminWriteOutcome.Saved,admin.CreateUser(new("New Customer","customer@closure.test","password-123","customer",null),out var replacement).Outcome);Assert.NotEqual(customer,replacement!.Id);Assert.Equal(0,Count($"SELECT COUNT(*) FROM projects WHERE owner_id='{replacement.Id}'"));
 }
 [Fact] public void ClosureProtectsOwnerSelfAndStaleConfirmations(){
  Assert.Equal(AdminWriteOutcome.Protected,closure.Close(owner,owner,Request(owner),out _).Outcome);
  admin.CreateUser(new("Admin","admin@closure.test","password-123","admin",null),out var staff);Assert.Equal(AdminWriteOutcome.Protected,closure.Close(staff!.Id,staff.Id,Request(staff.Id),out _).Outcome);
  Assert.Equal(AdminWriteOutcome.Protected,closure.Close(customer,customer,Request(customer),out _).Outcome);
  var request=Request(customer);Assert.Equal(AdminWriteOutcome.Conflict,closure.Close(customer,owner,request with{ConfirmEmail="wrong@closure.test"},out _).Outcome);
  Assert.Equal(AdminWriteOutcome.Conflict,closure.Close(customer,owner,request with{ExpectedUpdatedAt=request.ExpectedUpdatedAt.AddSeconds(-1)},out _).Outcome);Assert.NotNull(users.Get(customer));
 }
 [Fact] public void ClosingStaffReleasesAssignmentsWithoutDeletingProjects(){
  admin.CreateUser(new("Staff","staff@closure.test","password-123","operator",null),out var staff);
  var draft=projects.Create(customer);Sql($"UPDATE projects SET assignee_user_id='{staff!.Id}' WHERE id='{draft.Id}';");Assert.Equal(1,closure.Preview(staff.Id)!.AssignedProjects);
  Assert.Equal(AdminWriteOutcome.Saved,closure.Close(staff.Id,owner,Request(staff.Id),out _).Outcome);Assert.Equal(1,Count($"SELECT COUNT(*) FROM projects WHERE id='{draft.Id}' AND assignee_user_id IS NULL"));
 }
 [Fact] public void ClosureClearsDailyActivityWithoutAffectingOtherAccounts(){
  presence.Login(customer);presence.Login(owner);
  Assert.True(presence.Heartbeat(customer,"device",0,new(Guid.NewGuid().ToString("D"),true,true)));
  Assert.Equal(1,Count($"SELECT SUM(logins) FROM user_activity_daily WHERE user_id='{customer}'"));
  Assert.Equal(1,Count($"SELECT SUM(active_periods) FROM user_activity_daily WHERE user_id='{customer}'"));
  Assert.Equal(AdminWriteOutcome.Saved,closure.Close(customer,owner,Request(customer),out _).Outcome);
  Assert.Equal(0,Count($"SELECT COUNT(*) FROM user_activity_daily WHERE user_id='{customer}'"));
  presence.Login(customer);
  Assert.False(presence.Heartbeat(customer,"late-device",0,new(Guid.NewGuid().ToString("D"),true,true)));
  Assert.Equal(0,Count($"SELECT COUNT(*) FROM user_activity_daily WHERE user_id='{customer}'"));
  Assert.Equal(1,Count($"SELECT SUM(logins) FROM user_activity_daily WHERE user_id='{owner}'"));
 }
 [Fact] public void ClosureClearsEmailTopicsRecoveryLinksAndExternalLoginBindings(){
  var protection=new EphemeralDataProtectionProvider();
  var emails=new EmailRepository(connection,protection,EmailTests.Settings(),users,new NotificationRepository(connection));emails.Initialize();
  new OidcStore(connection,protection).Initialize();
  foreach(var id in new[]{customer,owner}){
   Sql($"INSERT INTO email_settings(user_id,email,verified) SELECT id,email,1 FROM users WHERE id='{id}'; INSERT INTO oidc_external_bindings VALUES('test','https://identity.example.test','client','{id}','{id}'); INSERT INTO oidc_flows(id,provider_id,browser_hash,version,locale,portal,user_id,session_version,expires) VALUES('{id}','test','hash',1,'en-US','customer','{id}',0,9999999999);");
   Assert.True(emails.SavePreferences(id,true,["completed","returned"]));
   Assert.True(emails.Request("reset",Assert.IsType<string>(users.Get(id)!.Email)));
  }
  string[] tables=["email_settings","email_notification_scope","email_tokens","email_requests","email_outbox","oidc_external_bindings","oidc_flows"];
  foreach(var table in tables)Assert.Equal(1,Count($"SELECT COUNT(*) FROM {table} WHERE user_id='{customer}'"));
  Assert.Equal(AdminWriteOutcome.Saved,closure.Close(customer,owner,Request(customer),out _).Outcome);
  foreach(var table in tables){
   Assert.Equal(0,Count($"SELECT COUNT(*) FROM {table} WHERE user_id='{customer}'"));
   Assert.Equal(1,Count($"SELECT COUNT(*) FROM {table} WHERE user_id='{owner}'"));
  }
  Assert.False(emails.SavePreferences(customer,true,["completed"]));
  Assert.False(emails.Request("reset","customer@closure.test"));
 }
 [Fact] public void InitializationRemovesLegacyClosedAccountCalendarButKeepsDisabledAccounts(){
  presence.Login(customer);presence.Login(owner);
  Assert.Equal(AdminWriteOutcome.Saved,closure.Close(customer,owner,Request(customer),out _).Outcome);
  // Simulate daily totals left by the earlier closure implementation.
  Sql($"INSERT OR REPLACE INTO user_activity_daily(user_id,day,logins,active_periods) VALUES('{customer}','2026-09-01',2,3); UPDATE users SET is_active=0 WHERE id='{owner}';");
  presence.Initialize();presence.Initialize();
  Assert.Equal(0,Count($"SELECT COUNT(*) FROM user_activity_daily WHERE user_id='{customer}'"));
  Assert.Equal(1,Count($"SELECT SUM(logins) FROM user_activity_daily WHERE user_id='{owner}'"));
 }
 public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
