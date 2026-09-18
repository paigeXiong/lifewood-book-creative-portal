using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;

if (DatabaseIntegrityCommand.TryRun(args, out var databaseValidationExitCode))
{
    Environment.ExitCode = databaseValidationExitCode;
    return;
}

if (await RestoreEngine.TryRun(args)) return;

RestartWaiter.Wait(args);
var serviceMode = OperatingSystem.IsWindows() && WindowsServiceHelpers.IsWindowsService();
var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = serviceMode ? AppContext.BaseDirectory : null
});
builder.Services.AddWindowsService(options => options.ServiceName = "Lifewood Book Creative Portal");
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 510_000_000);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => options.MultipartBodyLengthLimit = 510_000_000);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
builder.Services.AddOpenApi();

builder.Services.AddHttpClient("book-recognition", client => client.Timeout = TimeSpan.FromSeconds(60))
    .ConfigurePrimaryHttpMessageHandler(sp => new OutboundProxyHandler(sp.GetRequiredService<OutboundProxyStore>(), false));
var trustedProxyAddresses = new HashSet<IPAddress>();
foreach (var value in builder.Configuration.GetSection("Network:TrustedProxies")
             .GetChildren().Select(item => item.Value).Where(value => !string.IsNullOrWhiteSpace(value)))
{
    if (!IPAddress.TryParse(value, out var address))
        throw new InvalidOperationException("Network:TrustedProxies entries must be valid IP addresses.");
    trustedProxyAddresses.Add(address);
    if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        trustedProxyAddresses.Add(address.MapToIPv6());
    else if (address.IsIPv4MappedToIPv6)
        trustedProxyAddresses.Add(address.MapToIPv4());
}
if (trustedProxyAddresses.Count > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownProxies.Clear();
        options.KnownIPNetworks.Clear();
        foreach (var address in trustedProxyAddresses) options.KnownProxies.Add(address);
    });
}

var configuredDataDirectory = builder.Configuration["Lifewood:DataDirectory"];
var platformLimits = PlatformLimits.FromConfiguration(builder.Configuration);
var dataDirectory = string.IsNullOrWhiteSpace(configuredDataDirectory)
    ? Path.Combine(builder.Environment.ContentRootPath, "data")
    : Path.GetFullPath(Path.IsPathRooted(configuredDataDirectory)
        ? configuredDataDirectory
        : Path.Combine(builder.Environment.ContentRootPath, configuredDataDirectory));
builder.Services.AddSingleton(provider => new BookRecognitionSettingsStore(dataDirectory, builder.Configuration, provider.GetRequiredService<IDataProtectionProvider>()));
builder.Services.AddSingleton(sp => new OutboundProxyStore(dataDirectory, sp.GetRequiredService<IDataProtectionProvider>(), sp.GetRequiredService<OidcStore>().List().Select(p => p.Id)));
builder.Services.AddTransient(provider => new BookRecognitionService(provider.GetRequiredService<IHttpClientFactory>().CreateClient("book-recognition"), provider.GetRequiredService<BookRecognitionSettingsStore>().Current));
var databaseConnection = $"Data Source={Path.Combine(dataDirectory, "platform.db")}";
var voiceSampleDirectory = Path.Combine(dataDirectory, "voice-samples");
var voiceSampleLocks = new System.Collections.Concurrent.ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);
var projectWriteLocks = new AsyncKeyedLock();
using var restoreStartupLock = RestoreStartupLock.Acquire(
    dataDirectory,
    builder.Configuration["Lifewood:CoordinationDirectory"],
    TimeSpan.FromSeconds(120));
var backupDirectory = Path.GetFullPath(builder.Configuration["Lifewood:BackupDirectory"] ?? Path.TrimEndingDirectorySeparator(dataDirectory) + ".backups");
RestoreEngine.Recover(dataDirectory, backupDirectory, builder.Configuration["Lifewood:RestoreAttempt"]);
Directory.CreateDirectory(dataDirectory);
var runtimeSettings = new RuntimeSettingsStore(dataDirectory, builder.Configuration["urls"], builder.Configuration["Lifewood:CustomerUrl"], builder.Configuration["Lifewood:AdminUrl"]);
builder.WebHost.UseUrls(runtimeSettings.ActiveUrls);
builder.Services.AddSingleton(runtimeSettings);
builder.Services.AddSingleton(serviceProvider =>
    new RuntimeLifecycle(serviceProvider.GetRequiredService<IHostApplicationLifetime>(), serviceMode));
var platformLockPath = Path.Combine(dataDirectory, "platform.lock");
using var platformLock = new FileStream(platformLockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
restoreStartupLock.Release();
CleanupInterruptedUploads(dataDirectory);
ProjectExport.Cleanup(dataDirectory);
Directory.CreateDirectory(voiceSampleDirectory);
CleanupOrphanedVoiceUploads(voiceSampleDirectory);
var bundledSampleDirectory = Path.Combine(AppContext.BaseDirectory, "assets", "voice-samples");
var bundledSampleMarker = Path.Combine(voiceSampleDirectory, ".bundled-samples-v1");
if (!File.Exists(bundledSampleMarker) && Directory.Exists(bundledSampleDirectory))
{
    var bundledSamples = Directory.EnumerateFiles(bundledSampleDirectory)
        .Where(path => Path.GetExtension(path).Equals(".wav", StringComparison.OrdinalIgnoreCase) || Path.GetExtension(path).Equals(".mp3", StringComparison.OrdinalIgnoreCase))
        .ToArray();
    foreach (var source in bundledSamples)
    {
        var target = Path.Combine(voiceSampleDirectory, Path.GetFileName(source));
        if (!File.Exists(target)) File.Copy(source, target);
    }
    if (bundledSamples.Length > 0) File.WriteAllText(bundledSampleMarker, DateTimeOffset.UtcNow.ToString("O"));
}var keyDirectory = Path.Combine(dataDirectory, "data-protection-keys");
Directory.CreateDirectory(keyDirectory);
var dataProtection = builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory))
    .SetApplicationName("Lifewood.BookVideoPlatform");
if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi(protectToLocalMachine: true);
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "lw_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Events.OnCheckSlidingExpiration = context => { if (context.HttpContext.Items.ContainsKey("backup.read_only")) context.ShouldRenew = false; return Task.CompletedTask; };
        options.Events.OnValidatePrincipal = context => {
            var readOnly = context.HttpContext.Items.ContainsKey("backup.read_only");
            var principal=context.Principal;var id=principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            if(id is null||!int.TryParse(principal?.FindFirstValue("lw_session_version"),out var version)){context.RejectPrincipal();return Task.CompletedTask;}
            var user=context.HttpContext.RequestServices.GetRequiredService<UserRepository>().Get(id,version);
            if(user is null){context.RejectPrincipal();return Task.CompletedTask;}
            var accounts=context.HttpContext.RequestServices.GetRequiredService<AccountSwitchStore>();
            var session=principal?.FindFirstValue("lw_login_session");
            if(session is null && !readOnly){
                session=user is null?null:accounts.Remember(context.HttpContext,user,version,context.Properties.ExpiresUtc??DateTimeOffset.UtcNow,context.Properties.IsPersistent,true,principal?.FindFirstValue("lw_presence_session"));
                if(session is not null){((ClaimsIdentity)principal!.Identity!).AddClaim(new Claim("lw_login_session",session));context.ShouldRenew=true;}
            }
            if(session is null||!accounts.IsSessionActive(id,session,version,!readOnly))context.RejectPrincipal();
            else if(!readOnly && context.Properties.AllowRefresh!=false && context.Properties.IssuedUtc is {} issued && context.Properties.ExpiresUtc is {} expiry && DateTimeOffset.UtcNow-issued>expiry-DateTimeOffset.UtcNow){
                if(accounts.RenewSession(context.HttpContext,id,session,version,DateTimeOffset.UtcNow+(expiry-issued)))context.ShouldRenew=true;else context.RejectPrincipal();
            }
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToLogin = context => { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        options.Events.OnRedirectToAccessDenied = context => { context.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "lw_csrf";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.OnRejected = async (rejected, cancellationToken) =>
    {
        if (rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
            rejected.HttpContext.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        await rejected.HttpContext.Response.WriteAsJsonAsync(
            new ApiErrorDto("rate_limit.exceeded", "errors.rateLimit.exceeded", "Too many requests. Wait briefly and try again.", null, true, rejected.HttpContext.TraceIdentifier),
            AppJsonContext.Default.ApiErrorDto);
    };
    options.AddPolicy("presence", context => RateLimitPartition.GetFixedWindowLimiter(context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("book-recognition", context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 6, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("authentication", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
    {
        if (context.Request.Path == "/api/me/presence") return RateLimitPartition.GetNoLimiter("presence");
        if (HttpMethods.IsGet(context.Request.Method) || HttpMethods.IsHead(context.Request.Method) || HttpMethods.IsOptions(context.Request.Method))
            return RateLimitPartition.GetNoLimiter("read");
        var key = context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = platformLimits.WriteRequestsPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        });
    });
});

var repository = new ProjectRepository(databaseConnection);
repository.Initialize();
builder.Services.AddSingleton(repository);
var revisions = new RevisionStore(databaseConnection);
revisions.Initialize();
builder.Services.AddSingleton(revisions);
var users = new UserRepository(databaseConnection, dataDirectory);
users.Initialize();
builder.Services.AddSingleton(users);
OidcFeature.Register(builder.Services, databaseConnection, (context, user, version) => SignIn(context, user, false, authenticatedVersion: version));
var personalWorkspace=new PersonalWorkspaceRepository(databaseConnection);
personalWorkspace.Initialize();builder.Services.AddSingleton(personalWorkspace);
var feedback=new FeedbackRepository(databaseConnection);
feedback.Initialize();builder.Services.AddSingleton(feedback);

var presence = new UserPresenceRepository(databaseConnection);
presence.Initialize();
builder.Services.AddSingleton(presence);

var administration = new AdminRepository(databaseConnection);
administration.Initialize();
builder.Services.AddSingleton(administration);
builder.Services.AddSingleton(new AccountClosureRepository(databaseConnection));
builder.Services.AddSingleton(new OperationsRepository(databaseConnection));
builder.Services.AddSingleton(new TrendRepository(databaseConnection));
var auditEvents = new AuditRepository(databaseConnection, dataDirectory);
auditEvents.Initialize();
builder.Services.AddSingleton(auditEvents);
var deliveries = new DeliveryRepository(databaseConnection);
deliveries.Initialize();
var customerDashboard = new CustomerDashboardRepository(databaseConnection);
customerDashboard.Initialize(); builder.Services.AddSingleton(customerDashboard);
var adminAnalytics = new AdminAnalyticsRepository(databaseConnection);
adminAnalytics.Initialize(); builder.Services.AddSingleton(adminAnalytics);
builder.Services.AddSingleton(deliveries);
var announcements = new AnnouncementRepository(databaseConnection);
announcements.Initialize();
builder.Services.AddSingleton(announcements);
var savedAccounts = new AccountSwitchStore(databaseConnection, users);
savedAccounts.Initialize();
builder.Services.AddSingleton(savedAccounts);
var notifications = new NotificationRepository(databaseConnection);
notifications.Initialize();
builder.Services.AddSingleton(notifications);
builder.Services.AddSingleton(provider => new MailSettingsStore(dataDirectory, new MailSettings(builder.Configuration), provider.GetRequiredService<IDataProtectionProvider>()));
builder.Services.AddSingleton(provider => provider.GetRequiredService<MailSettingsStore>().Settings);
builder.Services.AddSingleton<IPlatformMailer, SmtpPlatformMailer>();
builder.Services.AddSingleton(service => {
    var repository = new EmailRepository(databaseConnection, service.GetRequiredService<Microsoft.AspNetCore.DataProtection.IDataProtectionProvider>(), service.GetRequiredService<MailSettings>(), users, notifications);
    repository.Initialize();
    return repository;
});
builder.Services.AddHostedService<EmailWorker>();
builder.Services.AddSingleton<BackupGate>();
builder.Services.AddHostedService<NotificationWorker>();
var characterPresets = new CharacterPresetRepository(databaseConnection);
builder.Services.AddSingleton(characterPresets);
var voiceReferences = new VoiceReferenceRepository(databaseConnection);
voiceReferences.Initialize();
RecoverVoiceSampleBackups(voiceSampleDirectory, voiceReferences);
voiceReferences.ReconcileAudioAvailability(id =>
    File.Exists(Path.Combine(voiceSampleDirectory, id + ".wav")) ||
    File.Exists(Path.Combine(voiceSampleDirectory, id + ".mp3")));
builder.Services.AddSingleton(voiceReferences);
var formOptions = new FormOptionRepository(databaseConnection);
formOptions.Initialize();
builder.Services.AddSingleton(formOptions);
var fileCategories = new FileCategoryRepository(databaseConnection);
fileCategories.Initialize();
builder.Services.AddSingleton(fileCategories);
builder.Services.AddSingleton(platformLimits);
builder.Services.AddSingleton(new StorageQuota(dataDirectory, platformLimits));
builder.Services.AddSingleton(new RuntimeMonitor(databaseConnection, dataDirectory, platformLimits.MaxStoredBytes, backupDirectory));
builder.Services.AddHostedService(provider => provider.GetRequiredService<RuntimeMonitor>());

builder.Services.AddSingleton(provider => new BackupService(dataDirectory, backupDirectory, provider.GetRequiredService<BackupGate>(), provider.GetRequiredService<AuditRepository>(), provider.GetRequiredService<ILogger<BackupService>>()));
builder.Services.AddHostedService(provider => provider.GetRequiredService<BackupService>());
builder.Services.AddSingleton(provider => new RestoreService(dataDirectory, backupDirectory, builder.Configuration["Lifewood:CoordinationDirectory"], !serviceMode && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("INVOCATION_ID")) && !string.IsNullOrEmpty(Environment.ProcessPath) && !Path.GetFileNameWithoutExtension(Environment.ProcessPath).Contains("testhost", StringComparison.OrdinalIgnoreCase), provider.GetRequiredService<RuntimeSettingsStore>(), provider.GetRequiredService<BackupService>(), provider.GetRequiredService<BackupGate>(), provider.GetRequiredService<AuditRepository>(), provider.GetRequiredService<IHostApplicationLifetime>(), provider.GetRequiredService<ILogger<RestoreService>>()));
builder.Services.AddHostedService(provider => provider.GetRequiredService<RestoreService>());
var app = builder.Build();
_ = app.Services.GetRequiredService<OutboundProxyStore>();
var configuredWebRoot = builder.Configuration["Lifewood:WebRoot"];
var webRoot = string.IsNullOrWhiteSpace(configuredWebRoot)
    ? Path.Combine(AppContext.BaseDirectory, "web")
    : Path.GetFullPath(Path.IsPathRooted(configuredWebRoot) ? configuredWebRoot : Path.Combine(app.Environment.ContentRootPath, configuredWebRoot));
var backupPathComparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
if (backupDirectory.Equals(Path.TrimEndingDirectorySeparator(webRoot), backupPathComparison) || backupDirectory.StartsWith(Path.TrimEndingDirectorySeparator(webRoot) + Path.DirectorySeparatorChar, backupPathComparison))
    throw new InvalidOperationException("Backup storage cannot be inside publicly served web assets.");
var customerWebRoot = Path.Combine(webRoot, "customer");
var adminWebRoot = Path.Combine(webRoot, "admin");
var customerIndex = Path.Combine(customerWebRoot, "index.html");
var adminIndex = Path.Combine(adminWebRoot, "index.html");
var requireWebAssets = builder.Configuration.GetValue("Lifewood:RequireWebAssets", true);
if (requireWebAssets && (!File.Exists(customerIndex) || !File.Exists(adminIndex)))
    throw new InvalidOperationException($"The production web assets are incomplete under {webRoot}. Both customer/index.html and admin/index.html are required.");
RecoverDraftUploadTombstones(dataDirectory, repository, app.Logger);
RecoverDeletedReferenceFiles(dataDirectory, repository, app.Logger);
foreach (var (projectId, deliveryId) in deliveries.ListRevokedFileKeys())
    DeliveryEndpoints.DeleteDeliveryFiles(dataDirectory, projectId, deliveryId, app.Logger);
RecoverPendingFileOperations(dataDirectory, repository, deliveries, app.Logger);
app.Use(async (context, next) =>
{
    if (context.Request.Headers.ContainsKey("Forwarded") ||
        context.Request.Headers.ContainsKey("X-Forwarded-For") ||
        context.Request.Headers.ContainsKey("X-Forwarded-Proto") ||
        context.Request.Headers.ContainsKey("X-Forwarded-Host"))
        context.Items["Lifewood.ProxyHeadersPresent"] = true;
    await next();
});
if (trustedProxyAddresses.Count > 0) app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=()";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'";
    context.Response.Headers.Append("X-Request-Id", context.TraceIdentifier);
    await next();
});
var sharedPresetRoot = Path.Combine(customerWebRoot, "character-presets");
if (Directory.Exists(sharedPresetRoot))
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(sharedPresetRoot), RequestPath = "/character-presets" });
app.Use(async (context, next) => {
    var port = context.Connection.LocalPort;
    if (!runtimeSettings.ExternalFrontends && port != 0) {
        var backend = port == runtimeSettings.Active.Port;
        var customerHere = runtimeSettings.Active.Customer!.Shared ? backend : port == runtimeSettings.Active.Customer.Port;
        var adminHere = runtimeSettings.Active.Admin!.Shared ? backend : port == runtimeSettings.Active.Admin.Port;
        var path = context.Request.Path;
        if (path.StartsWithSegments("/api")) {
            if (path.StartsWithSegments("/api/admin") && !backend && !adminHere) { context.Response.StatusCode = 404; return; }
        } else if (path.StartsWithSegments("/admin")) {
            if (!adminHere) { context.Response.StatusCode = 404; return; }
        } else if (!customerHere) {
            if (adminHere) { context.Response.Redirect("/admin" + path + context.Request.QueryString); return; }
            context.Response.StatusCode = 404; return;
        }
    }
    await next(context);
});
if (Directory.Exists(adminWebRoot))
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(adminWebRoot), RequestPath = "/admin" });
if (Directory.Exists(customerWebRoot))
    app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(customerWebRoot) });
