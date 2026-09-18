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
        api.MapGet("/admin/mail/templates", (HttpContext c, EmailRepository repository, string? locale) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!user.Roles.Contains("owner")) return Results.StatusCode(403);
            if (locale is not ("zh-CN" or "en-US")) return Failure(c, 400, "invalidFilter");
            return Results.Ok(repository.Templates.Preview(locale));
        });
        api.MapPost("/admin/mail/templates/{kind}/preview", (string kind,string locale,SaveMailTemplate input,HttpContext c) => {
            if(currentUser(c) is not {} user)return Results.Unauthorized();
            if(!user.Roles.Contains("owner"))return Results.StatusCode(403);
            if(input.Reset || !MailTemplateStore.Validate(kind,locale,input))return SettingsFailure(c,400,"invalid");
            return Results.Ok(MailTemplateStore.PreviewDraft(kind,locale,input));
        });
        api.MapPost("/admin/mail/templates/{kind}/test", async (string kind, string locale, MailTestRequest input, HttpContext c, EmailRepository repository, MailSettingsStore store, IPlatformMailer mailer) => {
            if(currentUser(c) is not {} user)return Results.Unauthorized();
            if(!user.Roles.Contains("owner"))return Results.StatusCode(403);
            if(!MailTemplateStore.Valid(kind,locale))return Results.BadRequest();
            if(!await store.Operations.WaitAsync(0,c.RequestAborted))return SettingsFailure(c,409,"busy");
            try {
                var template=repository.Templates.Preview(locale).Single(t=>t.Kind==kind);
                if(template.Revision!=input.Revision)return SettingsFailure(c,409,"conflict");
                var error=store.BeginTest(store.Read(locale).Revision,out var recipient);
                if(error is not null)return SettingsFailure(c,error=="cooldown"?429:409,error);
                await mailer.SendContent(recipient,"[TEST] "+template.Subject,template.Body,c.RequestAborted);
                return Results.NoContent();
            }catch(MailRateLimitedException){return SettingsFailure(c,429,"quota");}catch(Exception exception){return SettingsFailure(c,502,MailFailureClassifier.Classify(exception));}
            finally {store.Operations.Release();}
        }).RequireRateLimiting("authentication");
        api.MapPut("/admin/mail/templates/{kind}", (string kind, string locale, SaveMailTemplate input, HttpContext c, EmailRepository repository) => {
            if(currentUser(c) is not {} user)return Results.Unauthorized();
            if(!user.Roles.Contains("owner"))return Results.StatusCode(403);
            var error=repository.Templates.Save(kind,locale,input);
            return error is null?Results.Ok(repository.Templates.Preview(locale)):SettingsFailure(c,error=="conflict"?409:400,error);
        });
        api.MapGet("/admin/mail/settings", (HttpContext c, MailSettingsStore store, string? locale) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            return !user.Roles.Contains("owner") ? Results.StatusCode(403) : Results.Ok(store.Read(locale));
        });
        api.MapPut("/admin/mail/settings", async (SaveMailSettings input, HttpContext c, MailSettingsStore store, string? locale) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!user.Roles.Contains("owner")) return Results.StatusCode(403);
            await store.Operations.WaitAsync(c.RequestAborted);
            try {
                var error = store.Save(input);
                return error is null ? Results.Ok(store.Read(locale)) : SettingsFailure(c, error == "conflict" ? 409 : 400, error);
            } catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException) {
                return SettingsFailure(c, 503, "saveFailed");
            } finally { store.Operations.Release(); }
        });
        api.MapPost("/admin/mail/test", async (MailTestRequest input, HttpContext c, MailSettingsStore store, IPlatformMailer mailer, string? locale) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!user.Roles.Contains("owner")) return Results.StatusCode(403);
            if (!await store.Operations.WaitAsync(0, c.RequestAborted)) return SettingsFailure(c, 409, "busy");
            try {
                var error = store.BeginTest(input.Revision, out var recipient);
                if (error is not null) return SettingsFailure(c, error == "cooldown" ? 429 : 409, error);
                var english = locale == "en-US";
                await mailer.Send(recipient, english ? "Book Creative Portal — Email test" : "Book Creative Portal — 邮件测试",
                    english ? "This is an email service test requested by your platform owner. No action is required." : "这是一封由平台负责人主动发送的邮件服务测试邮件，无需操作。", c.RequestAborted);
                return Results.NoContent();
            } catch (MailRateLimitedException) { return SettingsFailure(c,429,"quota"); } catch (Exception exception) { return SettingsFailure(c, 502, MailFailureClassifier.Classify(exception)); }
            finally { store.Operations.Release(); }
        }).RequireRateLimiting("authentication");
        api.MapGet("/admin/mail/status", (HttpContext c, EmailRepository repository, MailSettingsStore store, string? status, string? kind, int? page) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!user.Roles.Contains("owner")) return Results.StatusCode(403);
            if ((!string.IsNullOrEmpty(status) && !EmailRepository.QueueStates.Contains(status)) || (!string.IsNullOrEmpty(kind) && !EmailRepository.QueueKinds.Contains(kind)) || page is < 1 or > 100000) return Failure(c, 400, "invalidFilter");
            return Results.Ok(repository.QueueStatus(status, kind, page ?? 1) with {Rate=store.Limiter.Check(store.Settings.Current)});
        });
        api.MapGet("/me/email", (HttpContext c, EmailRepository repository, string? locale) => {
            if(currentUser(c) is not {} user) return Results.Unauthorized();
            return locale is not (null or "zh-CN" or "en-US") ? Results.BadRequest() : Results.Ok(repository.Status(user.Id,locale));
        });
        api.MapPost("/me/email/verify", (HttpContext c, EmailRepository repository, MailSettings settings) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if (!settings.Ready) return Failure(c, 503, "unavailable");
            return repository.Request("verify", user.Id) ? Results.NoContent() : Failure(c, 429, "cooldown");
        }).RequireRateLimiting("authentication");
        api.MapPut("/me/email/preferences", (EmailPreferenceRequest input, HttpContext c, EmailRepository repository) => {
            if (currentUser(c) is not {} user) return Results.Unauthorized();
            if(input.Topics is {} topics && (topics.Length>EmailRepository.TopicIds.Length || topics.Any(topic=>!EmailRepository.TopicIds.Contains(topic)) || topics.Distinct().Count()!=topics.Length)) return Results.BadRequest();
            return repository.SavePreferences(user.Id, input.Notifications,input.Topics) ? Results.Ok(repository.Status(user.Id)) : Failure(c, 409, "verifyFirst");
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
    private static IResult SettingsFailure(HttpContext c, int status, string code) => Results.Json(new ApiErrorDto("mailService." + code, "mailService.errors." + code, "Unable to complete mail configuration request.", null, false, c.TraceIdentifier), AppJsonContext.Default.ApiErrorDto, statusCode: status);
}
