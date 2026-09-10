using System.Diagnostics;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;

internal sealed class RestoreService(string data,string storage,string? coordination,bool available,RuntimeSettingsStore settings,BackupService backups,BackupGate gate,AuditRepository audit,IHostApplicationLifetime lifetime,ILogger<RestoreService> logger) : BackgroundService
{
    private readonly object sync=new();
    private (RestorePreview Preview,string User,string Hash)? preview;
    private (RestoreJournal Job,CurrentUserDto Actor,string Hash)? queued;
    public RestoreOverview Overview() { var pending=settings.Get(true,true).RestartRequired; return new(available && !pending,RestoreEngine.Read(storage)?.State,!available ? "unavailable" : pending ? "listenerChanges" : null); }
    public RestoreHistoryPage History(int page,string? status,UserRepository users)
    {
        var result=RestoreHistory.List(storage,page,status);
        var items=result.Items.Select(item=>new RestoreHistoryItem(item.State.Id,item.StartedAt,item.State.UpdatedAt,item.BackupCreatedAt,item.ActorId is null?null:users.Get(item.ActorId)?.DisplayName,item.State.Status,item.State.ErrorCode,backups.AvailableArchive(item.State.SafetyBackupId))).ToArray();
        return new(items,result.Page,20,result.Total,result.Incomplete,RestoreHistory.Filters);
    }
    private bool Idle() { var state=RestoreEngine.Read(storage)?.State;return state is null || state.Status is "completed" or "failed" or "rolledBack"; }
    private async Task<(Stream Stream,BackupRecord Record)> ReadArchive(string id,CancellationToken token)
    {
        try {return await backups.Download(id,token) ?? throw new RestoreValidationException("missingArchive");}
        catch(RestoreValidationException) {throw;}
        catch(IOException) {throw new RestoreValidationException("integrity");}
    }
    public async Task<RestorePreview> Preview(string id,CurrentUserDto actor,CancellationToken token)
    {
        var overview=Overview();
        if(!overview.Available)throw new RestoreValidationException(overview.UnavailableReason??"unavailable");
        if(!Idle() || !backups.ReserveRestore())throw new RestoreValidationException("busy");
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromMinutes(5));token=timeout.Token;
        var work=Path.Combine(storage,".backup-preflight-"+Guid.NewGuid().ToString("N"));
        try {
            RestoreEngine.PrivateDirectory(work,storage);
            var result=await ReadArchive(id,token);
            var archive=Path.Combine(work,"archive.zip");
            await using(var input=result.Stream) await using(var output=File.Create(archive)) await input.CopyToAsync(output,token);
            var stage=Path.Combine(work,"data");Directory.CreateDirectory(stage);
            var manifest=await RestoreEngine.Extract(archive,stage,actor.Id,token);
            var value=new RestorePreview(Guid.NewGuid().ToString("N"),id,result.Record.CreatedAt,manifest.Files.Length,manifest.Files.Sum(x=>x.Size),DateTimeOffset.UtcNow.AddMinutes(10));
            lock(sync) preview=(value,actor.Id,result.Record.Sha256!);
            audit.Record(actor,new("backup.preflight","backup",id),"restore-preflight");
            return value;
        } finally {try{RestoreEngine.Clean(work);}finally{backups.ReleaseRestore();}}
    }
    public RestoreState? Queue(RestoreRequest request,CurrentUserDto actor)
    {
        lock(sync) {
            if(!Overview().Available || !Idle() || queued is not null || request.Confirmation!="RESTORE" || preview is not {} ready || ready.Preview.Token!=request.Token || ready.User!=actor.Id || ready.Preview.ExpiresAt<=DateTimeOffset.UtcNow || !backups.ReserveRestore()) return null;
            try {
                var state=new RestoreState(Guid.NewGuid().ToString("N"),ready.Preview.BackupId,"queued",DateTimeOffset.UtcNow);
                var executable=Environment.ProcessPath!; var args=Environment.GetCommandLineArgs().Skip(Path.GetFileNameWithoutExtension(executable).Equals("dotnet",StringComparison.OrdinalIgnoreCase)?0:1).ToArray();
                // Restore/restart coordination flags are one-shot, never inherited by subsequent runs.
                var clean=new List<string>();
                for(var index=0;index<args.Length;index++) {if(args[index].StartsWith("--Lifewood:Restore",StringComparison.OrdinalIgnoreCase)||args[index].StartsWith("--Lifewood:RestartWaitForPid",StringComparison.OrdinalIgnoreCase)){if(!args[index].Contains('='))index++;continue;}clean.Add(args[index]);}
                var job=new RestoreJournal(state,data,storage,coordination,Environment.ProcessId,executable,clean.ToArray(),Environment.CurrentDirectory,DateTimeOffset.UtcNow,ready.Preview.CreatedAt,actor.Id);
                File.Delete(RestoreEngine.Handoff(job));
                if(RestoreEngine.Read(storage) is {} previous) RestoreHistory.Save(previous);
                RestoreEngine.Write(job); audit.Record(actor,new("backup.restore","backup",state.BackupId),"restore-"+state.Id);
                queued=(job,actor,ready.Hash);preview=null;return state;
            } catch {backups.ReleaseRestore();throw;}
        }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while(!stoppingToken.IsCancellationRequested) {
            (RestoreJournal Job,CurrentUserDto Actor,string Hash)? job;lock(sync)job=queued;
            if(job is {} value) {await Run(value.Job,value.Actor,value.Hash,stoppingToken);lock(sync)queued=null;}
            await Task.Delay(500,stoppingToken);
        }
    }
    private async Task Run(RestoreJournal job,CurrentUserDto actor,string hash,CancellationToken stoppingToken)
    {
        IDisposable? pause=null; bool handedOff=false;
        var work=Path.Combine(storage,".backup-restore-work-"+job.State.Id);
        try {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);timeout.CancelAfter(TimeSpan.FromMinutes(10));var token=timeout.Token;
            job=RestoreEngine.Status(job,"checking");RestoreEngine.PrivateDirectory(work,storage);
            var result=await ReadArchive(job.State.BackupId,token);
            await using(var input=result.Stream) {
                if(result.Record.Sha256!=hash)throw new RestoreValidationException("integrity");
                await using var output=File.Create(Path.Combine(work,"archive.zip"));await input.CopyToAsync(output,token);
            }
            RestoreEngine.PrivateDirectory(RestoreEngine.Stage(job),storage);
            await RestoreEngine.Extract(Path.Combine(work,"archive.zip"),RestoreEngine.Stage(job),actor.Id,token);
            job=RestoreEngine.Status(job,"safetyBackup");
            pause=await gate.PauseAsync(token);
            if(!Overview().Available)throw new RestoreValidationException("listenerChanges");
            var snapshot=Path.Combine(work,"safety");await BackupArchive.Snapshot(data,snapshot,token);
            var safety=await backups.SafetyBackup(snapshot,token);
            job=job with {State=job.State with {SafetyBackupId=safety.Id}};RestoreEngine.Write(job);
            job=RestoreEngine.Status(job,"preparing");
            RestoreEngine.PrepareData(RestoreEngine.Stage(job),data);
            // Keep an attributable recovery request in the restored history, too.
            var restoredAudit=new AuditRepository(new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder{DataSource=Path.Combine(RestoreEngine.Stage(job),"platform.db"),Pooling=false}.ConnectionString,RestoreEngine.Stage(job));
            restoredAudit.Record(actor,new("backup.restore","backup",job.State.BackupId),"restore-"+job.State.Id);
            job=RestoreEngine.Status(job,"restarting");
            var info=new ProcessStartInfo(job.Executable){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=job.WorkingDirectory};
            if(Path.GetFileNameWithoutExtension(job.Executable).Equals("dotnet",StringComparison.OrdinalIgnoreCase))info.ArgumentList.Add(job.Arguments[0]);
            info.ArgumentList.Add("--apply-restore");info.ArgumentList.Add(RestoreEngine.JournalPath(storage));
            using var helper=Process.Start(info) ?? throw new IOException("Restore helper could not start.");
            var deadline=DateTimeOffset.UtcNow.AddSeconds(15);
            while((!File.Exists(RestoreEngine.Handoff(job)) || File.ReadAllText(RestoreEngine.Handoff(job))!=job.State.Id) && !helper.HasExited && DateTimeOffset.UtcNow<deadline) await Task.Delay(100,token);
            if(helper.HasExited || !File.Exists(RestoreEngine.Handoff(job)) || File.ReadAllText(RestoreEngine.Handoff(job))!=job.State.Id) {if(!helper.HasExited){helper.Kill(true);await helper.WaitForExitAsync(token);}throw new IOException("Restore handoff failed.");}
            handedOff=true;
            await Task.Delay(750,CancellationToken.None);lifetime.StopApplication();
        } catch(Exception error) {
            logger.LogError(error,"Managed restore preparation failed");RestoreEngine.Status(job,"failed",error is RestoreValidationException validation?validation.Code:error is OperationCanceledException?"interrupted":job.State.Status=="safetyBackup"?"safetyBackup":job.State.Status=="restarting"?"handoff":"preflight");
        } finally {
            if(!handedOff) {pause?.Dispose();backups.ReleaseRestore();try{RestoreEngine.Clean(RestoreEngine.Stage(job));}catch(Exception error){logger.LogWarning(error,"Restore stage cleanup failed");}}
            try{RestoreEngine.Clean(work);}catch(Exception error){logger.LogWarning(error,"Restore scratch cleanup failed");}
        }
    }
}