app.UseRouting();
app.Use(async (context, next) =>
{
    if ((context.Request.Path.StartsWithSegments("/api/auth") && context.Request.Path != "/api/auth/csrf") || context.Request.Path == "/api/me")
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }
    var requestSize = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
    if (requestSize is { IsReadOnly: false })
    {
        var isVoiceSample = HttpMethods.IsPost(context.Request.Method) && context.Request.Path.Value?.EndsWith("/sample", StringComparison.Ordinal) == true;
        var isLargeUpload = HttpMethods.IsPost(context.Request.Method) &&
            (context.Request.Path.Value?.EndsWith("/files", StringComparison.Ordinal) == true || context.Request.Path.Value?.EndsWith("/deliveries", StringComparison.Ordinal) == true);
        var isAuthWrite = context.Request.Path.StartsWithSegments("/api/auth") && !HttpMethods.IsGet(context.Request.Method);
        requestSize.MaxRequestBodySize = isVoiceSample ? 22_000_000 : isLargeUpload ? 510_000_000 : isAuthWrite ? 16_384 : 2_000_000;
    }
    try { await next(); }
    catch (AntiforgeryValidationException)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(
                new ApiErrorDto("auth.csrf", "errors.auth.csrf", "The security token is missing or expired. Refresh and try again.", null, true, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto);
        }
    }
    catch (BadHttpRequestException exception) when (exception.StatusCode == StatusCodes.Status413PayloadTooLarge)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.Clear();
            context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
            await context.Response.WriteAsJsonAsync(
                new ApiErrorDto("validation.file", "errors.validation.file", "The uploaded file is larger than this category allows.", null, false, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto);
        }
    }
    catch (Microsoft.Data.Sqlite.SqliteException exception) when (exception.SqliteErrorCode == 19 && exception.Message.Contains("config.option_removed", StringComparison.Ordinal))
    {
        if (!context.Response.HasStarted)
        {
            context.Response.Clear();
            await Error(context, 409, "config.option_removed", "errors.validation.optionRemoved", "An option was removed while saving. Reload the available options and try again.", false).ExecuteAsync(context);
        }
    }
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Unhandled request failure {RequestId}", context.TraceIdentifier);
        if (!context.Response.HasStarted)
        {
            context.Response.Clear();
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(
                new ApiErrorDto("system.unexpected", "errors.system.unexpected", "The request could not be completed.", null, true, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto);
        }
    }
});

app.Use(async (context, next) => {
    var normalizedPath = context.Request.Path.Value?.TrimEnd('/').ToLowerInvariant();
    if (!context.Request.Path.StartsWithSegments("/api") || HttpMethods.IsGet(context.Request.Method) && normalizedPath is "/api/admin/backups" or "/api/admin/backups/restore" or "/api/admin/backups/restore/history" or "/api/notifications/stream" or "/api/health") { context.Items["backup.read_only"] = true; await next(); return; }
    using var lease = context.RequestServices.GetRequiredService<BackupGate>().TryEnter();
    if (lease is null) {
        context.Response.Headers.RetryAfter = "5";
        await Error(context, 503, "backup.snapshot", "backups.paused", "A consistent backup snapshot is being prepared. Retry shortly.", true).ExecuteAsync(context);
        return;
    }
    await next();
});
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.Use(async (context, next) =>
{
    var expected = context.Request.Headers["X-LW-Account"].ToString();
    if (context.Request.Path.StartsWithSegments("/api") && expected.Length > 0 && context.Request.Path != "/api/auth/active" &&
        expected != CurrentUser(context)?.Id)
    {
        await Error(context,409,"auth.account_changed","accountSwitch.changed","The active account changed. Refresh before continuing.",false).ExecuteAsync(context);
        return;
    }
    await next();
});
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") &&
        !HttpMethods.IsGet(context.Request.Method) &&
        !HttpMethods.IsHead(context.Request.Method) &&
        !HttpMethods.IsOptions(context.Request.Method))
    {
        await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context);
    }
    await next();
});
app.Use(async (context, next) =>
{
    var actor = context.Request.Path.StartsWithSegments("/api/admin") ? CurrentUser(context) : null;
    var action = AuditActionCatalog.Resolve(context.Request.Method, context.Request.Path);
    if (actor is null || action is null || action.ActionId == "project.export")
    {
        await next();
        return;
    }

    var configChange = action.TargetType == "form_option" || action.TargetType == "notification" && action.ActionId == "notification.config";
    if (configChange) await auditEvents.ConfigurationGate.WaitAsync(context.RequestAborted);
    AuditSnapshot? before = null;
    var responseBody = context.Response.Body;
    await using var bufferedBody = new MemoryStream();
    context.Response.Body = bufferedBody;
    try
    {
        if (action is { TargetType: "notification", TargetId: "rules" } && Can(actor, "admin.config.manage"))
        {
            context.Request.EnableBuffering();
            try
            {
                using var body = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
                if (body.RootElement.TryGetProperty("kind", out var kind) && kind.ValueKind == JsonValueKind.String)
                    action = action with { TargetId = "rules/" + kind.GetString() };
            }
            catch (JsonException) { }
            finally { context.Request.Body.Position = 0; }
        }
        before = auditEvents.Capture(action);
        await next();
        if (context.Response.StatusCode >= 200 && context.Response.StatusCode < 300)
        {
            if (context.Items.TryGetValue(AuditActionCatalog.TargetIdItemKey, out var targetId) && targetId is string value)
                action = action with { TargetId = value };
            try { auditEvents.Record(actor, action, context.TraceIdentifier, before); }
            catch (Exception exception)
            {
                app.Logger.LogCritical(exception, "Failed to persist audit event {RequestId}; the business operation may already be committed and will not be acknowledged as successful.", context.TraceIdentifier);
                bufferedBody.SetLength(0);
                bufferedBody.Position = 0;
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                context.Response.ContentType = "application/json; charset=utf-8";
                context.Response.ContentLength = null;
                context.Response.Headers.Remove("Location");
                await JsonSerializer.SerializeAsync(
                    bufferedBody,
                    new ApiErrorDto(
                        "audit.persistence_failed",
                        "errors.system.unexpected",
                        "The operation may have completed, but its audit record could not be persisted. Use the request ID before retrying.",
                        null,
                        false,
                        context.TraceIdentifier),
                    AppJsonContext.Default.ApiErrorDto,
                    context.RequestAborted);
            }
        }
        bufferedBody.Position = 0;
        await bufferedBody.CopyToAsync(responseBody);
    }
    finally
    {
        context.Response.Body = responseBody;
        if (configChange) auditEvents.ConfigurationGate.Release();
    }
});

if (app.Environment.IsDevelopment()) app.MapOpenApi();

var api = app.MapGroup("/api");
api.MapBackups(CurrentUser);
api.MapFeedback(CurrentUser);
api.MapMyOrganization(CurrentUser);
api.MapEmail(CurrentUser);
api.MapOutboundProxy(CurrentUser);
api.MapOidc(CurrentUser);
api.MapGet("/portals/{portal}", (string portal, string? locale, HttpContext context, RuntimeSettingsStore settings) => {
    if (portal is not ("customer" or "admin" or "profile" or "backups")) return Results.NotFound();
    var language = locale == "en-US" ? "en-US" : "zh-CN";
    context.Response.Headers.CacheControl = "no-store";
    var destination = settings.PortalUrl(portal is "admin" or "backups", context.Request.Host.Host, language, context.Connection.LocalPort);
    return Results.Redirect(portal switch { "profile" => destination[..^6] + "/profile", "backups" => destination[..^9] + "/settings/backups", _ => destination });
});
api.MapDeliveryEndpoints(dataDirectory);
api.MapHelpEndpoints();
api.MapAuditTools(CurrentUser);
api.MapGet("/admin/runtime-health", (HttpContext c, RuntimeMonitor monitor) =>
{
    var user = CurrentUser(c);
    if (user is null) return Results.Unauthorized();
    if (!Can(user, "admin.runtime.manage")) return Results.Forbid();
    c.Response.Headers.CacheControl = "no-store";
    return Results.Ok(monitor.Snapshot);
});

api.MapGet("/health", () => TypedResults.Ok(new HealthDto("ok")));
api.MapGet("/auth/status", (UserRepository accounts) => Results.Ok(new AuthStatusDto(accounts.RequiresBootstrap())));
api.MapGet("/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
    Results.Ok(new CsrfTokenDto(antiforgery.GetAndStoreTokens(context).RequestToken!)));
api.MapPost("/auth/bootstrap", async (BootstrapAccountRequest? request, HttpContext context, UserRepository accounts) =>
{
    if (!IsLoopbackRequest(context))
        return Error(context, 403, "auth.bootstrap_local_only", "errors.auth.bootstrapLocalOnly", "Initial setup must be completed from the server itself.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var result = accounts.CreateOwner(request.DisplayName, request.Email, request.Password, request.Phone, request.OrganizationName, request.Locale);
    if (result.Outcome == AccountCreateOutcome.AlreadyInitialized)
        return Error(context, 409, "auth.already_initialized", "errors.auth.alreadyInitialized", "The platform owner account already exists.", false);
    if (result.Outcome == AccountCreateOutcome.Invalid)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false,
            [new FieldErrorDto(result.Field ?? "request", "invalid", $"errors.auth.fields.{result.Field ?? "request"}")]);
    if(!await SignIn(context, result.User!, false))return Results.Unauthorized();
    context.RequestServices.GetRequiredService<UserPresenceRepository>().Login(result.User!.Id);
    return Results.Ok(result.User);
}).RequireRateLimiting("authentication");
api.MapPost("/auth/login", async (LoginRequest? request, HttpContext context, UserRepository accounts) =>
{
    if (request is null || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        return Error(context, 400, "auth.invalid_credentials", "errors.auth.invalidCredentials", "The email or password is incorrect.", false);
    var result = accounts.Authenticate(request.Email, request.Password);
    if (result.Outcome != AccountLoginOutcome.Success)
        return Error(context, 401, "auth.invalid_credentials", "errors.auth.invalidCredentials", "The email or password is incorrect.", false);
    if(!await SignIn(context, result.User!, request.RememberMe))return Results.Unauthorized();
    context.RequestServices.GetRequiredService<UserPresenceRepository>().Login(result.User!.Id);
    return Results.Ok(result.User);
}).RequireRateLimiting("authentication");
api.MapPost("/auth/logout", async (HttpContext context) =>
{
    if(CurrentUser(context) is {} departing) context.RequestServices.GetRequiredService<UserPresenceRepository>().EndSession(departing.Id, PresenceSession(context));
    context.RequestServices.GetRequiredService<AccountSwitchStore>().Remove(context);
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
});
api.MapGet("/me/sessions",(HttpContext c,AccountSwitchStore store,int page=1)=>CurrentUser(c) is {} u?Results.Ok(store.Devices(u.Id,c.User.FindFirstValue("lw_login_session")!,Math.Clamp(page,1,100000))):Results.Unauthorized());
api.MapDelete("/me/sessions/{id}",(string id,HttpContext c,AccountSwitchStore store,UserPresenceRepository presence)=>CurrentUser(c) is {} u?(store.Revoke(u.Id,c.User.FindFirstValue("lw_login_session")!,id,presence)?Results.NoContent():Results.Conflict()):Results.Unauthorized());
api.MapPost("/me/sessions/revoke-others",(HttpContext c,AccountSwitchStore store,UserPresenceRepository presence)=>CurrentUser(c) is {} u?(store.Revoke(u.Id,c.User.FindFirstValue("lw_login_session")!,null,presence)?Results.NoContent():Results.Conflict()):Results.Unauthorized());
api.MapPersonalWorkspace(CurrentUser);
api.MapProductivity(CurrentUser);
api.MapGet("/auth/active", (HttpContext c) => CurrentUser(c) is {} u ? Results.Text(u.Id) : Results.Unauthorized());
api.MapGet("/auth/accounts", (HttpContext c, AccountSwitchStore store) => CurrentUser(c) is {} u ? Results.Ok(store.List(c,u)) : Results.Unauthorized());
api.MapPost("/auth/accounts/add", async (LoginRequest? request,HttpContext c,UserRepository users,AccountSwitchStore store) => {
    var current=CurrentUser(c);if(current is null)return Results.Unauthorized();
    if(request is null||string.IsNullOrWhiteSpace(request.Email)||string.IsNullOrEmpty(request.Password))return Results.BadRequest();
    var result=users.Authenticate(request.Email,request.Password);
    if(result.Outcome!=AccountLoginOutcome.Success)return Error(c,401,"auth.invalid_credentials","errors.auth.invalidCredentials","The email or password is incorrect.",false);
    if(!store.HasRoom(c,result.User!.Id,current.Id))return Error(c,409,"auth.account_limit","accountSwitch.limit","Remove an account before adding another.",false);
    var auth=await c.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    store.Remember(c,current,int.Parse(c.User.FindFirstValue("lw_session_version")!,CultureInfo.InvariantCulture),auth.Properties?.ExpiresUtc??DateTimeOffset.UtcNow.AddHours(8),auth.Properties?.IsPersistent==true);
    if(!await SignIn(c,result.User,request.RememberMe))return Results.Unauthorized();
    c.RequestServices.GetRequiredService<UserPresenceRepository>().Login(result.User!.Id);
    return Results.Ok(result.User);
}).RequireRateLimiting("authentication");
api.MapPost("/auth/accounts/switch", async (SwitchAccountRequest request,HttpContext c,UserRepository users,AccountSwitchStore store) => {
    if(CurrentUser(c) is null)return Results.Unauthorized();
    var saved=store.Find(c,request.Id);
    if(saved is null || users.Get(saved.UserId,saved.Version) is not {} user)return Error(c,401,"auth.account_expired","accountSwitch.expired","Sign in to this account again.",false);
    if(!await SignIn(c,user,saved.Persistent,saved.ExpiresAt,saved.Version))return Results.Unauthorized();
    return Results.Ok(user);
}).RequireRateLimiting("authentication");
api.MapDelete("/auth/accounts/{id}",(string id,HttpContext c,AccountSwitchStore store)=>{
    var current=CurrentUser(c);if(current is null)return Results.Unauthorized();
    if(current.Id==id)return Results.Conflict();store.Remove(c,id);return Results.NoContent();
});
api.MapGet("/me", (HttpContext context) =>
{
    var user = CurrentUser(context);
    return user is null
        ? Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false)
        : Results.Ok(user);
});
api.MapPut("/me/profile", async (UpdateProfileRequest? request, HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var result = accounts.UpdateProfile(user.Id, request.DisplayName, request.Phone);
    if (result.Outcome == ProfileUpdateOutcome.NotFound)
        return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (result.Outcome == ProfileUpdateOutcome.Invalid)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The profile details are invalid.", false,
            [new FieldErrorDto(result.Field ?? "request", "invalid", $"errors.auth.fields.{result.Field ?? "request"}")]);
    if (result.User is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    var authentication = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    if(!await SignIn(context, result.User, authentication.Properties?.IsPersistent == true, refreshExisting:true))return Results.Unauthorized();
    return Results.Ok(result.User);
});
api.MapPut("/me/preferences", (UpdatePreferencesRequest? request, HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var result = accounts.UpdatePreferences(user.Id, request.Locale, request.TaskBackgroundMotion);
    if (result.Outcome == ProfileUpdateOutcome.NotFound)
        return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (result.Outcome == ProfileUpdateOutcome.Invalid)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The preferences are invalid.", false,
            [new FieldErrorDto(result.Field ?? "request", "invalid", $"errors.auth.fields.{result.Field ?? "request"}")]);
    return Results.Ok(result.User);
});
api.MapGet("/me/avatar", (HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    context.Response.Headers.CacheControl = "private, no-store";
    var avatar = accounts.OpenAvatar(user.Id);
    if (avatar is not null) return Results.Stream(avatar.Stream, avatar.ContentType);
    return Results.Text(AvatarImage.Create(user.Id, user.DisplayName), "image/svg+xml", Encoding.UTF8);
});
api.MapPost("/me/avatar", async (HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    var sizeFeature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
    if (sizeFeature is { IsReadOnly: false }) sizeFeature.MaxRequestBodySize = 6_000_000;
    if (!context.Request.HasFormContentType) return Error(context, 400, "validation.failed", "errors.validation.failed", "A multipart form is required.", false);
    var form = await context.Request.ReadFormAsync(context.RequestAborted);
    var file = form.Files.GetFile("avatar");
    if (file is null || file.Length is <= 0 or > 5_000_000)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Choose an avatar smaller than 5 MB.", false, [new FieldErrorDto("avatar", "file", "errors.validation.file")]);
    await using var content = new MemoryStream((int)file.Length);
    await file.CopyToAsync(content, context.RequestAborted);
    var extension = DetectAvatarExtension(content.GetBuffer().AsSpan(0, checked((int)content.Length)));
    if (extension is null)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The avatar must be a valid PNG image.", false, [new FieldErrorDto("avatar", "file", "errors.validation.file")]);
    content.Position = 0;
    var updated = await accounts.SaveAvatar(user.Id, content, extension, context.RequestAborted);
    return updated is null
        ? Error(context, 404, "auth.unauthorized", "errors.auth.unauthorized", "The user was not found.", false)
        : Results.Ok(updated);
});
api.MapDelete("/me/avatar", (HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    var updated = accounts.RemoveAvatar(user.Id);
    return updated is null
        ? Error(context, 404, "auth.unauthorized", "errors.auth.unauthorized", "The user was not found.", false)
        : Results.Ok(updated);
});

api.MapPost("/me/password", async (ChangePasswordRequest? request, HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var result = accounts.ChangePassword(user.Id, request.CurrentPassword, request.NewPassword);
    if (result.Outcome == PasswordUpdateOutcome.NotFound) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (result.Outcome == PasswordUpdateOutcome.Invalid)
        return Error(context, 400, "auth.password_invalid", "errors.auth.passwordInvalid", "The current password is incorrect or the new password is invalid.", false,
            [new FieldErrorDto(result.Field ?? "request", "invalid", result.Field == "currentPassword" ? "errors.auth.currentPassword" : "errors.auth.fields.password")]);
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
}).RequireRateLimiting("authentication");

