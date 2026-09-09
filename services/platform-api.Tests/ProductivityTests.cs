using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class ProductivityTests:IDisposable {
 readonly string root=Path.Combine(Path.GetTempPath(),"lw-productivity-"+Guid.NewGuid().ToString("N"));
 readonly string connection;readonly ProjectRepository projects;readonly UserRepository users;readonly AdminRepository admin;readonly PersonalWorkspaceRepository workspace;readonly string owner;
 public ProductivityTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";projects=new(connection);projects.Initialize();users=new(connection,root);users.Initialize();owner=users.CreateOwner("Owner","owner@productivity.test","password-12345").User!.Id;admin=new(connection);admin.Initialize();new DeliveryRepository(connection).Initialize();workspace=new(connection);workspace.Initialize();Sql("INSERT INTO users(id,email,normalized_email,display_name,password_hash,role,is_active,created_at,updated_at) SELECT 'op','op@test.example','OP@TEST.EXAMPLE','Operator',password_hash,'operator',1,created_at,updated_at FROM users LIMIT 1");}
 void Sql(string text,params(string,object)[] args){using var c=new SqliteConnection(connection);c.Open();using var q=c.CreateCommand();q.CommandText=text;foreach(var(k,v)in args)q.Parameters.AddWithValue(k,v);q.ExecuteNonQuery();}
 TaskDraftDto Project(){var d=projects.Create(owner);return projects.Submit(owner,d.Id,d.Version,Guid.NewGuid().ToString(),null).Draft!;}
 [Fact] public void SavedFiltersAreOwnedVersionedAndBounded(){
  var id=Guid.NewGuid().ToString("N");Assert.True(workspace.Save(owner,"tasks",id,new("Mine",new(){{"status","draft"}})));
  Assert.Empty(workspace.List("op","tasks"));Assert.False(workspace.Save("op","tasks",id,new("Hijack",new(),1)));Assert.False(workspace.Delete("op",id,1));
  Assert.True(workspace.Save(owner,"tasks",id,new("Renamed",new(),1)));Assert.False(workspace.Save(owner,"tasks",id,new("Stale",new(),1)));Assert.False(workspace.Delete(owner,id,1));
  Assert.False(workspace.Save(owner,"tasks",Guid.NewGuid().ToString("N"),new("Renamed",new())));Assert.False(workspace.Save(owner,"tasks",Guid.NewGuid().ToString("N"),new("Bad",new(){{"userId","op"}})));
  for(var i=0;i<19;i++)Assert.True(workspace.Save(owner,"tasks",Guid.NewGuid().ToString("N"),new("View "+i,new())));
  Assert.False(workspace.Save(owner,"tasks",Guid.NewGuid().ToString("N"),new("Overflow",new())));Assert.Equal(20,workspace.List(owner,"tasks").Length);
  Sql("UPDATE users SET is_active=0 WHERE id=$u",("$u",owner));Assert.False(workspace.Save(owner,"tasks",id,new("Inactive",new(),2)));
 }
 [Fact] public void ResumeUsesOwnedDraftAndAllowedReturnedSection(){
  var d=projects.Create(owner);Assert.True(workspace.Resume(owner,d.Id,"voice"));Assert.False(workspace.Resume("op",d.Id,"style"));Assert.False(workspace.Resume(owner,d.Id,"unknown"));Assert.Empty(workspace.ResumeSteps("op",[d.Id]));Assert.Equal("voice",Assert.Single(workspace.ResumeSteps(owner,[d.Id])).Step);
  var submitted=projects.Submit(owner,d.Id,d.Version,Guid.NewGuid().ToString(),null).Draft!;Assert.False(workspace.Resume(owner,d.Id,"review"));
  Assert.True(new RevisionStore(connection).Return(d.Id,new(submitted.Version,[new("style","Change style")],admin.GetProject(d.Id)!.WorkflowUpdatedAt),users.Get(owner)!));
  Assert.Equal("style",Assert.Single(workspace.ResumeSteps(owner,[d.Id])).Step);Assert.True(workspace.Resume(owner,d.Id,"review"));Assert.Equal("review",Assert.Single(workspace.ResumeSteps(owner,[d.Id])).Step);
 }
 [Fact] public void ReturnedFieldUpdatesPreserveWorkflowAndRejectStaleVersion(){
  var d=Project();Assert.True(new RevisionStore(connection).Return(d.Id,new(d.Version,[new("style","Change")],admin.GetProject(d.Id)!.WorkflowUpdatedAt),users.Get(owner)!));var detail=admin.GetProject(d.Id)!;
  var request=new UpdateProjectWorkflowRequest(detail.WorkflowStatus,"high","op",detail.WorkflowUpdatedAt);
  Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateWorkflow(d.Id,request,owner,owner,true,true).Outcome);
  Assert.Equal(AdminWriteOutcome.Conflict,admin.UpdateWorkflow(d.Id,request,owner,owner,true,true).Outcome);
  Assert.Equal(detail.WorkflowStatus,admin.GetProject(d.Id)!.WorkflowStatus);Assert.Equal("draft",admin.GetProject(d.Id)!.Project.Status);
  var ordinary=projects.Create(owner);Assert.Equal(AdminWriteOutcome.NotFound,admin.UpdateWorkflow(ordinary.Id,request,owner,owner,true,true).Outcome);
 }
 [Fact] public void TrendScopesProjectsAndUsesLocalFirstSubmissionDate(){
  var p=Project();var hidden=Project();var draft=projects.Create(owner);
  Sql("UPDATE projects SET first_submitted_at='2026-01-01T20:00:00Z',followup_due_at='2026-01-02T12:00:00Z',assignee_user_id='op' WHERE id=$id",("$id",p.Id));
  Sql("UPDATE projects SET first_submitted_at='2026-01-02T12:00:00Z' WHERE id IN ($hidden,$draft)",("$hidden",hidden.Id),("$draft",draft.Id));
  var repo=new TrendRepository(connection);var days=repo.Read("op",new(2026,1,1),new(2026,1,3),480,null,null).Days;
  Assert.Equal(0,days[0].Submitted);Assert.Equal(1,days[1].Submitted);Assert.Equal(1,days[1].Overdue);Assert.Equal(0,days.Sum(x=>x.Delivered));
  Assert.Equal(2,repo.Read(owner,new(2026,1,1),new(2026,1,3),480,null,null).Days.Sum(x=>x.Submitted));
  Assert.Equal(0,repo.Read(owner,new(2026,1,1),new(2026,1,3),480,"missing",null).Days.Sum(x=>x.Submitted));
  Assert.Equal(1,repo.Read(owner,new(2026,1,1),new(2026,1,3),480,null,"Operator").Days.Sum(x=>x.Submitted));
  Sql("UPDATE projects SET workflow_status='completed' WHERE id=$id",("$id",p.Id));Assert.Equal(0,repo.Read("op",new(2026,1,1),new(2026,1,3),480,null,null).Days.Sum(x=>x.Overdue));
 }
 [Fact] public void DeviceRenewalCannotResurrectRevokedSessions(){
  var store=new AccountSwitchStore(connection,users);store.Initialize();var u=users.Get(owner)!;var version=users.GetSessionVersion(owner)!.Value;
  var a=new DefaultHttpContext();a.Request.Headers.UserAgent="Chrome/123 Windows";var first=store.Remember(a,u,version,DateTimeOffset.UtcNow.AddHours(1),true)!;
  var b=new DefaultHttpContext();var second=store.Remember(b,u,version,DateTimeOffset.UtcNow.AddHours(1),true)!;
  var list=store.Devices(owner,first,1);Assert.Equal(2,list.Total);Assert.True(list.Items[0].Current);Assert.Equal("chrome",list.Items[0].Browser);
  Assert.True(store.RenewSession(a,owner,first,version,DateTimeOffset.UtcNow.AddHours(8)));Assert.True(store.Devices(owner,first,1).Items[0].ExpiresAt>DateTimeOffset.UtcNow.AddHours(7));
  var presence=new UserPresenceRepository(connection);presence.Initialize();Assert.False(store.Revoke(owner,first,first,presence));Assert.False(store.Revoke("op","other",second,presence));Assert.True(store.Revoke(owner,first,second,presence));Assert.False(store.IsSessionActive(owner,second,version));Assert.False(store.RenewSession(b,owner,second,version,DateTimeOffset.UtcNow.AddHours(8)));Assert.Null(store.Remember(b,u,version,DateTimeOffset.UtcNow.AddHours(8),true,true));Assert.True(store.IsSessionActive(owner,first,version));
 }
 public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
