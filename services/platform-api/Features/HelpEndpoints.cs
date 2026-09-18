using System.Security.Claims;
using System.Text.Json;
using Lifewood.PlatformApi.Persistence;

namespace Lifewood.PlatformApi.Features;

// Versioned help is embedded in the server, never in public client assets.
internal static class HelpEndpoints
{
    private static readonly System.Reflection.Assembly Assembly = typeof(HelpEndpoints).Assembly;
    private static readonly string Prefix = "Lifewood.PlatformApi.Help.";

    public static RouteGroupBuilder MapHelpEndpoints(this RouteGroupBuilder api)
    {
        api.MapGet("/admin/function-search", (HttpContext context, UserRepository users, string? locale, string? q) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = id is not null && int.TryParse(context.User.FindFirstValue("lw_session_version"), out var version) ? users.Get(id, version) : null;
            if (user is null) return Results.Unauthorized();
            if (!user.Permissions.Contains("admin.access")) return Results.Forbid();
            if (locale is not (null or "zh-CN" or "en-US") || q?.Length > 100) return Results.BadRequest();
            var terms = (q ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            using var output = new MemoryStream();
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartArray();
                if (terms.Length > 0)
                {
                    using var stream = Assembly.GetManifestResourceStream(Prefix + "functions." + (locale ?? "zh-CN") + ".json")!;
                    using var catalog = JsonDocument.Parse(stream);
                    foreach (var item in catalog.RootElement.EnumerateArray())
                    {
                        if (!item.GetProperty("permissions").EnumerateArray().All(p => user.Permissions.Contains(p.GetString()!))
                            || item.GetProperty("owner").GetBoolean() && !user.Roles.Contains("owner")) continue;
                        var text = item.GetProperty("title").GetString() + " " + item.GetProperty("category").GetString() + " " + item.GetProperty("keywords").GetString();
                        if (!terms.All(term => text.Contains(term, StringComparison.OrdinalIgnoreCase))) continue;
                        WriteSearchResult(writer, item.GetProperty("title").GetString()!, item.GetProperty("category").GetString()!, item.GetProperty("path").GetString()!, "function");
                    }
                    foreach (var audience in new[] { "admin", "customer" })
                    {
                        using var helpStream = Assembly.GetManifestResourceStream(Prefix + audience + "." + (locale ?? "zh-CN") + ".json")!;
                        using var articles = JsonDocument.Parse(helpStream);
                        foreach (var article in articles.RootElement.EnumerateArray())
                            if (terms.All(term => SearchText(article).Contains(term, StringComparison.OrdinalIgnoreCase)))
                                WriteSearchResult(writer, article.GetProperty("title").GetString()!, article.GetProperty("category").GetString()!, "/help?audience=" + audience + "&article=" + Uri.EscapeDataString(article.GetProperty("id").GetString()!), audience);
                    }
                }
                writer.WriteEndArray();
            }
            return Results.Bytes(output.ToArray(), "application/json; charset=utf-8");
        });
        api.MapGet("/help", (HttpContext context, UserRepository users, string? locale, string? audience, string? q) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = id is not null && int.TryParse(context.User.FindFirstValue("lw_session_version"), out var version) ? users.Get(id, version) : null;
            var admin = audience == "admin";
            if (admin && user is null) return Results.Unauthorized();
            if (admin && !user!.Permissions.Contains("admin.access")) return Results.Forbid();
            if (audience is not (null or "customer" or "admin") || locale is not (null or "zh-CN" or "en-US") || q?.Length > 200) return Results.BadRequest();
            using var stream = Assembly.GetManifestResourceStream(Prefix + (admin ? "admin" : "customer") + "." + (locale ?? "zh-CN") + ".json")!;
            using var document = JsonDocument.Parse(stream);
            var terms = (q ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            using var output = new MemoryStream();
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartArray();
                foreach (var article in document.RootElement.EnumerateArray())
                    if (terms.All(term => SearchText(article).Contains(term, StringComparison.OrdinalIgnoreCase))) article.WriteTo(writer);
                writer.WriteEndArray();
            }
            return Results.Bytes(output.ToArray(), "application/json; charset=utf-8");
        });
        api.MapGet("/help/images/{name}", (HttpContext context, UserRepository users, string name, string? locale) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            var id = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            var user = id is not null && int.TryParse(context.User.FindFirstValue("lw_session_version"), out var version) ? users.Get(id, version) : null;
            if (locale is not (null or "zh-CN" or "en-US")) return Results.BadRequest();
            if (name is not ("customer-projects" or "customer-intake" or "customer-detail" or "customer-overview" or "admin-overview")) return Results.NotFound();
            if (name.StartsWith("admin-", StringComparison.Ordinal) && (user is null || !user.Permissions.Contains("admin.access"))) return Results.NotFound();
            var stream = Assembly.GetManifestResourceStream(Prefix + name + "-" + (locale ?? "zh-CN") + ".jpg");
            return stream is null ? Results.NotFound() : Results.Stream(stream, "image/jpeg");
        });
        return api;
    }

    private static void WriteSearchResult(Utf8JsonWriter writer, string title, string category, string path, string kind)
    {
        writer.WriteStartObject();
        writer.WriteString("title", title); writer.WriteString("category", category);
        writer.WriteString("path", path); writer.WriteString("kind", kind);
        writer.WriteEndObject();
    }

    private static string SearchText(JsonElement article) => string.Join(" ",
        new[] { article.GetProperty("title").GetString(), article.GetProperty("summary").GetString(), article.GetProperty("category").GetString() }
        .Concat(article.GetProperty("steps").EnumerateArray().Select(step => step.GetString()))
        .Concat(article.GetProperty("faq").EnumerateArray().SelectMany(item => new[] { item.GetProperty("question").GetString(), item.GetProperty("answer").GetString() })));
}
