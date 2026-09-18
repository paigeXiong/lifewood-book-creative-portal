using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class AnnouncementTests:IDisposable {
 private readonly string root=Path.Combine(Path.GetTempPath(),"lw-announcements-"+Guid.NewGuid().ToString("N"));
 private readonly string connection;private readonly AnnouncementRepository repo;
 public AnnouncementTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"test.db")+";Pooling=False";Sql("CREATE TABLE users(id TEXT,locale TEXT,organization_id TEXT,is_active INTEGER);CREATE TABLE organizations(id TEXT,is_active INTEGER);INSERT INTO organizations VALUES('a',1),('b',1);INSERT INTO users VALUES('one','zh-CN','a',1),('two','en-US','a',1),('three','zh-CN','b',1),('four',NULL,'a',1),('disabled','zh-CN','a',0);");repo=new(connection);repo.Initialize();}
 private void Sql(string sql){using var db=new SqliteConnection(connection);db.Open();using var c=db.CreateCommand();c.CommandText=sql;c.ExecuteNonQuery();}
 private static AnnouncementInput Input()=>new("公告","正文","Notice","Body","personal","specified",["zh-CN"],["a"],null,null);
 private AnnouncementDocument Publish(AnnouncementInput? input=null){var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,input??Input(),out var d));Assert.Null(repo.Transition(id,d!.Version,true,out d));return d!;}
 [Fact] public void RecipientsAreAnIntersectionAndHistoryIsPrivateAndStable(){var d=Publish();Assert.Equal(2,d.Recipients);Assert.Single(repo.Feed("one","zh-CN",null).Items);Assert.Single(repo.Feed("four","zh-CN",null).Items);Assert.Empty(repo.Feed("two","zh-CN",null).Items);Assert.Empty(repo.Feed("three","zh-CN",null).Items);Assert.Empty(repo.Feed("disabled","zh-CN",null).Items);Assert.Empty(repo.Feed(null,"zh-CN",null).Items);Assert.False(repo.Dismiss("two",d.Id));Sql("UPDATE users SET locale='en-US',organization_id='b' WHERE id='one';INSERT INTO users VALUES('new','zh-CN','a',1);");Assert.Single(repo.Feed("one","en-US",null).Items);Assert.Empty(repo.Feed("new","zh-CN",null).Items);Assert.True(repo.Dismiss("one",d.Id));var restarted=new AnnouncementRepository(connection);Assert.Empty(restarted.Feed("one","zh-CN",null,true).Items);Assert.True(Assert.Single(restarted.Feed("one","zh-CN",null).Items).Dismissed);}
 [Fact] public void PagingDoesNotMixAccountsOrDuplicateNewArrivals(){for(var i=0;i<23;i++)Publish();var first=repo.Feed("one","zh-CN",null);Assert.Equal(20,first.Items.Length);Publish();var second=repo.Feed("one","zh-CN",first.NextCursor);Assert.Equal(3,second.Items.Length);Assert.Empty(first.Items.Select(x=>x.Id).Intersect(second.Items.Select(x=>x.Id)));Assert.Empty(repo.Feed("three","zh-CN",null).Items);}
 [Fact] public void PublicLanguageSchedulingAndWithdrawalAreEnforced(){var d=Publish(Input() with {Placement="login",OrganizationIds=[]});Assert.Single(repo.Feed(null,"zh-CN",null).Items);Assert.Empty(repo.Feed(null,"en-US",null).Items);Assert.Null(repo.Transition(d.Id,d.Version,false,out _));Assert.Empty(repo.Feed(null,"zh-CN",null).Items);var upgraded=Publish(Input() with {StartsAt=DateTimeOffset.UtcNow.AddDays(1).ToString("O")});Assert.Null(upgraded.Content.StartsAt);Assert.Equal(30,upgraded.Content.DisplayDays);Assert.Single(repo.Feed("one","zh-CN",null).Items);}
 [Fact] public void ValidationAndOptimisticVersionsProtectPublishedContent(){var id=Guid.NewGuid().ToString("N");Assert.Equal("invalid",repo.Save(id,Input() with {Placement="login"},out _));Assert.Equal("invalid",repo.Save(id,Input() with {Audience="specified",Languages=[],OrganizationIds=[]},out _));Assert.Equal("invalid",repo.Save(id,Input() with {EndsAt="bad date"},out _));Assert.Null(repo.Save(id,Input(),out var draft));Assert.Equal("conflict",repo.Save(id,Input(),out _));Assert.Null(repo.Transition(id,draft!.Version,true,out var published));Assert.Equal("conflict",repo.Save(id,Input() with {Version=published!.Version},out _));Assert.Equal("conflict",repo.Transition(id,draft.Version,false,out _));}
 [Fact] public void BulkDismissOnlyChangesTheCallingAccountsReceipts(){var a=Publish();var b=Publish();Assert.True(repo.DismissMany("one",[a.Id,b.Id]));Assert.Empty(repo.Feed("one","zh-CN",null,true).Items);Assert.Equal(2,repo.Feed("four","zh-CN",null,true).Items.Length);Assert.True(repo.DismissMany("two",[a.Id]));Assert.Equal(2,repo.Feed("four","zh-CN",null,true).Items.Length);Assert.False(repo.DismissMany("one",new string[501]));}
 [Fact] public void FiltersCombineWithSearchAndPreviewMatchesPublication(){var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,Input(),out var d));Assert.Null(repo.Preview(id,d!.Version,out var preview));Assert.Equal(2,preview!.Count);Assert.Single(repo.List(null,"公告","draft","personal").Items);Assert.Empty(repo.List(null,"公告","published","personal").Items);Assert.Empty(repo.List(null,"公告","draft","login").Items);Assert.Null(repo.Transition(id,d.Version,true,out var sent));Assert.Equal(preview.Count,sent!.Recipients);Assert.Equal("conflict",repo.Preview(id,d.Version,out _));}
 [Fact] public void OnlyCurrentDraftsCanBeDeleted(){var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,Input(),out var d));Assert.Equal("conflict",repo.DeleteDraft(id,0));Assert.Null(repo.DeleteDraft(id,d!.Version));Assert.Equal("missing",repo.DeleteDraft(id,d.Version));Assert.Empty(repo.List(null,null).Items);var sent=Publish();Assert.Equal("conflict",repo.DeleteDraft(sent.Id,sent.Version));Assert.Single(repo.Feed("one","zh-CN",null).Items);}
 [Fact] public void SingleContentDoesNotRequireTranslationsAndNeverChangesWithUiLocale(){var input=Input() with {Title="仅此一条",Body="无需英文",TitleZh=null,BodyZh=null,TitleEn=null,BodyEn=null,Audience="all",Languages=[],OrganizationIds=[]};var d=Publish(input);Assert.Equal(4,d.Recipients);Assert.Equal("仅此一条",Assert.Single(repo.Feed("one","en-US",null).Items).Title);Assert.Equal("无需英文",Assert.Single(repo.Feed("two","zh-CN",null).Items).Body);Assert.Single(repo.List(null,"仅此").Items);Assert.Equal("invalid",repo.Save(Guid.NewGuid().ToString("N"),input with {Body=""},out _));}
 [Fact] public void SingleContentTargetingIsOptionalAndLegacyTranslationsRemainReadable(){
  var legacy=Publish(Input() with {Audience="all",Languages=[],OrganizationIds=[]});
  Assert.Equal("Notice",Assert.Single(repo.Feed("two","en-US",null).Items).Title);
  var single=Input() with {Title="English-only update",Body="One message",TitleZh=null,BodyZh=null,TitleEn=null,BodyEn=null,Languages=["en-US"],OrganizationIds=[]};
  var targeted=Publish(single);Assert.Equal(1,targeted.Recipients);
  Assert.DoesNotContain(repo.Feed("one","en-US",null).Items,x=>x.Id==targeted.Id);
  Assert.Equal("English-only update",repo.Feed("two","zh-CN",null).Items.Single(x=>x.Id==targeted.Id).Title);
  var publicNotice=Publish(single with {Placement="login",Audience="all",Languages=[]});
  Assert.Equal("One message",Assert.Single(repo.Feed(null,"zh-CN",null).Items).Body);
  Assert.Equal("One message",Assert.Single(repo.Feed(null,"en-US",null).Items).Body);
  Assert.Equal("invalid",repo.Save(Guid.NewGuid().ToString("N"),single with {Title=null},out _));
 }
 [Theory]
 [InlineData(1)] [InlineData(30)] [InlineData(60)]
 public void DisplayDaysStartAtPublicationAndExpiredNoticesRemainInHistory(int days){
  var id=Guid.NewGuid().ToString("N");
  Assert.Null(repo.Save(id,Input() with {DisplayDays=days,StartsAt="2000-01-01T00:00:00Z",EndsAt="2000-01-02T00:00:00Z"},out var draft));
  Assert.Null(draft!.Content.StartsAt);Assert.Null(draft.Content.EndsAt);
  Assert.Null(repo.Transition(id,draft.Version,true,out var sent));
  Assert.Equal(TimeSpan.FromDays(days),DateTimeOffset.Parse(sent!.Content.EndsAt!)-DateTimeOffset.Parse(sent.CreatedAt));
  Assert.True(Assert.Single(repo.Feed("one","zh-CN",null,true).Items).Popup);
  Sql("UPDATE announcements SET document=json_set(document,'$.content.endsAt','2000-01-01T00:00:00Z')");
  Assert.Empty(repo.Feed("one","zh-CN",null,true).Items);
  Assert.False(Assert.Single(repo.Feed("one","zh-CN",null).Items).Popup);
 }
 [Theory] [InlineData(0)] [InlineData(-1)] [InlineData(3651)]
 public void DisplayDaysRejectInvalidRanges(int days){Assert.Equal("invalid",repo.Save(Guid.NewGuid().ToString("N"),Input() with {DisplayDays=days},out _));}
 [Fact] public void ExpiredPublicDisplayPeriodStopsAppearing(){
  Publish(Input() with {DisplayDays=1,Placement="login",OrganizationIds=[]});
  Assert.Single(repo.Feed(null,"zh-CN",null).Items);
  Sql("UPDATE announcements SET document=json_set(document,'$.content.endsAt','2000-01-01T00:00:00Z')");
  Assert.Empty(repo.Feed(null,"zh-CN",null).Items);
 }
 [Fact] public void BannersArePrivatePersistentDismissibleAndSeparateFromPopups(){
  var banner=Publish(Input() with {Placement="banner"});
  Assert.Equal(2,banner.Recipients);
  Assert.Single(repo.Feed("one","zh-CN",null,true,true).Items);
  Assert.Equal("Notice",Assert.Single(repo.Feed("one","en-US",null,true,true).Items).Title);
  Assert.Empty(repo.Feed("one","zh-CN",null,true).Items);
  Assert.Empty(repo.Feed("three","zh-CN",null,true,true).Items);
  Assert.Empty(repo.Feed(null,"zh-CN",null,true,true).Items);
  Assert.False(repo.Dismiss("three",banner.Id));
  Assert.True(repo.Dismiss("one",banner.Id));
  var restarted=new AnnouncementRepository(connection);
  Assert.Empty(restarted.Feed("one","zh-CN",null,true,true).Items);
  Assert.True(Assert.Single(restarted.Feed("one","zh-CN",null).Items).Dismissed);
  Assert.Single(restarted.Feed("four","zh-CN",null,true,true).Items);
  var next=Publish(Input() with {Placement="banner"});
  Assert.Equal(next.Id,Assert.Single(repo.Feed("one","zh-CN",null,true,true).Items).Id);
  Assert.Null(repo.Transition(next.Id,next.Version,false,out _));
  Assert.Empty(repo.Feed("one","zh-CN",null,true,true).Items);
 }
 [Fact] public void BannerSelectionIsNotHiddenBehindPopupPagesAndExpires(){
  var banner=Publish(Input() with {Placement="banner"});
  for(var i=0;i<22;i++)Publish();
  Assert.Equal(banner.Id,Assert.Single(repo.Feed("one","zh-CN",null,true,true).Items).Id);
  Sql("UPDATE announcements SET document=json_set(document,'$.content.endsAt','2000-01-01T00:00:00Z')");
  Assert.Empty(repo.Feed("one","zh-CN",null,true,true).Items);
 }
 [Fact] public void ScheduledPublicationPersistsUsesActualRecipientsAndCompletesOnce(){
  var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,Input(),out var draft));var runAt=DateTimeOffset.UtcNow.AddHours(1);
  Assert.Null(repo.Schedule(id,new(draft!.Version,runAt),out var scheduled));Assert.Equal("scheduled",scheduled!.Status);
  Assert.Empty(repo.Feed("one","zh-CN",null).Items);Assert.Empty(repo.Due(DateTimeOffset.UtcNow));
  var restarted=new AnnouncementRepository(connection);var due=Assert.Single(restarted.Due(runAt.AddMinutes(1)));Assert.Equal(id,due.Id);
  Sql("INSERT INTO users VALUES('late','zh-CN','a',1)");
  Assert.Null(restarted.Transition(due.Id,due.Version,true,out var published));Assert.Equal(3,published!.Recipients);
  Assert.Equal("conflict",repo.Transition(due.Id,due.Version,true,out _));Assert.Empty(repo.Due(runAt.AddMinutes(1)));
  var record=Assert.Single(repo.Jobs(1,"en-US").Items);Assert.Equal("completed",record.Status);Assert.Equal("Notice",record.Title);Assert.NotNull(record.FinishedAt);
  Assert.Equal(0,repo.Jobs(1,"zh-CN").Pending);Assert.Null(repo.Jobs(1,"zh-CN").NextRunAt);
 }
 [Fact] public void CancellationAndFailureKeepHistoryAndRequireNewVersion(){
  var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,Input(),out var draft));
  Assert.Equal("invalid",repo.Schedule(id,new(draft!.Version,DateTimeOffset.UtcNow.AddMinutes(-1)),out _));
  Assert.Null(repo.Schedule(id,new(draft.Version,DateTimeOffset.UtcNow.AddHours(1)),out var scheduled));
  Assert.Equal("conflict",repo.Save(id,Input() with {Version=scheduled!.Version},out _));
  Assert.Null(repo.CancelSchedule(id,scheduled.Version,out var cancelled));Assert.Equal("draft",cancelled!.Status);
  Assert.Equal("conflict",repo.Transition(id,scheduled.Version,true,out _));
  Assert.Null(repo.Schedule(id,new(cancelled.Version,DateTimeOffset.UtcNow.AddHours(2)),out var retry));
  repo.FailSchedule(id,retry!.Version);Assert.Equal(0,repo.Jobs(1,"zh-CN").Pending);
  Assert.Equal(new[]{"failed","cancelled"},repo.Jobs(1,"zh-CN").Items.Select(x=>x.Status).ToArray());
  var restored=Assert.Single(repo.List(null,null,"draft").Items);Assert.Null(repo.DeleteDraft(id,restored.Version));
  Assert.Equal(2,repo.Jobs(1,"zh-CN").Items.Length);Assert.All(repo.Jobs(1,"en-US").Items,item=>Assert.Equal("Notice",item.Title));
 }
 [Fact] public void AutomaticPublicationRollsBackWhenAuditCannotBeWritten(){
  new AuditRepository(connection,root).Initialize();
  var id=Guid.NewGuid().ToString("N");Assert.Null(repo.Save(id,Input(),out var draft));Assert.Null(repo.Schedule(id,new(draft!.Version,DateTimeOffset.UtcNow.AddHours(1)),out var scheduled));
  Sql("UPDATE announcements SET document=json_set(document,'$.scheduledAt','2000-01-01T00:00:00Z'); CREATE TRIGGER reject_auto_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'test'); END;");
  Assert.Throws<SqliteException>(()=>repo.Transition(id,scheduled!.Version,true,out _,automated:true));
  Assert.Empty(repo.Feed("one","zh-CN",null).Items);Assert.Equal(1,repo.Jobs(1,"zh-CN").Pending);
  Sql("DROP TRIGGER reject_auto_audit");
  Assert.Null(repo.Transition(id,scheduled!.Version,true,out _,automated:true));Assert.Equal("completed",Assert.Single(repo.Jobs(1,"zh-CN").Items).Status);
 }
 public void Dispose(){Directory.Delete(root,true);}
}
