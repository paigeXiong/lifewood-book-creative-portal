using System.Net.Mail;
using System.Net.Sockets;
using System.Security.Authentication;
using Lifewood.PlatformApi.Features;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class MailFailureClassifierTests
{
    public static IEnumerable<object[]> Failures() {
        yield return [new SmtpException((SmtpStatusCode)535, "private-password@example.test"), "testAuthentication"];
        yield return [new SmtpException(SmtpStatusCode.MustIssueStartTlsFirst), "testSecurity"];
        yield return [new SmtpException(SmtpStatusCode.ServiceNotAvailable), "testUnavailable"];
        yield return [new SmtpFailedRecipientException(SmtpStatusCode.MailboxUnavailable, "private@example.test"), "testRecipient"];
        yield return [new SmtpException("redacted", new AuthenticationException("private certificate details")), "testTls"];
        yield return [new SmtpException("redacted", new SocketException((int)SocketError.HostNotFound)), "testConnection"];
        yield return [new SmtpException("redacted", new SocketException((int)SocketError.ConnectionRefused)), "testConnection"];
        yield return [new SmtpException("redacted", new SocketException((int)SocketError.TimedOut)), "testTimeout"];
        yield return [new TimeoutException("private"), "testTimeout"];
        yield return [new OperationCanceledException("private"), "testTimeout"];
        yield return [new SmtpException("535 invalid password: untrusted text"), "testFailed"];
        yield return [new IOException("private details"), "testFailed"];
    }
    [Theory, MemberData(nameof(Failures))]
    public void OnlyReturnsStableCategoriesFromTypedFailures(Exception exception, string expected) => Assert.Equal(expected, MailFailureClassifier.Classify(exception));
}
