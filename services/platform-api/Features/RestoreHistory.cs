using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
namespace Lifewood.PlatformApi.Features;

// Small metadata only; kept outside the data directory so restoration cannot erase previous attempts.
internal static class RestoreHistory
{
    internal static string DirectoryPath(string storage)=>Path.Combine(storage,".backup-restores");
    internal static readonly RestoreStatusFilter[] Filters=[new("","restore.history.all"),new("completed","restore.states.completed"),new("failed","restore.states.failed"),new("rolledBack","restore.states.rolledBack"),new("recoveryRequired","restore.states.recoveryRequired")];
    internal static RestoreHistoryRecord Record(RestoreJournal job)=>new(job.State,job.StartedAt??job.State.UpdatedAt,job.BackupCreatedAt,job.ActorId);
    internal static void Save(RestoreJournal job)
    {
        if(!Guid.TryParseExact(job.State.Id,"N",out _))throw new IOException("Invalid history identifier.");
        var folder=DirectoryPath(job.StorageDirectory);BackupArchive.CheckDirectory(folder);Directory.CreateDirectory(folder);
        RestoreEngine.WriteAtomic(Path.Combine(folder,job.State.Id+".json"),JsonSerializer.Serialize(Record(job),AppJsonContext.Default.RestoreHistoryRecord));
    }
    internal static (RestoreHistoryRecord[] Items,int Page,int Total,bool Incomplete) List(string storage,int page,string? status)
    {
        var records=new Dictionary<string,RestoreHistoryRecord>(StringComparer.Ordinal);bool incomplete=false;
        try {
        var folder=DirectoryPath(storage);BackupArchive.CheckDirectory(folder);if(File.Exists(folder))incomplete=true;
        if(Directory.Exists(folder)) foreach(var path in Directory.EnumerateFiles(folder,"*.json")) {
            try {
                if(File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))throw new IOException("Linked history file.");
                using var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
                if(stream.Length>32_768)throw new IOException("Oversized history record.");
                var record=JsonSerializer.Deserialize(stream,AppJsonContext.Default.RestoreHistoryRecord);
                if(record?.State is null || !Guid.TryParseExact(record.State.Id,"N",out _) || Path.GetFileName(path)!=record.State.Id+".json")throw new IOException("Invalid history record.");
                records[record.State.Id]=record;
            } catch(Exception error) when(error is IOException or UnauthorizedAccessException or JsonException) {incomplete=true;}
        }
        } catch(Exception error) when(error is IOException or UnauthorizedAccessException) {incomplete=true;}
        // Legacy journals and the newest transition are visible even if its secondary history write was interrupted.
        try {if(RestoreEngine.Read(storage) is {} current)records[current.State.Id]=Record(current);}
        catch(Exception error) when(error is IOException or UnauthorizedAccessException or JsonException) {incomplete=true;}
        var filtered=records.Values.Where(x=>string.IsNullOrEmpty(status)||x.State.Status==status).OrderByDescending(x=>x.StartedAt).ThenBy(x=>x.State.Id,StringComparer.Ordinal).ToArray();
        page=Math.Clamp(page,1,Math.Max(1,(int)Math.Ceiling(filtered.Length/20d)));
        return (filtered.Skip((page-1)*20).Take(20).ToArray(),page,filtered.Length,incomplete);
    }
}