api.MapGet("/announcements/public", (HttpContext context, AnnouncementRepository notices, long? before) => Results.Ok(notices.Feed(null, Locale(context), before)));
api.MapGet("/announcements", (HttpContext context, AnnouncementRepository notices, long? before, bool unread = false) => {
    context.Response.Headers.CacheControl="no-store";
    var user=CurrentUser(context); return user is null ? Results.Unauthorized() : Results.Ok(notices.Feed(user.Id,Locale(context),before,unread));
});
api.MapPost("/announcements/dismiss", (DismissAnnouncementsRequest? request,HttpContext context,AnnouncementRepository notices) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();
    return notices.DismissMany(user.Id,request?.Ids)?Results.NoContent():Results.BadRequest();
});
api.MapPost("/announcements/{id}/dismiss", (string id,HttpContext context,AnnouncementRepository notices) => {
    var user=CurrentUser(context);return user is null?Results.Unauthorized():notices.Dismiss(user.Id,id)?Results.NoContent():Results.NotFound();
});
// Notification APIs always derive the account from the current, revalidated session.
api.MapGet("/notifications", (HttpContext c, NotificationRepository n, long? before, string? search, string? kind, string? state, string? project, string? from, string? to, bool unread=false, bool archived=false) => {
 var u=CurrentUser(c);return u is null?Results.Unauthorized():Results.Ok(n.List(u.Id,Locale(c),before,search,kind,state,project,from,to,unread,archived));
});
api.MapGet("/notifications/{id:long}/target",(long id,HttpContext c,NotificationRepository n,bool admin=false)=>CurrentUser(c) is {} u?(n.Target(u.Id,id,Locale(c),admin) is {} target?Results.Ok(target):Results.NotFound()):Results.Unauthorized());
api.MapGet("/notifications/counts", (HttpContext c,NotificationRepository n)=>CurrentUser(c) is {} u?Results.Ok(n.Counts(u.Id)):Results.Unauthorized());
api.MapPost("/notifications/state",(HttpContext c,NotificationRepository n,NotificationSelection input)=>CurrentUser(c) is {} u?(n.Update(u.Id,input)?Results.NoContent():Results.BadRequest()):Results.Unauthorized());
api.MapGet("/notifications/preferences",(HttpContext c,NotificationRepository n)=>CurrentUser(c) is {} u?Results.Ok(n.Preferences(u.Id)):Results.Unauthorized());
api.MapPut("/notifications/preferences",(HttpContext c,NotificationRepository n,NotificationPreferences input)=>CurrentUser(c) is {} u?(n.SavePreferences(u.Id,input)?Results.Ok(input):Results.BadRequest()):Results.Unauthorized());
api.MapGet("/notifications/catalog",(HttpContext c,NotificationRepository n)=>CurrentUser(c) is not null?Results.Ok(n.Rules()):Results.Unauthorized());
api.MapGet("/notifications/stream",async (HttpContext c,NotificationRepository n,string? account)=>{
 if(CurrentUser(c) is not {} user){c.Response.StatusCode=401;return;}
 if(account is not null&&account!=user.Id){c.Response.StatusCode=409;return;}
 c.Response.ContentType="text/event-stream";c.Response.Headers.CacheControl="no-cache, no-store";
 try{while(!c.RequestAborted.IsCancellationRequested){if(CurrentUser(c) is null)break;var counts=n.Counts(user.Id);await c.Response.WriteAsync("data: "+JsonSerializer.Serialize(counts,AppJsonContext.Default.NotificationCounts)+"\n\n",c.RequestAborted);await c.Response.Body.FlushAsync(c.RequestAborted);await Task.Delay(5000,c.RequestAborted);}}catch(OperationCanceledException){}
});
api.MapGet("/admin/notifications/rules",(HttpContext c,NotificationRepository n)=>CurrentUser(c) is {} u&&Can(u,"admin.config.manage")?Results.Ok(n.Rules()):Results.StatusCode(403));
api.MapPut("/admin/notifications/rules",(HttpContext c,NotificationRepository n,NotificationRule input)=>CurrentUser(c) is {} u&&Can(u,"admin.config.manage")?(n.SaveRule(input)?Results.Ok(n.Rules()):Results.Conflict()):Results.StatusCode(403));
api.MapPut("/admin/notifications/retention",(HttpContext c,NotificationRepository n,NotificationRetention input)=>CurrentUser(c) is {} u&&Can(u,"admin.config.manage")?(n.Retention(input.Days)?Results.NoContent():Results.BadRequest()):Results.StatusCode(403));
api.MapGet("/admin/notifications/logs",(HttpContext c,NotificationRepository n,long? before)=>CurrentUser(c) is {} u&&u.Roles.Contains("owner")?Results.Ok(n.Logs(before)):Results.StatusCode(403));
api.MapPost("/admin/notifications/retry/{id:long}",(long id,HttpContext c,NotificationRepository n)=>CurrentUser(c) is {} u&&u.Roles.Contains("owner")?(n.Retry(id)?Results.NoContent():Results.Conflict()):Results.StatusCode(403));

api.MapGet("/admin/announcements", (HttpContext context,AnnouncementRepository notices,long? before,string? search,string? status,string? placement) => {
    context.Response.Headers.CacheControl="no-store";var user=CurrentUser(context);return user is null?Results.Unauthorized():!Can(user,"admin.config.manage")?Results.Forbid():status is not (null or "" or "draft" or "published" or "withdrawn") || placement is not (null or "" or "login" or "personal") ? Results.BadRequest() : Results.Ok(notices.List(before,search,status,placement));
});
api.MapGet("/admin/announcements/{id}/preview", (string id,long version,HttpContext context,AnnouncementRepository notices) => {
    context.Response.Headers.CacheControl="no-store";var user=CurrentUser(context);if(user is null)return Results.Unauthorized();if(!Can(user,"admin.config.manage"))return Results.Forbid();
    var error=notices.Preview(id,version,out var preview);return error is null?Results.Ok(preview):Error(context,error=="missing"?404:409,"announcement."+error,"announcements.conflict","Announcement changed or was removed.",false);
});
api.MapDelete("/admin/announcements/{id}", (string id,long version,HttpContext context,AnnouncementRepository notices) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();if(!Can(user,"admin.config.manage"))return Results.Forbid();
    var error=notices.DeleteDraft(id,version);return error is null?Results.NoContent():Error(context,error=="missing"?404:409,"announcement."+error,"announcements.conflict","Announcement changed or cannot be deleted.",false);
});
api.MapPut("/admin/announcements/{id}", (string id,AnnouncementInput? input,HttpContext context,AnnouncementRepository notices) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();if(!Can(user,"admin.config.manage"))return Results.Forbid();
    if(!Guid.TryParseExact(id,"N",out _))return Results.BadRequest();
    var error=notices.Save(id,input,out var saved);return error is null?Results.Ok(saved):Error(context,error=="conflict"?409:400,"announcement."+error,error=="conflict"?"announcements.conflict":"announcements.invalid","Invalid announcement or stale version.",false);
});
api.MapPost("/admin/announcements/{id}/{action}", (string id,string action,AnnouncementVersion input,HttpContext context,AnnouncementRepository notices) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();if(!Can(user,"admin.config.manage"))return Results.Forbid();
    if(action is not ("publish" or "withdraw"))return Results.NotFound();
    var error=notices.Transition(id,input.Version,action=="publish",out var saved);return error is null?Results.Ok(saved):Error(context,error=="conflict"?409:error=="missing"?404:400,"announcement."+error,error=="conflict"?"announcements.conflict":"announcements.invalid","Invalid announcement or stale version.",false);
});

api.MapGet("/form-options", (HttpContext context, FormOptionRepository options, FileCategoryRepository categories, BookRecognitionService recognition) =>
{
    var locale = Locale(context);
    return Results.Ok(options.ForLocale(locale) with
    {
        BookRecognitionEnabled = recognition.Enabled,
        SourceCategories = categories.ForLocale(FileCategoryScopes.Source, locale),
        ReferenceCategories = categories.ForLocale(FileCategoryScopes.Reference, locale)
    });
});

api.MapGet("/admin/ai-settings", (HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Ok(settings.Get(Locale(context)));
});
api.MapPut("/admin/ai-settings", (UpdateAiSettingsRequest? request, HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    if (request is null || !settings.Save(request)) return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid AI settings.", false);
    return Results.Ok(settings.Get(Locale(context)));
});

api.MapPost("/admin/ai-settings/providers", (UpsertAiProviderRequest? request, HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    if (request is null || !settings.Upsert(request)) return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid provider settings.", false);
    return Results.Ok(settings.Get(Locale(context)));
});
api.MapPut("/admin/ai-settings/active", (SelectAiProviderRequest? request, HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    if (request is null || !settings.Select(request.ProviderId)) return Error(context, 400, "validation.failed", "errors.validation.failed", "Provider is not configured.", false);
    return Results.Ok(settings.Get(Locale(context)));
});
api.MapPut("/admin/ai-settings/bindings", (UpdateAiBindingRequest? request, HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    if (request is null || !settings.Bind(request)) return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid AI feature settings.", false);
    return Results.Ok(settings.Get(Locale(context)));
});
api.MapDelete("/admin/ai-settings/providers/{id}", (string id, HttpContext context, BookRecognitionSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    if (!settings.Remove(id)) return Error(context, 400, "validation.failed", "errors.validation.failed", "Switch or disable the active provider before deleting it.", false);
    return Results.Ok(settings.Get(Locale(context)));
});

api.MapGet("/admin/runtime-settings", (HttpContext context, RuntimeSettingsStore settings, RuntimeLifecycle lifecycle) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    return Results.Ok(settings.Get(lifecycle.CanRestart, true));
});

api.MapPut("/admin/runtime-settings", (UpdateRuntimeSettingsRequest? request, HttpContext context, RuntimeSettingsStore settings, RuntimeLifecycle lifecycle) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    if (!settings.Save(request.Scheme, request.ListenAddress, request.Port, request.Customer, request.Admin, out var field))
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The listening settings are invalid.", false,
            [new FieldErrorDto(field ?? "request", "invalid", "errors.validation.invalid")]);
    return Results.Ok(settings.Get(lifecycle.CanRestart, true));
});

api.MapPost("/admin/runtime-actions/restart", (HttpContext context, RuntimeLifecycle lifecycle, RuntimeSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    if (settings.ExternalFrontends || !lifecycle.RequestRestart()) return Error(context, 409, "runtime.action_unavailable", "errors.admin.runtimeActionUnavailable", "The platform cannot restart itself in the current process mode, or another stop action is already running.", false);
    return Results.Accepted(value: new RuntimeActionDto("restart", DateTimeOffset.UtcNow));
});

api.MapPost("/admin/runtime-actions/shutdown", (HttpContext context, RuntimeLifecycle lifecycle, RuntimeSettingsStore settings) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.runtime.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Platform owner permission is required.", false);
    if (settings.ExternalFrontends || !lifecycle.RequestShutdown()) return Error(context, 409, "runtime.action_unavailable", "errors.admin.runtimeActionUnavailable", "Another stop action is already running.", false);
    return Results.Accepted(value: new RuntimeActionDto("shutdown", DateTimeOffset.UtcNow));
});

// Export records its audit before streaming; other admin responses use the buffered audit middleware.
api.MapPost("/admin/projects/{id}/export", async (string id, HttpContext context, AdminRepository admin, ProjectRepository projects, StorageQuota quota) =>
{
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in required.",false);
    if(!Can(user,"admin.projects.export"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Export permission required.",false);
    var detail=admin.GetProject(id,user.Id);
    if(detail is null)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    FileStream? archive=null;
    try
    {
        var files=ProjectExport.Attachments(dataDirectory,detail);
        await using var reservation=await quota.TryReserveAsync(files.Sum(x=>x.Size)+10_000_000,context.RequestAborted);
        if(reservation is null)return Error(context,507,"storage.quota","errors.storage.quota","Storage full.",true);
        archive=await ProjectExport.Build(dataDirectory,detail.Project,projects.GetSubmissionSnapshotForAdmin(id),files,Locale(context),context.RequestAborted);
        var current=CurrentUser(context);
        if(current is null || !Can(current,"admin.projects.export")) {await archive.DisposeAsync();return Error(context,403,"auth.forbidden","errors.auth.forbidden","Permission changed.",false);}
        var fresh=admin.GetProject(id,current.Id);
        if(fresh is null){await archive.DisposeAsync();return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);}
        if(fresh.Project.Version!=detail.Project.Version || fresh.WorkflowUpdatedAt!=detail.WorkflowUpdatedAt)
        {await archive.DisposeAsync();return Error(context,409,"export.changed","operations.exportChanged","Project changed. Export again.",true);}
        context.RequestAborted.ThrowIfCancellationRequested();
        auditEvents.Record(current,new AuditActionMatch("project.export","project",id),context.TraceIdentifier);
        context.Response.Headers.CacheControl="private, no-store";
        return Results.File(archive,"application/zip",ProjectExport.SafeName(detail.Project.TaskNumber??id)+".zip");
    }
    catch(ProjectExport.ExportTooLargeException){if(archive is not null)await archive.DisposeAsync();return Error(context,413,"export.size","operations.exportTooLarge","Project attachments exceed 1 GB.",false);}
    catch(Exception exception) when(exception is IOException or InvalidDataException){if(archive is not null)await archive.DisposeAsync();return Error(context,409,"export.files","operations.exportFiles","Files are unavailable or changed. Export again.",true);}
    catch {if(archive is not null)await archive.DisposeAsync();throw;}
});

api.MapGet("/admin/workbench", (HttpContext context, OperationsRepository operations, string? queue, string? search, bool mine=false, int page=1, int pageSize=20) =>
{
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in required.",false);
    if(!Can(user,"admin.projects.read"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Read permission required.",false);
    return Results.Ok(operations.Workbench(user.Id,Locale(context),queue,search,mine,Math.Max(1,page),Math.Clamp(pageSize,1,100)));
});
api.MapGet("/admin/projects/{id}/followup", (string id,HttpContext context,OperationsRepository operations) =>
{
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in required.",false);
    if(!Can(user,"admin.projects.read"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Read permission required.",false);
    var result=operations.GetFollowup(id,user.Id);
    return result is null?Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false):Results.Ok(result);
});
api.MapPut("/admin/projects/{id}/followup", (string id,UpdateFollowupRequest request,HttpContext context,OperationsRepository operations) =>
{
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in required.",false);
    if(!Can(user,"admin.projects.workflow"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Workflow permission required.",false);
    var result=operations.SetFollowup(id,user.Id,request);
    return result.Outcome switch {
        AdminWriteOutcome.Saved=>Results.Ok(operations.GetFollowup(id,user.Id)),
        AdminWriteOutcome.NotFound=>Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false),
        AdminWriteOutcome.Conflict=>Error(context,409,"followup.conflict","operations.conflict","Follow-up changed. Refresh and retry.",true),
        _=>Error(context,400,"followup.invalid","operations.invalidDeadline","Choose a valid follow-up time for an active project.",false)
    };
});

api.MapGet("/admin/overview", (HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.overview.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.GetOverview());
});

api.MapGet("/admin/overview/analytics", (HttpContext context, AdminAnalyticsRepository analytics, int days = 30, string? timeZone = null) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.overview.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Overview permission is required.", false);
    if (days is not (7 or 30 or 90) || string.IsNullOrWhiteSpace(timeZone) || timeZone.Length > 100)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid analytics range.", false);
    TimeZoneInfo zone;
    try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone); }
    catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
    { return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid time zone.", false); }
    context.Response.Headers.CacheControl = "private, no-store";
    return Results.Ok(analytics.Get(days, zone));
});

api.MapGet("/admin/audit-actions", (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.audit.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(AuditActionCatalog.ForLocale(Locale(context)));
});

api.MapGet("/admin/audit-events", (HttpContext context, AuditRepository audit, string? search, string? actionId, string? from, string? to, int page = 1, int pageSize = 30) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.audit.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    context.Response.Headers.CacheControl = "no-store";
    var result = audit.List(search, actionId, from, to, Math.Max(1, page), Math.Clamp(pageSize, 1, 100));
    return Results.Ok(result with { Items = result.Items.Select(audit.Present).ToArray() });
});

api.MapGet("/admin/audit-avatar/{actorId}", (string actorId, string? name, HttpContext context, UserRepository accounts) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.audit.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    context.Response.Headers.CacheControl = "private, no-store";
    var avatar = accounts.OpenAvatar(actorId);
    if (avatar is not null) return Results.Stream(avatar.Stream, avatar.ContentType);
    return Results.Text(AvatarImage.Create(actorId, string.IsNullOrWhiteSpace(name) ? "?" : name), "image/svg+xml", Encoding.UTF8);
});

api.MapGet("/admin/roles", (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "User management permission is required.", false);
    var zh = Locale(context) == "zh-CN";
    return Results.Ok(new ConfigOptionDto[] {
        new("owner", zh ? "平台负责人" : "Platform owner"),
        new("admin", zh ? "管理员" : "Administrator"),
        new("operator", zh ? "运营人员" : "Operations staff"),
        new("customer", zh ? "客户" : "Customer")
    });
});

api.MapGet("/admin/users", (HttpContext context, UserPresenceRepository presence, string? search, string? role, string? status, string? organization, string? enabled, DateTimeOffset? todayStart, int page = 1, int pageSize = 20, bool assignableOnly = false) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if(status is not (null or "" or "online" or "away" or "offline") || enabled is not (null or "" or "enabled" or "disabled") || search?.Length>200 || organization?.Length>64 || (todayStart is {} start && (start<DateTimeOffset.UtcNow.AddHours(-26) || start>DateTimeOffset.UtcNow.AddMinutes(1)))) return Results.BadRequest();
    context.Response.Headers.CacheControl="no-store";
    return Results.Ok(presence.List(search, role, status, organization, enabled, Math.Max(1, page), Math.Clamp(pageSize, 1, 100),todayStart??new DateTimeOffset(DateTime.UtcNow.Date,TimeSpan.Zero),assignableOnly));
});

api.MapGet("/admin/users/{id}/details", (string id,HttpContext context,UserPresenceRepository presence) => {
    var user=CurrentUser(context);
    if(user is null)return Results.Unauthorized();
    if(!Can(user,"admin.users.manage"))return Results.Forbid();
    context.Response.Headers.CacheControl="no-store";
    return presence.Details(id) is {} details?Results.Ok(details):Results.NotFound();
});
api.MapPost("/me/presence", (PresenceHeartbeatRequest? request,HttpContext context,UserPresenceRepository presence) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();
    if(request is null || !Guid.TryParseExact(request.TabId,"D",out _))return Results.BadRequest();
    var version=int.Parse(context.User.FindFirstValue("lw_session_version")!,CultureInfo.InvariantCulture);
    return presence.Heartbeat(user.Id,PresenceSession(context),version,request)?Results.NoContent():Results.StatusCode(429);
}).RequireRateLimiting("presence");
api.MapDelete("/me/presence", (string tabId,HttpContext context,UserPresenceRepository presence) => {
    var user=CurrentUser(context);if(user is null)return Results.Unauthorized();
    if(!Guid.TryParseExact(tabId,"D",out _))return Results.BadRequest();
    presence.LeaveTab(user.Id,PresenceSession(context),tabId);return Results.NoContent();
}).RequireRateLimiting("presence");

