using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class MailTemplateTests
{
    [Theory]
    [InlineData("en-US")]
    [InlineData("zh-CN")]
    public void PreviewContainsAllTemplatesWithInertSampleActions(string locale)
    {
        var templates = MailTemplates.Preview(locale);
        Assert.Equal(new[] { "verify", "reset", "notice", "security" }, templates.Select(t => t.Kind));
        foreach (var template in templates) {
            Assert.Contains("Book Creative Portal", template.Body.Text);
            Assert.DoesNotContain("href=", template.Body.Html);
            Assert.DoesNotContain("<script", template.Body.Html);
            Assert.DoesNotContain("<img", template.Body.Html);
            Assert.DoesNotContain("token=" + new string('A', 64), template.Body.Text);
            Assert.Equal(template.Body, MailBody.Decode(template.Body.Encode()));
        }
        Assert.Contains(locale == "en-US" ? "10 minutes" : "10 分钟", templates[0].Body.Text);
        Assert.Contains("preview-only", templates[1].Body.Text);
        Assert.Contains(locale == "en-US" ? "sessions were revoked" : "会话已失效", templates[3].Body.Text);
    }
    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://user:password@example.test/path")]
    [InlineData("http://public.example.test")]
    [InlineData("/relative")]
    public void ActionsRejectUnsafeUrls(string url) => Assert.Throws<ArgumentException>(() => MailTemplates.Render("verify", "en-US", url));

    [Fact] public void ActionsAreEncodedButPlainTextLinkIsUnchanged()
    {
        const string url = "https://portal.example.test/email-action#token=abc&value=\"<img>";
        var template = MailTemplates.Render("verify", "en-US", url);
        Assert.Contains(url, template.Body.Text);
        Assert.DoesNotContain("<img>", template.Body.Html);
        Assert.Contains("&quot;&lt;img&gt;", template.Body.Html);
        Assert.Contains("href=", template.Body.Html);
    }
    [Fact] public void SmtpMessagePreservesPlainTextWithOptionalHtml()
    {
        var body = MailTemplates.Render("security", "zh-CN").Body;
        using var message = SmtpPlatformMailer.CreateMessage("sender@example.test", "recipient@example.test", "安全提醒", body);
        Assert.False(message.IsBodyHtml); Assert.Equal(body.Text, message.Body);
        Assert.Equal("text/html", Assert.Single(message.AlternateViews).ContentType.MediaType);
        Assert.Equal("utf-8", message.SubjectEncoding!.WebName);
        const string legacy = "Book Creative Portal\nhttps://portal.example.test/#token=original";
        using var old = SmtpPlatformMailer.CreateMessage("sender@example.test", "recipient@example.test", "Legacy", MailBody.Decode(legacy));
        Assert.Equal(legacy, old.Body); Assert.Empty(old.AlternateViews);
    }
    [Theory]
    [InlineData("zh-CN")]
    [InlineData("en-US")]
    public async Task SerializedMailContainsBothMimeAlternativesWithoutNetworkAccess(string locale)
    {
        var folder = Path.Combine(Path.GetTempPath(), "portal-mail-mime-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        try {
            var template = MailTemplates.Preview(locale)[0];
            using var message = SmtpPlatformMailer.CreateMessage("sender@example.test", "recipient@example.test", template.Subject, template.Body);
            using var smtp = new System.Net.Mail.SmtpClient { DeliveryMethod = System.Net.Mail.SmtpDeliveryMethod.SpecifiedPickupDirectory, PickupDirectoryLocation = folder };
            await smtp.SendMailAsync(message);
            var mime = await File.ReadAllTextAsync(Assert.Single(Directory.GetFiles(folder, "*.eml")));
            Assert.Contains("multipart/alternative", mime);
            Assert.Contains("text/plain; charset=utf-8", mime);
            Assert.Contains("text/html; charset=utf-8", mime);
        } finally { Directory.Delete(folder, recursive: true); }
    }
}
