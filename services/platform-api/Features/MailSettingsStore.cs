using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

public sealed record MailSettingsDocument(string Revision, bool Enabled, string Host, int Port, string From, string Username, string ProtectedPassword, string PublicUrl, int PerMinute = 10, int PerDay = 200);
public sealed record SaveMailSettings(string Revision, bool Enabled, string Host, int Port, string From, string Username, string? Password, bool ClearPassword, string PublicUrl, int PerMinute = 10, int PerDay = 200);
public sealed record MailServiceDto(string Revision, bool Enabled, string Host, int Port, string From, string Username, bool HasPassword, string PublicUrl, bool Available, Dictionary<string, string> Labels, int PerMinute = 10, int PerDay = 200);
public sealed record MailTestRequest(string Revision);

internal sealed class MailSettingsStore
{
    private readonly object gate = new();
    private readonly string path;
    private readonly IDataProtector protector;
    private readonly MailSettings settings;
    public MailSettings Settings => settings;
    public MailRateLimiter Limiter {get;}
    private string revision = Guid.NewGuid().ToString("N");
    private DateTimeOffset nextTest;
    public SemaphoreSlim Operations { get; } = new(1, 1);
    public MailSettingsStore(string directory, MailSettings settings, IDataProtectionProvider protection)
    {
        this.settings = settings;
        Limiter = new(directory);
        path = Path.Combine(directory, "mail-settings.json");
        protector = protection.CreateProtector("BookCreativePortal.SmtpPassword.v1");
        if (File.Exists(path)) {
            var saved = JsonSerializer.Deserialize(File.ReadAllText(path), AppJsonContext.Default.MailSettingsDocument)
                ?? throw new InvalidDataException("Invalid mail settings document.");
            settings.Apply(new(saved.Enabled, saved.Host, saved.Port, saved.From, saved.Username,
                saved.ProtectedPassword.Length == 0 ? "" : protector.Unprotect(saved.ProtectedPassword), saved.PublicUrl, Math.Clamp(saved.PerMinute,1,1000), Math.Clamp(saved.PerDay,1,100000)));
            revision = saved.Revision;
        }
    }
    public AuditSnapshot AuditSnapshot() {
        var value=settings.Current;
        return new("邮件服务","Email service","settings/mail",new() {
            ["enabled"]=value.Enabled?"true":"false",
            ["perMinute"]=value.PerMinute.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["perDay"]=value.PerDay.ToString(System.Globalization.CultureInfo.InvariantCulture)
        });
    }
    public MailServiceDto Read(string? locale)
    {
        lock (gate) {
            var value = settings.Current;
            return new(revision, value.Enabled, value.Host, value.Port, value.From, value.Username, value.Password.Length > 0, value.PublicUrl, value.Ready, MailServiceLabels.For(locale),value.PerMinute,value.PerDay);
        }
    }
    public string? Save(SaveMailSettings input)
    {
        lock (gate) {
            if (input.Revision != revision) return "conflict";
            if(input.PerMinute is < 1 or > 1000 || input.PerDay is < 1 or > 100000)return "invalid";
            if (input.Host is null || input.From is null || input.Username is null || input.PublicUrl is null
                || input.Host.Length > 253 || input.From.Length > 254 || input.Username.Length > 254 || input.PublicUrl.Length > 2048 || input.Password?.Length > 4096
                || input.ClearPassword && !string.IsNullOrEmpty(input.Password)) return "invalid";
            var previous = settings.Current;
            var password = input.ClearPassword ? "" : string.IsNullOrEmpty(input.Password) ? previous.Password : input.Password;
            // Never silently forward an existing credential to another SMTP destination/account.
            if (password.Length > 0 && string.IsNullOrEmpty(input.Password) && !input.ClearPassword
                && (!string.Equals(input.Host.Trim(), previous.Host, StringComparison.OrdinalIgnoreCase) || input.Port != previous.Port || input.Username.Trim() != previous.Username)) return "credentialsChanged";
            var value = new MailConfiguration(input.Enabled, input.Host.Trim(), input.Port, input.From.Trim(), input.Username.Trim(), password, input.PublicUrl.Trim().TrimEnd('/'),input.PerMinute,input.PerDay);
            if (value.Enabled && !value.Ready) return "invalid";
            var nextRevision = Guid.NewGuid().ToString("N");
            var document = new MailSettingsDocument(nextRevision, value.Enabled, value.Host, value.Port, value.From, value.Username,
                password.Length == 0 ? "" : protector.Protect(password), value.PublicUrl,value.PerMinute,value.PerDay);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllText(temporary, JsonSerializer.Serialize(document, AppJsonContext.Default.MailSettingsDocument));
                File.Move(temporary, path, true);
            } finally { if (File.Exists(temporary)) File.Delete(temporary); }
            settings.Apply(value);
            revision = nextRevision;
            return null;
        }
    }
    public string? BeginTest(string expectedRevision, out string recipient)
    {
        lock (gate) {
            recipient = "";
            if (expectedRevision != revision) return "conflict";
            if (!settings.Ready) return "unavailable";
            if (DateTimeOffset.UtcNow < nextTest) return "cooldown";
            nextTest = DateTimeOffset.UtcNow.AddMinutes(1);
            recipient = settings.From;
            return null;
        }
    }
}
