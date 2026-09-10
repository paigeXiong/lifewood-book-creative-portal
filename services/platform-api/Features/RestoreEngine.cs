using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;
namespace Lifewood.PlatformApi.Features;

internal static class RestoreEngine
{
    internal static string JournalPath(string storage) => Path.Combine(storage,".backup-restore.json");
    internal static string Stage(RestoreJournal job) => Path.TrimEndingDirectorySeparator(job.DataDirectory)+".restore-"+job.State.Id;
    internal static string Rollback(RestoreJournal job) => Path.TrimEndingDirectorySeparator(job.DataDirectory)+".rollback-"+job.State.Id;
    internal static string Ready(RestoreJournal job) => Path.Combine(job.StorageDirectory,".backup-restore-"+job.State.Id+".ready");
    internal static string Handoff(RestoreJournal job) => Path.Combine(job.StorageDirectory,".backup-restore-"+job.State.Id+".handoff");
    internal static RestoreJournal? Read(string storage)
    {
        if(!File.Exists(JournalPath(storage))) return null;
        using var stream=new FileStream(JournalPath(storage),FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete);
        return JsonSerializer.Deserialize(stream,AppJsonContext.Default.RestoreJournal);
    }
    internal static void Write(RestoreJournal job)
    {
        WriteAtomic(JournalPath(job.StorageDirectory),JsonSerializer.Serialize(job,AppJsonContext.Default.RestoreJournal));
        // History is secondary; its storage failure must never undo a successful directory switch.
        try { RestoreHistory.Save(job); }
        catch(Exception error) when(error is IOException or UnauthorizedAccessException) { Console.Error.WriteLine("Restore history could not be saved: "+error.Message); }
    }
    internal static void WriteAtomic(string path,string json)
    {
        using(var stream=new FileStream(path+".tmp",FileMode.Create,FileAccess.Write,FileShare.None)) {using var writer=new StreamWriter(stream,leaveOpen:true);writer.Write(json);writer.Flush();stream.Flush(true);}
        for(var attempt=0;;attempt++) {
            try {File.Move(path+".tmp",path,true);return;}
            catch(Exception error) when(attempt<50 && error is IOException or UnauthorizedAccessException) {Thread.Sleep(20);}
        }
    }
    internal static RestoreJournal Status(RestoreJournal job,string status,string? error=null) { job=job with {State=job.State with {Status=status,ErrorCode=error,UpdatedAt=DateTimeOffset.UtcNow}}; Write(job); return job; }
    internal static bool Terminal(string status) => status is "completed" or "failed" or "rolledBack" or "recoveryRequired";
    internal static void ValidatePaths(RestoreJournal job)
    {
        if(!Guid.TryParseExact(job.State.Id,"N",out _) || !Path.IsPathFullyQualified(job.DataDirectory) || !Path.IsPathFullyQualified(job.StorageDirectory)) throw new IOException("Invalid restore paths.");
        BackupArchive.CheckDirectory(job.DataDirectory); BackupArchive.CheckDirectory(job.StorageDirectory); BackupArchive.CheckDirectory(Stage(job)); BackupArchive.CheckDirectory(Rollback(job));
        var data=Path.TrimEndingDirectorySeparator(Path.GetFullPath(job.DataDirectory));
        if(Path.GetDirectoryName(data) is null || data==Path.GetPathRoot(data)) throw new IOException("Unsafe restore target.");
    }
    internal static void PrivateDirectory(string target,string source)
    {
        BackupArchive.CheckDirectory(target); Directory.CreateDirectory(target);
        if(OperatingSystem.IsWindows()) System.IO.FileSystemAclExtensions.SetAccessControl(new DirectoryInfo(target),System.IO.FileSystemAclExtensions.GetAccessControl(new DirectoryInfo(source)));
        else File.SetUnixFileMode(target,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
    }
    internal static void Clean(string path)
    {
        BackupArchive.CheckDirectory(path); if(!Directory.Exists(path))return;
        foreach(var entry in Directory.EnumerateFileSystemEntries(path,"*",SearchOption.AllDirectories)) if(File.GetAttributes(entry).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked restore data.");
        Directory.Delete(path,true);
    }
    internal static async Task<BackupManifest> Extract(string archive,string stage,string owner,CancellationToken token)
    {
        try { await BackupArchive.Verify(archive,token); }
        catch(Exception error) when(error is IOException or JsonException) {throw new RestoreValidationException("integrity");}
        using var zip=ZipFile.OpenRead(archive);
        using var metadata=zip.GetEntry(BackupArchive.ManifestName)!.Open();
        var manifest=(await JsonSerializer.DeserializeAsync(metadata,AppJsonContext.Default.BackupManifest,token))!;
        if(!Version.TryParse(manifest.Version,out var version) || version>typeof(RestoreEngine).Assembly.GetName().Version) throw new RestoreValidationException("version");
        // Validate cross-platform names before extracting; reject ADS, devices, case aliases and ZIP links.
        long expanded=0;
        foreach(var file in manifest.Files) {
            expanded=checked(expanded+file.Size);
            if(file.Size<0 || file.Path.Split('/').Any(part=>part.Contains(':') || part.EndsWith('.') || part.EndsWith(' ') || part.IndexOfAny(Path.GetInvalidFileNameChars())>=0 || new[]{"CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"}.Contains(part.Split('.')[0],StringComparer.OrdinalIgnoreCase))) throw new RestoreValidationException("integrity");
            if(file.Path is "platform.lock" or "platform.db-wal" or "platform.db-shm" or "platform.db-journal") throw new RestoreValidationException("integrity");
            if(((zip.GetEntry(file.Path)!.ExternalAttributes>>16)&0xF000)==0xA000) throw new RestoreValidationException("integrity");
        }
        var drive=new DriveInfo(Path.GetPathRoot(Path.GetFullPath(stage))!);
        if(drive.AvailableFreeSpace<expanded+64L*1024*1024) throw new RestoreValidationException("space");
        foreach(var file in manifest.Files) {
            var path=Path.GetFullPath(Path.Combine(stage,file.Path));
            if(!path.StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(stage))+Path.DirectorySeparatorChar,OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal)) throw new RestoreValidationException("integrity");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            await using var input=zip.GetEntry(file.Path)!.Open(); await using var output=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None,81920,true); await input.CopyToAsync(output,token);
        }
        try { ValidateDatabase(stage,owner); }
        catch(SqliteException) {throw new RestoreValidationException("database");}
        return manifest;
    }
    internal static void ValidateDatabase(string directory,string owner)
    {
        using var connection=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(directory,"platform.db"),Mode=SqliteOpenMode.ReadOnly,Pooling=false}.ConnectionString); connection.Open();
        using var query=connection.CreateCommand(); query.CommandText="PRAGMA quick_check"; if(query.ExecuteScalar() as string!="ok") throw new RestoreValidationException("database");
        query.CommandText="PRAGMA foreign_key_check"; using(var reader=query.ExecuteReader()) if(reader.Read()) throw new RestoreValidationException("database");
        query.CommandText="SELECT count(*) FROM users WHERE id=$id AND role='owner' AND is_active=1"; query.Parameters.AddWithValue("$id",owner); if(Convert.ToInt64(query.ExecuteScalar())!=1) throw new RestoreValidationException("ownerMissing");
    }
    internal static void PrepareData(string stage,string current)
    {
        foreach(var name in new[]{"runtime-settings.json","backup-policy.json"}) { var target=Path.Combine(stage,name); File.Delete(target); if(File.Exists(Path.Combine(current,name)))File.Copy(Path.Combine(current,name),target); }
        using var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(stage,"platform.db"),Mode=SqliteOpenMode.ReadWrite,Pooling=false}.ConnectionString); c.Open(); using var q=c.CreateCommand();
        // Removing saved sessions also invalidates cookies and one-click account switching from the snapshot.
        q.CommandText="UPDATE users SET session_version=session_version+1; DELETE FROM saved_account_sessions; DELETE FROM user_presence; DELETE FROM presence_session_activity; DELETE FROM ended_presence_sessions;";q.ExecuteNonQuery();
        q.CommandText="PRAGMA wal_checkpoint(TRUNCATE)";q.ExecuteNonQuery();
    }
    internal static void Switch(RestoreJournal job)
    {
        ValidatePaths(job);
        using(var locked=new FileStream(Path.Combine(job.DataDirectory,"platform.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) { }
        Status(job,"switching"); Directory.Move(job.DataDirectory,Rollback(job));
        Directory.Move(Stage(job),job.DataDirectory); Status(job,"starting");
    }
    internal static void Undo(RestoreJournal job)
    {
        ValidatePaths(job);
        if(Directory.Exists(Rollback(job))) {
            if(Directory.Exists(job.DataDirectory)) { using(var locked=new FileStream(Path.Combine(job.DataDirectory,"platform.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) { } Clean(job.DataDirectory); }
            Directory.Move(Rollback(job),job.DataDirectory);
        }
        Clean(Stage(job)); Status(job,"rolledBack","startup");
    }
    internal static void Recover(string data,string storage,string? attempt)
    {
        var job=Read(storage);
        if(job?.State.Status=="recoveryRequired") throw new IOException("Restore rollback needs operator recovery; startup refused to protect data.");
        if(job is null || Terminal(job.State.Status) || job.State.Id==attempt) return;
        if(!Path.GetFullPath(job.DataDirectory).Equals(Path.GetFullPath(data),OperatingSystem.IsWindows()?StringComparison.OrdinalIgnoreCase:StringComparison.Ordinal)) throw new IOException("Restore target mismatch.");
        ValidatePaths(job);
        if(job.State.Status is "switching" or "starting") {
            if(File.Exists(Ready(job)) && Directory.Exists(data)) { Status(job,"completed"); Clean(Rollback(job)); }
            else Undo(job);
        } else { Clean(Stage(job)); Status(job,"failed","interrupted"); }
    }
    internal static async Task<bool> WaitForCommit(string storage,string id,CancellationToken token,TimeSpan? timeout=null)
    {
        var deadline=DateTimeOffset.UtcNow+(timeout??TimeSpan.FromSeconds(120));
        while(!token.IsCancellationRequested && DateTimeOffset.UtcNow<deadline) {
            try {var state=Read(storage)?.State;if(state?.Id==id) {if(state.Status=="completed")return true;if(Terminal(state.Status))return false;}}
            catch(Exception error) when(error is IOException or UnauthorizedAccessException or JsonException) { }
            try {await Task.Delay(100,token);} catch(OperationCanceledException) {return false;}
        }
        return false;
    }
    internal static ProcessStartInfo StartInfo(RestoreJournal job,bool attempt)
    {
        var info=new ProcessStartInfo(job.Executable){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=job.WorkingDirectory};
        foreach(var arg in job.Arguments) info.ArgumentList.Add(arg);
        if(attempt) {info.ArgumentList.Add("--Lifewood:RestoreAttempt="+job.State.Id);info.ArgumentList.Add("--Lifewood:RestoreReady="+Ready(job));}
        return info;
    }
    public static async Task<bool> TryRun(string[] args)
    {
        if(args.Length!=2 || args[0]!="--apply-restore") return false;
        var path=Path.GetFullPath(args[1]); var job=Read(Path.GetDirectoryName(path)!) ?? throw new IOException("Missing restore job.");
        if(path!=JournalPath(job.StorageDirectory)) throw new IOException("Invalid restore journal.");
        ValidatePaths(job); Process? child=null;
        try {
            using(var coordination=RestoreStartupLock.Acquire(job.DataDirectory,job.CoordinationDirectory,TimeSpan.FromSeconds(120))) {
                File.WriteAllText(Handoff(job),job.State.Id);
                using var parent=Process.GetProcessById(job.ParentPid); await parent.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(120));
                job=Read(job.StorageDirectory)!;
                if(job.State.Status!="restarting") return true;
                Switch(job);
            }
            job=Read(job.StorageDirectory)!;
            child=Process.Start(StartInfo(job,true)) ?? throw new IOException("Server could not start.");
            var deadline=DateTimeOffset.UtcNow.AddSeconds(90);
            while(!child.HasExited && DateTimeOffset.UtcNow<deadline && !File.Exists(Ready(job))) await Task.Delay(250);
            if(!File.Exists(Ready(job)) || child.HasExited) throw new IOException("Restored server startup failed.");
            Status(job,"completed");
            try {Clean(Rollback(job));} catch(Exception error) {Console.Error.WriteLine(error);}
        } catch(Exception error) {
            Console.Error.WriteLine(error);
            try {
                if(child is not null && !child.HasExited) { child.Kill(true); await child.WaitForExitAsync(); }
                using(var coordination=RestoreStartupLock.Acquire(job.DataDirectory,job.CoordinationDirectory,TimeSpan.FromSeconds(120))) {
                    if(Directory.Exists(Rollback(job))) Undo(job); else Status(job,"failed","interrupted");
                }
                // A live parent means shutdown did not occur; never start a second server.
                bool parentAlive; try {using var parent=Process.GetProcessById(job.ParentPid);parentAlive=!parent.HasExited;} catch(ArgumentException){parentAlive=false;}
                if(!parentAlive) Process.Start(StartInfo(job,false));
            } catch(Exception recoveryError) {Console.Error.WriteLine(recoveryError);Status(job,"recoveryRequired","recovery");}
        } finally { child?.Dispose(); File.Delete(Handoff(job)); }
        return true;
    }
}
