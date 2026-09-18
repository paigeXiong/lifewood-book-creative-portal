using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
 [Fact] public async Task ScheduledAnnouncementHttpWorkerPublishesAndCancellationIsVersioned()
 {
  await BootstrapOwner();var csrf=await GetCsrf(ownerClient);
  using var customer=await CreateCustomerClient(csrf);
  Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/announcements/jobs")).StatusCode);
  var id=Guid.NewGuid().ToString("N");var input=new AnnouncementInput("预约","测试","Scheduled","Test","banner","all",[],[],null,null,DisplayDays:1);
  using var saved=await Send(ownerClient,HttpMethod.Put,$"/api/admin/announcements/{id}",csrf,JsonContent.Create(input));
  var draft=(await saved.Content.ReadFromJsonAsync<AnnouncementDocument>())!;
  Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Post,$"/api/admin/announcements/{id}/schedule",await GetCsrf(customer),JsonContent.Create(new ScheduleAnnouncementRequest(draft.Version,DateTimeOffset.UtcNow.AddHours(1))))).StatusCode);
  using var scheduled=await Send(ownerClient,HttpMethod.Post,$"/api/admin/announcements/{id}/schedule",csrf,JsonContent.Create(new ScheduleAnnouncementRequest(draft.Version,DateTimeOffset.UtcNow.AddHours(1))));
  Assert.Equal(HttpStatusCode.OK,scheduled.StatusCode);var pending=(await scheduled.Content.ReadFromJsonAsync<AnnouncementDocument>())!;
  Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Post,$"/api/admin/announcements/{id}/cancel-schedule",csrf,JsonContent.Create(new {version=draft.Version}))).StatusCode);
  using var cancelled=await Send(ownerClient,HttpMethod.Post,$"/api/admin/announcements/{id}/cancel-schedule",csrf,JsonContent.Create(new {version=pending.Version}));
  Assert.Equal(HttpStatusCode.OK,cancelled.StatusCode);var restored=(await cancelled.Content.ReadFromJsonAsync<AnnouncementDocument>())!;
  using var next=await Send(ownerClient,HttpMethod.Post,$"/api/admin/announcements/{id}/schedule",csrf,JsonContent.Create(new ScheduleAnnouncementRequest(restored.Version,DateTimeOffset.UtcNow.AddSeconds(1))));
  Assert.Equal(HttpStatusCode.OK,next.StatusCode);
  AnnouncementJobsPage? jobs=null;
  for(var i=0;i<40;i++){jobs=await ownerClient.GetFromJsonAsync<AnnouncementJobsPage>("/api/admin/announcements/jobs?locale=en-US");if(jobs!.Pending==0)break;await Task.Delay(300);}
  Assert.NotNull(jobs);Assert.Equal(0,jobs.Pending);Assert.Single(jobs.Items,x=>x.Status=="completed");Assert.Single(jobs.Items,x=>x.Status=="cancelled");
  Assert.Single((await customer.GetFromJsonAsync<AnnouncementFeed>("/api/announcements/banner"))!.Items);
  using var audit=System.Text.Json.JsonDocument.Parse(await ownerClient.GetStringAsync("/api/admin/audit-events?page=1&pageSize=100"));
  Assert.Single(audit.RootElement.GetProperty("items").EnumerateArray(),item=>item.GetProperty("actionId").GetString()=="announcement.publish" && item.GetProperty("targetId").GetString()==id);
 }
 [Fact] public async Task OperatorsManageAnnouncementsWithoutConfigurationOrOrganizationWriteAccess()
 {
  await BootstrapOwner();
  var ownerCsrf=await GetCsrf(ownerClient);
  using var created=await Send(ownerClient,HttpMethod.Post,"/api/admin/users",ownerCsrf,JsonContent.Create(new {displayName="Operator",email="notice-operator@example.test",password="operator-password-123",role="operator"}));
  Assert.Equal(HttpStatusCode.OK,created.StatusCode);
  using var staff=factory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=true});
  using var login=await Send(staff,HttpMethod.Post,"/api/auth/login",await GetCsrf(staff),JsonContent.Create(new {email="notice-operator@example.test",password="operator-password-123",rememberMe=false}));
  Assert.Equal(HttpStatusCode.OK,login.StatusCode);
  var user=(await staff.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
  Assert.Contains("admin.announcements.manage",user.Permissions);
  Assert.DoesNotContain("admin.config.manage",user.Permissions);
  Assert.DoesNotContain("admin.users.manage",user.Permissions);
  Assert.Equal(HttpStatusCode.OK,(await staff.GetAsync("/api/admin/announcements?placement=banner")).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await staff.GetAsync("/api/admin/organizations")).StatusCode);
  Assert.Equal(HttpStatusCode.OK,(await staff.GetAsync("/api/admin/organizations?purpose=announcement")).StatusCode);
  foreach(var language in new[]{"zh-CN","en-US"}) {
   var search=await staff.GetStringAsync("/api/admin/function-search?locale="+language+"&q=announcement");
   Assert.Contains("/announcements",search);
   Assert.DoesNotContain("/settings/announcements",search);
  }
  var csrf=await GetCsrf(staff);
  Assert.Equal(HttpStatusCode.Forbidden,(await Send(staff,HttpMethod.Post,"/api/admin/organizations",csrf,JsonContent.Create(new {name="Forbidden"}))).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await staff.GetAsync("/api/admin/notifications/rules")).StatusCode);
  using var customer=await CreateCustomerClient(ownerCsrf);
  Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/announcements")).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/organizations?purpose=announcement")).StatusCode);
  var id=Guid.NewGuid().ToString("N");
  var input=new AnnouncementInput("公告","正文","Notice","Body","banner","all",[],[],null,null,DisplayDays:1);
  using var save=await Send(staff,HttpMethod.Put,$"/api/admin/announcements/{id}",csrf,JsonContent.Create(input));
  Assert.Equal(HttpStatusCode.OK,save.StatusCode);
  var draft=(await save.Content.ReadFromJsonAsync<AnnouncementDocument>())!;
  Assert.Equal(HttpStatusCode.OK,(await staff.GetAsync($"/api/admin/announcements/{id}/preview?version={draft.Version}")).StatusCode);
  using var publish=await Send(staff,HttpMethod.Post,$"/api/admin/announcements/{id}/publish",csrf,JsonContent.Create(new {version=draft.Version}));
  Assert.Equal(HttpStatusCode.OK,publish.StatusCode);
  var published=(await publish.Content.ReadFromJsonAsync<AnnouncementDocument>())!;
  Assert.Equal(HttpStatusCode.OK,(await Send(staff,HttpMethod.Post,$"/api/admin/announcements/{id}/withdraw",csrf,JsonContent.Create(new {version=published.Version}))).StatusCode);
 }
}
