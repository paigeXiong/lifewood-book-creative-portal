using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class ProjectRepository
{
    public (string Outcome, TaskDraftDto? Draft) Copy(string ownerId, string sourceId, string requestId, int maximumDrafts)
    {
        using var c = Open(); using var tx = c.BeginTransaction(deferred: false);
        TaskDraftDto? Read(string id) {
            using var q = c.CreateCommand(); q.Transaction = tx;
            q.CommandText = "SELECT id,task_number,status,version,project_json,book_json,creative_json,voice_json,created_at,updated_at,workflow_status FROM projects WHERE owner_id=$owner AND id=$id";
            q.Parameters.AddWithValue("$owner",ownerId); q.Parameters.AddWithValue("$id",id);
            using var r=q.ExecuteReader(); return r.Read()?ReadDraft(r):null;
        }
        using(var q=c.CreateCommand()) {
            q.Transaction=tx; q.CommandText="SELECT source_id,draft_id FROM project_copies WHERE owner_id=$owner AND request_id=$key";
            q.Parameters.AddWithValue("$owner",ownerId);q.Parameters.AddWithValue("$key",requestId);
            using var r=q.ExecuteReader();
            if(r.Read()) { var source=r.GetString(0);var target=r.GetString(1);r.Close();return source==sourceId?("saved",Read(target)):("conflict",null); }
        }
        var original=Read(sourceId); if(original is null)return ("missing",null);
        using(var q=c.CreateCommand()) {
            q.Transaction=tx;q.CommandText="SELECT COUNT(*) FROM projects WHERE owner_id=$owner AND status='draft'";q.Parameters.AddWithValue("$owner",ownerId);
            if(Convert.ToInt32(q.ExecuteScalar())>=maximumDrafts)return ("limit",null);
        }
        var now=DateTimeOffset.UtcNow;
        var copy=original with {
            Id=Guid.NewGuid().ToString("N"),TaskNumber=null,Status="draft",Version=1,WorkflowStatus="new",CreatedAt=now,UpdatedAt=now,
            Project=original.Project with { Deadline=null },
            Book=original.Book with { SourceAssets=[] },
            Creative=original.Creative with { StyleReferenceImages=[],StyleReferenceImageUrls=[],Characters=original.Creative.Characters.Select(character=>character with { Id=Guid.NewGuid().ToString("N"),ReferenceImages=[],ReferenceImageUrls=[] }).ToArray() },
            VoiceAndReferences=original.VoiceAndReferences with { Assets=[] }
        };
        Insert(ownerId,copy,c,tx);
        using(var q=c.CreateCommand()) {
            q.Transaction=tx;q.CommandText="INSERT INTO project_copies VALUES($owner,$key,$source,$draft)";
            q.Parameters.AddWithValue("$owner",ownerId);q.Parameters.AddWithValue("$key",requestId);q.Parameters.AddWithValue("$source",sourceId);q.Parameters.AddWithValue("$draft",copy.Id);q.ExecuteNonQuery();
        }
        tx.Commit();return ("saved",copy);
    }
}
