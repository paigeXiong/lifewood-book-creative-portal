using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

internal sealed class RuntimeSettingsStore
{
    private readonly object gate = new();
    private readonly string path;
    private RuntimeSettingsDocument desired;

    public RuntimeSettingsStore(string dataDirectory, string? configuredUrl, string? customerUrl = null, string? adminUrl = null)
    {
        path = Path.Combine(dataDirectory, "runtime-settings.json");
        var fallback = FromUrl(configuredUrl);
        desired = Read(path) ?? fallback;
        var persistedScheme = string.IsNullOrWhiteSpace(desired.Scheme) ? "http" : desired.Scheme;
        if (!TryNormalize(persistedScheme, desired.ListenAddress, desired.Port, out var normalized, out _)) desired = fallback;
        else desired = normalized with { Customer = desired.Customer, Admin = desired.Admin };
        ExternalFrontends = customerUrl is not null && adminUrl is not null;
        var customer = FromUrl(customerUrl);
        var admin = FromUrl(adminUrl);
        if (!TryWeb(ExternalFrontends && desired.Customer?.Shared == true ? null : desired.Customer, ExternalFrontends ? new(customer.ListenAddress, customer.Port, customer.Scheme) : new(desired.ListenAddress, desired.Port, desired.Scheme, true), out var normalizedCustomer, out _))
            throw new InvalidOperationException("Invalid saved customer listener.");
        if (!TryWeb(ExternalFrontends && desired.Admin?.Shared == true ? null : desired.Admin, ExternalFrontends ? new(admin.ListenAddress, admin.Port, admin.Scheme) : new(desired.ListenAddress, desired.Port, desired.Scheme, true), out var normalizedAdmin, out _))
            throw new InvalidOperationException("Invalid saved admin listener.");
        desired = desired with { Customer = normalizedCustomer, Admin = normalizedAdmin };
        Active = ExternalFrontends ? desired with {
            Customer = new(customer.ListenAddress, customer.Port, customer.Scheme),
            Admin = new(admin.ListenAddress, admin.Port, admin.Scheme)
        } : desired;
    }

    public RuntimeSettingsDocument Active { get; }
    public string ActiveUrl => ToUrl(Active);
    public bool ExternalFrontends { get; }
    public string[] ActiveUrls => ExternalFrontends ? [ActiveUrl] : new[] { ActiveUrl, WebUrl(Active.Customer!), WebUrl(Active.Admin!) }.Distinct().ToArray();
    private string WebUrl(WebListenerSettings value) => value.Shared ? ActiveUrl : ToUrl(new(value.ListenAddress, value.Port, value.Scheme));
    public WebListenerSettings Effective(WebListenerSettings value) => value.Shared ? new(Active.ListenAddress, Active.Port, Active.Scheme, true) : value;
    public string PortalUrl(bool admin, string hostname, string locale, int sourcePort = 0) {
        var saved = admin ? Active.Admin! : Active.Customer!;
        if (saved.Shared && !ExternalFrontends && (sourcePort == 0 || sourcePort == Active.Port)) return (admin ? "/admin" : "") + "/" + locale + (admin ? "/projects" : "/tasks");
        var value = Effective(saved);
        var address = value.ListenAddress is "0.0.0.0" or "::" or "localhost" or "127.0.0.1" or "::1" ? NormalizeHost(hostname) : value.ListenAddress;
        return ToUrl(new(address, value.Port, value.Scheme)) + (admin && !ExternalFrontends ? "/admin" : "") + "/" + locale + (admin ? "/projects" : "/tasks");
    }

    public RuntimeSettingsDto Get(bool canRestart, bool canShutdown)
    {
        lock (gate)
        {
            return new(
                desired.Scheme,
                desired.ListenAddress,
                desired.Port,
                Active.Scheme,
                Active.ListenAddress,
                Active.Port,
                desired != Active,
                canRestart && !ExternalFrontends,
                canShutdown && !ExternalFrontends,
                desired.Customer!, desired.Admin!, Effective(Active.Customer!), Effective(Active.Admin!), ExternalFrontends);
        }
    }

    public bool Save(string? scheme, string? listenAddress, int port, out string? field) => Save(scheme, listenAddress, port, null, null, out field);

