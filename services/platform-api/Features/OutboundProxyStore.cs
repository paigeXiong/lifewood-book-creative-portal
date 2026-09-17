using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Features;

public sealed record ProxyRule(string Mode, string Address = "", string Username = "", string ProtectedPassword = "");
public sealed record ProxyDocument(string Revision, ProxyRule Global, Dictionary<string, ProxyRule> Overrides);
public sealed record SaveProxyRequest(string Revision, string Scope, string Mode, string Address, string Username, string? Password, bool ClearPassword = false);
public sealed record ProxyScopeDto(string Id, string Label, string Mode, string EffectiveMode, string Address, string Username, bool HasPassword);
public sealed record ProxyModeDto(string Id, string Label);
public sealed record ProxySettingsDto(string Revision, ProxyScopeDto[] Scopes, ProxyModeDto[] Modes, Dictionary<string, string> Labels);
public sealed record ProxyTestRequest(string Revision, string Scope);
public sealed record ProxyTestResult(int Status);
internal sealed record ResolvedProxy(string Mode, Uri? Address, NetworkCredential? Credential);

internal sealed class OutboundProxyStore
{
    private readonly object gate = new();
    private readonly string path;
    private readonly IDataProtector protector;
    private ProxyDocument document;
    public OutboundProxyStore(string directory, IDataProtectionProvider protection, IEnumerable<string> legacyOidcIds)
    {
        path = Path.Combine(directory, "outbound-proxy.json");
        protector = protection.CreateProtector("BookCreativePortal.OutboundProxy.v1");
        document = File.Exists(path) ? JsonSerializer.Deserialize(File.ReadAllText(path), AppJsonContext.Default.ProxyDocument) ?? throw new InvalidDataException()
            : new(Guid.NewGuid().ToString("N"), new("system"), legacyOidcIds.ToDictionary(id => "oidc:" + id, _ => new ProxyRule("direct")));
        if (string.IsNullOrEmpty(document.Revision) || document.Overrides is null || !ValidRule(document.Global) || document.Overrides.Any(p => !ValidRule(p.Value))) throw new InvalidDataException("Invalid outbound proxy settings.");
        if (!File.Exists(path)) Persist(document);
    }
    private static bool ValidRule(ProxyRule? rule) => rule is not null && rule.Mode is "direct" or "system" or "custom" && rule.Address is not null && rule.Username is not null && rule.ProtectedPassword is not null && (rule.Mode != "custom" || ValidAddress(rule.Address));
    private void Persist(ProxyDocument next)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temporary, JsonSerializer.Serialize(next, AppJsonContext.Default.ProxyDocument)); File.Move(temporary, path, true); document = next; }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    internal static bool ValidAddress(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme is "http" or "https" && uri.HostNameType != UriHostNameType.Unknown && uri.Port is > 0 and <= 65535 &&
        uri.UserInfo.Length == 0 && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0 && !value.Any(char.IsControl);
    public bool IsCurrent(string revision) { lock (gate) return revision == document.Revision; }
    public string? Save(SaveProxyRequest input, HashSet<string> scopes)
    {
        lock (gate) {
            if (input.Revision != document.Revision) return "conflict";
            if (input.Scope is null || !scopes.Contains(input.Scope) || input.Mode is not ("inherit" or "direct" or "system" or "custom") || input.Scope == "global" && input.Mode == "inherit") return "invalid";
            var previous = input.Scope == "global" ? document.Global : document.Overrides.GetValueOrDefault(input.Scope, new("inherit"));
            ProxyRule rule = new(input.Mode);
            if (input.Mode == "custom") {
                var address = input.Address?.Trim() ?? ""; var username = input.Username?.Trim() ?? "";
                if (address.Length > 2048 || !ValidAddress(address) || username.Length > 254 || username.Contains(':') || username.Any(char.IsControl) || input.Password?.Length > 4096 || input.Password?.Any(char.IsControl) == true || input.ClearPassword && !string.IsNullOrEmpty(input.Password)) return "invalid";
                address = new Uri(address).AbsoluteUri.TrimEnd('/');
                var password = input.ClearPassword ? "" : !string.IsNullOrEmpty(input.Password) ? protector.Protect(input.Password) : previous.ProtectedPassword;
                if (password.Length > 0 && string.IsNullOrEmpty(input.Password) && !input.ClearPassword && (previous.Address != address || previous.Username != username)) return "credentialsChanged";
                if ((username.Length == 0) != (password.Length == 0)) return "invalid";
                rule = new("custom", address, username, password);
            }
            var overrides = document.Overrides.Where(p => scopes.Contains(p.Key)).ToDictionary(p => p.Key, p => p.Value);
            if (input.Scope != "global") { if (input.Mode == "inherit") overrides.Remove(input.Scope); else overrides[input.Scope] = rule; }
            Persist(new(Guid.NewGuid().ToString("N"), input.Scope == "global" ? rule : document.Global, overrides));
            return null;
        }
    }
    public ResolvedProxy Resolve(string scope)
    {
        lock (gate) {
            var rule = document.Overrides.GetValueOrDefault(scope, document.Global);
            return new(rule.Mode, rule.Mode == "custom" ? new Uri(rule.Address) : null,
                rule.ProtectedPassword.Length > 0 ? new NetworkCredential(rule.Username, protector.Unprotect(rule.ProtectedPassword)) : null);
        }
    }
    public ProxySettingsDto Read((string Id, string Label)[] scopes, string locale)
    {
        lock (gate) {
            var zh = locale != "en-US";
            return new(document.Revision, scopes.Select(scope => {
                var rule = scope.Id == "global" ? document.Global : document.Overrides.GetValueOrDefault(scope.Id, new("inherit"));
                return new ProxyScopeDto(scope.Id, scope.Label, rule.Mode, rule.Mode == "inherit" ? document.Global.Mode : rule.Mode, rule.Address, rule.Username, rule.ProtectedPassword.Length > 0);
            }).ToArray(), [new("inherit", zh ? "继承全局" : "Inherit global"), new("direct", zh ? "直接连接" : "Direct"), new("system", zh ? "跟随系统" : "System proxy"), new("custom", zh ? "自定义代理" : "Custom proxy")], new() {
                ["scope"] = zh ? "适用范围" : "Scope", ["mode"] = zh ? "连接方式" : "Connection mode", ["effective"] = zh ? "生效方式" : "Effective mode",
                ["address"] = zh ? "代理地址" : "Proxy URL", ["username"] = zh ? "代理用户名" : "Proxy username", ["password"] = zh ? "代理密码" : "Proxy password",
                ["savedPassword"] = zh ? "已保存，留空保留" : "Saved; leave blank to keep", ["clearPassword"] = zh ? "清除认证信息" : "Clear credentials",
                ["help"] = zh ? "适用于服务器访问 AI 和 OIDC；不改变浏览器网络，SMTP 仍为直连。支持 HTTP/HTTPS CONNECT 代理和可选 Basic 认证。自定义代理失败不会回退直连。系统模式采用进程启动时的系统/环境代理及绕过规则；系统代理更改后需重启。OIDC 目标仍由服务器解析并校验公网 IP，因此服务器必须能解析目标域名。新请求使用已保存配置，已在途请求不切换。" : "Applies to server-side AI and OIDC requests, not browser traffic or SMTP. Supports HTTP/HTTPS CONNECT proxies and optional Basic authentication. Custom proxy failures never fall back to direct. System mode uses process-start system/environment proxy and bypass rules; restart after changing those. OIDC targets are resolved and checked for public IPs locally, so the server must resolve target domains. Saved settings apply to new requests, not requests already in flight.",
                ["passwordHelp"] = zh ? "密码加密保存。更换代理地址或用户名时需重新输入密码。切换为非自定义方式会清除该范围的代理认证信息。" : "Passwords are encrypted. Re-enter when changing the proxy URL or username. Switching away from custom removes this scope's proxy credentials.",
                ["testHelp"] = zh ? "检查已保存配置到该服务的 HTTPS 连接，不携带 AI 密钥或 OIDC 客户端密钥，不调用模型。目标返回 401/403/405 等状态也表示连接已建立，不代表业务认证通过。" : "Checks the saved HTTPS route to this service without AI keys, OIDC client secrets or model calls. A target 401/403/405 still confirms connectivity, not business authentication."
            });
        }
    }
}
