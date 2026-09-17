namespace Lifewood.PlatformApi.Features;

internal static class MailServiceLabels
{
    public static Dictionary<string, string> For(string? locale) => locale == "en-US" ? new() {
        ["configure"] = "Configure email", ["title"] = "Email service", ["enabled"] = "Enable email service",
        ["host"] = "SMTP server", ["port"] = "Port (STARTTLS)", ["from"] = "Sender email", ["username"] = "SMTP username",
        ["password"] = "Authorization code / password", ["passwordSaved"] = "Saved; leave blank to keep", ["clearPassword"] = "Clear saved credential",
        ["publicUrl"] = "Customer portal domain", ["save"] = "Save", ["cancel"] = "Cancel", ["test"] = "Send test email",
        ["testTitle"] = "Send a test email?", ["testBody"] = "One test email will be sent to the configured sender mailbox:",
        ["testAccepted"] = "The mail server accepted the test email. Check the sender mailbox, including spam.",
        ["saved"] = "Email settings saved and applied.", ["help"] = "Settings take effect immediately. Enabling resumes eligible queued messages and subscribed notifications. Disabling stops new sends; messages already being sent cannot be recalled. Saved settings override environment variables.",
        ["smtpHelp"] = "Use a STARTTLS SMTP endpoint, usually port 587. Implicit TLS on port 465 and OAuth-only authentication are not supported. QQ Mail uses smtp.qq.com and an authorization code.",
        ["passwordHelp"] = "Credentials are encrypted on the server and never returned. Leave blank to keep the saved value. When changing the SMTP server, port or username, re-enter or explicitly clear the credential.",
        ["domainHelp"] = "Include https://, without a page path. Email links use this domain. Local testing permits http://127.0.0.1:5173; configure the public domain before deployment.",
        ["testHelp"] = "Tests use saved settings and send to the sender mailbox only, at most once per minute. Server acceptance does not guarantee inbox delivery. Test messages are not included in the notification queue.",
        ["reload"] = "Reload saved settings"
    } : new() {
        ["configure"] = "配置邮件服务", ["title"] = "邮件服务", ["enabled"] = "启用邮件服务",
        ["host"] = "SMTP 服务器", ["port"] = "端口（STARTTLS）", ["from"] = "发件邮箱", ["username"] = "SMTP 用户名",
        ["password"] = "授权码 / 密码", ["passwordSaved"] = "已保存，留空保留", ["clearPassword"] = "清除已保存的授权码",
        ["publicUrl"] = "客户门户域名", ["save"] = "保存", ["cancel"] = "取消", ["test"] = "发送测试邮件",
        ["testTitle"] = "发送测试邮件？", ["testBody"] = "将向当前配置的发件邮箱发送一封测试邮件：",
        ["testAccepted"] = "邮件服务器已接受测试邮件，请查看发件邮箱的收件箱或垃圾邮件。",
        ["saved"] = "邮件配置已保存并立即生效。", ["help"] = "保存后立即生效。启用会恢复符合条件的待发邮件和已订阅通知；停用后停止新发送，已经开始发送的邮件无法撤回。后台保存的配置优先于环境变量。",
        ["smtpHelp"] = "使用 STARTTLS SMTP 服务，通常为 587 端口。暂不支持 465 隐式 TLS 或仅支持 OAuth 的服务。QQ 邮箱使用 smtp.qq.com 和邮箱授权码。",
        ["passwordHelp"] = "授权码在服务器加密保存且不回显，留空保留原值。更换 SMTP 服务器、端口或用户名时，需重新填写或明确清除授权码。",
        ["domainHelp"] = "需包含 https://，不带页面路径。验证和找回密码邮件将使用该域名。本机测试可用 http://127.0.0.1:5173，正式部署前需改成公开域名。",
        ["testHelp"] = "使用已保存的配置，仅向发件邮箱发送测试邮件，每分钟最多一次。服务器接受不代表进入收件箱；测试邮件不计入下方通知队列。",
        ["reload"] = "重新读取已保存配置"
    };
}
