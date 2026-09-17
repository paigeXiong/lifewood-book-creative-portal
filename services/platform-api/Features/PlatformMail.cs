using System.Net;
using System.Net.Mail;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;

namespace Lifewood.PlatformApi.Features;

internal sealed record MailConfiguration(bool Enabled, string Host, int Port, string From, string Username, string Password, string PublicUrl)
{
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
internal sealed class MailSettings
{
    private MailConfiguration current;
    public MailSettings(IConfiguration configuration)
    {
        var port = configuration["Lifewood:Mail:Port"];
        current = new(bool.TryParse(configuration["Lifewood:Mail:Enabled"], out var enabled) && enabled,
            configuration["Lifewood:Mail:Host"] ?? "", string.IsNullOrWhiteSpace(port) ? 587 : int.TryParse(port, out var parsed) ? parsed : 0,
            configuration["Lifewood:Mail:From"] ?? "", configuration["Lifewood:Mail:Username"] ?? "",
            configuration["Lifewood:Mail:Password"] ?? "", (configuration["Lifewood:Mail:PublicUrl"] ?? "").TrimEnd('/'));
    }
    public MailConfiguration Current => Volatile.Read(ref current);
    public void Apply(MailConfiguration value) => Volatile.Write(ref current, value);
    public string Host => Current.Host;
    public int Port => Current.Port;
    public string From => Current.From;
    public string Username => Current.Username;
    public string Password => Current.Password;
    public string PublicUrl => Current.PublicUrl;
    public bool Ready => Current.Ready;
    public IReadOnlyList<MailConfigurationCheck> ConfigurationChecks => Current.ConfigurationChecks;
}
internal interface IPlatformMailer {
    Task Send(string address, string subject, string body, CancellationToken cancellation);
    Task SendContent(string address, string subject, MailBody body, CancellationToken cancellation) => Send(address, subject, body.Text, cancellation);
}
internal sealed class SmtpPlatformMailer(MailSettings settings) : IPlatformMailer
{
    public Task Send(string address, string subject, string body, CancellationToken cancellation) => SendContent(address, subject, new(body), cancellation);
    internal static MailMessage CreateMessage(string from, string address, string subject, MailBody body)
    {
        var message = new MailMessage(from, address, subject, body.Text) { IsBodyHtml = false, BodyEncoding = System.Text.Encoding.UTF8, SubjectEncoding = System.Text.Encoding.UTF8 };
        if (body.Html is not null) message.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(body.Html, System.Text.Encoding.UTF8, "text/html"));
        return message;
    }
    public async Task SendContent(string address, string subject, MailBody body, CancellationToken cancellation)
    {
        var configuration = settings.Current;
        if (!configuration.Ready) throw new InvalidOperationException("Mail is not configured.");
        using var message = CreateMessage(configuration.From, address, subject, body);
        using var smtp = new SmtpClient(configuration.Host, configuration.Port) { EnableSsl = true, UseDefaultCredentials = false };
        if (configuration.Username.Length > 0) smtp.Credentials = new NetworkCredential(configuration.Username, configuration.Password);
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
