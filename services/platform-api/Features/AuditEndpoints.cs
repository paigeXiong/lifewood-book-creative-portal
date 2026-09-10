using System.Text;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal static class AuditEndpoints
{
    public static string CsvCell(string? value)
    {
        value ??= "";
        if (value.TrimStart().StartsWith('=') || value.TrimStart().StartsWith('+') || value.TrimStart().StartsWith('-') || value.TrimStart().StartsWith('@') || value.StartsWith('\t') || value.StartsWith('\r')) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
    public static void MapAuditTools(this RouteGroupBuilder api, Func<HttpContext, CurrentUserDto?> current)
    {
        api.MapGet("/admin/audit-events/export", (HttpContext c, AuditRepository audit, string? search, string? actionId, string? from, string? to, string? locale) =>
        {
            var user = current(c); if (user is null) return Results.Unauthorized();
            if (!user.Permissions.Contains("admin.audit.read")) return Results.Forbid();
            c.Response.Headers.CacheControl = "no-store";
            var records = audit.List(search, actionId, from, to, 1, 2000);
            if (records.Total > 2000) return Results.BadRequest(new ApiErrorDto("audit.export_limit", "auditTools.exportLimit", "Narrow the filters to 2,000 records or fewer.", null, false, c.TraceIdentifier));
            var zh = locale != "en-US";
            var labels = AuditActionCatalog.ForLocale(zh ? "zh-CN" : "en-US").ToDictionary(x=>x.Id,x=>x.Label);
            var rows = new List<string[]> { zh ? ["操作人", "操作", "对象", "名称来源", "时间（UTC）"] : ["Actor", "Action", "Target", "Name source", "Time (UTC)"] };
            foreach (var raw in records.Items)
            {
                c.RequestAborted.ThrowIfCancellationRequested();
                var item = audit.Present(raw);
                rows.Add([item.ActorName, labels.GetValueOrDefault(item.ActionId, zh ? "其他操作" : "Other action"), (zh ? item.Context?.LabelZh : item.Context?.LabelEn) ?? (zh ? "对象不可用" : "Target unavailable"), item.Context?.Source switch { "recorded" => zh ? "操作时记录" : "Recorded at operation", "current" => zh ? "当前信息" : "Current information", _ => zh ? "对象不可用" : "Target unavailable" }, item.OccurredAt.ToUniversalTime().ToString("O")]);
            }
            var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(string.Join("\r\n",rows.Select(row=>string.Join(",",row.Select(CsvCell)))))).ToArray();
            return Results.File(bytes, "text/csv; charset=utf-8", "audit.csv");
        });
    }
}
