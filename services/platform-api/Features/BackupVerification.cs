using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Features;

internal sealed class BackupIntegrityException(string? message = null) : IOException(message);
internal sealed partial class BackupService
{
    internal static readonly RestoreStatusFilter[] VerificationFilters=[new("","backups.check.all"),new("passed","backups.check.passed"),new("damaged","backups.check.damaged"),new("unavailable","backups.check.unavailable"),new("interrupted","backups.check.interrupted"),new("unchecked","backups.check.unchecked"),new("recordFailed","backups.check.recordFailed")];
    public BackupRecord? QueueVerification(string id,CurrentUserDto user)
    {
        lock(sync) {
            if(current is not null || restoreReserved)return null;
            var index=records.FindIndex(x=>x.Id==id && x.Status=="completed");if(index<0)return null;
            var item=records[index] with {VerificationStatus="queued"};WriteRecord(item);records[index]=item;
            // Current is a work indicator only; the completed archive's creation status is never rewritten.
            current=item with {Status="checkingArchive"};actor=user;return item;
        }
    }
    internal async Task RunVerification(BackupRecord job,CancellationToken token)
    {
        var outcome="unavailable";
        try {
            lock(sync) {var index=records.FindIndex(x=>x.Id==job.Id);var checking=records[index] with {VerificationStatus="checking"};WriteRecord(checking);records[index]=checking;}
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(token);timeout.CancelAfter(TimeSpan.FromMinutes(10));
            var result=await Download(job.Id,timeout.Token);
            if(result is null)outcome="unavailable";
            else {
                await using var input=result.Value.Stream;
                // Retain the same open file through full-archive hash and per-entry verification.
                try {await BackupArchive.Verify(input,timeout.Token);outcome="passed";}
                catch(Exception error) when(error is InvalidDataException or JsonException or BackupIntegrityException) {outcome="damaged";}
            }
        }
        catch(BackupIntegrityException) {outcome="damaged";}
        catch(OperationCanceledException) {outcome="interrupted";}
        catch(Exception error) {logger.LogWarning(error,"Backup verification could not finish for {Id}",job.Id);}
        finally {
            outcome=SaveVerificationOutcome(job.Id,outcome);
            try {
                using var lease=gate.TryEnter();
                if(lease is not null)audit.Record(actor??SystemActor,new(outcome=="passed"?"backup.verified":"backup.verification_failed","backup",job.Id),"backup-verify-"+job.Id);
            } catch(Exception error) {logger.LogError(error,"Backup verification audit could not be recorded");}
            lock(sync) {current=null;actor=null;}
        }
    }
    internal string SaveVerificationOutcome(string id,string outcome)
    {
        lock(sync) {
            var index=records.FindIndex(x=>x.Id==id);if(index<0)return "recordFailed";
            var result=records[index] with {VerificationStatus=outcome,VerifiedAt=DateTimeOffset.UtcNow};
            try {WriteRecord(result);records[index]=result;return outcome;}
            catch(Exception error) {
                logger.LogError(error,"Backup verification result could not be persisted");
                // Expose the write failure instead of claiming a durable successful check.
                // The existing queued/checking record becomes interrupted on startup; a fresh check can retry.
                records[index]=records[index] with {VerificationStatus="recordFailed",VerifiedAt=null};
                return "recordFailed";
            }
        }
    }

}
