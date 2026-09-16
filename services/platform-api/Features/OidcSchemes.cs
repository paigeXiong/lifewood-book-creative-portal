using Lifewood.PlatformApi.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;

namespace Lifewood.PlatformApi.Features;

// Only registered, persisted providers become authentication schemes. User input never creates a scheme.
internal sealed class OidcSchemes : AuthenticationSchemeProvider
{
    private readonly OidcStore store;
    private readonly object gate = new();
    private readonly HashSet<string> registered = [];
    public OidcSchemes(IOptions<AuthenticationOptions> options, OidcStore store) : base(options)
    {
        this.store = store;
        Refresh();
    }
    public void Refresh()
    {
        lock (gate)
        {
            var names = store.List().Where(c => c.Id != "default").Select(c => OidcFeature.SchemeFor(c.Id)).ToHashSet();
            foreach (var name in registered.Except(names).ToArray()) { RemoveScheme(name); registered.Remove(name); }
            foreach (var name in names.Except(registered)) { AddScheme(new AuthenticationScheme(name, null, typeof(OpenIdConnectHandler))); registered.Add(name); }
        }
    }
}

internal sealed class OidcNamedOptions(Action<string, OpenIdConnectOptions> configure) : IConfigureNamedOptions<OpenIdConnectOptions>
{
    public void Configure(OpenIdConnectOptions options) { }
    public void Configure(string? name, OpenIdConnectOptions options)
    {
        if (name == OidcFeature.Scheme) configure("default", options);
        else if (name?.StartsWith(OidcFeature.Scheme + ":", StringComparison.Ordinal) == true)
            configure(name[(OidcFeature.Scheme.Length + 1)..], options);
    }
}
