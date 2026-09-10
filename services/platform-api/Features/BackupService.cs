using System.Text.Json;
using System.Security.Cryptography;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;
internal sealed partial class BackupService : BackgroundService
{
    private readonly object sync = new();
    private readonly string data, storage;
    private readonly BackupGate gate;
    private readonly AuditRepository audit;
    private readonly ILogger<BackupService> logger;
    private readonly List<BackupRecord> records = [];
    private BackupSchedule schedule;
    private BackupRecord? current;
    private bool restoreReserved;
    internal bool ReserveRestore() { lock(sync) { if(current is not null || restoreReserved) return false; restoreReserved=true; return true; } }
    internal void ReleaseRestore() { lock(sync) restoreReserved=false; }
    internal async Task<BackupRecord> SafetyBackup(string stage, CancellationToken token) {
        var item=new BackupRecord(Guid.NewGuid().ToString("N"),DateTimeOffset.UtcNow,"safety","queued");
        lock(sync) { WriteRecord(item); records.Add(item); }
        try { var manifest=await BackupArchive.Pack(stage,ZipPath(item.Id)+".partial",token); await BackupArchive.Verify(ZipPath(item.Id)+".partial",token);
            await using(var stream=File.OpenRead(ZipPath(item.Id)+".partial")) item=item with {Status="completed",Size=stream.Length,FileCount=manifest.Files.Length,Sha256=Convert.ToHexString(await SHA256.HashDataAsync(stream,token)),VerificationStatus="passed",VerifiedAt=DateTimeOffset.UtcNow};
            File.Move(ZipPath(item.Id)+".partial",ZipPath(item.Id));
        } catch { item=item with {Status="failed",ErrorCode="failed"}; throw; }
        finally { lock(sync) {WriteRecord(item);records[records.FindIndex(x=>x.Id==item.Id)]=item;} CleanupScratch(item.Id); }
        return item;
    }
    private CurrentUserDto? actor;
    private static readonly CurrentUserDto SystemActor = new("system", null, "System", null, null, null, [], [], "en-US", null);
    public BackupService(string dataDirectory, string backupDirectory, BackupGate gate, AuditRepository audit, ILogger<BackupService> logger)
    {
        data = Path.GetFullPath(dataDirectory); storage = Path.GetFullPath(backupDirectory);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (data.StartsWith(Path.TrimEndingDirectorySeparator(storage) + Path.DirectorySeparatorChar, comparison) || storage.Equals(data, comparison) || storage.StartsWith(data.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, comparison)) throw new InvalidOperationException("Backup storage must be outside platform data.");
        BackupArchive.CheckDirectory(storage); Directory.CreateDirectory(storage);
        if (Directory.EnumerateFileSystemEntries(storage).Any(path => !Path.GetFileName(path).StartsWith("backup-", StringComparison.Ordinal) && !Path.GetFileName(path).StartsWith(".backup-", StringComparison.Ordinal)))
            throw new InvalidOperationException("Backup storage must be a dedicated managed directory.");
        if (OperatingSystem.IsWindows())
        {
            var permissions = new System.Security.AccessControl.DirectorySecurity();
            permissions.SetAccessRuleProtection(true, false);
            var identities = new[] {
                System.Security.Principal.WindowsIdentity.GetCurrent().User!,
                new System.Security.Principal.SecurityIdentifier(System.Security.Principal.WellKnownSidType.LocalSystemSid, null),
                new System.Security.Principal.SecurityIdentifier(System.Security.Principal.WellKnownSidType.BuiltinAdministratorsSid, null)
            };
            foreach (var identity in identities) permissions.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(identity, System.Security.AccessControl.FileSystemRights.FullControl, System.Security.AccessControl.InheritanceFlags.ContainerInherit | System.Security.AccessControl.InheritanceFlags.ObjectInherit, System.Security.AccessControl.PropagationFlags.None, System.Security.AccessControl.AccessControlType.Allow));
            System.IO.FileSystemAclExtensions.SetAccessControl(new DirectoryInfo(storage), permissions);
        }
        else File.SetUnixFileMode(storage, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        this.gate = gate; this.audit = audit; this.logger = logger;
        schedule = File.Exists(PolicyPath) ? JsonSerializer.Deserialize(File.ReadAllText(PolicyPath), AppJsonContext.Default.BackupSchedule)! : new(new(), null);
        if (schedule is null || !Valid(schedule.Policy)) throw new InvalidOperationException("Invalid backup policy.");
        foreach (var path in Directory.EnumerateFiles(storage, "backup-*.json"))
        {
            var item = JsonSerializer.Deserialize(File.ReadAllText(path), AppJsonContext.Default.BackupRecord);
            if (item is null || !Guid.TryParseExact(item.Id, "N", out _) || Path.GetFileName(path) != $"backup-{item.Id}.json") continue;
            if (item.Status is not ("completed" or "failed")) { item = item with { Status = "failed", ErrorCode = "interrupted" }; WriteRecord(item); }
            if(item.VerificationStatus is "queued" or "checking") {item=item with {VerificationStatus="interrupted"};WriteRecord(item);}
            records.Add(item);
            CleanupScratch(item.Id);
        }
    }
    private void CleanupScratch(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new IOException("Invalid backup identifier.");
        var stage = Path.Combine(storage, $".backup-{id}.stage");
        try { BackupArchive.CheckDirectory(stage); if (Directory.Exists(stage)) Directory.Delete(stage, true); File.Delete(ZipPath(id) + ".partial"); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { logger.LogWarning(exception, "Backup scratch cleanup will retry for {Id}", id); }
    }
    private string PolicyPath => Path.Combine(data, "backup-policy.json");
    private string ZipPath(string id) => Path.Combine(storage, $"backup-{id}.zip");
    private void WriteRecord(BackupRecord item) => Atomic(Path.Combine(storage, $"backup-{item.Id}.json"), JsonSerializer.Serialize(item, AppJsonContext.Default.BackupRecord));
    private static void Atomic(string path, string json) { var temporary = path + ".tmp"; File.WriteAllText(temporary, json); File.Move(temporary, path, true); }
    public BackupPage List(int page, string? source, string? status, string? verification=null)
    {
        lock (sync) { var items = records.Where(x => (string.IsNullOrEmpty(source) || x.Source == source) && (string.IsNullOrEmpty(status) || x.Status == status) && (string.IsNullOrEmpty(verification) || (verification=="unchecked" ? x.Status=="completed" && x.VerificationStatus is null : x.VerificationStatus==verification))).OrderByDescending(x => x.CreatedAt).ToArray(); page = Math.Max(1, page); return new(items.Skip((page - 1) * 20).Take(20).ToArray(), page, 20, items.Length, schedule, current, gate.Paused, VerificationFilters); }
    }
    public static bool Valid(BackupPolicy policy) => policy.Frequency is "daily" or "weekly" && policy.Hour is >= 0 and <= 23 && policy.DayOfWeek is >= 0 and <= 6 && policy.TimeZoneId is "Asia/Shanghai" or "UTC" && policy.RetainDays is >= 1 and <= 3650 && policy.RetainCount is >= 1 and <= 500;
    internal static DateTimeOffset NextRun(BackupPolicy policy, DateTimeOffset now)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(policy.TimeZoneId);
        var today = TimeZoneInfo.ConvertTime(now, zone).Date;
        for (var offset = 0; offset <= 8; offset++)
        {
            var local = DateTime.SpecifyKind(today.AddDays(offset).AddHours(policy.Hour), DateTimeKind.Unspecified);
            if (policy.Frequency == "weekly" && (int)local.DayOfWeek != policy.DayOfWeek || zone.IsInvalidTime(local)) continue;
            var candidate = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, zone));
            if (candidate > now) return candidate;
        }
        throw new InvalidOperationException("Cannot calculate schedule.");
    }
    public bool SavePolicy(BackupPolicy value)
    {
        if (!Valid(value)) return false;
        lock (sync) { if(restoreReserved) return false; var next = new BackupSchedule(value, value.Enabled ? NextRun(value, DateTimeOffset.UtcNow) : null); Atomic(PolicyPath, JsonSerializer.Serialize(next, AppJsonContext.Default.BackupSchedule)); schedule = next; return true; }
    }
    public BackupRecord? Queue(CurrentUserDto user, string source = "manual")
    {
        lock (sync)
        {
            if (current is not null || restoreReserved) return null;
            var item = new BackupRecord(Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, source, "queued");
            WriteRecord(item); records.Add(item); actor = user; current = item; return item;
        }
    }
    private void Update(BackupRecord value) { lock (sync) { WriteRecord(value); records[records.FindIndex(x => x.Id == value.Id)] = value; current = value; } }
    internal BackupRecord? AvailableArchive(string? id)
    {
        lock(sync) {var item=records.Find(x=>x.Id==id && x.Status=="completed");return item is not null && File.Exists(ZipPath(item.Id)) ? item : null;}
    }
    public bool Delete(string id)
    {
        lock (sync)
        {
            var item = records.Find(x => x.Id == id); if (restoreReserved || item is null || current?.Id == id) return false;
            File.Delete(ZipPath(id)); CleanupScratch(id); File.Delete(Path.Combine(storage, $"backup-{id}.json")); records.Remove(item); return true;
        }
    }
    public async Task<(Stream Stream, BackupRecord Record)?> Download(string id, CancellationToken token)
    {
        BackupRecord? item; FileStream stream;
        lock (sync)
        {
            item = records.Find(x => x.Id == id && x.Status == "completed"); if (item is null) return null;
            var path = ZipPath(id); if (!File.Exists(path)) return null;
            if (File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint)) throw new IOException("Linked archive.");
            stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        }
        try { if (Convert.ToHexString(await SHA256.HashDataAsync(stream, token)) != item.Sha256) throw new BackupIntegrityException(); stream.Position = 0; return (stream, item); }
        catch { await stream.DisposeAsync(); throw; }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using (var lease = gate.TryEnter())
                {
                    if (lease is not null)
                    {
                        lock (sync)
                        {
                            if (current is null && !restoreReserved && schedule.Policy.Enabled && schedule.NextRunAt <= DateTimeOffset.UtcNow)
                            {
                                var next = new BackupSchedule(schedule.Policy, NextRun(schedule.Policy, DateTimeOffset.UtcNow));
                                Atomic(PolicyPath, JsonSerializer.Serialize(next, AppJsonContext.Default.BackupSchedule)); schedule = next;
                                Queue(SystemActor, "scheduled");
                            }
                        }
                    }
                }
                BackupRecord? job; lock (sync) job = current;
                if (job?.Status == "queued") await Run(job, stoppingToken);
                else if(job?.Status=="checkingArchive") await RunVerification(job,stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogError(exception, "Backup worker failed"); }
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }
    private async Task Run(BackupRecord job, CancellationToken token)
    {
        var stage = Path.Combine(storage, $".backup-{job.Id}.stage"); var partial = ZipPath(job.Id) + ".partial";
        try
        {
            Update(job with { Status = "snapshot" });
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                timeout.CancelAfter(TimeSpan.FromMinutes(5));
                using var pause = await gate.PauseAsync(timeout.Token);
                await BackupArchive.Snapshot(data, stage, timeout.Token);
            }
            Update(job with { Status = "compressing" });
            var manifest = await BackupArchive.Pack(stage, partial, token);
            Update(job with { Status = "verifying" });
            await BackupArchive.Verify(partial, token);
            await using var file = new FileStream(partial, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            var hash = Convert.ToHexString(await SHA256.HashDataAsync(file, token)); var size = file.Length; await file.DisposeAsync();
            File.Move(partial, ZipPath(job.Id));
            Update(job with { Status = "completed", Size = size, FileCount = manifest.Files.Length, Sha256 = hash, VerificationStatus="passed", VerifiedAt=DateTimeOffset.UtcNow });
            try { audit.Record(actor ?? SystemActor, new("backup.completed", "backup", job.Id), "backup-" + job.Id); }
            catch (Exception exception) { logger.LogCritical(exception, "Completed backup audit could not be recorded"); }
            try { Prune(); }
            catch (Exception exception) { logger.LogWarning(exception, "Backup retention will retry after the next backup"); }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Backup {Id} failed", job.Id);
            Update(job with { Status = "failed", ErrorCode = exception is OperationCanceledException ? "interrupted" : "failed" });
        }
        finally
        {
            CleanupScratch(job.Id);
            lock (sync) { current = null; actor = null; }
        }
    }
    internal void Prune()
    {
        lock (sync)
        {
            var candidates = records.Where(x => x.Source == "scheduled" && x.Status == "completed").OrderByDescending(x => x.CreatedAt).ToArray();
            for (var index = 1; index < candidates.Length; index++)
            {
                var item = candidates[index];
                if (index < schedule.Policy.RetainCount && item.CreatedAt >= DateTimeOffset.UtcNow.AddDays(-schedule.Policy.RetainDays)) continue;
                try { if (Delete(item.Id)) audit.Record(SystemActor, new("backup.pruned", "backup", item.Id), "backup-retention"); }
                catch (IOException exception) { logger.LogWarning(exception, "Retention skipped an in-use backup {Id}", item.Id); }
            }
        }
    }
}
