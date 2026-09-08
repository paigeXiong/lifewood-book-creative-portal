using System.Security.Claims;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace Lifewood.PlatformApi.Features;

internal static class DeliveryEndpoints
{
    private const long MaxDeliveryBytes = 500_000_000;
    private static readonly string[] AllowedContentTypes = ["video/mp4", "video/quicktime"];

    public static RouteGroupBuilder MapDeliveryEndpoints(this RouteGroupBuilder api, string dataDirectory)
    {
        api.MapGet("/admin/projects/{id}/deliveries", (string id, HttpContext context, AdminRepository admin, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            return admin.GetProject(id, user.Id) is null
                ? Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.")
                : Results.Ok(deliveries.ListForAdmin(id));
        });

        api.MapPost("/admin/projects/{id}/deliveries", async (string id, HttpContext context, AdminRepository admin, DeliveryRepository deliveries, StorageQuota storageQuota) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.deliver")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id, user.Id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
            if (!context.Request.HasFormContentType) return Error(context, 400, "validation.failed", "errors.validation.failed", "A multipart form is required.");
            var form = await context.Request.ReadFormAsync(context.RequestAborted);
            var file = form.Files.GetFile("file");
            var note = form["note"].ToString();
            if (file is null || file.Length <= 0 || file.Length > MaxDeliveryBytes) return Error(context, 400, "delivery.file", "errors.delivery.file", "Choose an MP4 or MOV file up to 500 MB.");
            var contentType = NormalizeContentType(file.ContentType, file.FileName);
            if (!AllowedContentTypes.Contains(contentType, StringComparer.OrdinalIgnoreCase))
                return Error(context, 400, "delivery.file", "errors.delivery.file", "Choose an MP4 or MOV file up to 500 MB.");
            if (note.Trim().Length > 2000) return Error(context, 400, "delivery.note", "errors.delivery.note", "The delivery note is too long.");

            await using var reservation = await storageQuota.TryReserveAsync(file.Length, context.RequestAborted);
            if (reservation is null) return Error(context, 507, "storage.quota", "errors.storage.quota", "Storage capacity has been reached. Contact an administrator.");

            var deliveryId = Guid.NewGuid().ToString("N");
            var safeName = SanitizeFileName(file.FileName);
            var folder = Path.Combine(dataDirectory, "deliveries", id);
            Directory.CreateDirectory(folder);
            var path = Path.Combine(folder, $"{deliveryId}_{safeName}");
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".upload";
            var pendingMarker = path + ".pending";
            try
            {
                await using (var output = File.Create(temporary))
                {
                    await file.CopyToAsync(output, context.RequestAborted);
                    output.Flush(flushToDisk: true);
                }
                context.RequestAborted.ThrowIfCancellationRequested();
            }
            catch
            {
                if (File.Exists(temporary)) File.Delete(temporary);
                if (File.Exists(path)) File.Delete(path);
                throw;
            }
            if (!IsoBmffVideoProbe.IsSupportedVideo(temporary))
            {
                File.Delete(temporary);
                return Error(context, 400, "delivery.file", "errors.delivery.file", "Choose a valid MP4 or MOV file containing a video track.");
            }
            try
            {
                CreatePendingMarker(pendingMarker);
                File.Move(temporary, path);
                var result = deliveries.Publish(deliveryId, id, user.Id, safeName, contentType, file.Length, note, out var delivery, user.Id);
                if (result.Outcome == AdminWriteOutcome.Saved)
                {
                    try { File.Delete(pendingMarker); }
                    catch (Exception exception)
                    {
                        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("DeliveryRecovery")
                            .LogWarning(exception, "Pending delivery marker {Path} will be reconciled on restart", pendingMarker);
                    }
                    context.Items[AuditActionCatalog.TargetIdItemKey] = delivery!.Id;
                    return Results.Ok(delivery);
                }
                File.Delete(path);
                File.Delete(pendingMarker);
                if (result.Outcome == AdminWriteOutcome.Conflict)
                {
                    return result.Field == "activeDelivery"
                        ? Error(context, 409, "delivery.active_exists", "errors.delivery.activeExists", "Withdraw the current final delivery before publishing another one.")
                        : Error(context, 409, "project.not_submitted", "errors.project.notSubmitted", "Only submitted projects can receive a final delivery.");
                }
                return Error(context, 400, "validation.failed", "errors.validation.failed", "The final delivery could not be published.");
            }
            catch
            {
                if (File.Exists(temporary)) File.Delete(temporary);
                if (File.Exists(path)) File.Delete(path);
                if (File.Exists(pendingMarker)) File.Delete(pendingMarker);
                throw;
            }
        }).DisableAntiforgery();

