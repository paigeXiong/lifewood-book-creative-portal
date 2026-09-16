using System.Net;
using System.Net.Mail;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;

namespace Lifewood.PlatformApi.Features;

internal sealed class MailSettings(IConfiguration configuration)
{
    public string Host { get; } = configuration["Lifewood:Mail:Host"] ?? "";
    public int Port { get; } = ParsePort(configuration["Lifewood:Mail:Port"]);
    public string From { get; } = configuration["Lifewood:Mail:From"] ?? "";
    public string Username { get; } = configuration["Lifewood:Mail:Username"] ?? "";
    public string Password { get; } = configuration["Lifewood:Mail:Password"] ?? "";
    public string PublicUrl { get; } = (configuration["Lifewood:Mail:PublicUrl"] ?? "").TrimEnd('/');
    private bool Enabled { get; } = bool.TryParse(configuration["Lifewood:Mail:Enabled"], out var enabled) && enabled;
    private static int ParsePort(string? value) => string.IsNullOrWhiteSpace(value) ? 587 : int.TryParse(value, out var port) ? port : 0;
    // Only stable check codes and outcomes may leave the owner-only status endpoint.
    public IReadOnlyList<MailConfigurationCheck> ConfigurationChecks => [
        new("enabled", Enabled),
        new("host", !string.IsNullOrWhiteSpace(Host) && Host == Host.Trim() && Uri.CheckHostName(Host) != UriHostNameType.Unknown),
        new("port", Port is > 0 and <= 65535 && Port != 465),
        new("sender", MailAddress.TryCreate(From, out var from) && from.Address == From),
        new("portal", Uri.TryCreate(PublicUrl, UriKind.Absolute, out var url) && url.UserInfo.Length == 0 && url.Query.Length == 0 && url.Fragment.Length == 0 && url.AbsolutePath == "/"
            && (url.Scheme == "https" || url.Scheme == "http" && url.IsLoopback)),
        new("credentials", (Username.Length == 0 && Password.Length == 0) || (!string.IsNullOrWhiteSpace(Username) && Password.Length > 0))
    ];
    public bool Ready => ConfigurationChecks.All(check => check.Passed);
}
internal interface IPlatformMailer { Task Send(string address, string subject, string body, CancellationToken cancellation); }
internal sealed class SmtpPlatformMailer(MailSettings settings) : IPlatformMailer
{
    public async Task Send(string address, string subject, string body, CancellationToken cancellation)
    {
        if (!settings.Ready) throw new InvalidOperationException("Mail is not configured.");
        using var message = new MailMessage(settings.From, address, subject, body) { IsBodyHtml = false };
        using var smtp = new SmtpClient(settings.Host, settings.Port) { EnableSsl = true, UseDefaultCredentials = false };
        if (settings.Username.Length > 0) smtp.Credentials = new NetworkCredential(settings.Username, settings.Password);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await smtp.SendMailAsync(message, timeout.Token);
    }
}
internal sealed class EmailWorker(EmailRepository emails, MailSettings settings, IPlatformMailer mailer, BackupGate gate, ILogger<EmailWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextDigest = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var lease = gate.TryEnter();
                if (lease is not null)
                {
                    if (settings.Ready && DateTimeOffset.UtcNow >= nextDigest) {
                        emails.QueueNotifications();
                        nextDigest = DateTimeOffset.UtcNow.AddMinutes(1);
                    }
                    // Retention still runs while sending is disabled; it shares the backup gate.
                    await emails.DeliverOne(mailer, stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch { logger.LogWarning("Email processing failed; pending deliveries will retry. No message content is logged."); }
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
