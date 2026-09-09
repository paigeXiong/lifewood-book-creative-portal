using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;

public sealed class UserPresenceTests : IDisposable
{
 private readonly string root=Path.Combine(Path.GetTempPath(),"lw-presence-"+Guid.NewGuid().ToString("N"));
 private readonly string connection;
 private readonly UserPresenceRepository presence;
 private readonly ProjectRepository projects;
 private readonly AdminRepository admin;
 private readonly TestClock clock=new();
 private readonly string owner,customer;
 public UserPresenceTests(){
  Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";
  projects=new(connection);projects.Initialize();new RevisionStore(connection).Initialize();
  var users=new UserRepository(connection,root);users.Initialize();owner=users.CreateOwner("Owner","owner@presence.test","password-12345",organizationName:"Organization").User!.Id;
  admin=new(connection);admin.Initialize();Assert.Equal(AdminWriteOutcome.Saved,admin.CreateUser(new("Customer","customer@presence.test","password-12345","customer",null),out var user).Outcome);customer=user!.Id;
  presence=new(connection,clock);presence.Initialize();
 }
 private PagedAdminUsersDto List(string? status=null,string? organization=null,string? enabled=null,string? search=null,int page=1,int size=20)=>presence.List(search,null,status,organization,enabled,page,size,clock.GetUtcNow().Date);
 private string Tab()=>Guid.NewGuid().ToString("D");
 [Fact] public void PollingDoesNotKeepAnIdleUserOnlineOrMoveLastActive(){
  var tab=Tab();var first=clock.GetUtcNow();Assert.True(presence.Heartbeat(customer,"device",0,new(tab,true,true)));
  for(var i=0;i<4;i++){clock.Advance(60);presence.Heartbeat(customer,"device",0,new(tab,true,false));}Assert.Single(List("online").Items);
  clock.Advance(61);presence.Heartbeat(customer,"device",0,new(tab,true,false));Assert.Single(List("away").Items);
  Assert.Equal(first,presence.Details(customer)!.User.Presence!.LastActiveAt);
  clock.Advance(121);Assert.Empty(List("away").Items);Assert.Equal("offline",presence.Details(customer)!.User.Presence!.Status);
  Assert.Equal(1,List().Statistics!.TodayActive);
 }
 [Fact] public void TabsAndDevicesAggregateAndLogoutOnlyRemovesThatDevice(){
  var a=Tab();var b=Tab();var c=Tab();presence.Heartbeat(customer,"one",0,new(a,true,true));presence.Heartbeat(customer,"one",0,new(b,false,false));presence.Heartbeat(customer,"two",0,new(c,true,true));
  Assert.Equal(1,List().Statistics!.Online);presence.EndSession(customer,"one");Assert.False(presence.Heartbeat(customer,"one",0,new(a,true,true)));Assert.Single(List("online").Items);
  presence.LeaveTab(customer,"two",c);Assert.Empty(List("online").Items);
 }
 [Fact] public void SessionRevocationAndDeactivationOverrideFreshHeartbeats(){
  var tab=Tab();presence.Heartbeat(customer,"one",0,new(tab,true,true));
  Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateUser(customer,new("Customer","customer",false,null),out _).Outcome);
  Assert.Empty(List("online").Items);Assert.False(presence.Heartbeat(customer,"one",0,new(tab,true,true)));
  Assert.Equal(AdminWriteOutcome.Saved,admin.UpdateUser(customer,new("Customer","customer",true,null),out _).Outcome);
  Assert.Empty(List("online").Items);Assert.True(presence.Heartbeat(customer,"new",1,new(tab,true,true)));
  Assert.Single(List("online").Items);
 }
 [Fact] public void RestartKeepsHistoryButNeverInventsConnectedSessions(){
  presence.Login(customer);presence.Heartbeat(customer,"one",0,new(Tab(),true,true));presence.Initialize();
  var info=presence.Details(customer)!.User.Presence!;Assert.Equal("offline",info.Status);Assert.NotNull(info.LastActiveAt);Assert.NotNull(info.LastLoginAt);
  var old=presence.Details(owner)!.User.Presence!;Assert.Null(old.LastActiveAt);Assert.Null(old.LastLoginAt);
 }
 [Fact] public void ReloadPreservesRecentActivityWithoutExtendingIt(){
  var original=Tab();var first=clock.GetUtcNow();presence.Login(owner);
  presence.Heartbeat(owner,"browser",0,new(original,true,true));clock.Advance(30);
  presence.LeaveTab(owner,"browser",original);
  Assert.Equal("offline",presence.Details(owner)!.User.Presence!.Status);
  var refreshed=Tab();presence.Heartbeat(owner,"browser",0,new(refreshed,true,false));
  Assert.Equal("online",presence.Details(owner)!.User.Presence!.Status);
  Assert.Equal(first,presence.Details(owner)!.User.Presence!.LastActiveAt);
  Assert.Equal(first,presence.Details(owner)!.User.Presence!.LastLoginAt);
  // A delayed unload from the old page cannot remove the refreshed connection.
  presence.LeaveTab(owner,"browser",original);Assert.Single(List("online").Items);
  // Hidden pages remain away, even with recent activity in this session.
  presence.Heartbeat(owner,"browser",0,new(refreshed,false,false));Assert.Single(List("away").Items);
  // Repeated refreshes never extend the original five minute activity window.
  clock.Advance(271);presence.LeaveTab(owner,"browser",refreshed);
  presence.Heartbeat(owner,"browser",0,new(Tab(),true,false));Assert.Single(List("away").Items);
  Assert.Equal(first,presence.Details(owner)!.User.Presence!.LastActiveAt);
 }
 [Fact] public void ReloadActivityCannotCrossDevicesOrRevokedSessions(){
  var a=Tab();presence.Heartbeat(customer,"old",0,new(a,true,true));presence.LeaveTab(customer,"old",a);
  presence.Heartbeat(customer,"other-device",0,new(Tab(),true,false));Assert.Empty(List("online").Items);
  presence.EndSession(customer,"old");Assert.False(presence.Heartbeat(customer,"old",0,new(Tab(),true,false)));
  presence.Heartbeat(customer,"new-login",0,new(Tab(),true,false));Assert.Empty(List("online").Items);
  var retainedTab=Tab();presence.Heartbeat(customer,"versioned",0,new(retainedTab,true,true));
  admin.UpdateUser(customer,new("Customer","customer",false,null),out _);
  admin.UpdateUser(customer,new("Customer","customer",true,null),out _);
  presence.Heartbeat(customer,"versioned",1,new(retainedTab,true,false));Assert.Empty(List("online").Items);
  presence.Heartbeat(customer,"versioned",1,new(Tab(),true,false));Assert.Empty(List("online").Items);
 }
 [Fact] public void FiltersAndStatisticsUseTheSameUsersBeforePagination(){
  presence.Heartbeat(customer,"one",0,new(Tab(),true,true));
  var all=List(size:1);Assert.Equal(2,all.Total);Assert.Single(all.Items);Assert.Equal(customer,all.Items[0].Id);Assert.Equal(1,all.Statistics!.Online);
  var unassigned=List(organization:"unassigned");Assert.Equal(1,unassigned.Total);Assert.Equal(1,unassigned.Statistics!.Unassigned);
  Assert.Empty(List(status:"offline",organization:"unassigned").Items);
  Assert.Single(List(search:"Organization").Items);Assert.Empty(List(enabled:"disabled").Items);
  Assert.Equal(owner,List(page:2,size:1).Items.Single().Id);
 }
 [Fact] public void AssignableMembersAreFilteredBeforePaginationAndCannotIncludeDisabledOrCustomerAccounts(){
  admin.CreateUser(new("Operations One","op1@presence.test","password-12345","operator",null),out var one);
  admin.CreateUser(new("Operations Two","op2@presence.test","password-12345","operator",null),out var two);
  admin.CreateUser(new("Inactive Admin","disabled@presence.test","password-12345","admin",null),out var disabled);
  admin.UpdateUser(disabled!.Id,new("Inactive Admin","admin",false,null),out _);
  PagedAdminUsersDto Query(string? role=null,string? enabled=null,string? search=null,int page=1,int size=1)=>presence.List(search,role,null,null,enabled,page,size,clock.GetUtcNow().Date,true);
  var first=Query();Assert.Equal(3,first.Total);Assert.Single(first.Items);Assert.Equal(3,first.Statistics!.Enabled);
  var ids=Enumerable.Range(1,3).SelectMany(page=>Query(page:page).Items).Select(user=>user.Id).ToHashSet();
  Assert.Equal(3,ids.Count);Assert.Contains(owner,ids);Assert.Contains(one!.Id,ids);Assert.Contains(two!.Id,ids);Assert.DoesNotContain(customer,ids);Assert.DoesNotContain(disabled.Id,ids);
  Assert.Empty(Query(role:"customer").Items);Assert.Empty(Query(enabled:"disabled").Items);
  Assert.Equal(two.Id,Assert.Single(Query(search:"op2@presence.test").Items).Id);
 }
 [Fact] public void UserDetailsExcludeUnsubmittedDrafts(){
  projects.Create(customer);Assert.Equal(0,presence.Details(customer)!.SubmittedProjects);
  var draft=projects.Create(customer);projects.Submit(customer,draft.Id,draft.Version,Guid.NewGuid().ToString(),null);
  Assert.Equal(1,presence.Details(customer)!.SubmittedProjects);Assert.Null(presence.Details("missing"));
 }
 public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
 private sealed class TestClock:TimeProvider{private DateTimeOffset now=DateTimeOffset.Parse("2026-09-09T08:00:00Z");public override DateTimeOffset GetUtcNow()=>now;public void Advance(int seconds)=>now=now.AddSeconds(seconds);}
}
