using System.Text;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

internal static class MyOrganizationEndpoints
{
    public static void MapMyOrganization(this RouteGroupBuilder api, Func<HttpContext, CurrentUserDto?> currentUser)
    {
        var group = api.MapGroup("/me/organization");
        group.AddEndpointFilter(async (context, next) =>
        {
            context.HttpContext.Response.Headers.CacheControl = "private, no-store";
            if (currentUser(context.HttpContext) is null)
                return Results.Json(new ApiErrorDto("auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", null, false, context.HttpContext.TraceIdentifier), AppJsonContext.Default.ApiErrorDto, statusCode: 401);
            return await next(context);
        });
        group.MapGet("", (HttpContext context, UserRepository accounts, string? locale, string? search, int page = 1) =>
        {
            if (search?.Length > 100 || page < 1 || locale is not (null or "zh-CN" or "en-US")) return Results.BadRequest();
            return Results.Ok(accounts.ReadMyOrganization(currentUser(context)!.Id, search, page, locale));
        });
        group.MapGet("/members/{id}", (string id, HttpContext context, UserRepository accounts, string? locale) =>
        {
            if (locale is not (null or "zh-CN" or "en-US")) return Results.BadRequest();
            var member = accounts.ReadOrganizationMember(currentUser(context)!.Id, id, locale);
            return member is not null ? Results.Ok(member) : Results.Json(
                new ApiErrorDto("organization.member_unavailable", "organizationMember.unavailable", "This member is unavailable.", null, false, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto, statusCode: 404);
        });
        group.MapGet("/members/{id}/activity", (string id, HttpContext context, UserRepository accounts, string? locale, string? search, int page = 1) =>
        {
            if (locale is not (null or "zh-CN" or "en-US") || search?.Length > 100 || page < 1) return Results.BadRequest();
            var activity = accounts.ReadOrganizationMemberActivity(currentUser(context)!.Id, id, locale, search, page);
            return activity is not null ? Results.Ok(activity) : Results.Json(
                new ApiErrorDto("organization.member_unavailable", "organizationMember.unavailable", "This member is unavailable.", null, false, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto, statusCode: 404);
        });
        group.MapGet("/members/{id}/avatar", (string id, HttpContext context, UserRepository accounts) =>
        {
            var name = accounts.FindOrganizationMemberName(currentUser(context)!.Id, id);
            if (name is null) return Results.NotFound();
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            var avatar = accounts.OpenAvatar(id);
            return avatar is null ? Results.Text(AvatarImage.Create(id, name), "image/svg+xml", Encoding.UTF8) : Results.Stream(avatar.Stream, avatar.ContentType);
        });
    }
}
