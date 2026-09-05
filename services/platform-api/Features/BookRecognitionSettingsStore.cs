using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

public sealed record AiSettingsDocument(bool Enabled, string Endpoint, string Model, string ProtectedKey);
public sealed record UpdateAiSettingsRequest(bool Enabled, string Endpoint, string Model, string? ApiKey, bool ClearApiKey = false);
public sealed record AiProviderDocument(string Id, string Name, string Protocol, string Endpoint, string Model, string ProtectedKey, string[]? Models = null);
public sealed record AiBindingDocument(string FeatureId, string? ProviderId, string Model, bool Enabled);
public sealed record AiBindingDto(string FeatureId, string Label, string? ProviderId, string Model, bool Enabled);
public sealed record UpdateAiBindingRequest(string FeatureId, string? ProviderId, string Model, bool Enabled);
public sealed record AiProvidersDocument(int Version, string? ActiveProviderId, AiProviderDocument[] Providers, AiBindingDocument[]? Bindings = null);
public sealed record AiProviderDto(string Id, string Name, string Protocol, string Endpoint, string Model, bool HasApiKey, string[] Models);
public sealed record AiProtocolDto(string Id, string Label, string EndpointPlaceholder);
public sealed record UpsertAiProviderRequest(string? Id, string Name, string Protocol, string Endpoint, string Model, string? ApiKey, bool ClearApiKey = false, string[]? Models = null);
public sealed record SelectAiProviderRequest(string? ProviderId);
public sealed record AiSettingsDto(bool Enabled, string Endpoint, string Model, bool HasApiKey, Dictionary<string, string> Labels,
    string? ActiveProviderId, AiProviderDto[] Providers, AiProtocolDto[] Protocols, AiBindingDto[] Bindings);