api.MapGet("/admin/users/{id}/avatar", (string id, HttpContext context, AdminRepository admin, UserRepository accounts) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var user = admin.GetUser(id);
    if (user is null) return Error(context, 404, "admin.user_not_found", "errors.admin.userNotFound", "The user was not found.", false);
    context.Response.Headers.CacheControl = "private, no-store";
    var avatar = accounts.OpenAvatar(id);
    if (avatar is not null) return Results.Stream(avatar.Stream, avatar.ContentType);
    return Results.Text(AvatarImage.Create(user.Id, user.DisplayName), "image/svg+xml", Encoding.UTF8);
});

api.MapGet("/admin/assignees", (HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.assign")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListAssignees());
});

api.MapPost("/admin/users", (CreateUserRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.CreateUser(request, out var created);
    if (result.Outcome == AdminWriteOutcome.Saved && created is not null)
        context.Items[AuditActionCatalog.TargetIdItemKey] = created.Id;
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(created),
        AdminWriteOutcome.Conflict => Error(context, 409, "user.email_exists", "errors.admin.emailExists", "An account already uses this email.", false, [new FieldErrorDto("email", "duplicate", "errors.admin.emailExists")]),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapGet("/admin/users/{id}/closure", (string id,HttpContext context,AccountClosureRepository closure) => {
    var actor=CurrentUser(context);if(actor is null)return Results.Unauthorized();
    if(!Can(actor,"admin.users.manage"))return Results.Forbid();
    context.Response.Headers.CacheControl="no-store";
    return closure.Preview(id) is {} preview?Results.Ok(preview):Results.NotFound();
});
api.MapDelete("/admin/users/{id}", (string id,[Microsoft.AspNetCore.Mvc.FromBody] CloseAccountRequest? request,HttpContext context,AccountClosureRepository closure,UserRepository accounts) => {
    var actor=CurrentUser(context);if(actor is null)return Results.Unauthorized();
    if(!Can(actor,"admin.users.manage"))return Results.Forbid();
    var result=closure.Close(id,actor.Id,request,out var avatar);
    if(result.Outcome==AdminWriteOutcome.Saved){accounts.CleanupClosedAvatar(avatar);return Results.NoContent();}
    return result.Outcome switch {
        AdminWriteOutcome.NotFound=>Error(context,404,"user.not_found","errors.admin.userNotFound","The user was not found.",false),
        AdminWriteOutcome.Protected=>Error(context,409,"user.close_protected","accountClosure.protected","The owner and current account cannot be closed.",false),
        AdminWriteOutcome.Conflict=>Error(context,409,"user.close_conflict","accountClosure.conflict","The account changed. Review it again.",true),
        _=>Error(context,400,"user.close_invalid","accountClosure.invalid","Enter the account email to confirm.",false)
    };
});

api.MapPut("/admin/users/{id}", (string id, UpdateUserRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if (id == current.Id && request is { Active: false }) return Error(context, 409, "user.self_deactivate", "errors.admin.selfDeactivate", "You cannot deactivate your own account.", false);
    var result = admin.UpdateUser(id, request, out var updated, current.Id);
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(updated),
        AdminWriteOutcome.NotFound => Error(context, 404, "user.not_found", "errors.admin.userNotFound", "The user was not found.", false),
        AdminWriteOutcome.Protected => Error(context, 409, "user.owner_protected", "errors.admin.ownerProtected", "The owner account cannot be changed here.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});


api.MapPut("/admin/users/{id}/password", (string id, ResetPasswordRequest? request, HttpContext context, UserRepository accounts, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var target = admin.GetUser(id);
    if (target is null) return Error(context, 404, "user.not_found", "errors.admin.userNotFound", "The user was not found.", false);
    if (target.Role == "owner") return Error(context, 409, "user.owner_protected", "errors.admin.ownerProtected", "The owner password can only be changed by the owner.", false);
    var result = accounts.ResetPassword(id, request.NewPassword);
    return result.Outcome switch
    {
        PasswordUpdateOutcome.Updated => Results.NoContent(),
        PasswordUpdateOutcome.NotFound => Error(context, 404, "user.not_found", "errors.admin.userNotFound", "The user was not found.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The password is invalid.", false,
            [new FieldErrorDto(result.Field ?? "newPassword", "invalid", "errors.auth.fields.password")])
    };
});
api.MapGet("/admin/projects", (HttpContext context, AdminRepository admin, string? workflowStatus, string? priority, string? search, int page = 1, int pageSize = 20) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListProjects(workflowStatus, priority, search, Math.Max(1, page), Math.Clamp(pageSize, 1, 100), user.Id));
});

api.MapGet("/admin/projects/{id}", (string id, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var project = admin.GetProject(id, user.Id);
    return project is null ? Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false) : Results.Ok(project);
});

api.MapGet("/projects/{id}/revision-avatar/{messageId}", (string id,string messageId,HttpContext context,RevisionStore store,UserRepository accounts, AdminRepository admin, ProjectRepository projects) => {
    var user=CurrentUser(context);
    if(user is null || ((projects.GetVisible(user.Id,id) is null || !Can(user,"tasks.read")) && (!Can(user,"admin.projects.read") || admin.GetProject(id,user.Id) is null)))return Results.NotFound();
    var actor=store.MessageAuthor(id,messageId);if(actor is null)return Results.NotFound();
    context.Response.Headers.CacheControl="private, no-store";
    var avatar=accounts.OpenAvatar(actor);
    return avatar is null?Results.Text(AvatarImage.Create(actor,"?"),"image/svg+xml",Encoding.UTF8):Results.Stream(avatar.Stream,avatar.ContentType);
});
api.MapGet("/projects/{id}/revisions", (string id, HttpContext context, RevisionStore store, ProjectRepository projects) => {
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in required.",false);
    var visible = Can(user,"tasks.read") ? projects.GetVisible(user.Id,id) : null;
    if(visible is null)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    return Results.Ok(store.View(id,false,Locale(context)) with { CanEdit = visible.CanEdit });
});
api.MapGet("/admin/projects/{id}/revisions", (string id, HttpContext context, RevisionStore store, AdminRepository admin, int page=1) => {
    var user=CurrentUser(context);
    if(user is null || !Can(user,"admin.projects.read"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Permission required.",false);
    if(admin.GetProject(id, user.Id) is null)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    return Results.Ok(store.View(id,true,Locale(context),page));
});
api.MapPost("/admin/projects/{id}/return", (string id, ReturnProjectRequest request, HttpContext context, RevisionStore store, AdminRepository admin) => {
    var user=CurrentUser(context);
    if(user is null || !Can(user,"admin.projects.return"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Permission required.",false);
    if(admin.GetProject(id, user.Id) is null)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    return store.Return(id,request,user,user.Id)?Results.Ok(store.View(id,true,Locale(context))):Error(context,409,"project.workflow_conflict","errors.project.workflowConflict","Return request is invalid or project changed.",true);
});
api.MapPost("/projects/{id}/revisions/{round}/messages", (string id,string round,RevisionReplyRequest request,HttpContext context,RevisionStore store) => {
    var user=CurrentUser(context);
    if(user is null || !Can(user,"tasks.write"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Permission required.",false);
    if(store.Owner(id)!=user.Id)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    return store.Reply(id,round,request,user,false)?Results.Ok(store.View(id,false,Locale(context))):Error(context,409,"validation.failed","errors.validation.failed","Message could not be sent.",true);
});
api.MapPost("/admin/projects/{id}/revisions/{round}/messages", (string id,string round,RevisionReplyRequest request,HttpContext context,RevisionStore store, AdminRepository admin) => {
    var user=CurrentUser(context);
    if(user is null || !Can(user,"admin.projects.reply"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Permission required.",false);
    if(admin.GetProject(id, user.Id) is null)return Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    return store.Reply(id,round,request,user,true,user.Id)?Results.Ok(store.View(id,true,Locale(context))):Error(context,409,"validation.failed","errors.validation.failed","Message could not be sent.",true);
});

api.MapPut("/admin/projects/{id}/workflow", (string id, UpdateProjectWorkflowRequest? request, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.workflow")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.UpdateWorkflow(id, request, user.Id, user.Id, Can(user, "admin.projects.assign"));
    if (result.Outcome == AdminWriteOutcome.Protected) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Assignment permission is required.", false);
    if (result.Outcome == AdminWriteOutcome.NotFound) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (result.Outcome == AdminWriteOutcome.Conflict) return Error(context, 409, "project.workflow_conflict", "errors.project.workflowConflict", "The workflow was changed by another administrator. Reload and try again.", true);
    if (result.Outcome != AdminWriteOutcome.Saved) return Error(context, 400, "validation.failed", "errors.validation.failed", "The workflow values are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")]);
    return Results.Ok(admin.GetProject(id, user.Id));
});

api.MapPost("/admin/projects/{id}/notes", (string id, AddAdminNoteRequest? request, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.note")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.AddNote(id, user.Id, request, out var note, user.Id);
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(note),
        AdminWriteOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The note is invalid.", false, [new FieldErrorDto(result.Field ?? "body", "invalid", "errors.validation.invalid")])
    };
});

api.MapGet("/admin/projects/{id}/files/{fileId}", (string id, string fileId, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var detail = admin.GetProject(id, user.Id);
    var asset = detail is null ? null : (AllProjectAssets(detail.Project).FirstOrDefault(item => item.Id == fileId) ?? revisions.HistoryAsset(id, fileId));
    if (detail is null || asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var folder = Path.Combine(dataDirectory, "uploads", detail.OwnerId, id);
    var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").Where(IsStoredFile).SingleOrDefault() : null;
    if (path is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    return asset.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
        ? Results.File(path, asset.ContentType, enableRangeProcessing: true)
        : Results.File(path, asset.ContentType, asset.FileName, enableRangeProcessing: true);
});

api.MapGet("/admin/file-content-types", (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(UploadContentTypes.All.Order(StringComparer.Ordinal).ToArray());
});

api.MapGet("/admin/file-categories/{scope}", (string scope, HttpContext context, FileCategoryRepository categories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return FileCategoryScopes.All.Contains(scope)
        ? Results.Ok(categories.ListAdmin(scope))
        : Error(context, 404, "config.group_not_found", "errors.http.notFound", "The file category scope was not found.", false);
});

api.MapPut("/admin/file-categories/{scope}/{id}", (string scope, string id, UpsertFileCategoryRequest? request, HttpContext context, FileCategoryRepository categories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if (!FileCategoryScopes.All.Contains(scope)) return Error(context, 404, "config.group_not_found", "errors.http.notFound", "The file category scope was not found.", false);
    var result = categories.Upsert(scope, id, request, out var saved);
    return result.Outcome switch
    {
        FileCategoryWriteOutcome.Saved => Results.Ok(saved),
        FileCategoryWriteOutcome.Conflict => Error(context, 409, "config.version_conflict", "admin.formOptions.conflict", "This category changed elsewhere. Reload it before saving.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The file category is invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapDelete("/admin/file-categories/{scope}/{id}", (string scope, string id, DateTimeOffset? expectedUpdatedAt, HttpContext context, FileCategoryRepository categories) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    var error = categories.Remove(scope, id, expectedUpdatedAt);
    return error is null ? Results.NoContent() : Error(context, error == "missing" ? 404 : 409, "config." + error, "admin.configRemoval." + error, "Could not delete configuration.", false);
});

api.MapDelete("/admin/character-presets/{id}", (string id, string? expectedUpdatedAt, HttpContext context, CharacterPresetRepository presets) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    var error = presets.Remove(id, expectedUpdatedAt);
    return error is null ? Results.NoContent() : Error(context, error == "missing" ? 404 : 409, "config." + error, "admin.configRemoval." + error, "Could not delete configuration.", false);
});

api.MapDelete("/admin/voices/{id}", async (string id, string? expectedUpdatedAt, HttpContext context, VoiceReferenceRepository voices) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        var error = voices.Remove(id, expectedUpdatedAt);
        return error is null ? Results.NoContent() : Error(context, error == "missing" ? 404 : 409, "config." + error, "admin.configRemoval." + error, "Could not delete configuration.", false);
    }
    finally { gate.Release(); }
});

api.MapGet("/admin/form-option-groups", (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(FormOptionNavigation.ForLocale(Locale(context)));
});

api.MapGet("/admin/form-options/{groupId}", (string groupId, HttpContext context, FormOptionRepository options) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return FormOptionGroups.Configurable.Contains(groupId)
        ? Results.Ok(options.ListAdmin(groupId))
        : Error(context, 404, "config.group_not_found", "errors.http.notFound", "The configuration group was not found.", false);
});

api.MapPut("/admin/form-options/{groupId}/{id}", (string groupId, string id, UpsertFormOptionRequest? request, HttpContext context, FormOptionRepository options) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if (!FormOptionGroups.Configurable.Contains(groupId))
        return Error(context, 404, "config.group_not_found", "errors.http.notFound", "The configuration group was not found.", false);
    var result = options.Upsert(groupId, id, request, out var saved);
    return result.Outcome switch
    {
        FormOptionWriteOutcome.Saved => Results.Ok(saved),
        FormOptionWriteOutcome.Conflict => Error(context, 409, "config.version_conflict", "admin.formOptions.conflict", "This option changed elsewhere. Reload it before saving.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The form option is invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapDelete("/admin/form-options/{groupId}/{id}", (string groupId, string id, DateTimeOffset? expectedUpdatedAt, HttpContext context, FormOptionRepository options) =>
{
    var user=CurrentUser(context);
    if(user is null || !Can(user,"admin.config.manage")) return Error(context,user is null?401:403,"auth.forbidden","errors.auth.forbidden","Configuration permission is required.",false);
    var error=options.Remove(groupId,id,expectedUpdatedAt);
    return error is null ? Results.NoContent() : Error(context,error=="missing"?404:409,"config."+error,"admin.formOptions.remove"+char.ToUpperInvariant(error[0])+error[1..],"The option could not be removed.",false);
});

api.MapGet("/admin/character-presets", (HttpContext context, CharacterPresetRepository presets) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    return Results.Ok(presets.List());
});
api.MapPut("/admin/character-presets/{id}", (string id, UpsertCharacterPresetRequest? request, HttpContext context, CharacterPresetRepository presets, FormOptionRepository options) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    var error = presets.Save(id, request, options, out var saved);
    return error is null ? Results.Ok(saved) : Error(context, error == "conflict" ? 409 : 400, "preset." + error, "admin.presets." + error, "Could not save character preset.", false);
});
api.MapPost("/admin/character-presets/{id}/image", async (string id, HttpContext context, CharacterPresetRepository presets, StorageQuota storageQuota) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.config.manage")) return Error(context, user is null ? 401 : 403, "auth.forbidden", "errors.auth.forbidden", "Configuration permission is required.", false);
    if (!context.Request.HasFormContentType) return Error(context, 400, "preset.image", "admin.presets.imageInvalid", "Select a JPG, PNG or WebP image under 5 MB.", false);
    var form = await context.Request.ReadFormAsync(context.RequestAborted);
    var file = form.Files.GetFile("file");
    var contentType = file is null ? null : NormalizeContentType(file.ContentType, file.FileName);
    if (file is null || file.Length is <= 0 or > 5000000 || contentType is not ("image/jpeg" or "image/png" or "image/webp") || !await HasExpectedSignature(file, contentType, context.RequestAborted))
        return Error(context, 400, "preset.image", "admin.presets.imageInvalid", "Select a JPG, PNG or WebP image under 5 MB.", false);
    await using var reservation = await storageQuota.TryReserveAsync(file.Length, context.RequestAborted);
    if (reservation is null) return Error(context, 507, "storage.quota", "errors.storage.quota", "Storage capacity has been reached.", true);
    var directory = Path.Combine(dataDirectory, "character-preset-images"); Directory.CreateDirectory(directory);
    var name = Guid.NewGuid().ToString("N") + (contentType == "image/png" ? ".png" : contentType == "image/webp" ? ".webp" : ".jpg");
    var target = Path.Combine(directory, name);
    try
    {
        await using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None)) await file.CopyToAsync(output, context.RequestAborted);
        var error = presets.SetImage(id, form["expectedUpdatedAt"].ToString(), $"/api/character-preset-images/{name}", out var saved);
        if (error is not null) { File.Delete(target); return Error(context, error == "conflict" ? 409 : 404, "preset." + error, "admin.presets." + error, "Could not update preset image.", false); }
        return Results.Ok(saved);
    }
    catch { if (File.Exists(target)) File.Delete(target); throw; }
}).DisableAntiforgery();
api.MapGet("/character-preset-images/{name}", (string name, HttpContext context) =>
{
    if (CurrentUser(context) is null) return Results.Unauthorized();
    if (!System.Text.RegularExpressions.Regex.IsMatch(name, "^[a-f0-9]{32}\\.(png|jpg|webp)$")) return Results.NotFound();
    var path = Path.Combine(dataDirectory, "character-preset-images", name);
    return File.Exists(path) ? Results.File(path, NormalizeContentType("", name)) : Results.NotFound();
});

api.MapGet("/admin/voices", (HttpContext context, VoiceReferenceRepository voices) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(voices.ListAdmin());
});

api.MapPut("/admin/voices/{id}", async (string id, UpsertVoiceReferenceRequest? request, HttpContext context, VoiceReferenceRepository voices, FormOptionRepository options) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        var result = voices.Upsert(id, request, options.EnabledIds(FormOptionGroups.VoiceTags), out var saved);
        return result.Outcome switch
        {
            VoiceWriteOutcome.Saved => Results.Ok(saved),
            VoiceWriteOutcome.Conflict => Error(context, 409, "voice.conflict", "admin.voices.conflict", "This voice reference changed elsewhere. Reload and try again.", false),
            _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The voice reference is invalid.", false,
                [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
        };
    }
    finally { gate.Release(); }
});

// Form endpoint metadata is disabled because the global unsafe-method middleware validates CSRF before route execution.
api.MapPost("/admin/voices/{id}/sample", async (string id, HttpContext context, VoiceReferenceRepository voices, StorageQuota storageQuota) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        if (!voices.Exists(id)) return Error(context, 404, "voice.not_found", "errors.http.notFound", "The voice reference was not found.", false);
        if (!context.Request.HasFormContentType) return Error(context, 400, "validation.failed", "errors.validation.failed", "A multipart form is required.", false);
        var form = await context.Request.ReadFormAsync(context.RequestAborted);
        var file = form.Files.GetFile("file");
        if (file is null || file.Length <= 0 || file.Length > 20_000_000)
            return Error(context, 400, "validation.audio", "errors.validation.file", "Choose a WAV or MP3 file up to 20 MB.", false);
        var contentType = NormalizeAudioContentType(file.ContentType, file.FileName);
        if (contentType is null || !await HasExpectedAudioSignature(file, contentType, context.RequestAborted))
            return Error(context, 400, "validation.audio", "errors.validation.file", "Choose a valid WAV or MP3 audio file.", false);
        var existingBytes = new[] { Path.Combine(voiceSampleDirectory, id + ".wav"), Path.Combine(voiceSampleDirectory, id + ".mp3") }
            .Where(File.Exists).Sum(path => new FileInfo(path).Length);
        await using var reservation = await storageQuota.TryReserveAsync(Math.Max(0, file.Length - existingBytes), context.RequestAborted);
        if (reservation is null)
            return Error(context, 507, "storage.quota", "errors.storage.quota", "Storage capacity has been reached. Contact an administrator.", true);
        var extension = contentType == "audio/wav" ? ".wav" : ".mp3";
        var target = Path.Combine(voiceSampleDirectory, id + extension);
        var temporary = Path.Combine(voiceSampleDirectory, id + "." + Guid.NewGuid().ToString("N") + ".upload");
        var staged = new List<(string Original, string Backup)>();
        var installed = false;
        var stateUpdated = false;
        try
        {
            await using (var output = File.Create(temporary))
                await file.CopyToAsync(output, context.RequestAborted);
            staged = StageVoiceSamples(voiceSampleDirectory, id);
            File.Move(temporary, target, true);
            installed = true;
            if (!voices.SetAudioAvailable(id, true, out var updated))
            {
                File.Delete(target);
                installed = false;
                RestoreVoiceSamples(staged);
                return Error(context, 404, "voice.not_found", "errors.http.notFound", "The voice reference was not found.", false);
            }
            stateUpdated = true;
            DeleteVoiceSampleBackups(staged);
            return Results.Ok(updated);
        }
        catch
        {
            if (!stateUpdated)
            {
                if (installed && File.Exists(target)) File.Delete(target);
                RestoreVoiceSamples(staged);
            }
            throw;
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
    finally { gate.Release(); }
}).DisableAntiforgery();

api.MapDelete("/admin/voices/{id}/sample", async (string id, HttpContext context, VoiceReferenceRepository voices) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.config.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        if (!voices.Exists(id)) return Error(context, 404, "voice.not_found", "errors.http.notFound", "The voice reference was not found.", false);
        var staged = StageVoiceSamples(voiceSampleDirectory, id);
        var stateUpdated = false;
        try
        {
            if (!voices.SetAudioAvailable(id, false, out var updated))
            {
                RestoreVoiceSamples(staged);
                return Error(context, 404, "voice.not_found", "errors.http.notFound", "The voice reference was not found.", false);
            }
            stateUpdated = true;
            DeleteVoiceSampleBackups(staged);
            return Results.Ok(updated);
        }
        catch
        {
            if (!stateUpdated) RestoreVoiceSamples(staged);
            throw;
        }
    }
    finally { gate.Release(); }
});

