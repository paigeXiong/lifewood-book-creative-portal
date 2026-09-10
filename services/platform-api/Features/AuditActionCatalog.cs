using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal sealed record AuditActionMatch(string ActionId, string TargetType, string? TargetId);

internal static class AuditActionCatalog
{
    public const string TargetIdItemKey = "audit.target_id";
    private sealed record Definition(string Id, string LabelZhCn, string LabelEnUs);

    private static readonly Definition[] Definitions =
    [
        new("backup.preflight", "校验恢复备份", "Checked restore backup"),
        new("backup.restore", "恢复平台备份", "Requested platform restore"),
        new("backup.verify", "请求备份校验", "Requested backup verification"),
        new("backup.verified", "备份校验通过", "Backup verification passed"),
        new("backup.verification_failed", "备份校验未通过", "Backup verification did not pass"),
        new("backup.create", "创建备份", "Requested backup"),
        new("backup.completed", "备份完成", "Completed backup"),
        new("backup.download", "下载备份", "Downloaded backup"),
        new("backup.delete", "删除备份", "Deleted backup"),
        new("backup.pruned", "清理过期自动备份", "Pruned scheduled backup"),
        new("backup.policy", "修改备份策略", "Changed backup policy"),
        new("notification.config", "修改通知配置", "Changed notification configuration"),
        new("notification.retry", "重试通知", "Retried notification delivery"),
        new("announcement.delete", "删除公告草稿", "Deleted announcement draft"),
        new("announcement.save", "保存公告草稿", "Saved announcement draft"),
        new("announcement.publish", "发布公告", "Published announcement"),
        new("announcement.withdraw", "下架公告", "Withdrew announcement"),
        new("user.close", "永久注销账号", "Permanently closed account"),
        new("user.create", "创建用户", "Created user"),
        new("user.update", "更新用户", "Updated user"),
        new("user.password_reset", "重置用户密码", "Reset user password"),
        new("organization.create", "创建组织", "Created organization"),
        new("organization.update", "更新组织", "Updated organization"),
        new("project.followup_update", "更新项目跟进期限", "Updated project follow-up deadline"),
        new("project.export", "导出项目资料包", "Exported project brief"),
        new("project.workflow_update", "更新项目跟进", "Updated project workflow"),
        new("project.note_add", "添加内部备注", "Added internal note"),
        new("delivery.publish", "发布最终成品", "Published final delivery"),
        new("delivery.revoke", "撤回最终成品", "Withdrew final delivery"),
        new("file_category.remove", "删除文件类别", "Deleted file category"),
        new("preset.remove", "删除预设角色", "Deleted character preset"),
        new("voice.remove", "删除参考音色", "Deleted voice reference"),
        new("file_category.upsert", "保存文件类别", "Saved file category"),
        new("form_option.remove", "移除表单选项", "Removed form option"),
        new("form_option.upsert", "保存表单选项", "Saved form option"),
        new("preset.upsert", "保存预设角色", "Saved character preset"),
        new("preset.image_upload", "上传预设角色图片", "Uploaded character preset image"),
        new("voice.upsert", "保存参考音色", "Saved voice reference"),
        new("voice.sample_upload", "上传音色样本", "Uploaded voice sample"),
        new("voice.sample_remove", "移除音色样本", "Removed voice sample"),
        new("ai.settings_update", "更新 AI 接入", "Updated AI integration"),
        new("runtime.settings_update", "更新运行设置", "Updated runtime settings"),
        new("runtime.restart", "重启平台", "Restarted platform"),
        new("runtime.shutdown", "关闭平台", "Shut down platform")
    ];

    public static ConfigOptionDto[] ForLocale(string locale) =>
        [.. Definitions.Select(item => new ConfigOptionDto(item.Id, locale == "en-US" ? item.LabelEnUs : item.LabelZhCn))];

    public static AuditActionMatch? Resolve(string method, PathString path)
    {
        var segments = path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (segments is null || segments.Length < 3 || segments[0] != "api" || segments[1] != "admin") return null;
        string? Value(int index) => segments.Length > index ? Uri.UnescapeDataString(segments[index]) : null;

        if (segments.Length >= 4 && segments[2] == "notifications" && method == "PUT") return new("notification.config", "notification", Value(3));
        if (segments.Length >= 5 && segments[2] == "notifications" && method == "POST") return new("notification.retry", "notification", Value(4));
        if (method == "DELETE" && segments.Length == 4 && segments[2] == "announcements") return new("announcement.delete", "announcement", Value(3));
        if (method == "PUT" && segments.Length == 4 && segments[2] == "announcements") return new("announcement.save", "announcement", Value(3));
        if (method == "POST" && segments.Length == 5 && segments[2] == "announcements" && (segments[4] is "publish" or "withdraw")) return new("announcement." + segments[4], "announcement", Value(3));
        if (method == "DELETE" && segments.Length == 5 && segments[2] == "file-categories") return new("file_category.remove", "file_category", $"{Value(3)}/{Value(4)}");
        if (method == "DELETE" && segments.Length == 4 && segments[2] == "character-presets") return new("preset.remove", "character_preset", Value(3));
        if (method == "DELETE" && segments.Length == 4 && segments[2] == "voices") return new("voice.remove", "voice", Value(3));
        if (method == "PUT" && segments.Length == 4 && segments[2] == "character-presets") return new("preset.upsert", "character_preset", Value(3));
        if (method == "POST" && segments.Length == 5 && segments[2] == "character-presets" && segments[4] == "image") return new("preset.image_upload", "character_preset", Value(3));
        if (method == "DELETE" && segments.Length == 4 && segments[2] == "users") return new("user.close", "user", Value(3));
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
        if (method == "PUT" && segments.Length == 5 && segments[2] == "projects" && segments[4] == "followup")
            return new("project.followup_update", "project", Value(3));
        if (method == "POST" && segments.Length == 5 && segments[2] == "projects" && segments[4] == "export")
            return new("project.export", "project", Value(3));
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
        if (method == "DELETE" && segments.Length == 5 && segments[2] == "form-options") return new("form_option.remove", "form_option", $"{Value(3)}/{Value(4)}");
        if (method == "PUT" && segments.Length == 5 && segments[2] == "form-options")
            return new("form_option.upsert", "form_option", $"{Value(3)}/{Value(4)}");
        if (method == "PUT" && segments.Length == 4 && segments[2] == "voices")
            return new("voice.upsert", "voice", Value(3));
        if (segments.Length == 5 && segments[2] == "voices" && segments[4] == "sample")
        {
            if (method == "POST") return new("voice.sample_upload", "voice", Value(3));
            if (method == "DELETE") return new("voice.sample_remove", "voice", Value(3));
        }
        if (method == "PUT" && segments is ["api", "admin", "ai-settings"])
            return new("ai.settings_update", "ai_settings", "book-recognition");
        if ((method == "POST" || method == "PUT" || method == "DELETE") && segments.Length >= 4 && segments[2] == "ai-settings")
            return new("ai.settings_update", "ai_settings", "book-recognition");
        if (method == "PUT" && segments is ["api", "admin", "runtime-settings"])
            return new("runtime.settings_update", "runtime_settings", "network");
        if (method == "POST" && segments is ["api", "admin", "runtime-actions", "restart"])
            return new("runtime.restart", "runtime", "platform");
        if (method == "POST" && segments is ["api", "admin", "runtime-actions", "shutdown"])
            return new("runtime.shutdown", "runtime", "platform");
        return null;
    }
}
