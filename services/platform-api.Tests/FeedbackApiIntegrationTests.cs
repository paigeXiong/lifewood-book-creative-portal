using System.Net;
using System.Net.Http.Json;
using System.Text;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task PlatformFeedbackIsScopedIdempotentAndRepliesArriveAsNotifications()
    {
        await BootstrapOwner(); var ownerCsrf=await GetCsrf(ownerClient);
        using var customer=await CreateCustomerClient(ownerCsrf);var csrf=await GetCsrf(customer);
        var id=Guid.NewGuid().ToString("N");
        var input=new CreateFeedbackRequest(id,"bug","<script>alert('feedback')</script> The button does not work.","/zh-CN/tasks");
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input with {Description="Changed description"}))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync("/api/admin/feedback")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/admin/feedback/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await Send(customer,HttpMethod.Put,$"/api/admin/feedback/{id}",csrf,JsonContent.Create(new UpdateFeedbackRequest(1,"resolved","No access")))).StatusCode);
        var page=await ownerClient.GetFromJsonAsync<FeedbackPage>("/api/admin/feedback?search=button");Assert.Single(page!.Items);Assert.Equal(input.Description,page.Items[0].Description);
        var update=new UpdateFeedbackRequest(1,"resolved","Fixed <b>without rendering HTML</b>");
        Assert.Equal(HttpStatusCode.NoContent,(await Send(ownerClient,HttpMethod.Put,$"/api/admin/feedback/{id}",ownerCsrf,JsonContent.Create(update))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,(await Send(ownerClient,HttpMethod.Put,$"/api/admin/feedback/{id}",ownerCsrf,JsonContent.Create(update))).StatusCode);
        var notifications=new NotificationRepository("Data Source="+Path.Combine(root,"platform.db"));notifications.Dispatch();
        var rule=notifications.Rules().Items.Single(r=>r.Kind=="feedback_reply");
        Assert.False(notifications.SaveRule(rule with {Enabled=false}));Assert.False(notifications.SaveRule(rule with {Audience="allAdmins"}));
        var feed=await customer.GetFromJsonAsync<NotificationPage>("/api/notifications?kind=feedback_reply");var notice=Assert.Single(feed!.Items);
        var detail=await customer.GetFromJsonAsync<FeedbackNotice>($"/api/notifications/{notice.Id}/feedback");Assert.Equal(input.Description,detail!.Description);Assert.Equal(update.Reply,detail.Reply);Assert.Equal("resolved",detail.Status);
        Assert.Equal(HttpStatusCode.NotFound,(await ownerClient.GetAsync($"/api/notifications/{notice.Id}/feedback")).StatusCode);
        var adminDetail=await ownerClient.GetFromJsonAsync<FeedbackDetail>($"/api/admin/feedback/{id}");Assert.Single(adminDetail!.Responses);
        Assert.Empty((await ownerClient.GetFromJsonAsync<FeedbackPage>("/api/admin/feedback?status=pending"))!.Items);
    }
    [Fact]
    public async Task PlatformFeedbackRejectsUnsafeScreenshotsAndLimitsSubmissions()
    {
        await BootstrapOwner();var ownerCsrf=await GetCsrf(ownerClient);using var customer=await CreateCustomerClient(ownerCsrf);var csrf=await GetCsrf(customer);
        var catalog=await customer.GetFromJsonAsync<FeedbackCatalog>("/api/feedback/catalog?locale=en-US");
        Assert.Equal(10_000_000,catalog!.ScreenshotSourceMaxBytes);Assert.Equal(1_000_000,catalog.ScreenshotMaxBytes);
        var input=new CreateFeedbackRequest(Guid.NewGuid().ToString("N"),"bug","Screenshot issue","/zh-CN/profile",Convert.ToBase64String(Encoding.UTF8.GetBytes("<svg onload='alert(1)'></svg>")),"image/svg+xml");
        Assert.Equal(HttpStatusCode.BadRequest,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input with {ScreenshotType="image/png"}))).StatusCode);
        input=input with {ScreenshotBase64=null,ScreenshotType=null,PagePath="/profile?token=secret"};
        Assert.Equal(HttpStatusCode.BadRequest,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
        input=input with {PagePath="/zh-CN/profile",ScreenshotType="image/png",ScreenshotBase64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII="};
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
        var image=await ownerClient.GetAsync($"/api/admin/feedback/{input.Id}/screenshot");Assert.Equal("image/png",image.Content.Headers.ContentType!.MediaType);Assert.Contains("nosniff",image.Headers.GetValues("X-Content-Type-Options"));
        Assert.Equal(HttpStatusCode.Forbidden,(await customer.GetAsync($"/api/admin/feedback/{input.Id}/screenshot")).StatusCode);
        for(var n=0;n<4;n++)Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input with {Id=Guid.NewGuid().ToString("N"),ScreenshotBase64=null,ScreenshotType=null}))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input with {Id=Guid.NewGuid().ToString("N")}))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,(await Send(customer,HttpMethod.Post,"/api/feedback",csrf,JsonContent.Create(input))).StatusCode);
    }
}
