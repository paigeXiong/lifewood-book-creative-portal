using System.Net.Mail;
using System.Net.Sockets;
using System.Security.Authentication;

namespace Lifewood.PlatformApi.Features;

internal static class MailFailureClassifier
{
    // Only stable categories leave the server. Never parse or expose SMTP text,
    // which may contain credentials, addresses or provider-specific details.
    public static string Classify(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException) {
            if (current is SmtpFailedRecipientException) return "testRecipient";
            if (current is AuthenticationException) return "testTls";
            if (current is TimeoutException or OperationCanceledException) return "testTimeout";
            if (current is SocketException socket) return socket.SocketErrorCode == SocketError.TimedOut ? "testTimeout" : "testConnection";
            if (current is SmtpException smtp) {
                if ((int)smtp.StatusCode == 535) return "testAuthentication";
                if (smtp.StatusCode == SmtpStatusCode.MustIssueStartTlsFirst) return "testSecurity";
                if (smtp.StatusCode == SmtpStatusCode.ServiceNotAvailable) return "testUnavailable";
            }
        }
        return "testFailed";
    }
}
