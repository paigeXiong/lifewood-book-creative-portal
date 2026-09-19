using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using System.Net;
using System.Text.Json;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task FunctionSearchRequiresAdminAndMatchesLocalizedSynonyms()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.GetAsync("/api/admin/function-search?q=register")).StatusCode);
        await BootstrapOwner();
        using var customer = await CreateCustomerClient(await GetCsrf(ownerClient));
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/admin/function-search?q=register")).StatusCode);
        foreach (var pair in new[] { ("zh-CN", "注册"), ("en-US", "registration") })
        {
            using var response = await ownerClient.GetAsync("/api/admin/function-search?locale=" + pair.Item1 + "&q=" + Uri.EscapeDataString(pair.Item2));
            response.EnsureSuccessStatusCode();
            Assert.True(response.Headers.CacheControl!.NoStore);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var results = json.RootElement.EnumerateArray().ToArray();
            Assert.Contains(results, r => r.GetProperty("path").GetString() == "/users");
            Assert.Contains(results, r => r.GetProperty("path").GetString() == "/settings/oidc");
            Assert.All(results, r => Assert.StartsWith("/", r.GetProperty("path").GetString()));
        }
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/admin/users", await GetCsrf(ownerClient), JsonContent.Create(new { displayName = "Search admin", email = "search-admin@example.test", password = "admin-password-123", role = "admin" }));
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        using var admin = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });
        using var login = await Send(admin, HttpMethod.Post, "/api/auth/login", await GetCsrf(admin), JsonContent.Create(new { email = "search-admin@example.test", password = "admin-password-123" }));
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        using var limited = JsonDocument.Parse(await admin.GetStringAsync("/api/admin/function-search?q=registration"));
        Assert.Contains(limited.RootElement.EnumerateArray(), r => r.GetProperty("path").GetString() == "/users");
        Assert.DoesNotContain(limited.RootElement.EnumerateArray(), r => r.GetProperty("path").GetString() == "/settings/oidc");
        Assert.Equal("[]", await ownerClient.GetStringAsync("/api/admin/function-search?q=unmatched-zzzz"));
        Assert.Equal("[]", await ownerClient.GetStringAsync("/api/admin/function-search?q="));
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/admin/function-search?locale=de-DE&q=test")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/admin/function-search?q=" + new string('x', 101))).StatusCode);
    }

    [Fact]
    public async Task HelpDocumentationEnforcesAudienceAndSearchesLocalizedBody()
    {
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/help")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ownerClient.GetAsync("/api/help/images/customer-intake")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await ownerClient.GetAsync("/api/help?audience=admin")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync("/api/help/images/admin-overview?locale=en-US")).StatusCode);
        await BootstrapOwner();
        var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf);
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/help?audience=admin")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync("/api/help/images/admin-overview")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ownerClient.GetAsync("/api/help/images/unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/help?audience=owner")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/help?locale=de-DE")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ownerClient.GetAsync("/api/help?q=" + new string('x', 201))).StatusCode);
        foreach (var locale in new[] { "zh-CN", "en-US" })
        {
            using var response = await customer.GetAsync("/api/help?locale=" + locale);
            response.EnsureSuccessStatusCode();
            Assert.True(response.Headers.CacheControl!.NoStore);
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(14, body.RootElement.GetArrayLength());
            Assert.Contains(body.RootElement.EnumerateArray(), article => article.GetProperty("id").GetString() == "invitation-registration");
            Assert.DoesNotContain(body.RootElement.EnumerateArray(), article => article.GetProperty("id").GetString() == "mail-service");
            foreach (var article in body.RootElement.EnumerateArray())
            {
                Assert.True(article.GetProperty("steps").GetArrayLength() >= 3);
                Assert.True(article.GetProperty("faq").GetArrayLength() >= 1);
                var image = article.GetProperty("image").GetString();
                if (image is not null) Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync("/api/help/images/" + image + "?locale=" + locale)).StatusCode);
            }
            using var admin = await ownerClient.GetAsync("/api/help?audience=admin&locale=" + locale);
            admin.EnsureSuccessStatusCode();
            using var adminBody = JsonDocument.Parse(await admin.Content.ReadAsStringAsync());
            Assert.Equal(19, adminBody.RootElement.GetArrayLength());
            Assert.Contains(adminBody.RootElement.EnumerateArray(), article=>article.GetProperty("id").GetString()=="invitations");
            Assert.Contains(adminBody.RootElement.EnumerateArray(), article=>article.GetProperty("id").GetString()=="mail-templates");
        }
        foreach (var (locale, query, id) in new[] {
            ("zh-CN", "保存并设置发布时间", "scheduled-announcements"),
            ("en-US", "Save and set publication time", "scheduled-announcements"),
            ("zh-CN", "维护暂停", "scheduled-backups"),
            ("en-US", "maintenance-paused", "scheduled-backups") })
        {
            using var result = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/help?audience=admin&locale=" + locale + "&q=" + Uri.EscapeDataString(query)));
            Assert.Contains(result.RootElement.EnumerateArray(), article => article.GetProperty("id").GetString() == id);
            using var publicResult = JsonDocument.Parse(await customer.GetStringAsync("/api/help?locale=" + locale + "&q=" + Uri.EscapeDataString(query)));
            Assert.DoesNotContain(publicResult.RootElement.EnumerateArray(), article => article.GetProperty("id").GetString() == id);
        }
        foreach (var (locale, query) in new[] { ("zh-CN", "昵称"), ("en-US", "read-only") })
        {
            using var invitationHelp = JsonDocument.Parse(await customer.GetStringAsync("/api/help?locale=" + locale + "&q=" + Uri.EscapeDataString(query)));
            Assert.Contains(invitationHelp.RootElement.EnumerateArray(), article => article.GetProperty("id").GetString() == "invitation-registration");
        }
        using var search = JsonDocument.Parse(await ownerClient.GetStringAsync("/api/help?audience=admin&locale=en-US&q=implicit%20TLS"));
        Assert.Equal("mail-service", Assert.Single(search.RootElement.EnumerateArray()).GetProperty("id").GetString());
        using var zh = JsonDocument.Parse(await customer.GetStringAsync("/api/help?locale=zh-CN&q=" + Uri.EscapeDataString("未验证邮箱")));
        Assert.Equal("password", Assert.Single(zh.RootElement.EnumerateArray()).GetProperty("id").GetString());
        Assert.Equal("[]", await customer.GetStringAsync("/api/help?q=zzzz-unmatched-phrase"));
        using var screenshot = await ownerClient.GetAsync("/api/help/images/admin-overview");
        screenshot.EnsureSuccessStatusCode();
        Assert.Equal("image/jpeg", screenshot.Content.Headers.ContentType!.MediaType);
        Assert.True(screenshot.Headers.CacheControl!.NoStore);
    }
}
