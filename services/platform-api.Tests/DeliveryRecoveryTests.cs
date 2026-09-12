using System.Net;
using System.Net.Http.Json;
using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed partial class VoiceSampleApiIntegrationTests
{
    [Fact]
    public async Task DeliveryUploadReplayChecksContentAndPreservesRevocation()
    {
        await BootstrapOwner(); var csrf = await GetCsrf(ownerClient);
        using var create = await Send(ownerClient, HttpMethod.Post, "/api/projects", csrf, JsonContent.Create(new { }));
        var draft = (await create.Content.ReadFromJsonAsync<TaskDraftDto>())!;
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(root, "platform.db")}"))
        {
            connection.Open(); using var command = connection.CreateCommand();
            command.CommandText = "UPDATE projects SET status='submitted' WHERE id=$id;";
            command.Parameters.AddWithValue("$id", draft.Id); command.ExecuteNonQuery();
        }
        var key = Guid.NewGuid().ToString("N"); var url = $"/api/admin/projects/{draft.Id}/deliveries";
        async Task<HttpResponseMessage> Upload(string uploadKey, string note = "Ready", byte[]? bytes = null)
        {
            using var body = new MultipartFormDataContent(); var video = new ByteArrayContent(bytes ?? MinimalMp4());
            video.Headers.ContentType = new("video/mp4"); body.Add(video,"file","final.mp4");
            body.Add(new StringContent(note),"note"); body.Add(new StringContent(uploadKey),"uploadId");
            return await Send(ownerClient,HttpMethod.Post,url,csrf,body);
        }
        var requests = await Task.WhenAll(Upload(key),Upload(key));
        Assert.All(requests, response => Assert.Equal(HttpStatusCode.OK,response.StatusCode));
        var first = (await requests[0].Content.ReadFromJsonAsync<FinalDeliveryDto>())!;
        Assert.Equal(first.Id,(await requests[1].Content.ReadFromJsonAsync<FinalDeliveryDto>())!.Id);
        foreach(var response in requests) response.Dispose();
        var result = await ownerClient.GetFromJsonAsync<DeliveryUploadStatusDto>($"{url}/uploads/{key}");
        Assert.True(result!.Recorded); Assert.Equal(first.Id,result.Delivery!.Id);
        Assert.Single(Directory.EnumerateFiles(Path.Combine(root,"deliveries",draft.Id)));
        using var changedNote = await Upload(key,"Different"); Assert.Equal(HttpStatusCode.Conflict,changedNote.StatusCode);
        var changedBytes=MinimalMp4(); changedBytes[^1]^=1;
        using var changed = await Upload(key,bytes:changedBytes); Assert.Equal(HttpStatusCode.Conflict,changed.StatusCode);
        using var different = await Upload(Guid.NewGuid().ToString("N")); Assert.Equal(HttpStatusCode.Conflict,different.StatusCode);
        using var revoke = await Send(ownerClient,HttpMethod.Delete,$"{url}/{first.Id}",csrf); Assert.Equal(HttpStatusCode.NoContent,revoke.StatusCode);
        using var replay = await Upload(key); Assert.Equal(HttpStatusCode.OK,replay.StatusCode);
        Assert.NotNull((await replay.Content.ReadFromJsonAsync<FinalDeliveryDto>())!.RevokedAt);
        Assert.Empty(await ownerClient.GetFromJsonAsync<FinalDeliveryDto[]>($"/api/projects/{draft.Id}/deliveries") ?? []);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(root,"deliveries",draft.Id)));
        using var customer = await CreateCustomerClient(csrf);
        using var forbidden = await customer.GetAsync($"{url}/uploads/{key}"); Assert.Equal(HttpStatusCode.Forbidden,forbidden.StatusCode);
        var missing = await ownerClient.GetFromJsonAsync<DeliveryUploadStatusDto>($"{url}/uploads/{Guid.NewGuid():N}"); Assert.False(missing!.Recorded);
    }
}
