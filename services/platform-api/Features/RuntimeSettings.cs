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

    public RuntimeSettingsStore(string dataDirectory, string? configuredUrl)
    {
        path = Path.Combine(dataDirectory, "runtime-settings.json");
        var fallback = FromUrl(configuredUrl);
        desired = Read(path) ?? fallback;
        if (!TryNormalize(desired.ListenAddress, desired.Port, out var normalized, out _)) desired = fallback;
        else desired = normalized;
        Active = desired;
    }

    public RuntimeSettingsDocument Active { get; }
    public string ActiveUrl => ToUrl(Active);

    public RuntimeSettingsDto Get(bool canRestart, bool canShutdown)
    {
        lock (gate)
        {
            return new(
                desired.ListenAddress,
                desired.Port,
                Active.ListenAddress,
                Active.Port,
                desired != Active,
                canRestart,
                canShutdown);
        }
    }

    public bool Save(string? listenAddress, int port, out string? field)
    {
        if (!TryNormalize(listenAddress, port, out var normalized, out field)) return false;
        lock (gate)
        {
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
            return new(NormalizeHost(uri.Host), uri.Port);
        return new("127.0.0.1", 5000);
    }

    private static bool TryNormalize(string? listenAddress, int port, out RuntimeSettingsDocument normalized, out string? field)
    {
        normalized = new("127.0.0.1", 5000);
        field = null;
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
        normalized = new(address.ToLowerInvariant(), port);
        return true;
    }

    private static string NormalizeHost(string host) => host.Trim().TrimStart('[').TrimEnd(']');

    private static string ToUrl(RuntimeSettingsDocument settings)
    {
        var host = settings.ListenAddress.Contains(':', StringComparison.Ordinal)
            ? $"[{settings.ListenAddress}]"
            : settings.ListenAddress;
        return $"http://{host}:{settings.Port.ToString(CultureInfo.InvariantCulture)}";
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
