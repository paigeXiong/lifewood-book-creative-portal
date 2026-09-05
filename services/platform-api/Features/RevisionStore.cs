using System.Text.Json;
using System.Text.Json.Nodes;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Features;

public sealed record RevisionUnit(string Id, string Label);
public sealed record RevisionReason(string Unit, string Body);
public sealed record ReturnProjectRequest(int Version, RevisionReason[] Reasons, DateTimeOffset? ExpectedWorkflowUpdatedAt = null);
public sealed record RevisionReplyRequest(string Id, string Unit, string Body);
public sealed record RevisionMessage(string Id, string Unit, string Body, string AuthorId, string AuthorName, string? AvatarUrl, bool IsAdmin, string CreatedAt);
public sealed record RevisionRound(string Id, string CreatedAt, string? SubmittedAt, RevisionReason[] Reasons, RevisionMessage[] Messages, string? BeforeSnapshot = null, string? AfterSnapshot = null);
public sealed record RevisionView(RevisionUnit[] Units, RevisionRound[] Rounds, bool HasMore, Dictionary<string,string> Labels);

internal sealed class RevisionStore(string connectionString)
{
    internal static readonly string[] UnitIds = ["project", "characters", "voice", "style", "references"];
    private SqliteConnection Open() { var c = new SqliteConnection(connectionString); c.Open(); return c; }
    private static SqliteCommand Command(SqliteConnection c, string sql, params (string, object?)[] args) {
        var cmd = c.CreateCommand(); cmd.CommandText = sql;
        foreach (var (key, value) in args) cmd.Parameters.AddWithValue(key, value ?? DBNull.Value);
        return cmd;
    }
    public void Initialize() {
        using var c = Open();
        using var tx = c.BeginTransaction();
        using var cmd = Command(c, """
            CREATE TABLE IF NOT EXISTS revision_rounds(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, created_at TEXT NOT NULL, submitted_at TEXT NULL, reasons TEXT NOT NULL, before_snapshot TEXT NOT NULL, after_snapshot TEXT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS ix_revision_active ON revision_rounds(project_id) WHERE submitted_at IS NULL;
            CREATE INDEX IF NOT EXISTS ix_revision_history ON revision_rounds(project_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS revision_messages(id TEXT PRIMARY KEY, round_id TEXT NOT NULL, unit TEXT NOT NULL, body TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, avatar_url TEXT NULL, is_admin INTEGER NOT NULL, created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_revision_messages ON revision_messages(round_id, created_at);
            DROP TRIGGER IF EXISTS revision_close;
            CREATE TRIGGER revision_close AFTER UPDATE OF status ON projects
            WHEN NEW.status='submitted' AND OLD.status='draft'
            BEGIN
              UPDATE revision_rounds SET submitted_at=NEW.updated_at,
                after_snapshot=json_object('project',json(NEW.project_json),'book',json(NEW.book_json),'creative',json(NEW.creative_json),'voiceAndReferences',json(NEW.voice_json),'configuration',json(NEW.submission_snapshot_json))
              WHERE project_id=NEW.id AND submitted_at IS NULL;
            END;
            CREATE TRIGGER IF NOT EXISTS revision_preserve BEFORE DELETE ON projects
            WHEN EXISTS(SELECT 1 FROM revision_rounds WHERE project_id=OLD.id)
            BEGIN SELECT RAISE(ABORT,'Returned project history must be preserved'); END;
            """); cmd.Transaction = tx; cmd.ExecuteNonQuery(); tx.Commit();
    }
    public string? Owner(string projectId) { using var c=Open(); using var cmd=Command(c,"SELECT owner_id FROM projects WHERE id=$id",("$id",projectId)); return cmd.ExecuteScalar() as string; }
    public string? MessageAuthor(string projectId,string messageId) { using var c=Open();using var cmd=Command(c,"SELECT author_id FROM revision_messages m JOIN revision_rounds r ON r.id=m.round_id WHERE r.project_id=$project AND m.id=$message",("$project",projectId),("$message",messageId));return cmd.ExecuteScalar() as string; }
    public bool HasHistory(string id) { using var c=Open(); using var cmd=Command(c,"SELECT COUNT(*) FROM revision_rounds WHERE project_id=$id",("$id",id)); return (long)cmd.ExecuteScalar()! > 0; }
    public bool Return(string id, ReturnProjectRequest request, CurrentUserDto user) {
        if(request.ExpectedWorkflowUpdatedAt is null || request.Reasons is not {Length: >=1 and <=5} || request.Reasons.Any(r=>r is null || !UnitIds.Contains(r.Unit) || string.IsNullOrWhiteSpace(r.Body) || r.Body.Length>2000) || request.Reasons.Select(r=>r.Unit).Distinct().Count()!=request.Reasons.Length) return false;
        using var c=Open(); using var tx=c.BeginTransaction();
        using var read=Command(c,"SELECT json_object('project',json(project_json),'book',json(book_json),'creative',json(creative_json),'voiceAndReferences',json(voice_json),'configuration',json(submission_snapshot_json)) FROM projects WHERE id=$id AND version=$version AND status='submitted' AND COALESCE(workflow_updated_at,updated_at)=$workflow",("$id",id),("$version",request.Version),("$workflow",request.ExpectedWorkflowUpdatedAt.Value.ToString("O"))); read.Transaction=tx;
        var snapshot=read.ExecuteScalar() as string; if(snapshot is null) return false;
        var round=Guid.NewGuid().ToString("N"); var now=DateTimeOffset.UtcNow.ToString("O");
        using var insert=Command(c,"INSERT INTO revision_rounds VALUES($round,$id,$now,NULL,$reasons,$snapshot,NULL)",("$round",round),("$id",id),("$now",now),("$reasons",JsonSerializer.Serialize(request.Reasons,AppJsonContext.Default.RevisionReasonArray)),("$snapshot",snapshot)); insert.Transaction=tx; insert.ExecuteNonQuery();
        foreach(var reason in request.Reasons) InsertMessage(c,tx,round,new(Guid.NewGuid().ToString("N"),reason.Unit,reason.Body.Trim()),user,true,now);
        using var update=Command(c,"UPDATE projects SET status='draft',version=version+1,submission_key=NULL,workflow_status='awaiting_customer',updated_at=$now,workflow_updated_at=$now WHERE id=$id",("$id",id),("$now",now)); update.Transaction=tx; update.ExecuteNonQuery(); tx.Commit(); return true;
    }
    private static void InsertMessage(SqliteConnection c, SqliteTransaction tx, string round, RevisionReplyRequest request, CurrentUserDto user,bool admin,string now) {
        using var cmd=Command(c,"INSERT INTO revision_messages VALUES($id,$round,$unit,$body,$author,$name,$avatar,$admin,$now)",("$id",request.Id),("$round",round),("$unit",request.Unit),("$body",request.Body.Trim()),("$author",user.Id),("$name",user.DisplayName),("$avatar",user.AvatarUrl),("$admin",admin?1:0),("$now",now)); cmd.Transaction=tx;cmd.ExecuteNonQuery();
    }
    public bool Reply(string id,string round,RevisionReplyRequest request,CurrentUserDto user,bool admin) {
        if(!Guid.TryParse(request.Id,out _) || string.IsNullOrWhiteSpace(request.Body) || request.Body.Length>2000) return false;
        using var c=Open(); using var tx=c.BeginTransaction();
        using var check=Command(c,"SELECT reasons FROM revision_rounds WHERE id=$round AND project_id=$id AND submitted_at IS NULL",("$round",round),("$id",id));check.Transaction=tx;
        var reasons=check.ExecuteScalar() as string; if(reasons is null || !JsonSerializer.Deserialize(reasons,AppJsonContext.Default.RevisionReasonArray)!.Any(r=>r.Unit==request.Unit))return false;
        using var existing=Command(c,"SELECT COUNT(*) FROM revision_messages WHERE id=$message AND round_id=$round AND author_id=$author AND body=$body AND unit=$unit",("$message",request.Id),("$round",round),("$author",user.Id),("$body",request.Body.Trim()),("$unit",request.Unit)); existing.Transaction=tx;
        if((long)existing.ExecuteScalar()!>0)return true;
        using var count=Command(c,"SELECT COUNT(*) FROM revision_messages WHERE round_id=$round",("$round",round));count.Transaction=tx;if((long)count.ExecuteScalar()!>=500)return false;
        InsertMessage(c,tx,round,request,user,admin,DateTimeOffset.UtcNow.ToString("O"));tx.Commit();return true;
    }
    public RevisionView View(string id,bool admin,string locale,int page=1) {
        var zh=locale=="zh-CN";
        var units=UnitIds.Zip(zh?new[]{"上传图书","故事角色","旁白配音","视觉风格","参考与创意"}:new[]{"Book information","Story characters","Narration","Visual style","References & creative"},(key,label)=>new RevisionUnit(key,label)).ToArray();
        using var c=Open();
        using var cmd=Command(c,"SELECT id,created_at,submitted_at,reasons,before_snapshot,after_snapshot FROM revision_rounds WHERE project_id=$id ORDER BY created_at DESC LIMIT $limit OFFSET $offset",("$id",id),("$limit",admin?6:1),("$offset",admin?(Math.Clamp(page,1,100000)-1)*5:0));
        var rounds=new List<RevisionRound>();using(var reader=cmd.ExecuteReader())while(reader.Read())rounds.Add(new(reader.GetString(0),reader.GetString(1),reader.IsDBNull(2)?null:reader.GetString(2),JsonSerializer.Deserialize(reader.GetString(3),AppJsonContext.Default.RevisionReasonArray)!,[],admin?reader.GetString(4):null,admin&&!reader.IsDBNull(5)?reader.GetString(5):null));
        var more=rounds.Count>5;if(more)rounds.RemoveAt(5);
        for(var i=0;i<rounds.Count;i++) {
            using var messages=Command(c,"SELECT id,unit,body,author_id,author_name,avatar_url,is_admin,created_at FROM revision_messages WHERE round_id=$round ORDER BY created_at",("$round",rounds[i].Id));
            var list=new List<RevisionMessage>();using var r=messages.ExecuteReader();while(r.Read())list.Add(new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),$"/api/projects/{id}/revision-avatar/{r.GetString(0)}",r.GetInt32(6)==1,r.GetString(7)));
            rounds[i]=rounds[i] with {Messages=[..list]};
        }
        return new(units,[..rounds],more,new(){["title"]=zh?"退回沟通":"Revision discussion",["return"]=zh?"退回修改":"Request changes",["reason"]=zh?"退回原因":"Reason for return",["send"]=zh?"发送":"Send",["reply"]=zh?"回复说明，也可以说明保持原方案的理由":"Reply, or explain why the current approach should remain",["history"]=zh?"退回历史":"Return history",["pending"]=zh?"待修改或回复":"Changes or response requested",["submitted"]=zh?"已重新提交":"Resubmitted",["locked"]=zh?"本轮未退回此单元，请选择需要处理的单元。":"This section is not open for revision. Choose a requested section.",["review"]=zh?"审阅并重新提交":"Review and resubmit",["previous"]=zh?"上一页":"Previous",["next"]=zh?"下一页":"Next",["cancel"]=zh?"取消":"Cancel",["before"]=zh?"退回前记录":"Before return",["after"]=zh?"重新提交记录":"After resubmission",["error"]=zh?"操作未完成，请刷新后重试。":"The action could not be completed. Refresh and try again.",["close"]=zh?"关闭":"Close"});
    }
    public ReferenceAssetDto? HistoryAsset(string id, string fileId) {
        if (!Guid.TryParseExact(fileId, "N", out _)) return null;
        using var c = Open();
        using var cmd = Command(c, "SELECT before_snapshot,after_snapshot FROM revision_rounds WHERE project_id=$id", ("$id", id));
        using var reader = cmd.ExecuteReader();
        while (reader.Read()) for (var i = 0; i < 2; i++) {
            if (!reader.IsDBNull(i) && FindAsset(JsonNode.Parse(reader.GetString(i)), fileId) is { } asset) return asset;
        }
        return null;
    }
    private static ReferenceAssetDto? FindAsset(JsonNode? node, string fileId) {
        if (node is JsonObject obj) {
            if (obj["id"]?.ToString() == fileId && obj.ContainsKey("contentType") && obj.ContainsKey("fileName"))
                return obj.Deserialize(AppJsonContext.Default.ReferenceAssetDto);
            foreach (var entry in obj) if (FindAsset(entry.Value, fileId) is { } found) return found;
        } else if (node is JsonArray array)
            foreach (var item in array) if (FindAsset(item, fileId) is { } found) return found;
        return null;
    }
    // Previously accepted, unchanged units remain valid when configuration evolves.
    public FieldErrorDto[] FilterSubmissionErrors(string id, TaskDraftDto current, FieldErrorDto[] errors) {
        using var c = Open();
        using var cmd = Command(c, "SELECT before_snapshot FROM revision_rounds WHERE project_id=$id AND submitted_at IS NULL", ("$id", id));
        if (cmd.ExecuteScalar() is not string snapshot) return errors;
        var before = JsonNode.Parse(snapshot)!;
        var after = JsonSerializer.SerializeToNode(current, AppJsonContext.Default.TaskDraftDto)!;
        Normalize(before); Normalize(after);
        JsonNode? Unit(JsonNode node, string unit) => unit switch {
            "project" => node["book"],
            "characters" => node["creative"]?["characters"],
            "voice" => node["voiceAndReferences"]?["voiceover"],
            "style" => Without(node["creative"], "characters"),
            "references" => new JsonArray(node["project"]?.DeepClone(), Without(node["voiceAndReferences"], "voiceover")),
            _ => null
        };
        var unchanged = UnitIds.Where(unit => JsonNode.DeepEquals(Unit(before, unit), Unit(after, unit))).ToHashSet();
        string? FieldUnit(string field) =>
            field.StartsWith("book.") ? "project" :
            field.StartsWith("project.") ? "references" :
            field.StartsWith("creative.characters") ? "characters" :
            field.StartsWith("creative.") ? "style" :
            field.StartsWith("voiceAndReferences.voiceover") ? "voice" :
            field.StartsWith("voiceAndReferences.") ? "references" : null;
        return errors.Where(error => FieldUnit(error.Field) is not { } unit || !unchanged.Contains(unit)).ToArray();
    }
    private static JsonNode? Without(JsonNode? node, string property) {
        var result = node?.DeepClone();
        if (result is JsonObject obj) obj.Remove(property);
        return result;
    }
    public bool Allows(string id,TaskDraftDto before,ProjectInfoDto? project=null,BookInfoDto? book=null,CreativeInfoDto? creative=null,VoiceAndReferencesInfoDto? voice=null) {
        using var c=Open();using var cmd=Command(c,"SELECT reasons FROM revision_rounds WHERE project_id=$id AND submitted_at IS NULL",("$id",id));var json=cmd.ExecuteScalar() as string;if(json is null)return true;
        var allowed=JsonSerializer.Deserialize(json,AppJsonContext.Default.RevisionReasonArray)!.Select(r=>r.Unit).ToHashSet();
        var after=before with {Project=project??before.Project,Book=book??before.Book,Creative=creative??before.Creative,VoiceAndReferences=voice??before.VoiceAndReferences};
        var a=JsonSerializer.SerializeToNode(before,AppJsonContext.Default.TaskDraftDto)!;var b=JsonSerializer.SerializeToNode(after,AppJsonContext.Default.TaskDraftDto)!;
        Normalize(a);Normalize(b);
        bool Same(string field)=>JsonNode.DeepEquals(a[field],b[field]);
        if(!allowed.Contains("project")&&!Same("book"))return false;
        if(!allowed.Contains("references")&&!Same("project"))return false;
        if(!allowed.Contains("characters")&&!JsonNode.DeepEquals(a["creative"]?["characters"],b["creative"]?["characters"]))return false;
        a["creative"]?.AsObject().Remove("characters");b["creative"]?.AsObject().Remove("characters");
        if(!allowed.Contains("style")&&!Same("creative"))return false;
        if(!allowed.Contains("voice")&&!JsonNode.DeepEquals(a["voiceAndReferences"]?["voiceover"],b["voiceAndReferences"]?["voiceover"]))return false;
        a["voiceAndReferences"]?.AsObject().Remove("voiceover");b["voiceAndReferences"]?.AsObject().Remove("voiceover");
        return allowed.Contains("references")||Same("voiceAndReferences");
    }
    private static void Normalize(JsonNode? node) {
        if(node is JsonObject obj)foreach(var key in obj.Select(p=>p.Key).ToArray()) { var value=obj[key];if(value is null || value is JsonValue v && v.TryGetValue<string>(out var s)&&s=="")obj.Remove(key);else Normalize(value); }
        else if(node is JsonArray array)foreach(var item in array)Normalize(item);
    }
}