    public bool Save(string? scheme, string? listenAddress, int port, WebListenerSettings? customer, WebListenerSettings? admin, out string? field)
    {
        lock (gate)
        {
            var effectiveScheme = scheme is null ? desired.Scheme : scheme;
            if (!TryNormalize(effectiveScheme, listenAddress, port, out var normalized, out field)) return false;
            if (!TryWeb(customer, desired.Customer!, out var normalizedCustomer, out field)) { field = "customer." + field; return false; }
            if (!TryWeb(admin, desired.Admin!, out var normalizedAdmin, out field)) { field = "admin." + field; return false; }
            if (ExternalFrontends && (normalizedCustomer.Shared || normalizedAdmin.Shared)) { field = "frontends.shared"; return false; }
            var ports = new List<int> { normalized.Port };
            foreach (var (name, listener) in new[] { ("customer", normalizedCustomer), ("admin", normalizedAdmin) }) {
                if (listener.Shared) continue;
                if (ports.Contains(listener.Port)) { field = name + ".port"; return false; }
                ports.Add(listener.Port);
            }
            normalized = normalized with { Customer = normalizedCustomer, Admin = normalizedAdmin };
            var temporaryPath = path + "." + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture) + ".tmp";
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllText(temporaryPath, JsonSerializer.Serialize(normalized, AppJsonContext.Default.RuntimeSettingsDocument));
                File.Move(temporaryPath, path, true);
                desired = normalized;
                return true;
            }
            finally
            {
                try { if (File.Exists(temporaryPath)) File.Delete(temporaryPath); }
                catch { }
            }
        }
    }

    private static bool TryWeb(WebListenerSettings? value, WebListenerSettings fallback, out WebListenerSettings normalized, out string? field) {
        value ??= fallback;
        if (!TryNormalize(value.Scheme, value.ListenAddress, value.Port, out var parsed, out field)) { normalized = fallback; return false; }
        normalized = new(parsed.ListenAddress, parsed.Port, parsed.Scheme, value.Shared);
        return true;
    }

    private static RuntimeSettingsDocument? Read(string filePath)
    {
        try
        {
            return File.Exists(filePath)
                ? JsonSerializer.Deserialize(File.ReadAllText(filePath), AppJsonContext.Default.RuntimeSettingsDocument)
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static RuntimeSettingsDocument FromUrl(string? configuredUrl)
    {
        var value = configuredUrl?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            return new(NormalizeHost(uri.Host), uri.Port, uri.Scheme.ToLowerInvariant());
        return new("127.0.0.1", 5000);
    }

    private static bool TryNormalize(string? scheme, string? listenAddress, int port, out RuntimeSettingsDocument normalized, out string? field)
    {
        normalized = new("127.0.0.1", 5000);
        field = null;
        var normalizedScheme = scheme?.Trim().ToLowerInvariant() ?? "";
        if (normalizedScheme is not ("http" or "https"))
        {
            field = "scheme";
            return false;
        }
        var address = NormalizeHost(listenAddress?.Trim() ?? "");
        if (address == "*") address = "0.0.0.0";
        if (!address.Equals("localhost", StringComparison.OrdinalIgnoreCase) && !IPAddress.TryParse(address, out _))
        {
            field = "listenAddress";
            return false;
        }
        if (port is < 1 or > 65535)
        {
            field = "port";
            return false;
        }
        normalized = new(address.ToLowerInvariant(), port, normalizedScheme);
        return true;
    }

    private static string NormalizeHost(string host) => host.Trim().TrimStart('[').TrimEnd(']');

    private static string ToUrl(RuntimeSettingsDocument settings)
    {
        var host = settings.ListenAddress.Contains(':', StringComparison.Ordinal)
            ? $"[{settings.ListenAddress}]"
            : settings.ListenAddress;
        return $"{settings.Scheme}://{host}:{settings.Port.ToString(CultureInfo.InvariantCulture)}";
    }
}

internal sealed class RuntimeLifecycle(IHostApplicationLifetime lifetime, bool windowsService)
{
    private int actionRequested;

    public bool CanRestart =>
        windowsService ||
        (!string.IsNullOrWhiteSpace(Environment.ProcessPath) && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("INVOCATION_ID")));

    public bool RequestShutdown()
    {
        if (Interlocked.CompareExchange(ref actionRequested, 1, 0) != 0) return false;
        _ = StopAfterResponse();
        return true;
    }

    public bool RequestRestart()
    {
        if (!CanRestart || Interlocked.CompareExchange(ref actionRequested, 1, 0) != 0) return false;
        if (windowsService)
        {
            _ = ExitForServiceRecoveryAfterResponse();
            return true;
        }
        try
        {
            Process.Start(StandaloneRestart());
            _ = StopAfterResponse();
            return true;
        }
        catch
        {
            Interlocked.Exchange(ref actionRequested, 0);
            return false;
        }
    }

    private async Task StopAfterResponse()
    {
        await Task.Delay(500);
        lifetime.StopApplication();
    }

    private static async Task ExitForServiceRecoveryAfterResponse()
    {
        // The MSI configures service recovery to restart after a failed exit.
        // Do not report a graceful SERVICE_STOPPED state, which would suppress recovery.
        await Task.Delay(500);
        Environment.Exit(1);
    }

    private static ProcessStartInfo StandaloneRestart()
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("The current executable path is unavailable.");
        var commandLine = Environment.GetCommandLineArgs();
        var info = new ProcessStartInfo(executable) { UseShellExecute = false };
        var start = Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase) ? 0 : 1;
        for (var index = start; index < commandLine.Length; index++)
        {
            var argument = commandLine[index];
            if (argument.Equals("--Lifewood:RestoreAttempt", StringComparison.OrdinalIgnoreCase) || argument.Equals("--Lifewood:RestoreReady", StringComparison.OrdinalIgnoreCase)) { index++; continue; }
            if (argument.StartsWith("--Lifewood:RestoreAttempt=", StringComparison.OrdinalIgnoreCase) || argument.StartsWith("--Lifewood:RestoreReady=", StringComparison.OrdinalIgnoreCase)) continue;
            if (argument.Equals("--Lifewood:RestartWaitForPid", StringComparison.OrdinalIgnoreCase))
            {
                index++;
                continue;
            }
            if (argument.StartsWith("--Lifewood:RestartWaitForPid=", StringComparison.OrdinalIgnoreCase)) continue;
            info.ArgumentList.Add(argument);
        }
        info.ArgumentList.Add($"--Lifewood:RestartWaitForPid={Environment.ProcessId}");
        return info;
    }
}

internal static class RestartWaiter
{
    public static void Wait(string[] arguments)
    {
        const string prefix = "--Lifewood:RestartWaitForPid=";
        var value = arguments.FirstOrDefault(item => item.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        if (value is null || !int.TryParse(value[prefix.Length..], NumberStyles.None, CultureInfo.InvariantCulture, out var processId)) return;
        try { Process.GetProcessById(processId).WaitForExit(30_000); }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
    }
}
