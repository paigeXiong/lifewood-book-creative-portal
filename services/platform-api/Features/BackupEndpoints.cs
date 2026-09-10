using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal static class BackupEndpoints
{
    public static void MapBackups(this RouteGroupBuilder api, Func<HttpContext, CurrentUserDto?> currentUser)
    {
        var group = api.MapGroup("/admin/backups");
        group.AddEndpointFilter(async (context, next) => {
            var user = currentUser(context.HttpContext);
            if (user is null) return Results.Unauthorized();
            if (!user.Permissions.Contains("admin.runtime.manage")) return Results.Forbid();
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            return await next(context);
        });
        group.MapGet("", (BackupService service, int page = 1, string? source = null, string? status = null, string? verification = null) => Results.Ok(service.List(page, source, status, verification)));
        group.MapGet("/restore/history", (RestoreService service, UserRepository users, int page=1, string? status=null) => Results.Ok(service.History(page,status,users)));
        group.MapGet("/restore", (RestoreService service) => Results.Ok(service.Overview()));
        group.MapPost("/{id}/preflight", async (string id, RestoreService service, HttpContext context) => {
            try { return Results.Ok(await service.Preview(id, currentUser(context)!, context.RequestAborted)); }
            catch (RestoreValidationException error) { return Results.Conflict(new ApiErrorDto("restore."+error.Code, "restore.errors."+error.Code, "Restore preflight failed.", null, false, context.TraceIdentifier)); }
            catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested) { return Results.Conflict(new ApiErrorDto("restore.timeout", "restore.errors.interrupted", "Restore preflight timed out.", null, true, context.TraceIdentifier)); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidOperationException or Microsoft.Data.Sqlite.SqliteException or System.Text.Json.JsonException) { return Results.Conflict(new ApiErrorDto("restore.preflight", "restore.preflightError", "Restore preflight failed.", null, false, context.TraceIdentifier)); }
        });
        group.MapPost("/restore", (RestoreRequest request, RestoreService service, HttpContext context) => {
            var state=service.Queue(request,currentUser(context)!);
            return state is null ? Results.Conflict(new ApiErrorDto("restore.stale", "restore.stale", "Repeat preflight before restoring.", null, false, context.TraceIdentifier)) : Results.Accepted(value:state);
        });
        group.MapPut("/policy", (BackupPolicy input, BackupService service, AuditRepository audit, HttpContext context) => {
            if (!service.SavePolicy(input)) return Results.BadRequest();
            audit.Record(currentUser(context)!, new("backup.policy", "backup", null), context.TraceIdentifier);
            return Results.Ok(service.List(1, null, null).Schedule);
        });
        group.MapPost("", (BackupService service, AuditRepository audit, HttpContext context) => {
            var actor = currentUser(context)!; var job = service.Queue(actor);
            if (job is null) return Results.Conflict(new ApiErrorDto("backup.running", "backups.alreadyRunning", "A backup is already running.", null, true, context.TraceIdentifier));
            audit.Record(actor, new("backup.create", "backup", job.Id), context.TraceIdentifier);
            return Results.Accepted(value: job);
        });
        group.MapPost("/{id}/verify", (string id, BackupService service, AuditRepository audit, HttpContext context) => {
            var actor=currentUser(context)!;var record=service.QueueVerification(id,actor);
            if(record is null) return Results.Conflict(new ApiErrorDto("backup.check_unavailable","backups.check.unavailableAction","Backup verification is unavailable or another task is running.",null,true,context.TraceIdentifier));
            audit.Record(actor,new("backup.verify","backup",id),context.TraceIdentifier);
            return Results.Accepted(value:record);
        });
        group.MapDelete("/{id}", (string id, BackupService service, AuditRepository audit, HttpContext context) => {
            if (!service.Delete(id)) return Results.NotFound();
            audit.Record(currentUser(context)!, new("backup.delete", "backup", id), context.TraceIdentifier);
            return Results.NoContent();
        });
        group.MapGet("/{id}/download", async (string id, BackupService service, AuditRepository audit, HttpContext context) => {
            try
            {
                var result = await service.Download(id, context.RequestAborted);
                if (result is null) return Results.NotFound();
                try { audit.Record(currentUser(context)!, new("backup.download", "backup", id), context.TraceIdentifier); }
                catch { await result.Value.Stream.DisposeAsync(); throw; }
                return Results.File(result.Value.Stream, "application/zip", $"lifewood-backup-{result.Value.Record.CreatedAt:yyyyMMdd-HHmmss}.zip", enableRangeProcessing: true);
            }
            catch (IOException) { return Results.Conflict(new ApiErrorDto("backup.integrity", "backups.integrityError", "Archive is missing, unreadable or failed verification.", null, false, context.TraceIdentifier)); }
        });
    }
}