api.MapGet("/admin/voices/{id}/sample", async (string id, HttpContext context, VoiceReferenceRepository voices) =>
{
    var user = CurrentUser(context);
    if (user is null)
    {
        await Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false).ExecuteAsync(context);
        return;
    }
    if (!Can(user, "admin.config.manage"))
    {
        await Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false).ExecuteAsync(context);
        return;
    }
    if (!voices.Exists(id))
    {
        await Error(context, 404, "voice.not_found", "errors.http.notFound", "The voice reference was not found.", false).ExecuteAsync(context);
        return;
    }
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    (FileStream Stream, string ContentType)? snapshot;
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        snapshot = voices.Exists(id) ? OpenVoiceSampleSnapshot(voiceSampleDirectory, id) : null;
    }
    finally { gate.Release(); }
    if (snapshot is null)
    {
        await Results.NotFound().ExecuteAsync(context);
        return;
    }
    context.Response.Headers.CacheControl = "no-cache";
    await using var sampleStream = snapshot.Value.Stream;
    await Results.Stream(sampleStream, snapshot.Value.ContentType, enableRangeProcessing: true).ExecuteAsync(context);
});
api.MapGet("/voices", (HttpContext context, VoiceReferenceRepository voices) =>
    Results.Ok(voices.ForLocale(Locale(context))));

api.MapGet("/voices/{id}/sample", async (string id, HttpContext context, VoiceReferenceRepository voices) =>
{
    if (!voices.EnabledIds().Contains(id))
    {
        await Results.NotFound().ExecuteAsync(context);
        return;
    }
    var gate = voiceSampleLocks.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
    (FileStream Stream, string ContentType)? snapshot;
    await gate.WaitAsync(context.RequestAborted);
    try
    {
        snapshot = voices.EnabledIds().Contains(id) ? OpenVoiceSampleSnapshot(voiceSampleDirectory, id) : null;
    }
    finally { gate.Release(); }
    if (snapshot is null)
    {
        await Results.NotFound().ExecuteAsync(context);
        return;
    }
    context.Response.Headers.CacheControl = "no-cache";
    await using var sampleStream = snapshot.Value.Stream;
    await Results.Stream(sampleStream, snapshot.Value.ContentType, enableRangeProcessing: true).ExecuteAsync(context);
});
api.MapGet("/projects", (HttpContext context, ProjectRepository projects, string? status, string? search, string? sort, string? direction, string? scope, int page = 1, int pageSize = 10) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    page = Math.Max(1, page);
    pageSize = Math.Clamp(pageSize, 1, 100);
    if (scope is not (null or "personal" or "organization")) return Results.BadRequest();
    return Results.Ok(projects.List(user.Id, status, search, page, pageSize, sort, direction, shared: true, personalOnly: scope == "personal"));
});

api.MapGet("/projects/stats", (HttpContext context, ProjectRepository projects, string? scope) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    if (scope is not (null or "personal" or "organization")) return Results.BadRequest();
    return Results.Ok(projects.GetStats(user.Id, shared: scope != "personal"));
});

api.MapGet("/projects/dashboard", (HttpContext context, CustomerDashboardRepository dashboard, string? month, string? timeZone, string? scope, int day = 1, int page = 1) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    if (!DateTime.TryParseExact(month, "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var start)
        || start.Year < 2000 || start.Year > 2100 || day < 1 || day > DateTime.DaysInMonth(start.Year,start.Month) || string.IsNullOrWhiteSpace(timeZone) || timeZone.Length > 100)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid calendar range.", false);
    TimeZoneInfo zone;
    try { zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone); }
    catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
    { return Error(context, 400, "validation.failed", "errors.validation.failed", "Invalid time zone.", false); }
    context.Response.Headers.CacheControl = "private, no-store";
    if (scope is not (null or "personal" or "organization")) return Results.BadRequest();
    return Results.Ok(dashboard.Get(user.Id, start, zone, day, page, shared: scope == "organization"));
});

api.MapPost("/projects/{id}/copy", async (string id, CopyProjectRequest request, HttpContext context, ProjectRepository projects, PlatformLimits limits) =>
{
    var user=CurrentUser(context);
    if(user is null)return Error(context,401,"auth.unauthorized","errors.auth.unauthorized","Sign in is required.",false);
    if(!Can(user,"tasks.write"))return Error(context,403,"auth.forbidden","errors.auth.forbidden","Write permission is required.",false);
    if(user.Organization is null || string.IsNullOrWhiteSpace(user.Organization.Name))return Error(context,403,"project.organization_required","errors.project.organizationRequired","An organization must be assigned.",false);
    if(request.RequestId==Guid.Empty)return Results.BadRequest();
    await using(await projectWriteLocks.AcquireAsync($"{user.Id}:create",context.RequestAborted)) {
        var result=projects.Copy(user.Id,id,request.RequestId.ToString("N"),limits.MaxDraftsPerUser);
        if(result.Outcome=="limit")return Error(context,409,"project.draft_limit","errors.project.draftLimit","Finish or delete an existing draft.",false);
        if(result.Outcome=="conflict")return Error(context,409,"project.copy_conflict","errors.http.conflict","This request has already been used.",false);
        return result.Draft is {} draft?Results.Ok(draft):Error(context,404,"project.not_found","errors.project.notFound","Project not found.",false);
    }
});

api.MapPost("/projects", async (HttpContext context, ProjectRepository projects, PlatformLimits limits) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    if (user.Organization is null || string.IsNullOrWhiteSpace(user.Organization.Name))
        return Error(context, 403, "project.organization_required", "errors.project.organizationRequired", "An organization must be assigned before creating a project.", false);
    await using (await projectWriteLocks.AcquireAsync($"{user.Id}:create", context.RequestAborted))
    {
        if (projects.CountDrafts(user.Id) >= limits.MaxDraftsPerUser)
            return Error(context, 409, "project.draft_limit", "errors.project.draftLimit", "Finish or delete an existing draft before creating another one.", false);
        return Results.Ok(projects.Create(
            user.Id,
            user.Organization.Name,
            user.DisplayName,
            user.Email ?? "",
            user.Phone, Locale(context)));
    }
});

api.MapGet("/admin/projects/{id}/voices", (string id, HttpContext context, AdminRepository admin, ProjectRepository projects, VoiceReferenceRepository voices) =>
{
    var user = CurrentUser(context);
    if (user is null || !Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Read permission is required.", false);
    var detail = admin.GetProject(id, user.Id);
    if (detail is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "Project not found.", false);
    var selected = detail.Project.VoiceAndReferences.Voiceover;
    var ids = selected.SelectedVoiceIds.Append(selected.PreferredVoiceId).ToHashSet();
    var saved = projects.GetSubmissionSnapshotForAdmin(id)?.Voices ?? [];
    return Results.Ok(saved.Concat(voices.ListAdmin()).DistinctBy(voice => voice.Id).Where(voice => ids.Contains(voice.Id)).ToArray());
});

api.MapGet("/admin/projects/{id}/submission-snapshot", (string id, HttpContext context, ProjectRepository projects, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var snapshot = admin.GetProject(id, user.Id) is null ? null : projects.GetSubmissionSnapshotForAdmin(id);
    return snapshot is null
        ? Error(context, 404, "submission.snapshot_not_found", "errors.http.notFound", "The submission configuration snapshot was not found.", false)
        : Results.Ok(snapshot);
});

api.MapGet("/admin/organizations", (HttpContext context, AdminRepository admin, string? search, int page = 1, int pageSize = 20) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListOrganizations(search, Math.Max(1, page), Math.Clamp(pageSize, 1, 100)));
});

api.MapGet("/admin/organizations/{id}/avatar", (string id, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Results.Unauthorized();
    if (!Can(current, "admin.users.manage")) return Results.StatusCode(403);
    var organization = admin.GetOrganization(id);
    if (organization is null) return Results.NotFound();
    context.Response.Headers.CacheControl = "private, no-store";
    context.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    return Results.Text(AvatarImage.CreateOrganization(organization.Name), "image/svg+xml", Encoding.UTF8);
});

api.MapPost("/admin/organizations", (CreateOrganizationRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.CreateOrganization(request, out var created);
    if (result.Outcome == AdminWriteOutcome.Saved && created is not null) context.Items[AuditActionCatalog.TargetIdItemKey] = created.Id;
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(created),
        AdminWriteOutcome.Conflict => Error(context, 409, "organization.name_exists", "errors.admin.organizationExists", "An organization already uses this name.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The organization details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapPut("/admin/organizations/{id}", (string id, UpdateOrganizationRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.UpdateOrganization(id, request, out var updated);
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(updated),
        AdminWriteOutcome.NotFound => Error(context, 404, "organization.not_found", "errors.admin.organizationNotFound", "The organization was not found.", false),
        AdminWriteOutcome.Conflict => Error(context, 409, "organization.name_exists", "errors.admin.organizationExists", "An organization already uses this name.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The organization details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapGet("/projects/{id}", (string id, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    var project = projects.GetVisible(user.Id, id);
    return project is null
        ? Error(context, 404, "project.not_found", "errors.project.notFound", "The task was not found.", false)
        : Results.Ok(project.Status == "draft" && project.CanEdit ? project with { Project = CreatorInfo.FillMissing(project.Project, user) } : project);
});

api.MapDelete("/projects/{id}", async (string id, int version, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    await using (await projectWriteLocks.AcquireAsync($"{user.Id}:{id}", context.RequestAborted))
    {

    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The project was not found.", false);
    if (current.TaskNumber is not null && current.WorkflowStatus != "awaiting_customer") return Error(context,409,"project.not_editable","errors.project.notEditable","Only returned projects can be deleted.",false);
    if (!current.Status.Equals("draft", StringComparison.Ordinal))
        return Error(context, 409, "project.not_editable", "errors.project.notEditable", "Submitted projects cannot be deleted.", false, currentVersion: current.Version);
    if (current.Version != version)
        return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This draft changed elsewhere. Reload before deleting.", false, currentVersion: current.Version);

    string? stagedUploads;
    try { stagedUploads = StageDraftUploadDeletion(dataDirectory, user.Id, id); }
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Could not stage uploads before deleting draft {ProjectId}", id);
        return Error(context, 500, "system.unexpected", "errors.system.unexpected", "The draft could not be safely deleted. Try again.", true);
    }

    SaveResult result;
    try { result = projects.DeleteDraft(user.Id, id, version); }
    catch
    {
        if (stagedUploads is not null) RestoreDraftUploadDeletion(dataDirectory, user.Id, id, stagedUploads, app.Logger);
        throw;
    }
    if (result.Outcome != SaveOutcome.Saved)
    {
        if (stagedUploads is not null) RestoreDraftUploadDeletion(dataDirectory, user.Id, id, stagedUploads, app.Logger);
        return result.Outcome switch
        {
            SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The project was not found.", false),
            SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "Submitted projects cannot be deleted.", false, currentVersion: result.CurrentVersion),
            _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This draft changed elsewhere. Reload before deleting.", false, currentVersion: result.CurrentVersion)
        };
    }

    if (stagedUploads is not null)
    {
        try { Directory.Delete(stagedUploads, recursive: true); CleanupEmptyDraftUploadTombstoneParents(dataDirectory, stagedUploads); }
        catch (Exception exception) { app.Logger.LogWarning(exception, "Staged uploads for deleted draft {ProjectId} will be cleaned on restart", id); }
    }
    return Results.NoContent();
    }
});

api.MapGet("/projects/{id}/submission-snapshot", (string id, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    var visible = projects.GetVisible(user.Id, id);
    var snapshot = visible is null ? null : projects.GetSubmissionSnapshotForAdmin(id);
    return snapshot is null
        ? Error(context, 404, "submission.snapshot_not_found", "errors.http.notFound", "The submission configuration snapshot was not found.", false)
        : Results.Ok(snapshot);
});
api.MapPost("/projects/{id}/recognize-book", async (string id, BookRecognitionRequest? request, HttpContext context,
    ProjectRepository projects, FormOptionRepository options, BookRecognitionService recognition) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var project = projects.Get(user.Id, id);
    if (project is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The project was not found.", false);
    if (project.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This project is read-only.", false);
    if (!recognition.Enabled) return Error(context, 503, "recognition.disabled", "bookIntake.recognitionDisabled", "Book recognition is not configured.", false);
    if (request?.AssetIds is not { Length: >= 1 and <= BookRecognitionService.MaxImages } ids || ids.Distinct(StringComparer.Ordinal).Count() != ids.Length)
        return Error(context, 400, "recognition.images", "bookIntake.recognitionImages", "Choose between one and six cover photos.", false);
    var assets = (project.Book.SourceAssets ?? []).Where(asset => ids.Contains(asset.Id) && asset.CategoryId == "book-cover").ToArray();
    if (assets.Length != ids.Length || assets.Sum(asset => asset.SizeBytes) > BookRecognitionService.MaxTotalBytes ||
        assets.Any(asset => asset.ContentType is not ("image/jpeg" or "image/png" or "image/webp") || !Guid.TryParseExact(asset.Id, "N", out _)))
        return Error(context, 400, "recognition.images", "bookIntake.recognitionImages", "Invalid cover photos.", false);
    try
    {
        var images = new List<RecognitionImage>();
        // Read only authenticated project uploads, never provider/client-supplied URLs or paths.
        var folder = Path.Combine(dataDirectory, "uploads", user.Id, project.Id);
        foreach (var asset in assets)
        {
            var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{asset.Id}_*").Where(IsStoredFile).SingleOrDefault() : null;
            if (path is null || new FileInfo(path).Length != asset.SizeBytes || asset.SizeBytes > 10_000_000)
                return Error(context, 400, "recognition.images", "bookIntake.recognitionImages", "Cover photo is unavailable.", false);
            images.Add(new(asset.ContentType, await File.ReadAllBytesAsync(path, context.RequestAborted)));
        }
        var bookContext = await BookRecognitionContext.BuildAsync(project.Book, folder, context.RequestAborted);
        var result = await recognition.RecognizeAsync([.. images], options.ForLocale(Locale(context)).Genres, Locale(context), context.RequestAborted, bookContext);
        return Results.Ok(result);
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { return Results.StatusCode(499); }
    catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException or KeyNotFoundException or IndexOutOfRangeException or IOException or OperationCanceledException)
    {
        // Record only the failure category/status and correlation ID, never provider payloads or keys.
        var providerStatus = (exception as HttpRequestException)?.StatusCode;
        app.Logger.LogWarning("Book recognition failed. RequestId={RequestId} Category={Category} ProviderStatus={ProviderStatus}",
            context.TraceIdentifier, exception.GetType().Name, (int?)providerStatus);
        if (providerStatus == System.Net.HttpStatusCode.NotFound)
            return Error(context, 502, "recognition.endpoint", "bookIntake.recognitionEndpoint", "AI endpoint or model not found.", false);
        return Error(context, 502, "recognition.failed", "bookIntake.recognitionFailed", "Book recognition failed. Try again or enter the information manually.", true);
    }
}).RequireRateLimiting("book-recognition");

api.MapPut("/projects/{id}/draft", (string id, SaveDraftRequest? request, HttpContext context, ProjectRepository projects, FormOptionRepository options, FileCategoryRepository fileCategories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false, [new FieldErrorDto("request", "required", "errors.validation.required")]);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The task was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This task is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This draft was changed elsewhere. Reload before saving again.", false, currentVersion: current.Version);
    var creatorInfo = CreatorInfo.FillMissing(current.Project, user);
    if (request.Project is not null)
        request = request with { Project = request.Project with {
            ClientName = creatorInfo.ClientName, ContactName = creatorInfo.ContactName,
            Email = creatorInfo.Email, Phone = creatorInfo.Phone,
            ProjectName = string.IsNullOrWhiteSpace(request.Project.ProjectName) ? request.Book?.Title?.Trim() ?? "" : request.Project.ProjectName
        } };
    var fieldErrors = DraftValidator.Validate(request, options, fileCategories, current, allowPastDeadline: true);
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Some fields are invalid.", false, fieldErrors);
    if (!AssetsMatch(current.Book.SourceAssets ?? [], request.Book.SourceAssets ?? []))
        return Error(context, 400, "validation.assets", "errors.validation.invalid", "Source assets must match stored uploads.", false, [new FieldErrorDto("book.sourceAssets", "invalid", "errors.validation.invalid")]);
    var result = projects.Save(user.Id, id, request);
    return result.Outcome switch
    {
        SaveOutcome.Saved => Results.Ok(result.Draft),
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The task was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This task is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This draft was changed elsewhere. Reload before saving again.", false, currentVersion: result.CurrentVersion)
    };
});

