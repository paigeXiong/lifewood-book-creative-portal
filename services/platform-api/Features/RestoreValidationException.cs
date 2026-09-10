namespace Lifewood.PlatformApi.Features;

// Stable, localized failure categories. Never send exception text, server paths or SQL to the browser.
internal sealed class RestoreValidationException(string code) : IOException("Restore validation failed: "+code)
{
    internal string Code { get; } = code;
}