        api.MapDelete("/admin/projects/{id}/deliveries/{deliveryId}", (string id, string deliveryId, HttpContext context, AdminRepository admin, DeliveryRepository deliveries, ILoggerFactory loggerFactory) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.deliver")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id, user.Id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
            var result = deliveries.Revoke(id, deliveryId, user.Id);
            if (result.Outcome != AdminWriteOutcome.Saved)
                return Error(context, 404, "delivery.not_found", "admin.delivery.notFound", "The delivery was not found.");
            DeleteDeliveryFiles(dataDirectory, id, deliveryId, loggerFactory.CreateLogger("DeliveryCleanup"));
            return Results.NoContent();
        });
        api.MapGet("/admin/projects/{id}/deliveries/{deliveryId}/file", (string id, string deliveryId, HttpContext context, AdminRepository admin, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id, user.Id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
            return DeliveryFile(id, deliveryId, dataDirectory, deliveries, context);
        });

        api.MapGet("/projects/{id}/deliveries", (string id, HttpContext context, ProjectRepository projects, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Read permission is required.");
            return projects.Get(user.Id, id) is null
                ? Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.")
                : Results.Ok(deliveries.List(id));
        });

        api.MapGet("/projects/{id}/deliveries/{deliveryId}/file", (string id, string deliveryId, HttpContext context, ProjectRepository projects, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Read permission is required.");
            if (projects.Get(user.Id, id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
            return DeliveryFile(id, deliveryId, dataDirectory, deliveries, context);
        });

        return api;
    }

    private static IResult DeliveryFile(string projectId, string deliveryId, string dataDirectory, DeliveryRepository deliveries, HttpContext context)
    {
        var delivery = deliveries.Find(projectId, deliveryId);
        if (delivery is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.");
        var folder = Path.Combine(dataDirectory, "deliveries", projectId);
        var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{delivery.Id}_*").Where(IsStoredFile).SingleOrDefault() : null;
        return path is null
            ? Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.")
            : Results.File(path, delivery.ContentType, delivery.FileName, enableRangeProcessing: true);
    }

    internal static void DeleteDeliveryFiles(string dataDirectory, string projectId, string deliveryId, ILogger logger)
    {
        var folder = Path.Combine(dataDirectory, "deliveries", projectId);
        if (!Directory.Exists(folder)) return;
        string[] paths;
        try { paths = [.. Directory.EnumerateFiles(folder, $"{deliveryId}_*")]; }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not enumerate revoked delivery files for {DeliveryId}; cleanup will retry on restart", deliveryId);
            return;
        }
        foreach (var path in paths)
        {
            try { File.Delete(path); }
            catch (Exception exception) { logger.LogWarning(exception, "Revoked delivery file {DeliveryId} will be cleaned on restart", deliveryId); }
        }
    }

    private static CurrentUserDto? CurrentUser(HttpContext context)
    {
        var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        var sessionClaim = context.User.FindFirstValue("lw_session_version");
        return string.IsNullOrWhiteSpace(userId) || !int.TryParse(sessionClaim, out var sessionVersion)
            ? null
            : context.RequestServices.GetRequiredService<UserRepository>().Get(userId, sessionVersion);
    }

    private static bool Can(CurrentUserDto user, string permission) => user.Permissions.Contains(permission, StringComparer.Ordinal);

    private static IResult Error(HttpContext context, int status, string code, string messageKey, string fallback) =>
        Results.Json(new ApiErrorDto(code, messageKey, fallback, null, false, context.TraceIdentifier), AppJsonContext.Default.ApiErrorDto, statusCode: status);

    private static string NormalizeContentType(string contentType, string fileName)
    {
        var expected = Path.GetExtension(fileName).ToLowerInvariant() switch { ".mp4" => "video/mp4", ".mov" => "video/quicktime", _ => "application/octet-stream" };
        return string.IsNullOrWhiteSpace(contentType) || contentType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) || contentType.Equals(expected, StringComparison.OrdinalIgnoreCase)
            ? expected : "application/octet-stream";
    }


    private static string SanitizeFileName(string fileName)
    {
        var name = Path.GetFileName(fileName);
        var invalid = Path.GetInvalidFileNameChars();
        var safe = new string(name.Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
        if (string.IsNullOrWhiteSpace(safe)) return "final-video.mp4";
        if (safe.Length <= 120) return safe;
        var extension = Path.GetExtension(safe);
        var stem = Path.GetFileNameWithoutExtension(safe);
        var maxStemLength = Math.Max(1, 120 - extension.Length);
        return $"{stem[..Math.Min(stem.Length, maxStemLength)]}{extension}";
    }

    private static void CreatePendingMarker(string path)
    {
        using var marker = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        marker.Flush(flushToDisk: true);
    }

    private static bool IsStoredFile(string path) =>
        !path.EndsWith(".pending", StringComparison.OrdinalIgnoreCase) &&
        !path.EndsWith(".upload", StringComparison.OrdinalIgnoreCase);
}