api.MapPut("/projects/{id}/creative", async (string id, SaveCreativeRequest? request, HttpContext context, ProjectRepository projects, FormOptionRepository options) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    await using (await projectWriteLocks.AcquireAsync($"{user.Id}:{id}", context.RequestAborted))
    {
        var current = projects.Get(user.Id, id);
        if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
        if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
        if (request is not null && current.Version != request.Version)
            return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: current.Version);
        var fieldErrors = CreativeValidator.Validate(request, options, current);
        if (fieldErrors.Length > 0)
            return Error(context, 400, "validation.failed", "errors.validation.failed", "Some fields are invalid.", false, fieldErrors);

        var retainedCharacterIds = request!.Creative.Characters.Select(character => character.Id).ToHashSet(StringComparer.Ordinal);
        var removedAssets = current.Creative.Characters
            .Where(character => !retainedCharacterIds.Contains(character.Id))
            .SelectMany(character => character.ReferenceImages ?? [])
            .ToArray();
        if (removedAssets.Length > 0)
            return Error(context, 400, "validation.assets", "errors.validation.invalid", "Delete the character reference images before deleting the character.", false,
                [new FieldErrorDto("creative.characters", "invalid", "errors.validation.invalid")]);

        var result = projects.SaveCreative(user.Id, id, request);

        return result.Outcome switch
        {
            SaveOutcome.Saved => Results.Ok(result.Draft),
            SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
            SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
            _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: result.CurrentVersion)
        };
    }
});

api.MapPut("/projects/{id}/voice-and-references", (string id, SaveVoiceAndReferencesRequest? request, HttpContext context, ProjectRepository projects, VoiceReferenceRepository voices, FormOptionRepository options, FileCategoryRepository fileCategories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (request is not null && current.Version != request.Version)
        return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: current.Version);
    if (request?.Project is not null)
    {
        var creator = CreatorInfo.FillMissing(current.Project, user);
        request = request with { Project = request.Project with {
            ClientName=creator.ClientName, ContactName=creator.ContactName, Email=creator.Email, Phone=creator.Phone,
            ProjectName=string.IsNullOrWhiteSpace(request.Project.ProjectName) ? current.Book.Title.Trim() : request.Project.ProjectName
        } };
        var basicErrors = DraftValidator.Validate(new SaveDraftRequest(request.Version, request.Project, current.Book), options, fileCategories, current,
            allowPastDeadline: !request.RequireComplete);
        if (basicErrors.Length > 0)
            return Error(context, 400, "validation.failed", "errors.validation.failed", "Some project fields are invalid.", false, basicErrors);
    }
    if (request?.RequireComplete == true)
    {
        var basic = request.Project ?? current.Project;
        var basicErrors = new List<FieldErrorDto>();
        if (string.IsNullOrWhiteSpace(basic.VideoGoalId)) basicErrors.Add(new("project.videoGoalId", "required", "errors.validation.required"));
        if (basic.AudienceIds.Length == 0) basicErrors.Add(new("project.audienceIds", "required", "errors.validation.required"));
        if (basicErrors.Count > 0)
            return Error(context, 400, "validation.failed", "errors.validation.failed", "Complete project basics before review.", false, [.. basicErrors]);
    }
    var fieldErrors = VoiceAndReferencesValidator.Validate(request, voices.EnabledIds(), options, fileCategories, current);
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Some fields are invalid.", false, fieldErrors);
    if (!AssetsMatch(current.VoiceAndReferences.Assets, request!.VoiceAndReferences.Assets ?? []))
        return Error(context, 400, "validation.assets", "errors.validation.invalid", "Reference assets must match stored uploads.", false, [new FieldErrorDto("voiceAndReferences.assets", "invalid", "errors.validation.invalid")]);
    var result = projects.SaveVoiceAndReferences(user.Id, id, request!);
    return result.Outcome switch
    {
        SaveOutcome.Saved => Results.Ok(result.Draft),
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: result.CurrentVersion)
    };
});

api.MapPost("/projects/{id}/validate", (string id, ValidateProjectRequest? request, HttpContext context, ProjectRepository projects, VoiceReferenceRepository voices, FormOptionRepository options, FileCategoryRepository fileCategories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.submit")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Submit permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before validating.", false, currentVersion: current.Version);
    var fieldErrors = revisions.FilterSubmissionErrors(id, current, SubmitValidator.Validate(current, voices.EnabledIds(), options, fileCategories));
    return Results.Ok(new ValidationResultDto(fieldErrors.Length == 0, fieldErrors));
});

api.MapPost("/projects/{id}/submit", (string id, SubmitProjectRequest? request, HttpContext context, ProjectRepository projects, VoiceReferenceRepository voices, FormOptionRepository options, FileCategoryRepository fileCategories) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.submit")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Submit permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    if (!Guid.TryParseExact(request.IdempotencyKey, "N", out _)) return Error(context, 400, "validation.idempotency_key", "errors.validation.invalid", "The idempotency key is invalid.", false);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (current.Status == "submitted")
    {
        var replay = projects.Submit(user.Id, id, request.Version, request.IdempotencyKey, null);
        return replay.Outcome == SaveOutcome.Saved
            ? Results.Ok(replay.Draft)
            : Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: replay.CurrentVersion);
    }
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before submitting.", false, currentVersion: current.Version);
    var fieldErrors = revisions.FilterSubmissionErrors(id, current, SubmitValidator.Validate(current, voices.EnabledIds(), options, fileCategories));
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The application is incomplete.", false, fieldErrors);
    var snapshot = CaptureSubmissionConfiguration(current, options, voices, fileCategories);
    var result = projects.Submit(user.Id, id, request.Version, request.IdempotencyKey, snapshot);
    return result.Outcome switch
    {
        SaveOutcome.Saved => Results.Ok(result.Draft),
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before submitting.", false, currentVersion: result.CurrentVersion)
    };
});

api.MapPost("/projects/{id}/files", async (string id, HttpContext context, ProjectRepository projects, FileCategoryRepository categories, StorageQuota storageQuota) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    await using (await projectWriteLocks.AcquireAsync($"{user.Id}:{id}", context.RequestAborted))
    {
    var project = projects.Get(user.Id, id);
    if (project is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (project.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false);
    if (!context.Request.HasFormContentType) return Error(context, 400, "validation.failed", "errors.validation.failed", "A multipart form is required.", false);
    var requestedCategoryId = context.Request.Query["categoryId"].ToString();
    var definition = categories.FindEnabled(requestedCategoryId);
    var category = definition?.Category;
    if (definition is null || category is null)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The file category is invalid.", false);
    var multipartLimit = Math.Min(501_000_000, checked(category.MaxBytes + 1_000_000));
    var requestSizeFeature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
    if (requestSizeFeature is { IsReadOnly: false }) requestSizeFeature.MaxRequestBodySize = multipartLimit;
    if (context.Request.ContentLength is > 0 && context.Request.ContentLength > multipartLimit)
        return Error(context, 413, "validation.file", "errors.validation.fileSize", "The file is larger than this category allows.", false);
    var form = await context.Request.ReadFormAsync(context.RequestAborted);
    var categoryId = form["categoryId"].ToString();
    var characterId = form["characterId"].ToString();
    if (!int.TryParse(form["version"].ToString(), out var version)) return Error(context, 400, "validation.failed", "errors.validation.failed", "The draft version is required.", false);
    var file = form.Files.GetFile("file");
    if (!categoryId.Equals(requestedCategoryId, StringComparison.Ordinal) || file is null || file.Length <= 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The file or category is invalid.", false);
    var contentType = NormalizeContentType(file.ContentType, file.FileName);
    var uploadId = form["uploadId"].ToString();
    if (uploadId.Length > 0 && !Guid.TryParse(uploadId, out _))
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The upload identifier is invalid.", false);
    var fileId = uploadId.Length == 0 ? Guid.NewGuid().ToString("N")
        : Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{user.Id}:{id}:{Guid.Parse(uploadId):N}")))[..32].ToLowerInvariant();
    var existing = (project.Book.SourceAssets ?? []).Concat(project.Creative.StyleReferenceImages ?? [])
        .Concat(project.Creative.Characters.SelectMany(character => character.ReferenceImages ?? []))
        .Concat(project.VoiceAndReferences.Assets).FirstOrDefault(asset => asset.Id == fileId);
    if (existing is not null)
    {
        var sameCharacter = categoryId != "character-reference" || project.Creative.Characters.Any(character => character.Id == characterId && (character.ReferenceImages ?? []).Any(asset => asset.Id == fileId));
        if (existing.CategoryId != categoryId || existing.FileName != SanitizeFileName(file.FileName) || existing.SizeBytes != file.Length || existing.ContentType != contentType || !sameCharacter)
            return Error(context, 409, "validation.failed", "errors.validation.failed", "The upload identifier was already used for another file.", false);
        var storedPath = Path.Combine(dataDirectory, "uploads", user.Id, id, $"{existing.Id}_{existing.FileName}");
        if (!File.Exists(storedPath))
            return Error(context, 409, "validation.file", "errors.validation.fileContent", "The stored upload is unavailable.", false);
        await using var originalFile = File.OpenRead(storedPath);
        await using var replayFile = file.OpenReadStream();
        var originalHash = await System.Security.Cryptography.SHA256.HashDataAsync(originalFile, context.RequestAborted);
        var replayHash = await System.Security.Cryptography.SHA256.HashDataAsync(replayFile, context.RequestAborted);
        if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(originalHash, replayHash))
            return Error(context, 409, "validation.file", "errors.validation.fileContent", "The upload identifier was already used for different contents.", false);
        // Replay before the version and capacity checks: the first response may have been lost.
        return Results.Ok(new UploadReferenceResultDto(project, existing));
    }
    if (project.Version != version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before uploading.", false, currentVersion: project.Version);
    var target = definition.Scope == FileCategoryScopes.Source ? "source" : categoryId switch
    {
        "style-reference" => "creative-style",
        "character-reference" => "creative-character",
        _ => "reference"
    };
    if (target == "creative-character" && (string.IsNullOrWhiteSpace(characterId) || !project.Creative.Characters.Any(character => character.Id == characterId)))
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Choose an existing character before uploading a reference image.", false, [new FieldErrorDto("creative.characters", "invalid", "errors.validation.invalid")]);
    var storedAssets = target switch
    {
        "source" => project.Book.SourceAssets ?? [],
        "creative-style" => project.Creative.StyleReferenceImages ?? [],
        "creative-character" => project.Creative.Characters.First(character => character.Id == characterId).ReferenceImages ?? [],
        _ => project.VoiceAndReferences.Assets
    };
    var assetField = target switch
    {
        "source" => "book.sourceAssets",
        "creative-style" => "creative.styleReferenceImages",
        "creative-character" => "creative.characters.referenceImages",
        _ => "voiceAndReferences.assets"
    };
    if (storedAssets.Count(asset => asset.CategoryId == categoryId) >= category.MaxFiles)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The category file limit was reached.", false, [new FieldErrorDto(assetField, "too_many", "errors.validation.too_many")]);
    if (file.Length > category.MaxBytes)
        return Error(context, 400, "validation.file", "errors.validation.fileSize", "The file is larger than this category allows.", false);
    if (!category.Accept.Contains(contentType, StringComparer.OrdinalIgnoreCase))
        return Error(context, 400, "validation.file", "errors.validation.fileType", "The file type is not allowed for this category.", false);
    if (!await HasExpectedSignature(file, contentType, context.RequestAborted))
        return Error(context, 400, "validation.file", "errors.validation.fileContent", "The file contents do not match its declared format.", false);

    await using var reservation = await storageQuota.TryReserveAsync(file.Length, context.RequestAborted);
    if (reservation is null)
        return Error(context, 507, "storage.quota", "errors.storage.quota", "Storage capacity has been reached. Contact an administrator.", true);

    var safeName = SanitizeFileName(file.FileName);
    var folder = Path.Combine(dataDirectory, "uploads", user.Id, id);
    Directory.CreateDirectory(folder);
    var path = Path.Combine(folder, $"{fileId}_{safeName}");
    var temporary = path + "." + Guid.NewGuid().ToString("N") + ".upload";
    var pendingMarker = path + ".pending";
    try
    {
        await using (var output = File.Create(temporary))
        {
            await file.CopyToAsync(output, context.RequestAborted);
            output.Flush(flushToDisk: true);
        }
        context.RequestAborted.ThrowIfCancellationRequested();
        CreatePendingMarker(pendingMarker);
        File.Move(temporary, path);
        var asset = new ReferenceAssetDto(fileId, categoryId, safeName, contentType, file.Length, $"/api/projects/{id}/files/{fileId}");
        var result = projects.AddAsset(user.Id, id, version, asset, target, string.IsNullOrWhiteSpace(characterId) ? null : characterId);
        if (result.Outcome == SaveOutcome.Saved)
        {
            try { File.Delete(pendingMarker); }
            catch (Exception exception) { app.Logger.LogWarning(exception, "Pending upload marker {Path} will be reconciled on restart", pendingMarker); }
            return Results.Ok(new UploadReferenceResultDto(result.Draft!, asset));
        }
        File.Delete(path);
        File.Delete(pendingMarker);
        return result.Outcome switch
        {
            SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
            SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
            _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before uploading.", false, currentVersion: result.CurrentVersion)
        };
    }
    catch
    {
        if (File.Exists(temporary)) File.Delete(temporary);
        if (File.Exists(path)) File.Delete(path);
        if (File.Exists(pendingMarker)) File.Delete(pendingMarker);
        throw;
    }
    }
}).DisableAntiforgery();

api.MapGet("/projects/{id}/files/{fileId}", (string id, string fileId, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Read permission is required.", false);
    var project = projects.GetVisible(user.Id, id);
    var asset = project is null ? null : AllProjectAssets(project).FirstOrDefault(item => item.Id == fileId);
    if (asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var folder = Path.Combine(dataDirectory, "uploads", project!.Creator!.Id, id);
    var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").Where(IsStoredFile).SingleOrDefault() : null;
    if (path is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    return asset.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
        ? Results.File(path, asset.ContentType, enableRangeProcessing: true)
        : Results.File(path, asset.ContentType, asset.FileName, enableRangeProcessing: true);
});

api.MapDelete("/projects/{id}/files/{fileId}", async (string id, string fileId, int version, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    await using (await projectWriteLocks.AcquireAsync($"{user.Id}:{id}", context.RequestAborted))
    {
        var project = projects.Get(user.Id, id);
        if (project is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
        if (project.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false);
        if (!Guid.TryParseExact(fileId, "N", out _)) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
        var asset = AllProjectAssets(project).FirstOrDefault(item => item.Id == fileId);
        if (asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);

        (string Original, string Staged)? stagedFile;
        try { stagedFile = revisions.HistoryAsset(id, fileId) is null ? StageReferenceFileDeletion(dataDirectory, user.Id, id, fileId) : null; }
        catch (Exception exception)
        {
            app.Logger.LogError(exception, "Could not stage reference file {FileId} before deletion", fileId);
            return Error(context, 500, "system.unexpected", "errors.system.unexpected", "The file could not be safely deleted. Try again.", true);
        }

        var result = projects.RemoveAsset(user.Id, id, version, fileId);
        if (result.Outcome != SaveOutcome.Saved)
        {
            if (stagedFile is { } pending) RestoreReferenceFileDeletion(pending, app.Logger);
            return result.Outcome switch
            {
                SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
                SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
                _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before deleting.", false, currentVersion: result.CurrentVersion)
            };
        }
        if (stagedFile is { } removed)
        {
            try { File.Delete(removed.Staged); }
            catch (Exception exception) { app.Logger.LogWarning(exception, "Staged reference file {FileId} will be cleaned on restart", fileId); }
        }
        var uploadFolder = Path.Combine(dataDirectory, "uploads", user.Id, id);
        if (Directory.Exists(uploadFolder))
            foreach (var marker in Directory.EnumerateFiles(uploadFolder, $"{fileId}_*.pending"))
                try { File.Delete(marker); }
                catch (Exception exception) { app.Logger.LogWarning(exception, "Pending reference marker {Path} will be reconciled on restart", marker); }
        return Results.Ok(result.Draft);
    }
});
if (File.Exists(adminIndex))
{
    app.MapGet("/admin/{**path}", () => Results.File(adminIndex, "text/html; charset=utf-8"));
}
app.MapGet("/api/{**path}", () => Results.NotFound());
if (File.Exists(customerIndex))
    app.MapGet("/{**path}", () => Results.File(customerIndex, "text/html; charset=utf-8"));

if (builder.Configuration["Lifewood:LocalProcessRecord"] is {} localProcessRecord && builder.Configuration["Lifewood:LocalLaunchId"] is {} localLaunchId)
    app.Lifetime.ApplicationStarted.Register(() => File.WriteAllText(localProcessRecord, JsonSerializer.Serialize(new LocalProcessReceipt(Environment.ProcessId, Environment.ProcessPath!, localLaunchId), AppJsonContext.Default.LocalProcessReceipt)));
if (builder.Configuration["Lifewood:RestoreReady"] is {} restoreReady && builder.Configuration["Lifewood:RestoreAttempt"] is {} restoreAttempt)
{
    var restoreJob = RestoreEngine.Read(backupDirectory);
    if (restoreJob?.State.Id != restoreAttempt || RestoreEngine.Ready(restoreJob) != restoreReady) throw new IOException("Invalid restore readiness marker.");
    // The child reports readiness before the helper commits. Keep both requests and background writers paused until then.
    var restoreStartupPause = await app.Services.GetRequiredService<BackupGate>().PauseAsync(CancellationToken.None);
    app.Lifetime.ApplicationStarted.Register(() => {
        File.WriteAllText(restoreReady, restoreAttempt);
        _ = Task.Run(async () => {
            if (await RestoreEngine.WaitForCommit(backupDirectory, restoreAttempt, app.Lifetime.ApplicationStopping)) { restoreStartupPause.Dispose(); return; }
            if (!app.Lifetime.ApplicationStopping.IsCancellationRequested) {
                app.Logger.LogError("Restore commit acknowledgement did not arrive; restarting through journal recovery.");
                if (!app.Services.GetRequiredService<RuntimeLifecycle>().RequestRestart()) app.Lifetime.StopApplication();
            }
        });
    });
}
app.Run();

static IEnumerable<ReferenceAssetDto> AllProjectAssets(TaskDraftDto project) =>
    (project.Book.SourceAssets ?? [])
        .Concat(project.Creative.StyleReferenceImages ?? [])
        .Concat(project.Creative.Characters.SelectMany(character => character.ReferenceImages ?? []))
        .Concat(project.VoiceAndReferences.Assets);

static CurrentUserDto? CurrentUser(HttpContext context)
{
    var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    var sessionClaim = context.User.FindFirstValue("lw_session_version");
    return string.IsNullOrWhiteSpace(userId) || !int.TryParse(sessionClaim, NumberStyles.None, CultureInfo.InvariantCulture, out var sessionVersion)
        ? null
        : context.User.FindFirstValue("lw_login_session") is not {} login||!context.RequestServices.GetRequiredService<AccountSwitchStore>().IsSessionActive(userId,login,sessionVersion,!context.Items.ContainsKey("backup.read_only"))?null:context.RequestServices.GetRequiredService<UserRepository>().Get(userId, sessionVersion);
}

static async Task<bool> SignIn(HttpContext context, CurrentUserDto user, bool persistent, DateTimeOffset? expires = null, int? savedVersion = null, bool refreshExisting = false, int? authenticatedVersion = null)
{
    var sessionVersion = authenticatedVersion ?? savedVersion ?? context.RequestServices.GetRequiredService<UserRepository>().GetSessionVersion(user.Id)
        ?? throw new InvalidOperationException("Cannot create a session for an inactive or missing user.");
    var previousId=context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    if(previousId is not null && previousId!=user.Id)context.RequestServices.GetRequiredService<UserPresenceRepository>().EndSession(previousId,PresenceSession(context));
    var presenceSession=previousId==user.Id?PresenceSession(context):Guid.NewGuid().ToString("N");
    var expiresAt=expires??DateTimeOffset.UtcNow.Add(persistent?TimeSpan.FromDays(30):TimeSpan.FromHours(8));
    var loginSession=context.RequestServices.GetRequiredService<AccountSwitchStore>().Remember(context,user,sessionVersion,expiresAt,persistent,savedVersion is not null||refreshExisting,presenceSession);
    if(loginSession is null)return false;
    var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.DisplayName),
            new Claim("lw_session_version", sessionVersion.ToString(CultureInfo.InvariantCulture)),
            new Claim("lw_presence_session", presenceSession),
            new Claim("lw_login_session",loginSession)
        ],
        CookieAuthenticationDefaults.AuthenticationScheme);
    var properties = new AuthenticationProperties
    {
        IsPersistent = persistent,
        AllowRefresh = true,
        ExpiresUtc = expiresAt
    };
    await context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
    return true;
}
static string PresenceSession(HttpContext context) => context.User.FindFirstValue("lw_presence_session") ?? Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(context.Request.Cookies["lw_session"]??"")));
static bool Can(CurrentUserDto user, string permission) => user.Permissions.Contains(permission, StringComparer.Ordinal);

