using Microsoft.Data.Sqlite;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal sealed record AuditSnapshot(string? LabelZh, string? LabelEn, string? Path, Dictionary<string, string?>? Fields = null);

internal static class AuditTargets
{
    public static AuditContextDto RecordContext(AuditSnapshot? after, AuditSnapshot? before)
    {
        var target = after ?? before;
        AuditChangeDto[]? changes = null;
        if (before?.Fields is not null || after?.Fields is not null)
        {
            var oldFields = before?.Fields ?? new();
            var newFields = after?.Fields ?? new();
            changes = oldFields.Keys.Union(newFields.Keys).Where(key => oldFields.GetValueOrDefault(key) != newFields.GetValueOrDefault(key))
                .Select(key => new AuditChangeDto(key, oldFields.GetValueOrDefault(key), newFields.GetValueOrDefault(key))).ToArray();
        }
        return new(target?.LabelZh, target?.LabelEn, target is null ? "unavailable" : "recorded", null, changes);
    }

    public static AuditSnapshot? Capture(string connectionString, AuditActionMatch action)
    {
        using var c = new SqliteConnection(connectionString);
        c.Open();
        // Only these projections can enter an audit snapshot. Never serialize an account or request object.
        string? sql = null; string? path = null; string? group = null;
        var id = action.TargetId ?? "";
        switch (action.TargetType)
        {
            case "project":
                sql = "SELECT COALESCE(NULLIF(json_extract(book_json,'$.title'),''),NULLIF(json_extract(project_json,'$.projectName'),''),task_number), task_number FROM projects WHERE id=$id AND first_submitted_at IS NOT NULL";
                path = "projects?project=" + Uri.EscapeDataString(id); break;
            case "delivery":
                sql = "SELECT d.file_name,d.file_name,p.id FROM project_deliveries d JOIN projects p ON p.id=d.project_id WHERE d.id=$id AND p.first_submitted_at IS NOT NULL";
                path = "projects?project="; break;
            case "user":
                sql = "SELECT display_name, email FROM users WHERE id=$id AND closed_at IS NULL";
                path = "users?q="; break;
            case "organization":
                sql = "SELECT name,name FROM organizations WHERE id=$id";
                path = "users?organization=" + Uri.EscapeDataString(id); break;
            case "form_option":
                var parts = id.Split('/', 2); if (parts.Length != 2) return null;
                group = parts[0]; id = parts[1];
                sql = "SELECT label_zh_cn,label_en_us,description_zh_cn,description_en_us,enabled,sort_order,allows_custom_value,is_removed,tone,preview_color,preview_image_url,preview_video_url FROM form_options WHERE group_id=$group AND id=$id";
                path = "settings/options?group=" + Uri.EscapeDataString(group); break;
            case "notification":
                if (id == "retention")
                {
                    sql = "SELECT '归档保留期限','Archive retention',retention_days FROM notification_settings WHERE id=1";
                    path = "settings/notifications";
                }
                else if (id.StartsWith("rules/", StringComparison.Ordinal))
                {
                    id = id[6..];
                    sql = "SELECT document FROM notification_rules WHERE kind=$id";
                    path = "settings/notifications";
                }
                else return new("通知配置", "Notification configuration", "settings/notifications");
                break;
            case "backup": return new("平台备份", "Platform backups", "settings/backups");
            case "ai_settings": return new("AI 接入", "AI integration", "settings/ai");
            case "runtime": case "runtime_settings": return new("运行与网络", "Runtime and network", "settings/runtime");
            case "file_category": return new("文件类别", "File category", "settings/files");
            case "character_preset": return new("预设角色", "Character preset", "settings/characters");
            case "voice": return new("参考音色", "Voice reference", "settings/voices");
            case "announcement": return new("公告", "Announcement", "settings/announcements");
            default: return null;
        }
        try
        {
            using var q = c.CreateCommand(); q.CommandText = sql; q.CommandTimeout = 5;
            q.Parameters.AddWithValue("$id", id); q.Parameters.AddWithValue("$group", group ?? "");
            using var r = q.ExecuteReader(); if (!r.Read()) return null;
            if (action.TargetType == "notification" && action.TargetId?.StartsWith("rules/", StringComparison.Ordinal) == true)
            {
                using var json = JsonDocument.Parse(r.GetString(0));
                var fields = new Dictionary<string,string?>();
                foreach (var key in new[]{ "titleZh", "titleEn", "level", "enabled", "allowMute", "audience" })
                    fields[key] = json.RootElement.TryGetProperty(key, out var value) ? value.ToString() : null;
                return new(fields.GetValueOrDefault("titleZh"), fields.GetValueOrDefault("titleEn"), path, fields);
            }
            var zh = r.GetString(0); var en = action.TargetType is "project" or "user" ? zh : r.GetString(1);
            if (action.TargetType == "user") path += Uri.EscapeDataString(r.GetString(1));
            if (action.TargetType == "delivery") path += Uri.EscapeDataString(r.GetString(2));
            Dictionary<string,string?>? values = null;
            if (action.TargetType == "form_option")
            {
                values = new();
                var names = new[]{"labelZh", "labelEn", "descriptionZh", "descriptionEn", "enabled", "sortOrder", "allowsCustomValue", "removed", "tone", "previewColor", "previewImageUrl", "previewVideoUrl"};
                for (var i=0; i<names.Length; i++) values[names[i]] = r.IsDBNull(i) ? null : Convert.ToString(r.GetValue(i), System.Globalization.CultureInfo.InvariantCulture);
            }
            if (action.TargetType == "notification") values = new() { ["retentionDays"] = r.GetInt32(2).ToString(System.Globalization.CultureInfo.InvariantCulture) };
            return new(zh, en, path, values);
        }
        // Legacy unit databases may not contain an associated business table. Missing targets are not invented.
        catch (SqliteException ex) when (ex.SqliteErrorCode == 1 && ex.Message.Contains("no such", StringComparison.OrdinalIgnoreCase)) { return null; }
    }
}
