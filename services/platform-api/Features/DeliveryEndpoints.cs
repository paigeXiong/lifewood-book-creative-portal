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
            if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            return admin.GetProject(id) is null
                ? Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.")
                : Results.Ok(deliveries.ListForAdmin(id));
        });

        api.MapPost("/admin/projects/{id}/deliveries", async (string id, HttpContext context, AdminRepository admin, DeliveryRepository deliveries, StorageQuota storageQuota) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
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
            try
            {
                await using (var output = File.Create(path))
                {
                    await file.CopyToAsync(output, context.RequestAborted);
                }
                context.RequestAborted.ThrowIfCancellationRequested();
            }
            catch
            {
                if (File.Exists(path)) File.Delete(path);
                throw;
            }
            if (!IsoBmffVideoProbe.IsSupportedVideo(path))
            {
                File.Delete(path);
                return Error(context, 400, "delivery.file", "errors.delivery.file", "Choose a valid MP4 or MOV file containing a video track.");
            }
            try
            {
                var result = deliveries.Publish(deliveryId, id, user.Id, safeName, contentType, file.Length, note, out var delivery);
                if (result.Outcome == AdminWriteOutcome.Saved)
                {
                    context.Items[AuditActionCatalog.TargetIdItemKey] = delivery!.Id;
                    return Results.Ok(delivery);
                }
                File.Delete(path);
                return result.Outcome == AdminWriteOutcome.Conflict
                    ? Error(context, 409, "project.not_submitted", "errors.project.notSubmitted", "Only submitted projects can receive a final delivery.")
                    : Error(context, 400, "validation.failed", "errors.validation.failed", "The final delivery could not be published.");
            }
            catch
            {
                if (File.Exists(path)) File.Delete(path);
                throw;
            }
        }).DisableAntiforgery();

        api.MapDelete("/admin/projects/{id}/deliveries/{deliveryId}", (string id, string deliveryId, HttpContext context, AdminRepository admin, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
            var result = deliveries.Revoke(id, deliveryId);
            return result.Outcome == AdminWriteOutcome.Saved
                ? Results.NoContent()
                : Error(context, 404, "delivery.not_found", "admin.delivery.notFound", "The delivery was not found.");
        });
        api.MapGet("/admin/projects/{id}/deliveries/{deliveryId}/file", (string id, string deliveryId, HttpContext context, AdminRepository admin, DeliveryRepository deliveries) =>
        {
            var user = CurrentUser(context);
            if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.");
            if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.");
            if (admin.GetProject(id) is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.");
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
        var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{delivery.Id}_*").SingleOrDefault() : null;
        return path is null
            ? Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.")
            : Results.File(path, delivery.ContentType, delivery.FileName, enableRangeProcessing: true);
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
}
