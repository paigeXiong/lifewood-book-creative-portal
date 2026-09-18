using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task OrganizationProjectsAreReadableButOnlyCreatorCanWrite()
    {
        await BootstrapOwner(); var csrf = await GetCsrf(ownerClient);
        using var customer = await CreateCustomerClient(csrf); var customerCsrf = await GetCsrf(customer);
        var owner = (await ownerClient.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new {}));
        create.EnsureSuccessStatusCode();
        var draft = (await create.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        var route = $"/api/projects/{draft.Id}";
        var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        using var cover = ReferenceRequest(png, "cover.png", "image/png", draft.Version, "book-cover");
        using var upload = await Send(ownerClient, HttpMethod.Post, route + "/files?categoryId=book-cover", csrf, cover);
        upload.EnsureSuccessStatusCode();
        var shared = (await customer.GetFromJsonAsync<TaskDraftDto>(route))!;
        Assert.False(shared.CanEdit); Assert.Equal(owner.Id, shared.Creator!.Id);
        Assert.Equal(owner.DisplayName, shared.Creator.DisplayName);
        Assert.True((await ownerClient.GetFromJsonAsync<TaskDraftDto>(route))!.CanEdit);
        var list = (await customer.GetFromJsonAsync<PagedProjectsDto>("/api/projects?search="))!;
        Assert.False(Assert.Single(list.Items).CanEdit);
        Assert.Equal(1, (await customer.GetFromJsonAsync<ProjectStatsDto>("/api/projects/stats"))!.Total);
        Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync(shared.Book.SourceAssets![0].Url)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync(shared.Creator.AvatarUrl)).StatusCode);
        Assert.False((await customer.GetFromJsonAsync<RevisionView>(route + "/revisions"))!.CanEdit);
        Assert.Equal(HttpStatusCode.OK, (await customer.GetAsync(route + "/deliveries")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(customer, HttpMethod.Put, route + "/draft", customerCsrf,
            JsonContent.Create(new SaveDraftRequest(shared.Version, shared.Project, shared.Book)))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(customer, HttpMethod.Delete, route + $"?version={shared.Version}", customerCsrf)).StatusCode);
        using var foreignCover = ReferenceRequest(png, "other.png", "image/png", shared.Version, "book-cover");
        Assert.Equal(HttpStatusCode.NotFound, (await Send(customer, HttpMethod.Post, route + "/files?categoryId=book-cover", customerCsrf, foreignCover)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(customer, HttpMethod.Delete, route + $"/files/{shared.Book.SourceAssets[0].Id}?version={shared.Version}", customerCsrf)).StatusCode);

        // Membership changes take effect immediately, even with the existing signed-in session.
        var member = (await customer.GetFromJsonAsync<CurrentUserDto>("/api/me"))!;
        using var db = new SqliteConnection("Data Source=" + Path.Combine(root, "platform.db")); db.Open();
        using var change = db.CreateCommand();
        change.CommandText = "UPDATE projects SET workflow_status='awaiting_customer' WHERE id=$project";
        change.Parameters.AddWithValue("$project", draft.Id); change.ExecuteNonQuery();
        Assert.Empty((await customer.GetFromJsonAsync<PagedProjectsDto>("/api/projects?status=action_required"))!.Items);
        Assert.Single((await ownerClient.GetFromJsonAsync<PagedProjectsDto>("/api/projects?status=action_required"))!.Items);
        Assert.Equal(0, (await customer.GetFromJsonAsync<ProjectStatsDto>("/api/projects/stats"))!.ActionRequired);
        Assert.Single((await customer.GetFromJsonAsync<PagedProjectsDto>("/api/projects?status=stage:awaiting_customer"))!.Items);
        change.CommandText = "UPDATE users SET organization_id=NULL WHERE id=$id"; change.Parameters.AddWithValue("$id", member.Id); change.ExecuteNonQuery();
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync(route)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync(shared.Book.SourceAssets[0].Url)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync(route + "/revisions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await customer.GetAsync(route + "/deliveries")).StatusCode);
        Assert.Empty((await customer.GetFromJsonAsync<PagedProjectsDto>("/api/projects"))!.Items);
    }
}
