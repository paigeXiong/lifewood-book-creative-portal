using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

internal static class EmailEndpoints
{
    public static void MapEmail(this RouteGroupBuilder api, Func<HttpContext, CurrentUserDto?> currentUser)
    {
        api = api.MapGroup("");
        api.AddEndpointFilter(async (context, next) => { context.HttpContext.Response.Headers.CacheControl = "no-store"; return await next(context); });
        api.MapGet("/auth/email-status", (MailSettings settings) => Results.Ok(new MailAvailabilityDto(settings.Ready)));
        api.MapGet("/admin/mail/status", (HttpContext c, EmailRepository repository, string? status, string? kind, int? page) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!user.Roles.Contains("owner")) return Results.StatusCode(403);
            if ((!string.IsNullOrEmpty(status) && !EmailRepository.QueueStates.Contains(status)) || (!string.IsNullOrEmpty(kind) && !EmailRepository.QueueKinds.Contains(kind)) || page is < 1 or > 100000) return Failure(c, 400, "invalidFilter");
            return Results.Ok(repository.QueueStatus(status, kind, page ?? 1));
        });
        api.MapGet("/me/email", (HttpContext c, EmailRepository repository) => currentUser(c) is {} user ? Results.Ok(repository.Status(user.Id)) : Results.Unauthorized());
        api.MapPost("/me/email/verify", (HttpContext c, EmailRepository repository, MailSettings settings) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!settings.Ready) return Failure(c, 503, "unavailable");
            return repository.Request("verify", user.Id) ? Results.NoContent() : Failure(c, 429, "cooldown");
        }).RequireRateLimiting("authentication");
        api.MapPut("/me/email/preferences", (EmailPreferenceRequest input, HttpContext c, EmailRepository repository) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            return repository.SavePreferences(user.Id, input.Notifications) ? Results.Ok(repository.Status(user.Id)) : Failure(c, 409, "verifyFirst");
        });
        api.MapPost("/auth/password/forgot", async (ForgotPasswordRequest input, HttpContext c, EmailRepository repository, MailSettings settings) => {
            if (!settings.Ready) return Failure(c, 503, "unavailable");
            // Uniform response for unknown, unverified, disabled and throttled accounts.
            var timer = System.Diagnostics.Stopwatch.StartNew();
            if (input.Email is { Length: > 0 and <= 254 }) repository.Request("reset", input.Email);
            var remaining = TimeSpan.FromMilliseconds(300) - timer.Elapsed;
            if (remaining > TimeSpan.Zero) await Task.Delay(remaining, c.RequestAborted);
            return Results.NoContent();
        }).RequireRateLimiting("authentication");
        api.MapPost("/auth/email/verify", (EmailTokenRequest input, HttpContext c, EmailRepository repository) =>
            repository.Consume("verify", input.Token) ? Results.NoContent() : Failure(c, 400, "invalidLink")).RequireRateLimiting("authentication");
        api.MapPost("/auth/password/reset", (EmailTokenRequest input, HttpContext c, EmailRepository repository) =>
            repository.Consume("reset", input.Token, input.NewPassword) ? Results.NoContent() : Failure(c, 400, "invalidLink")).RequireRateLimiting("authentication");
    }
    private static IResult Failure(HttpContext c, int status, string code) => Results.Json(new ApiErrorDto("email." + code, "email.errors." + code, "Unable to complete email request.", null, false, c.TraceIdentifier), AppJsonContext.Default.ApiErrorDto, statusCode: status);
}