static bool IsLoopbackRequest(HttpContext context)
{
    if (context.Items.ContainsKey("Lifewood.ProxyHeadersPresent") ||
        context.Request.Headers.ContainsKey("Forwarded") ||
        context.Request.Headers.ContainsKey("X-Forwarded-For") ||
        context.Request.Headers.ContainsKey("X-Forwarded-Proto") ||
        context.Request.Headers.ContainsKey("X-Forwarded-Host") ||
        context.Request.Headers.ContainsKey("X-Original-For") ||
        context.Request.Headers.ContainsKey("X-Original-Proto") ||
        context.Request.Headers.ContainsKey("X-Original-Host")) return false;

    var address = context.Connection.RemoteIpAddress;
    if (address is null || !System.Net.IPAddress.IsLoopback(address)) return false;

    var host = context.Request.Host.Host;
    if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;
    return System.Net.IPAddress.TryParse(host, out var hostAddress) && System.Net.IPAddress.IsLoopback(hostAddress);
}
static string Locale(HttpContext context)
{
    var value = context.Request.Headers.AcceptLanguage.ToString();
    return value.StartsWith("en-US", StringComparison.OrdinalIgnoreCase) ? "en-US" : "zh-CN";
}
static SubmissionConfigurationSnapshotDto CaptureSubmissionConfiguration(
    TaskDraftDto project,
    FormOptionRepository options,
    VoiceReferenceRepository voices,
    FileCategoryRepository fileCategories)
{
    var selected = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
    void Add(string group, params IEnumerable<string?>[] values)
    {
        if (!selected.TryGetValue(group, out var ids)) selected[group] = ids = new(StringComparer.Ordinal);
        foreach (var value in values.SelectMany(items => items))
            if (!string.IsNullOrWhiteSpace(value)) ids.Add(value);
    }

    Add(FormOptionGroups.Brands, [project.Project.BrandId]);
    Add(FormOptionGroups.VideoGoals, [project.Project.VideoGoalId]);
    Add(FormOptionGroups.Audiences, project.Project.AudienceIds);
    Add(FormOptionGroups.Genres, [project.Book.GenreId]);
    Add(FormOptionGroups.ContentLanguages, [project.Book.ContentLanguageId, project.VoiceAndReferences.Voiceover.ContentLanguageId]);
    Add(FormOptionGroups.VideoDurations, [project.Book.VideoDurationId]);
    Add(FormOptionGroups.PublishingPlatforms, project.Book.PublishingPlatformIds);
    Add(FormOptionGroups.RoleTypes, project.Creative.Characters.Select(character => character.RoleTypeId));
    Add(FormOptionGroups.AgeRanges, project.Creative.Characters.Select(character => character.AgeRangeId));
    Add(FormOptionGroups.Genders, project.Creative.Characters.Select(character => character.GenderId));
    Add(FormOptionGroups.VisualStyles, [project.Creative.VisualStyleId]);
    Add(FormOptionGroups.MoodTags, project.Creative.MoodTagIds);
    Add(FormOptionGroups.ImageStyleTags, project.Creative.ImageStyleTagIds);
    Add(FormOptionGroups.PaceTags, project.Creative.PaceTagIds);
    Add(FormOptionGroups.NarrationTones, [project.VoiceAndReferences.Voiceover.NarrationToneId]);
    Add(FormOptionGroups.SpeechRates, [project.VoiceAndReferences.Voiceover.SpeechRateId]);
    Add(FormOptionGroups.VoiceGenders, [project.VoiceAndReferences.Voiceover.VoiceGenderId]);
    Add(FormOptionGroups.VoiceAges, [project.VoiceAndReferences.Voiceover.VoiceAgeId]);
    Add(FormOptionGroups.Accents, [project.VoiceAndReferences.Voiceover.AccentId]);
    Add(FormOptionGroups.VoiceEmotions, [project.VoiceAndReferences.Voiceover.EmotionStyleId]);

    var selectedVoiceIds = project.VoiceAndReferences.Voiceover.SelectedVoiceIds.ToHashSet(StringComparer.Ordinal);
    var voiceSnapshots = voices.ListAdmin().Where(voice => selectedVoiceIds.Contains(voice.Id)).ToArray();
    Add(FormOptionGroups.VoiceTags, voiceSnapshots.SelectMany(voice => voice.TagIds));
    var formSnapshots = selected
        .OrderBy(item => item.Key, StringComparer.Ordinal)
        .SelectMany(item => options.ListAdmin(item.Key).Where(option => item.Value.Contains(option.Id)))
        .ToArray();

    var selectedCategoryIds = (project.Book.SourceAssets ?? [])
        .Concat(project.Creative.StyleReferenceImages ?? [])
        .Concat(project.Creative.Characters.SelectMany(character => character.ReferenceImages ?? []))
        .Concat(project.VoiceAndReferences.Assets)
        .Select(asset => asset.CategoryId)
        .ToHashSet(StringComparer.Ordinal);
    var categorySnapshots = FileCategoryScopes.All
        .OrderBy(scope => scope, StringComparer.Ordinal)
        .SelectMany(fileCategories.ListAdmin)
        .Where(category => selectedCategoryIds.Contains(category.Id))
        .ToArray();

    return new(1, DateTimeOffset.UtcNow, formSnapshots, voiceSnapshots, categorySnapshots);
}

static string NormalizeContentType(string contentType, string fileName)
{
    var expected = Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".txt" => "text/plain", ".pdf" => "application/pdf", ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".webp" => "image/webp", ".mp4" => "video/mp4", ".mov" => "video/quicktime",
        _ => "application/octet-stream"
    };
    return string.IsNullOrWhiteSpace(contentType) || contentType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) || contentType.Equals(expected, StringComparison.OrdinalIgnoreCase)
        ? expected : "application/octet-stream";
}

static string? DetectAvatarExtension(ReadOnlySpan<byte> bytes)
{
    if (TryValidatePng(bytes, out var width, out var height) && AvatarDimensionsValid(width, height)) return ".png";
    return null;
}

static bool AvatarDimensionsValid(int width, int height) =>
    width is > 0 and <= 2048 && height is > 0 and <= 2048 && (long)width * height <= 4_000_000;

static bool TryValidatePng(ReadOnlySpan<byte> bytes, out int width, out int height)
{
    width = height = 0;
    ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.Length < 57 || !bytes[..8].SequenceEqual(signature)) return false;
    var offset = 8;
    var sawHeader = false;
    var sawPalette = false;
    var sawData = false;
    var endedData = false;
    var paletteEntries = 0;
    var bitDepth = 0;
    var colorType = 0;
    var interlaceMethod = 0;
    using var compressed = new MemoryStream();
    while (offset + 12 <= bytes.Length)
    {
        var lengthValue = BinaryPrimitives.ReadUInt32BigEndian(bytes[offset..(offset + 4)]);
        if (lengthValue > int.MaxValue) return false;
        var length = (int)lengthValue;
        var dataOffset = offset + 8;
        var next = dataOffset + length + 4;
        if (next < dataOffset || next > bytes.Length) return false;
        var type = bytes[(offset + 4)..(offset + 8)];
        var data = bytes[dataOffset..(dataOffset + length)];
        if (!IsValidPngChunkType(type)) return false;
        if (PngCrc(type, data) != BinaryPrimitives.ReadUInt32BigEndian(bytes[(dataOffset + length)..next])) return false;
        if (!sawHeader)
        {
            if (!type.SequenceEqual("IHDR"u8) || length != 13) return false;
            width = BinaryPrimitives.ReadInt32BigEndian(data[..4]);
            height = BinaryPrimitives.ReadInt32BigEndian(data[4..8]);
            bitDepth = data[8];
            colorType = data[9];
            interlaceMethod = data[12];
            if (data[10] != 0 || data[11] != 0 || interlaceMethod is not (0 or 1)) return false;
            sawHeader = true;
        }
        else if (type.SequenceEqual("PLTE"u8))
        {
            if (sawPalette || sawData || colorType is 0 or 4 || length is <= 0 or > 768 || length % 3 != 0) return false;
            paletteEntries = length / 3;
            if (colorType == 3 && paletteEntries > 1 << bitDepth) return false;
            sawPalette = true;
        }
        else if (type.SequenceEqual("IDAT"u8))
        {
            if (endedData || length == 0) return false;
            sawData = true;
            compressed.Write(data);
        }
        else if (type.SequenceEqual("IEND"u8))
        {
            if (length != 0 || !sawData || next != bytes.Length) return false;
            return (colorType != 3 || sawPalette) && ValidatePngPixels(compressed, width, height, bitDepth, colorType, interlaceMethod, paletteEntries);
        }
        else
        {
            if ((type[0] & 0x20) == 0) return false;
            if (sawData) endedData = true;
        }
        offset = next;
    }
    return false;
}

static bool ValidatePngPixels(MemoryStream compressed, int width, int height, int bitDepth, int colorType, int interlaceMethod, int paletteEntries)
{
    var channels = colorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => 0 };
    var validDepth = colorType switch
    {
        0 => bitDepth is 1 or 2 or 4 or 8 or 16,
        2 or 4 or 6 => bitDepth is 8 or 16,
        3 => bitDepth is 1 or 2 or 4 or 8,
        _ => false
    };
    if (!validDepth || !AvatarDimensionsValid(width, height)) return false;
    try
    {
        compressed.Position = 0;
        using var inflater = new ZLibStream(compressed, CompressionMode.Decompress, leaveOpen: true);
        if (interlaceMethod == 0)
        {
            ReadPngPass(inflater, width, height, channels, bitDepth, colorType, paletteEntries);
        }
        else
        {
            int[] xStarts = [0, 4, 0, 2, 0, 1, 0];
            int[] yStarts = [0, 0, 4, 0, 2, 0, 1];
            int[] xSteps = [8, 8, 4, 4, 2, 2, 1];
            int[] ySteps = [8, 8, 8, 4, 4, 2, 2];
            for (var pass = 0; pass < 7; pass++)
            {
                var passWidth = width <= xStarts[pass] ? 0 : (width - xStarts[pass] + xSteps[pass] - 1) / xSteps[pass];
                var passHeight = height <= yStarts[pass] ? 0 : (height - yStarts[pass] + ySteps[pass] - 1) / ySteps[pass];
                if (passWidth > 0 && passHeight > 0) ReadPngPass(inflater, passWidth, passHeight, channels, bitDepth, colorType, paletteEntries);
            }
        }
        return inflater.ReadByte() == -1;
    }
    catch (InvalidDataException) { return false; }
    catch (EndOfStreamException) { return false; }
    catch (OverflowException) { return false; }
}

static void ReadPngPass(Stream inflater, int width, int height, int channels, int bitDepth, int colorType, int paletteEntries)
{
    var rowBytes = checked((int)(((long)width * channels * bitDepth + 7) / 8));
    var bytesPerPixel = Math.Max(1, (channels * bitDepth + 7) / 8);
    var encoded = new byte[rowBytes + 1];
    var previous = new byte[rowBytes];
    var current = new byte[rowBytes];
    for (var y = 0; y < height; y++)
    {
        inflater.ReadExactly(encoded);
        var filter = encoded[0];
        if (filter > 4) throw new InvalidDataException("Invalid PNG row filter.");
        for (var index = 0; index < rowBytes; index++)
        {
            var left = index >= bytesPerPixel ? current[index - bytesPerPixel] : (byte)0;
            var up = previous[index];
            var upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : (byte)0;
            var predictor = filter switch
            {
                0 => 0,
                1 => left,
                2 => up,
                3 => (left + up) / 2,
                4 => PaethPredictor(left, up, upperLeft),
                _ => 0
            };
            current[index] = unchecked((byte)(encoded[index + 1] + predictor));
        }
        if (colorType == 3 && !PaletteIndexesValid(current, width, bitDepth, paletteEntries)) throw new InvalidDataException("PNG palette index is out of range.");
        (previous, current) = (current, previous);
        Array.Clear(current);
    }
}

static bool PaletteIndexesValid(ReadOnlySpan<byte> row, int width, int bitDepth, int paletteEntries)
{
    var mask = (1 << bitDepth) - 1;
    for (var pixel = 0; pixel < width; pixel++)
    {
        var bitOffset = pixel * bitDepth;
        var shift = 8 - bitDepth - bitOffset % 8;
        if (((row[bitOffset / 8] >> shift) & mask) >= paletteEntries) return false;
    }
    return true;
}

static int PaethPredictor(int left, int up, int upperLeft)
{
    var estimate = left + up - upperLeft;
    var leftDistance = Math.Abs(estimate - left);
    var upDistance = Math.Abs(estimate - up);
    var upperLeftDistance = Math.Abs(estimate - upperLeft);
    return leftDistance <= upDistance && leftDistance <= upperLeftDistance ? left : upDistance <= upperLeftDistance ? up : upperLeft;
}

static bool IsValidPngChunkType(ReadOnlySpan<byte> type)
{
    if (type.Length != 4 || (type[2] & 0x20) != 0) return false;
    foreach (var value in type)
        if (!((value >= (byte)'A' && value <= (byte)'Z') || (value >= (byte)'a' && value <= (byte)'z'))) return false;
    return true;
}