internal sealed class BookRecognitionSettingsStore
{
    private static readonly (string Id, string Zh, string En)[] Features = [("book-recognition", "封面识别", "Cover recognition")];
    private readonly object gate = new();
    private readonly string path;
    private readonly IDataProtector protector;
    private AiProvidersDocument document;
    public BookRecognitionSettingsStore(string directory, IConfiguration config, IDataProtectionProvider protection)
    {
        path = Path.Combine(directory, "book-recognition.json");
        protector = protection.CreateProtector("BookRecognition.ApiKey.v1");
        document = new(2, null, []);
        if (File.Exists(path))
        {
            var text = File.ReadAllText(path);
            using var json = JsonDocument.Parse(text);
            if (json.RootElement.TryGetProperty("providers", out _))
            {
                document = JsonSerializer.Deserialize(text, AppJsonContext.Default.AiProvidersDocument)!;
                if (document.Version is not (2 or 3)) throw new InvalidDataException("Unsupported AI settings version.");
            }
            else
            {
                var saved = JsonSerializer.Deserialize(text, AppJsonContext.Default.AiSettingsDocument)!;
                Migrate(saved.Enabled, saved.Endpoint, saved.Model, saved.ProtectedKey);
            }
        }
        else
        {
            var initial = BookRecognitionSettings.FromConfiguration(config);
            if (initial.Endpoint is not null || initial.Model.Length > 0 || initial.ApiKey.Length > 0)
                Migrate(initial.Enabled, initial.Endpoint?.AbsoluteUri ?? "", initial.Model, initial.ApiKey.Length == 0 ? "" : protector.Protect(initial.ApiKey));
        }
        // Apply the same resolution to saved providers, not only newly entered addresses.
        document = document with { Providers = document.Providers.Select(p =>
            Uri.TryCreate(p.Endpoint, UriKind.Absolute, out var endpoint)
                ? p with { Endpoint = ResolveEndpoint(endpoint, p.Protocol).AbsoluteUri } : p).ToArray() };
    }
    internal static Uri ResolveEndpoint(Uri endpoint, string protocol)
    {
        var path = endpoint.AbsolutePath.TrimEnd('/');
        string? suffix = null;
        if (path.Length == 0)
            suffix = protocol == "anthropic" ? "/v1/messages" : endpoint.Host == "api.openai.com" ? "/v1/chat/completions" : "/chat/completions";
        else if (path.EndsWith("/v1", StringComparison.Ordinal))
            suffix = protocol == "anthropic" ? "/messages" : "/chat/completions";
        else if (protocol == "anthropic" && path.EndsWith("/anthropic", StringComparison.Ordinal))
            suffix = "/v1/messages";
        // Full endpoints and custom paths remain unchanged.
        return suffix is null ? endpoint : new UriBuilder(endpoint) { Path = path + suffix }.Uri;
    }
    private AiBindingDocument Cover => document.Bindings?.FirstOrDefault(b => b.FeatureId == "book-recognition")
        ?? new("book-recognition", document.ActiveProviderId, document.Providers.FirstOrDefault(p => p.Id == document.ActiveProviderId)?.Model ?? "", document.ActiveProviderId is not null);
    private void Migrate(bool enabled, string endpoint, string model, string protectedKey)
    {
        var name = Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) ? uri.Host : "API";
        document = new(3, enabled ? "legacy" : null, [new("legacy", name, "openai", endpoint, "", protectedKey, model.Length > 0 ? [model] : [])], [new("book-recognition", "legacy", model, enabled)]);
    }
    public BookRecognitionSettings Current
    {
        get
        {
            lock (gate)
            {
                var binding = Cover;
                var provider = binding.Enabled ? document.Providers.FirstOrDefault(p => p.Id == binding.ProviderId) : null;
                return provider is null ? new(false, null, "", "") : new(true, new Uri(provider.Endpoint), binding.Model,
                    protector.Unprotect(provider.ProtectedKey), provider.Protocol);
            }
        }
    }
    private void Persist(AiProvidersDocument next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(next, AppJsonContext.Default.AiProvidersDocument));
            File.Move(temporary, path, true);
            document = next;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private bool TryProvider(UpsertAiProviderRequest request, out AiProviderDocument? result)
    {
        result = null;
        var previous = document.Providers.FirstOrDefault(p => p.Id == request.Id);
        if (request.Id is not null && previous is null) return false;
        if (previous is null && document.Providers.Length >= 50) return false;
        var name = request.Name?.Trim() ?? "";
        var endpoint = request.Endpoint?.Trim() ?? "";
        var model = request.Model?.Trim() ?? "";
        var suppliedKey = request.ApiKey?.Trim() ?? "";
        if (name.Length is < 1 or > 100 || endpoint.Length > 2000 || model.Length > 200 || suppliedKey.Length > 4096 ||
            name.Any(char.IsControl) || model.Any(char.IsControl) || suppliedKey.Any(char.IsControl) ||
            request.Protocol is not ("openai" or "anthropic")) return false;
        Uri? uri = null;
        if (endpoint.Length > 0 && (!Uri.TryCreate(endpoint, UriKind.Absolute, out uri) || uri.Scheme != "https" ||
            uri.UserInfo.Length > 0 || uri.Fragment.Length > 0 || uri.Query.Length > 0)) return false;
        if (uri is not null) uri = ResolveEndpoint(uri, request.Protocol);
        endpoint = uri?.AbsoluteUri ?? "";
        var encrypted = request.ClearApiKey ? "" : suppliedKey.Length > 0 ? protector.Protect(suppliedKey) : previous?.ProtectedKey ?? "";
        if (previous is not null && (endpoint != previous.Endpoint || request.Protocol != previous.Protocol) && suppliedKey.Length == 0)
            encrypted = "";
        var models = (request.Models ?? (model.Length > 0 ? [model] : previous is not null ? ModelsFor(previous) : [])).Select(m => m?.Trim() ?? "").ToArray();
        if (models.Length > 100 || models.Any(m => m.Length is < 1 or > 200 || m.Any(char.IsControl)) || models.Distinct(StringComparer.Ordinal).Count() != models.Length) return false;
        result = new(previous?.Id ?? Guid.NewGuid().ToString("N"), name, request.Protocol, endpoint, model, encrypted, models);
        return true;
    }
    private static string[] ModelsFor(AiProviderDocument p) => p.Models ?? (p.Model.Length > 0 ? [p.Model] : []);
    private static bool Ready(AiProviderDocument p) => p.Endpoint.Length > 0 && p.ProtectedKey.Length > 0;
    public bool Upsert(UpsertAiProviderRequest request)
    {
        lock (gate)
        {
            if (!TryProvider(request, out var provider) || provider is null) return false;
            if ((document.Bindings ?? [Cover]).Any(b => b.Enabled && b.ProviderId == provider.Id) && !Ready(provider)) return false;
            if ((document.Bindings ?? [Cover]).Any(b => b.ProviderId == provider.Id && b.Model.Length > 0 && !ModelsFor(provider).Contains(b.Model, StringComparer.Ordinal))) return false;
            var providers = document.Providers.Where(p => p.Id != provider.Id).Append(provider).ToArray();
            Persist(document with { Version = 3, Providers = providers, Bindings = document.Bindings ?? [Cover] });
            return true;
        }
    }
    public bool Bind(UpdateAiBindingRequest request)
    {
        lock (gate)
        {
            // Feature IDs come from the server catalog, never arbitrary client declarations.
            if (!Features.Any(f => f.Id == request.FeatureId)) return false;
            var model = request.Model?.Trim() ?? "";
            if (model.Length > 200 || model.Any(char.IsControl)) return false;
            var provider = document.Providers.FirstOrDefault(p => p.Id == request.ProviderId);
            if (request.ProviderId is not null && provider is null) return false;
            if (model.Length > 0 && (provider is null || !ModelsFor(provider).Contains(model, StringComparer.Ordinal))) return false;
            if (request.Enabled && (provider is null || !Ready(provider) || model.Length == 0)) return false;
            var binding = new AiBindingDocument(request.FeatureId, request.ProviderId, model, request.Enabled);
            Persist(document with { Version = 3, ActiveProviderId = request.Enabled ? request.ProviderId : null, Bindings = (document.Bindings ?? [Cover]).Where(b => b.FeatureId != request.FeatureId).Append(binding).ToArray() });
            return true;
        }
    }
    public bool Select(string? id)
    {
        lock (gate) return Bind(new("book-recognition", id, id is null ? "" : Cover.Model, id is not null));
    }
    public bool Remove(string id)
    {
        lock (gate)
        {
            if ((document.Bindings ?? [Cover]).Any(b => b.ProviderId == id) || !document.Providers.Any(p => p.Id == id)) return false;
            Persist(document with { Providers = document.Providers.Where(p => p.Id != id).ToArray() });
            return true;
        }
    }
    // Retain the original single-connection API for existing clients.
    public bool Save(UpdateAiSettingsRequest request)
    {
        lock (gate)
        {
            var old = document.Providers.FirstOrDefault(p => p.Id == document.ActiveProviderId) ?? document.Providers.FirstOrDefault();
            if (!TryProvider(new(old?.Id, old?.Name ?? "API", old?.Protocol ?? "openai", request.Endpoint, request.Model, request.ApiKey, request.ClearApiKey), out var provider) || provider is null) return false;
            if (request.Enabled && (!Ready(provider) || provider.Model.Length == 0)) return false;
            Persist(new(3, request.Enabled ? provider.Id : null, document.Providers.Where(p => p.Id != provider.Id).Append(provider).ToArray(), [new("book-recognition", provider.Id, provider.Model, request.Enabled)]));
            return true;
        }
    }
    public AiSettingsDto Get(string locale)
    {
        lock (gate)
        {
            var binding = Cover;
            var selected = binding.Enabled ? document.Providers.FirstOrDefault(p => p.Id == binding.ProviderId) : null;
            var zh = locale == "zh-CN";
            var labels = Labels(zh);
            return new(selected is not null, selected?.Endpoint ?? "", binding.Model, selected?.ProtectedKey.Length > 0,
                labels, document.ActiveProviderId,
                document.Providers.Select(p => new AiProviderDto(p.Id, p.Name, p.Protocol, p.Endpoint, p.Model, p.ProtectedKey.Length > 0, ModelsFor(p))).ToArray(),
                [new("openai", "OpenAI Chat Completions", "https://api.example.com/v1/chat/completions"),
                 new("anthropic", "Anthropic Messages", "https://api.anthropic.com/v1/messages")],
                Features.Select(f => {
                    var b = (document.Bindings ?? [Cover]).FirstOrDefault(b => b.FeatureId == f.Id) ?? new(f.Id, null, "", false);
                    return new AiBindingDto(f.Id, zh ? f.Zh : f.En, b.ProviderId, b.Model, b.Enabled);
                }).ToArray());
        }
    }
    private static Dictionary<string, string> Labels(bool zh) => new() {
            ["providers"] = zh ? "模型服务商" : "Model providers",
            ["business"] = zh ? "AI 业务配置" : "AI feature settings",
            ["configureFeature"] = zh ? "配置业务" : "Configure feature",
            ["provider"] = zh ? "服务商" : "Provider",
            ["none"] = zh ? "未选择" : "Not selected",
            ["enabledFeature"] = zh ? "启用此业务" : "Enable feature",
            ["inUse"] = zh ? "已被业务引用" : "Referenced by a feature",
            ["name"] = zh ? "供应商名称" : "Provider name",
            ["protocol"] = zh ? "接口格式" : "API format",
            ["add"] = zh ? "添加供应商" : "Add provider",
            ["active"] = zh ? "当前启用" : "Active provider",
            ["use"] = zh ? "启用此供应商" : "Use provider",
            ["disable"] = zh ? "停用识别" : "Disable recognition",
            ["delete"] = zh ? "删除" : "Delete",
            ["deleteConfirm"] = zh ? "确认删除此供应商？" : "Delete this provider?",
            ["empty"] = zh ? "尚未添加供应商" : "No providers yet",
            ["search"] = zh ? "搜索供应商、模型或地址" : "Search providers, models or endpoints",
            ["previous"] = zh ? "上一页" : "Previous",
            ["next"] = zh ? "下一页" : "Next",
            ["actions"] = zh ? "操作" : "Actions",
            ["title"] = zh ? "封面识别 API" : "Cover recognition API",
            ["edit"] = zh ? "配置接入" : "Configure",
            ["enabled"] = zh ? "启用封面识别" : "Enable cover recognition",
            ["on"] = zh ? "已启用" : "Enabled", ["off"] = zh ? "未启用" : "Disabled",
            ["endpoint"] = zh ? "API 地址（基础地址或完整接口）" : "API base URL or full endpoint",
            ["endpointHint"] = zh ? "支持基础地址或完整 HTTPS 接口地址；更换地址或格式时请重新填写密钥。" : "Base URL or full HTTPS endpoint. Re-enter the key when changing the address or format.",
            ["models"] = zh ? "可用模型" : "Available models",
            ["modelsHint"] = zh ? "每行填写一个模型 ID；被业务使用的模型需先解除引用再删除。" : "One model ID per line. Unassign a model from features before removing it.",
            ["model"] = zh ? "模型名称" : "Model name",
            ["modelHint"] = zh ? "需支持图片输入和 JSON 输出。" : "Must support image input and JSON output.",
            ["key"] = "API Key", ["keySet"] = zh ? "已配置" : "Configured", ["keyEmpty"] = zh ? "未配置" : "Not configured",
            ["keyHint"] = zh ? "留空保留已有密钥" : "Leave blank to keep the existing key",
            ["clear"] = zh ? "清除已有密钥" : "Clear existing key",
            ["save"] = zh ? "保存" : "Save", ["cancel"] = zh ? "取消" : "Cancel",
            ["saved"] = zh ? "配置已保存并生效" : "Settings saved and applied",
            ["invalid"] = zh ? "请检查地址、密钥和模型清单；已被业务引用的模型不能移除。" : "Check the endpoint, key and model list. Models referenced by features cannot be removed."
        };
}
