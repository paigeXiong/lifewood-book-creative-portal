using System.Net;
using System.Text.Json;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

internal sealed record MailBody(string Text, string? Html = null)
{
    private const string Prefix = "BCP-MAIL/1\n";
    public string Encode() => Prefix + JsonSerializer.Serialize(this, AppJsonContext.Default.MailBody);
    public static MailBody Decode(string value) => value.StartsWith(Prefix, StringComparison.Ordinal)
        ? JsonSerializer.Deserialize(value[Prefix.Length..], AppJsonContext.Default.MailBody) ?? throw new JsonException()
        : new(value);
}
internal sealed record MailTemplate(string Kind, string Subject, MailBody Body, string Introduction = "", bool Enabled = true, string Revision = "default");

internal static class MailTemplates
{
    public static MailTemplate[] Preview(string locale) => new[] { "verify", "reset", "notice", "security" }
        .Select(kind => Render(kind, locale, kind == "security" ? null : $"https://portal.example.test/{locale}/" +
            (kind == "notice" ? "notifications" : $"email-action#purpose={kind}&token=preview-only"), preview: true)).ToArray();

    public static MailTemplate Render(string kind, string locale, string? actionUrl = null, bool preview = false, string? customSubject = null, string? customIntroduction = null)
    {
        var en = locale == "en-US";
        var (subject, introduction, action, note) = kind switch {
            "verify" => en ? ("Verify your email", "Confirm your email address to keep your account connected.", "Verify email", "This link expires in 10 minutes and can be used once. If you did not request it, ignore this email.")
                : ("验证邮箱", "确认你的邮箱，完成账号邮箱验证。", "验证邮箱", "链接在 10 分钟后失效，仅可使用一次。如非本人操作，请忽略此邮件。"),
            "reset" => en ? ("Reset your password", "Use the button below to set a new password for your account.", "Reset password", "This link expires in 10 minutes and can be used once. If you did not request it, ignore this email.")
                : ("重置密码", "点击下方按钮，为你的账号设置新密码。", "重置密码", "链接在 10 分钟后失效，仅可使用一次。如非本人操作，请忽略此邮件。"),
            "notice" => en ? ("New platform notifications", "There are new notifications in Book Creative Portal. Sign in to view them.", "View notifications", "You can change email notification preferences in your profile.")
                : ("平台有新通知", "Book Creative Portal 有新通知，请登录查看。", "查看通知", "你可以在个人设置中调整邮件通知偏好。"),
            "security" => en ? ("Password changed", "Your Book Creative Portal password was reset. Existing sessions were revoked.", "", "Contact your platform owner immediately if this was not you.")
                : ("密码已修改", "你的 Book Creative Portal 密码已重置，原登录会话已失效。", "", "如非本人操作，请立即联系平台负责人。"),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        subject = customSubject ?? subject;
        introduction = customIntroduction ?? introduction;
        if (action.Length > 0 && (!Uri.TryCreate(actionUrl, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 ||
            !(uri.Scheme == "https" || uri.Scheme == "http" && uri.IsLoopback))) throw new ArgumentException("Invalid mail action URL.", nameof(actionUrl));
        static string E(string value) => WebUtility.HtmlEncode(value);
        var button = action.Length == 0 ? "" : $"<p style=\"margin:28px 0\"><a{(preview ? "" : $" href=\"{E(actionUrl!)}\"")} style=\"display:inline-block;background:#204e3e;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600\">{E(action)}</a></p>";
        var fallback = action.Length == 0 ? "" : $"<p style=\"font-size:12px;color:#52635c;word-break:break-all\">{E(en ? "If the button does not work, copy this link into your browser:" : "如果按钮无法打开，请复制以下链接到浏览器：")}<br>{E(actionUrl!)}</p>";
        var html = $"""
        <!doctype html><html lang="{(en ? "en" : "zh-CN")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
        <body style="margin:0;background:#f4f3ee;color:#173b2e;font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 16px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px"><tr><td style="padding:0 8px 20px;font-size:14px;font-weight:700;letter-spacing:.3px">Book Creative Portal</td></tr>
        <tr><td style="background:#ffffff;border-top:4px solid #204e3e;border-radius:10px;padding:32px">
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.4">{E(subject)}</h1>
        <p style="margin:0;font-size:16px">{E(introduction)}</p>{button}
        <p style="padding:16px;background:#eef4f0;border-radius:6px;font-size:14px">{E(note)}</p>{fallback}
        </td></tr><tr><td style="padding:20px 8px;font-size:12px;color:#52635c">{E(en ? "This is an automated email from Book Creative Portal." : "这是一封由 Book Creative Portal 自动发送的邮件。")}</td></tr></table>
        </td></tr></table></body></html>
        """;
        var text = $"Book Creative Portal\n\n{subject}\n\n{introduction}\n\n" + (action.Length == 0 ? "" : $"{action}:\n{actionUrl}\n\n") + note;
        return new(kind, subject, new(text, html), introduction);
    }
}
