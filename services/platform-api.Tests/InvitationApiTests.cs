using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Lifewood.PlatformApi.Features;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests {
 [Fact]public async Task InvitationAdminRoutesRequirePermissionAndCsrfAndDoNotExposeCodeInList(){
  await BootstrapOwner();using var anonymous=factory.CreateClient();using var customer=await CreateCustomerClient(await GetCsrf(ownerClient));
  Assert.Equal(HttpStatusCode.Unauthorized,(await anonymous.GetAsync("/api/admin/invitations")).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/invitations")).StatusCode);
  using var orgs=JsonDocument.Parse(await ownerClient.GetStringAsync("/api/admin/organizations?page=1&pageSize=30"));var org=orgs.RootElement.GetProperty("items")[0].GetProperty("id").GetString()!;
  var input=new CreateInvitation(org,"New customer team",7,1);
  Assert.Equal(HttpStatusCode.BadRequest,(await ownerClient.PostAsJsonAsync("/api/admin/invitations",input)).StatusCode);
  var csrf=await GetCsrf(ownerClient);var response=await Send(ownerClient,HttpMethod.Post,"/api/admin/invitations",csrf,JsonContent.Create(input));Assert.Equal(HttpStatusCode.OK,response.StatusCode);Assert.True(response.Headers.CacheControl!.NoStore);
  var code=(await response.Content.ReadFromJsonAsync<InvitationSecret>())!.Code;var listJson=await ownerClient.GetStringAsync("/api/admin/invitations");Assert.DoesNotContain(code,listJson);var page=JsonSerializer.Deserialize<InvitationPage>(listJson,new JsonSerializerOptions(JsonSerializerDefaults.Web))!;var id=Assert.Single(page.Items).Id;
  foreach(var action in new[]{"reveal","disable"})Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Post,$"/api/admin/invitations/{id}/{action}",await GetCsrf(customer))).StatusCode);
  Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/admin/invitations/{id}/members")).StatusCode);
  Assert.Equal(HttpStatusCode.OK,(await Send(anonymous,HttpMethod.Post,"/api/auth/invitations/lookup",await GetCsrf(anonymous),JsonContent.Create(new InvitationCodeRequest(code)))).StatusCode);
  Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Post,$"/api/admin/invitations/{id}/disable",csrf)).StatusCode);
  Assert.Equal(HttpStatusCode.BadRequest,(await Send(anonymous,HttpMethod.Post,"/api/auth/invitations/lookup",await GetCsrf(anonymous),JsonContent.Create(new InvitationCodeRequest(code)))).StatusCode);
 }
 [Fact]public async Task InvitationRegistrationHttpVerifiesEmailAndDoesNotReplaceExistingAccounts(){
  var fake=new EmailTests.FakeMailer();
  await using var testFactory=factory.WithWebHostBuilder(builder=>{builder.UseSetting("Lifewood:DataDirectory",Path.Combine(root,"invite-http"));builder.ConfigureServices(services=>services.AddSingleton<IPlatformMailer>(fake));});
  using var owner=testFactory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=true});
  Assert.Equal(HttpStatusCode.OK,(await Send(owner,HttpMethod.Post,"/api/auth/bootstrap",await GetCsrf(owner),JsonContent.Create(new{displayName="Owner",email="owner@example.test",password="password-123",organizationName="Invited team"}))).StatusCode);
  var settings=(await owner.GetFromJsonAsync<MailServiceDto>("/api/admin/mail/settings"))!;
  Assert.Equal(HttpStatusCode.OK,(await Send(owner,HttpMethod.Put,"/api/admin/mail/settings",await GetCsrf(owner),JsonContent.Create(new SaveMailSettings(settings.Revision,true,"smtp.example.test",587,"sender@example.test","","",false,"https://portal.example.test")))).StatusCode);
  using var orgs=JsonDocument.Parse(await owner.GetStringAsync("/api/admin/organizations?page=1&pageSize=30"));var org=orgs.RootElement.GetProperty("items")[0].GetProperty("id").GetString()!;
  var response=await Send(owner,HttpMethod.Post,"/api/admin/invitations",await GetCsrf(owner),JsonContent.Create(new CreateInvitation(org,"HTTP test",7,1)));var code=(await response.Content.ReadFromJsonAsync<InvitationSecret>())!.Code;
  using var guest=testFactory.CreateClient(new WebApplicationFactoryClientOptions{HandleCookies=true});var csrf=await GetCsrf(guest);
  foreach(var email in new[]{"owner@example.test","new@example.test"})Assert.Equal(HttpStatusCode.NoContent,(await Send(guest,HttpMethod.Post,"/api/auth/invitations/email",csrf,JsonContent.Create(new InvitationEmailRequest(code,email,"en-US")))).StatusCode);
  var emails=testFactory.Services.GetRequiredService<EmailRepository>();await emails.DeliverOne(fake,CancellationToken.None);
  var mail=Assert.Single(fake.Messages);Assert.Equal("new@example.test",mail.Address);var token=System.Text.RegularExpressions.Regex.Match(mail.Body,"token=([A-F0-9]{64})").Groups[1].Value;Assert.Equal(64,token.Length);
  Assert.Equal(HttpStatusCode.Unauthorized,(await guest.GetAsync("/api/me")).StatusCode);
  var input=new InvitationRegistration(token,"Invited member","password-new-123");
  Assert.Equal(HttpStatusCode.BadRequest,(await guest.PostAsJsonAsync("/api/auth/invitations/register",input)).StatusCode);
  Assert.Equal(HttpStatusCode.NoContent,(await Send(guest,HttpMethod.Post,"/api/auth/invitations/register",csrf,JsonContent.Create(input))).StatusCode);
  Assert.Equal(HttpStatusCode.BadRequest,(await Send(guest,HttpMethod.Post,"/api/auth/invitations/register",csrf,JsonContent.Create(input))).StatusCode);
  Assert.Equal(HttpStatusCode.OK,(await Send(guest,HttpMethod.Post,"/api/auth/login",csrf,JsonContent.Create(new{email="new@example.test",password="password-new-123"}))).StatusCode);
  var me=(await guest.GetFromJsonAsync<Lifewood.PlatformApi.Contracts.CurrentUserDto>("/api/me"))!;Assert.Contains("customer",me.Roles);Assert.DoesNotContain("admin.access",me.Permissions);
  Assert.Equal(HttpStatusCode.Forbidden,(await guest.GetAsync("/api/admin/invitations")).StatusCode);
 }

}
