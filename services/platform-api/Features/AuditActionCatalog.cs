using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal sealed record AuditActionMatch(string ActionId, string TargetType, string? TargetId);

internal static class AuditActionCatalog
{
    public const string TargetIdItemKey = "audit.target_id";
    private sealed record Definition(string Id, string LabelZhCn, string LabelEnUs);

    private static readonly Definition[] Definitions =
    [
        new("user.create", "创建用户", "Created user"),
        new("user.update", "更新用户", "Updated user"),
        new("user.password_reset", "重置用户密码", "Reset user password"),
        new("organization.create", "创建组织", "Created organization"),
        new("organization.update", "更新组织", "Updated organization"),
        new("project.workflow_update", "更新项目跟进", "Updated project workflow"),
        new("project.note_add", "添加内部备注", "Added internal note"),
        new("delivery.publish", "发布最终成品", "Published final delivery"),
        new("delivery.revoke", "撤回最终成品", "Withdrew final delivery"),
        new("file_category.upsert", "保存文件类别", "Saved file category"),
        new("form_option.upsert", "保存表单选项", "Saved form option"),
        new("voice.upsert", "保存参考音色", "Saved voice reference"),
        new("voice.sample_upload", "上传音色样本", "Uploaded voice sample"),
        new("voice.sample_remove", "移除音色样本", "Removed voice sample")
    ];

    public static ConfigOptionDto[] ForLocale(string locale) =>
        [.. Definitions.Select(item => new ConfigOptionDto(item.Id, locale == "en-US" ? item.LabelEnUs : item.LabelZhCn))];

    public static AuditActionMatch? Resolve(string method, PathString path)
    {
        var segments = path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments is null || segments.Length < 3 || segments[0] != "api" || segments[1] != "admin") return null;
        string? Value(int index) => segments.Length > index ? Uri.UnescapeDataString(segments[index]) : null;

        if (method == "POST" && segments is ["api", "admin", "users"])
            return new("user.create", "user", null);
        if (method == "PUT" && segments.Length == 4 && segments[2] == "users")
            return new("user.update", "user", Value(3));
        if (method == "PUT" && segments.Length == 5 && segments[2] == "users" && segments[4] == "password")
            return new("user.password_reset", "user", Value(3));
        if (method == "POST" && segments is ["api", "admin", "organizations"])
            return new("organization.create", "organization", null);
        if (method == "PUT" && segments.Length == 4 && segments[2] == "organizations")
            return new("organization.update", "organization", Value(3));
        if (method == "PUT" && segments.Length == 5 && segments[2] == "projects" && segments[4] == "workflow")
            return new("project.workflow_update", "project", Value(3));
        if (method == "POST" && segments.Length == 5 && segments[2] == "projects" && segments[4] == "notes")
            return new("project.note_add", "project", Value(3));
        if (method == "POST" && segments.Length == 5 && segments[2] == "projects" && segments[4] == "deliveries")
            return new("delivery.publish", "delivery", null);
        if (method == "DELETE" && segments.Length == 6 && segments[2] == "projects" && segments[4] == "deliveries")
            return new("delivery.revoke", "delivery", Value(5));
        if (method == "PUT" && segments.Length == 5 && segments[2] == "file-categories")
            return new("file_category.upsert", "file_category", $"{Value(3)}/{Value(4)}");
        if (method == "PUT" && segments.Length == 5 && segments[2] == "form-options")
            return new("form_option.upsert", "form_option", $"{Value(3)}/{Value(4)}");
        if (method == "PUT" && segments.Length == 4 && segments[2] == "voices")
            return new("voice.upsert", "voice", Value(3));
        if (segments.Length == 5 && segments[2] == "voices" && segments[4] == "sample")
        {
            if (method == "POST") return new("voice.sample_upload", "voice", Value(3));
            if (method == "DELETE") return new("voice.sample_remove", "voice", Value(3));
        }
        return null;
    }
}