static uint PngCrc(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
{
    var crc = 0xFFFFFFFFu;
    foreach (var value in type) crc = UpdateCrc(crc, value);
    foreach (var value in data) crc = UpdateCrc(crc, value);
    return ~crc;
    static uint UpdateCrc(uint current, byte value)
    {
        current ^= value;
        for (var bit = 0; bit < 8; bit++) current = (current & 1) != 0 ? 0xEDB88320u ^ (current >> 1) : current >> 1;
        return current;
    }
}

static (string Original, string Staged)? StageReferenceFileDeletion(string dataDirectory, string ownerId, string projectId, string fileId)
{
    var folder = Path.Combine(dataDirectory, "uploads", ownerId, projectId);
    var original = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").Where(IsStoredFile).SingleOrDefault() : null;
    if (original is null) return null;
    var stagingFolder = Path.Combine(dataDirectory, "uploads", ".deleted-files", ownerId, projectId);
    Directory.CreateDirectory(stagingFolder);
    var staged = Path.Combine(stagingFolder, $"{fileId}_{Guid.NewGuid():N}_{Path.GetFileName(original)}");
    File.Move(original, staged);
    return (original, staged);
}

static void RestoreReferenceFileDeletion((string Original, string Staged) pending, ILogger logger)
{
    try
    {
        Directory.CreateDirectory(Path.GetDirectoryName(pending.Original)!);
        if (!File.Exists(pending.Original)) File.Move(pending.Staged, pending.Original);
        else logger.LogCritical("Could not restore staged reference file because {Path} already exists", pending.Original);
    }
    catch (Exception exception)
    {
        logger.LogCritical(exception, "Could not restore staged reference file {Path}; startup recovery will retry", pending.Staged);
    }
}

static void RecoverDeletedReferenceFiles(string dataDirectory, ProjectRepository projects, ILogger logger)
{
    var root = Path.Combine(dataDirectory, "uploads", ".deleted-files");
    if (!Directory.Exists(root)) return;
    foreach (var ownerFolder in Directory.EnumerateDirectories(root))
    foreach (var projectFolder in Directory.EnumerateDirectories(ownerFolder))
    foreach (var staged in Directory.EnumerateFiles(projectFolder))
    {
        try
        {
            var ownerId = Path.GetFileName(ownerFolder);
            var projectId = Path.GetFileName(projectFolder);
            var name = Path.GetFileName(staged);
            if (name.Length < 67 || name[32] != '_' || name[65] != '_') throw new InvalidDataException("Unrecognized staged reference filename.");
            var fileId = name[..32];
            var originalName = name[66..];
            var project = projects.Get(ownerId, projectId);
            var referenced = project is not null && AllProjectAssets(project).Any(asset => asset.Id == fileId);
            if (!referenced) File.Delete(staged);
            else RestoreReferenceFileDeletion((Path.Combine(dataDirectory, "uploads", ownerId, projectId, originalName), staged), logger);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not recover staged reference file {Path}", staged);
        }
    }
}

static string? StageDraftUploadDeletion(string dataDirectory, string ownerId, string projectId)
{
    var source = Path.Combine(dataDirectory, "uploads", ownerId, projectId);
    var deliverySource = Path.Combine(dataDirectory, "deliveries", projectId);
    if (!Directory.Exists(source) && !Directory.Exists(deliverySource)) return null;
    var stagingParent = Path.Combine(dataDirectory, "uploads", ".deleted", ownerId);
    Directory.CreateDirectory(stagingParent);
    var staged = Path.Combine(stagingParent, $"{projectId}_{Guid.NewGuid():N}");
    if (Directory.Exists(source)) Directory.Move(source, staged);
    else Directory.CreateDirectory(staged);
    try
    {
        if (Directory.Exists(deliverySource)) Directory.Move(deliverySource, Path.Combine(staged, ".deliveries"));
    }
    catch
    {
        Directory.CreateDirectory(Path.GetDirectoryName(source)!);
        Directory.Move(staged, source);
        throw;
    }
    return staged;
}

static void RestoreDraftUploadDeletion(string dataDirectory, string ownerId, string projectId, string staged, ILogger logger)
{
    var destination = Path.Combine(dataDirectory, "uploads", ownerId, projectId);
    try
    {
        var stagedDeliveries = Path.Combine(staged, ".deliveries");
        if (Directory.Exists(stagedDeliveries))
        {
            var deliveryDestination = Path.Combine(dataDirectory, "deliveries", projectId);
            Directory.CreateDirectory(Path.GetDirectoryName(deliveryDestination)!);
            if (!Directory.Exists(deliveryDestination)) Directory.Move(stagedDeliveries, deliveryDestination);
            else
            {
                foreach (var file in Directory.EnumerateFiles(stagedDeliveries)) File.Move(file, Path.Combine(deliveryDestination, Path.GetFileName(file)));
                Directory.Delete(stagedDeliveries);
            }
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        if (!Directory.Exists(destination)) Directory.Move(staged, destination);
        else
        {
            foreach (var source in Directory.EnumerateFiles(staged))
            {
                var target = Path.Combine(destination, Path.GetFileName(source));
                if (File.Exists(target)) throw new IOException($"An upload already exists at {target}.");
                File.Move(source, target);
            }
            if (!Directory.EnumerateFileSystemEntries(staged).Any()) Directory.Delete(staged);
        }
        if (!Directory.Exists(staged)) CleanupEmptyDraftUploadTombstoneParents(dataDirectory, staged);
    }
    catch (Exception exception)
    {
        logger.LogCritical(exception, "Could not restore staged uploads for draft {ProjectId}; startup recovery will retry", projectId);
    }
}

static void CleanupEmptyDraftUploadTombstoneParents(string dataDirectory, string staged)
{
    var root = Path.Combine(dataDirectory, "uploads", ".deleted");
    var ownerFolder = Path.GetDirectoryName(staged);
    if (ownerFolder is not null && Directory.Exists(ownerFolder) && !Directory.EnumerateFileSystemEntries(ownerFolder).Any())
        Directory.Delete(ownerFolder);
    if (Directory.Exists(root) && !Directory.EnumerateFileSystemEntries(root).Any())
        Directory.Delete(root);
}

static void RecoverDraftUploadTombstones(string dataDirectory, ProjectRepository projects, ILogger logger)
{
    var root = Path.Combine(dataDirectory, "uploads", ".deleted");
    if (!Directory.Exists(root)) return;
    foreach (var ownerFolder in Directory.EnumerateDirectories(root))
    {
        var ownerId = Path.GetFileName(ownerFolder);
        foreach (var staged in Directory.EnumerateDirectories(ownerFolder))
        {
            var name = Path.GetFileName(staged);
            var separator = name.IndexOf('_');
            if (separator <= 0) { logger.LogWarning("Ignoring unrecognized draft upload tombstone {Path}", staged); continue; }
            var projectId = name[..separator];
            try
            {
                if (projects.Get(ownerId, projectId) is null) Directory.Delete(staged, recursive: true);
                else RestoreDraftUploadDeletion(dataDirectory, ownerId, projectId, staged, logger);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not recover draft upload tombstone {Path}", staged);
            }
        }
    }
}

static void CleanupOrphanedVoiceUploads(string sampleDirectory)
{
    foreach (var path in Directory.EnumerateFiles(sampleDirectory, "*.upload"))
        File.Delete(path);
}
static void CleanupInterruptedUploads(string dataDirectory)
{
    foreach (var directoryName in new[] { "uploads", "deliveries" })
    {
        var directory = Path.Combine(dataDirectory, directoryName);
        foreach (var path in EnumerateFilesWithoutReparse(directory, ".upload")) File.Delete(path);
    }
}
static bool IsStoredFile(string path) =>
    !path.EndsWith(".pending", StringComparison.OrdinalIgnoreCase) &&
    !path.EndsWith(".upload", StringComparison.OrdinalIgnoreCase);
static IEnumerable<string> EnumerateFilesWithoutReparse(string root, string suffix)
{
    if (!Directory.Exists(root)) yield break;
    var pending = new Stack<string>();
    pending.Push(root);
    while (pending.Count > 0)
    {
        var current = pending.Pop();
        var item = new DirectoryInfo(current);
        if ((item.Attributes & FileAttributes.ReparsePoint) != 0) continue;
        foreach (var child in item.EnumerateFileSystemInfos())
        {
            if ((child.Attributes & FileAttributes.ReparsePoint) != 0) continue;
            if (child is DirectoryInfo childDirectory) pending.Push(childDirectory.FullName);
            else if (child.Name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) yield return child.FullName;
        }
    }
}
static void CreatePendingMarker(string path)
{
    using var marker = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
    marker.Flush(flushToDisk: true);
}
static void RecoverPendingFileOperations(string dataDirectory, ProjectRepository projects, DeliveryRepository deliveries, ILogger logger)
{
    Recover(Path.Combine(dataDirectory, "uploads"), 3, (parts, fileId) =>
    {
        var project = projects.Get(parts[0], parts[1]);
        return project is not null && AllProjectAssets(project).Any(asset => asset.Id == fileId);
    });
    Recover(Path.Combine(dataDirectory, "deliveries"), 2, (parts, fileId) => deliveries.Find(parts[0], fileId) is not null);

    void Recover(string root, int expectedParts, Func<string[], string, bool> isReferenced)
    {
        foreach (var marker in EnumerateFilesWithoutReparse(root, ".pending"))
        {
            try
            {
                var relative = Path.GetRelativePath(root, marker);
                var parts = relative.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);
                var finalPath = marker[..^".pending".Length];
                var finalName = Path.GetFileName(finalPath);
                var separator = finalName.IndexOf('_');
                if (parts.Length != expectedParts || separator <= 0 || !Guid.TryParseExact(finalName[..separator], "N", out _))
                {
                    logger.LogWarning("Skipped malformed pending file marker {Path}", marker);
                    continue;
                }
                var fileId = finalName[..separator];
                var referenced = isReferenced(parts, fileId);
                if (referenced && !File.Exists(finalPath))
                {
                    logger.LogError("Pending file marker {Path} references a missing stored file", marker);
                    continue;
                }
                if (!referenced && File.Exists(finalPath)) File.Delete(finalPath);
                File.Delete(marker);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not recover pending file operation {Path}", marker);
            }
        }
    }
}
static List<(string Original, string Backup)> StageVoiceSamples(string sampleDirectory, string id)
{
    var staged = new List<(string Original, string Backup)>();
    try
    {
        foreach (var extension in new[] { ".wav", ".mp3" })
        {
            var original = Path.Combine(sampleDirectory, id + extension);
            if (!File.Exists(original)) continue;
            var backup = original + ".backup";
            if (File.Exists(backup)) throw new IOException("A pending voice sample operation must be recovered before retrying.");
            File.Move(original, backup);
            staged.Add((original, backup));
        }
        return staged;
    }
    catch
    {
        RestoreVoiceSamples(staged);
        throw;
    }
}

static void RestoreVoiceSamples(IEnumerable<(string Original, string Backup)> staged)
{
    foreach (var entry in staged.Reverse())
        if (File.Exists(entry.Backup)) File.Move(entry.Backup, entry.Original, true);
}

static void DeleteVoiceSampleBackups(IEnumerable<(string Original, string Backup)> staged)
{
    foreach (var entry in staged)
        if (File.Exists(entry.Backup)) File.Delete(entry.Backup);
}

static void RecoverVoiceSampleBackups(string sampleDirectory, VoiceReferenceRepository voices)
{
    var voiceStates = voices.ListAdmin().ToDictionary(item => item.Id, item => item.AudioUrl is not null, StringComparer.Ordinal);
    var groups = Directory.EnumerateFiles(sampleDirectory, "*.backup")
        .Select(backup => (Original: backup[..^".backup".Length], Backup: backup))
        .Where(entry => Path.GetExtension(entry.Original) is ".wav" or ".mp3")
        .GroupBy(entry => Path.GetFileNameWithoutExtension(entry.Original), StringComparer.Ordinal);
    foreach (var group in groups)
    {
        var hasRegularSample = File.Exists(Path.Combine(sampleDirectory, group.Key + ".wav")) || File.Exists(Path.Combine(sampleDirectory, group.Key + ".mp3"));
        var databaseHasSample = voiceStates.TryGetValue(group.Key, out var available) && available;
        if (hasRegularSample || !databaseHasSample) DeleteVoiceSampleBackups(group);
        else RestoreVoiceSamples(group);
    }
}
static (FileStream Stream, string ContentType)? OpenVoiceSampleSnapshot(string sampleDirectory, string id)
{
    var wav = Path.Combine(sampleDirectory, id + ".wav");
    if (IsPlayableVoiceSample(wav)) return (OpenSharedVoiceSample(wav), "audio/wav");
    var mp3 = Path.Combine(sampleDirectory, id + ".mp3");
    return IsPlayableVoiceSample(mp3) ? (OpenSharedVoiceSample(mp3), "audio/mpeg") : null;
}

static bool IsPlayableVoiceSample(string path)
{
    var file = new FileInfo(path);
    return file.Exists && file.Length is > 0 and <= 20_000_000;
}

static FileStream OpenSharedVoiceSample(string path) =>
    new(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
static string? NormalizeAudioContentType(string contentType, string fileName)
{
    var normalized = contentType.Split(';', 2)[0].Trim().ToLowerInvariant();
    var extension = Path.GetExtension(fileName).ToLowerInvariant();
    if (normalized is "audio/wav" or "audio/x-wav" || extension == ".wav") return "audio/wav";
    if (normalized == "audio/mpeg" || extension == ".mp3") return "audio/mpeg";
    return null;
}

static async Task<bool> HasExpectedAudioSignature(IFormFile file, string contentType, CancellationToken cancellationToken)
{
    await using var stream = file.OpenReadStream();
    return contentType switch
    {
        "audio/wav" => await HasValidWaveStructure(stream, file.Length, cancellationToken),
        "audio/mpeg" => await HasValidMp3Frame(stream, file.Length, cancellationToken),
        _ => false
    };
}

static async Task<bool> HasValidWaveStructure(Stream stream, long fileLength, CancellationToken cancellationToken)
{
    if (!stream.CanSeek || fileLength < 46 || fileLength > uint.MaxValue + 8L) return false;
    var header = new byte[12];
    await stream.ReadExactlyAsync(header, cancellationToken);
    if (!header.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !header.AsSpan(8, 4).SequenceEqual("WAVE"u8)) return false;
    if (BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4)) + 8L != fileLength) return false;

    var foundFormat = false;
    ushort sampleBlockAlign = 0;
    var chunkHeader = new byte[8];
    for (var chunk = 0; chunk < 128 && stream.Position + chunkHeader.Length <= fileLength; chunk++)
    {
        await stream.ReadExactlyAsync(chunkHeader, cancellationToken);
        var chunkSize = BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(4));
        var chunkStart = stream.Position;
        var next = chunkStart + chunkSize + (chunkSize & 1u);
        if (next > fileLength) return false;
        if (chunkHeader.AsSpan(0, 4).SequenceEqual("fmt "u8))
        {
            if (chunkSize < 16) return false;
            var format = new byte[16];
            await stream.ReadExactlyAsync(format, cancellationToken);
            var formatTag = BinaryPrimitives.ReadUInt16LittleEndian(format);
            var channels = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(2));
            var sampleRate = BinaryPrimitives.ReadUInt32LittleEndian(format.AsSpan(4));
            var byteRate = BinaryPrimitives.ReadUInt32LittleEndian(format.AsSpan(8));
            var blockAlign = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(12));
            var bitsPerSample = BinaryPrimitives.ReadUInt16LittleEndian(format.AsSpan(14));
            if (formatTag != 1 || channels is < 1 or > 8 || sampleRate is < 8_000 or > 384_000 ||
                bitsPerSample is not (8 or 16 or 24 or 32) || blockAlign == 0 ||
                (ulong)byteRate != (ulong)sampleRate * blockAlign || blockAlign != channels * bitsPerSample / 8)
                return false;
            sampleBlockAlign = blockAlign;
            foundFormat = true;
        }
        if (chunkHeader.AsSpan(0, 4).SequenceEqual("data"u8))
            return foundFormat && chunkSize > 0 && sampleBlockAlign > 0 && chunkSize % sampleBlockAlign == 0;
        stream.Position = next;
    }
    return false;
}

static async Task<bool> HasValidMp3Frame(Stream stream, long fileLength, CancellationToken cancellationToken)
{
    if (!stream.CanSeek || fileLength < 4) return false;
    var id3Header = new byte[10];
    var frameOffset = 0L;
    if (fileLength >= id3Header.Length)
    {
        await stream.ReadExactlyAsync(id3Header, cancellationToken);
        if (id3Header.AsSpan(0, 3).SequenceEqual("ID3"u8))
        {
            if ((id3Header[6] | id3Header[7] | id3Header[8] | id3Header[9]) >= 0x80) return false;
            var tagSize = (id3Header[6] << 21) | (id3Header[7] << 14) | (id3Header[8] << 7) | id3Header[9];
            frameOffset = 10L + tagSize + ((id3Header[5] & 0x10) == 0x10 ? 10 : 0);
        }
    }
    var first = await ReadMp3FrameLength(stream, frameOffset, fileLength, cancellationToken);
    if (!first.Valid) return false;
    var nextOffset = frameOffset + first.Length;
    if (nextOffset == fileLength) return true;
    var second = await ReadMp3FrameLength(stream, nextOffset, fileLength, cancellationToken);
    return second.Valid && nextOffset + second.Length <= fileLength;
}

static async Task<(bool Valid, int Length)> ReadMp3FrameLength(Stream stream, long offset, long fileLength, CancellationToken cancellationToken)
{
    if (offset < 0 || offset + 4 > fileLength) return (false, 0);
    stream.Position = offset;
    var frame = new byte[4];
    await stream.ReadExactlyAsync(frame, cancellationToken);
    if (frame[0] != 0xff || (frame[1] & 0xe0) != 0xe0) return (false, 0);
    var version = (frame[1] >> 3) & 0x03;
    var layer = (frame[1] >> 1) & 0x03;
    var bitrateIndex = (frame[2] >> 4) & 0x0f;
    var sampleRateIndex = (frame[2] >> 2) & 0x03;
    if (version == 1 || layer != 1 || bitrateIndex is 0 or 15 || sampleRateIndex == 3) return (false, 0);
    int[] mpeg1Bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    int[] mpeg2Bitrates = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    int[] sampleRates = [44_100, 48_000, 32_000];
    var bitrate = (version == 3 ? mpeg1Bitrates : mpeg2Bitrates)[bitrateIndex] * 1000;
    var sampleRate = sampleRates[sampleRateIndex] / (version == 3 ? 1 : version == 2 ? 2 : 4);
    var padding = (frame[2] >> 1) & 1;
    var frameLength = (version == 3 ? 144 : 72) * bitrate / sampleRate + padding;
    return (frameLength >= 24 && offset + frameLength <= fileLength, frameLength);
}
static async Task<bool> HasExpectedSignature(IFormFile file, string contentType, CancellationToken cancellationToken)
{
    var buffer = new byte[512];
    await using var stream = file.OpenReadStream();
    var length = await stream.ReadAsync(buffer, cancellationToken);
    var span = buffer.AsSpan(0, length);
    return contentType switch
    {
        "image/jpeg" => length >= 3 && span[0] == 0xff && span[1] == 0xd8 && span[2] == 0xff,
        "image/png" => length >= 8 && span[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/webp" => length >= 12 && span[..4].SequenceEqual("RIFF"u8) && span[8..12].SequenceEqual("WEBP"u8),
        "application/pdf" => length >= 4 && span[..4].SequenceEqual("%PDF"u8),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => length >= 4 && span[0] == 0x50 && span[1] == 0x4b && span[2] == 0x03 && span[3] == 0x04,
        "video/mp4" or "video/quicktime" => length >= 8 && span[4..8].SequenceEqual("ftyp"u8),
        "text/plain" => !span.Contains((byte)0),
        _ => false
    };
}

static bool AssetsMatch(ReferenceAssetDto[] stored, ReferenceAssetDto[] submitted)
{
    if (stored.Length != submitted.Length) return false;
    if (submitted.Cast<ReferenceAssetDto?>().Any(asset => asset is null) || submitted.Select(asset => asset.Id).Distinct(StringComparer.Ordinal).Count() != submitted.Length) return false;
    var submittedById = submitted.ToDictionary(asset => asset.Id, StringComparer.Ordinal);
    return stored.All(asset => submittedById.TryGetValue(asset.Id, out var other) && asset == other);
}

static string SanitizeFileName(string fileName)
{
    var name = Path.GetFileName(fileName);
    var invalid = Path.GetInvalidFileNameChars();
    var safe = new string(name.Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
    return string.IsNullOrWhiteSpace(safe) ? "upload" : safe;
}

static IResult Error(HttpContext context, int status, string code, string messageKey, string message, bool retryable, FieldErrorDto[]? fieldErrors = null, int? currentVersion = null)
{
    return Results.Json(
        new ApiErrorDto(code, messageKey, message, fieldErrors, retryable, context.TraceIdentifier, currentVersion),
        AppJsonContext.Default.ApiErrorDto,
        statusCode: status);
}

public partial class Program;
