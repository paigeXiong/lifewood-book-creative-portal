using System.Net;
using System.Security.Claims;
using System.Text;
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

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 510_000_000);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => options.MultipartBodyLengthLimit = 510_000_000);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
builder.Services.AddOpenApi();
var trustedProxyAddresses = builder.Configuration.GetSection("Network:TrustedProxies")
    .GetChildren().Select(item => item.Value).Where(value => !string.IsNullOrWhiteSpace(value)).ToArray();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    options.KnownProxies.Clear();
    options.KnownIPNetworks.Clear();
    foreach (var value in trustedProxyAddresses)
        if (IPAddress.TryParse(value, out var address)) options.KnownProxies.Add(address);
});

var dataDirectory = Path.Combine(builder.Environment.ContentRootPath, "data");
var databaseConnection = $"Data Source={Path.Combine(dataDirectory, "platform.db")}";
var voiceSampleDirectory = Path.Combine(AppContext.BaseDirectory, "assets", "voice-samples");
Directory.CreateDirectory(dataDirectory);
var keyDirectory = Path.Combine(dataDirectory, "data-protection-keys");
Directory.CreateDirectory(keyDirectory);
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(keyDirectory))
    .SetApplicationName("Lifewood.BookVideoPlatform");
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "lw_session";
        options.Cookie.HttpOnly = true;
        options.Cookie.IsEssential = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
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
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("authentication", context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 10,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        }));
});

var repository = new ProjectRepository(databaseConnection);
repository.Initialize();
builder.Services.AddSingleton(repository);
var users = new UserRepository(databaseConnection, dataDirectory);
users.Initialize();
builder.Services.AddSingleton(users);

var administration = new AdminRepository(databaseConnection);
administration.Initialize();
builder.Services.AddSingleton(administration);
var deliveries = new DeliveryRepository(databaseConnection);
deliveries.Initialize();
builder.Services.AddSingleton(deliveries);
var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    if ((context.Request.Path.StartsWithSegments("/api/auth") && context.Request.Path != "/api/auth/csrf") || context.Request.Path == "/api/me")
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }
    var requestSize = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
    if (requestSize is { IsReadOnly: false })
    {
        var isUpload = HttpMethods.IsPost(context.Request.Method) &&
            (context.Request.Path.Value?.EndsWith("/files", StringComparison.Ordinal) == true || context.Request.Path.Value?.EndsWith("/deliveries", StringComparison.Ordinal) == true);
        var isAuthWrite = context.Request.Path.StartsWithSegments("/api/auth") && !HttpMethods.IsGet(context.Request.Method);
        requestSize.MaxRequestBodySize = isUpload ? 510_000_000 : isAuthWrite ? 16_384 : 2_000_000;
    }
    context.Response.Headers.Append("X-Request-Id", context.TraceIdentifier);
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
    catch (Exception exception)
    {
        app.Logger.LogError(exception, "Unhandled request failure {RequestId}", context.TraceIdentifier);
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(
                new ApiErrorDto("system.unexpected", "errors.system.unexpected", "The request could not be completed.", null, true, context.TraceIdentifier),
                AppJsonContext.Default.ApiErrorDto);
        }
    }
});

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
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

if (app.Environment.IsDevelopment()) app.MapOpenApi();

var api = app.MapGroup("/api");
api.MapDeliveryEndpoints(dataDirectory);

api.MapGet("/health", () => TypedResults.Ok(new HealthDto("ok")));
api.MapGet("/auth/status", (UserRepository accounts) => Results.Ok(new AuthStatusDto(accounts.RequiresBootstrap())));
api.MapGet("/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
    Results.Ok(new CsrfTokenDto(antiforgery.GetAndStoreTokens(context).RequestToken!)));
api.MapPost("/auth/bootstrap", async (BootstrapAccountRequest? request, HttpContext context, UserRepository accounts) =>
{
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var result = accounts.CreateOwner(request.DisplayName, request.Email, request.Password);
    if (result.Outcome == AccountCreateOutcome.AlreadyInitialized)
        return Error(context, 409, "auth.already_initialized", "errors.auth.alreadyInitialized", "The platform owner account already exists.", false);
    if (result.Outcome == AccountCreateOutcome.Invalid)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false,
            [new FieldErrorDto(result.Field ?? "request", "invalid", $"errors.auth.fields.{result.Field ?? "request"}")]);
    await SignIn(context, result.User!, false);
    return Results.Ok(result.User);
}).RequireRateLimiting("authentication");
api.MapPost("/auth/login", async (LoginRequest? request, HttpContext context, UserRepository accounts) =>
{
    if (request is null || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        return Error(context, 400, "auth.invalid_credentials", "errors.auth.invalidCredentials", "The email or password is incorrect.", false);
    var result = accounts.Authenticate(request.Email, request.Password);
    if (result.Outcome != AccountLoginOutcome.Success)
        return Error(context, 401, "auth.invalid_credentials", "errors.auth.invalidCredentials", "The email or password is incorrect.", false);
    await SignIn(context, result.User!, request.RememberMe);
    return Results.Ok(result.User);
}).RequireRateLimiting("authentication");
api.MapPost("/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.NoContent();
});
api.MapGet("/me", (HttpContext context) =>
{
    var user = CurrentUser(context);
    return user is null
        ? Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false)
        : Results.Ok(user);
});
api.MapGet("/me/avatar", (HttpContext context) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    context.Response.Headers.CacheControl = "private, no-store";
    return Results.Text(AvatarImage.Create(user.Id, user.DisplayName), "image/svg+xml", Encoding.UTF8);
});

api.MapGet("/form-options", (HttpContext context) =>
    Results.Ok(FormOptionCatalog.ForLocale(Locale(context))));

api.MapGet("/admin/users", (HttpContext context, AdminRepository admin, string? search, string? role, int page = 1, int pageSize = 20) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListUsers(search, role, Math.Max(1, page), Math.Clamp(pageSize, 1, 100)));
});

api.MapGet("/admin/users/{id}/avatar", (string id, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var user = admin.GetUser(id);
    if (user is null) return Error(context, 404, "admin.user_not_found", "errors.admin.userNotFound", "The user was not found.", false);
    context.Response.Headers.CacheControl = "private, no-store";
    return Results.Text(AvatarImage.Create(user.Id, user.DisplayName), "image/svg+xml", Encoding.UTF8);
});

api.MapGet("/admin/assignees", (HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListAssignees());
});

api.MapPost("/admin/users", (CreateUserRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.CreateUser(request, out var created);
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(created),
        AdminWriteOutcome.Conflict => Error(context, 409, "user.email_exists", "errors.admin.emailExists", "An account already uses this email.", false, [new FieldErrorDto("email", "duplicate", "errors.admin.emailExists")]),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapPut("/admin/users/{id}", (string id, UpdateUserRequest? request, HttpContext context, AdminRepository admin) =>
{
    var current = CurrentUser(context);
    if (current is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(current, "admin.users.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    if (id == current.Id && request is { Active: false }) return Error(context, 409, "user.self_deactivate", "errors.admin.selfDeactivate", "You cannot deactivate your own account.", false);
    var result = admin.UpdateUser(id, request, out var updated);
    return result.Outcome switch
    {
        AdminWriteOutcome.Saved => Results.Ok(updated),
        AdminWriteOutcome.NotFound => Error(context, 404, "user.not_found", "errors.admin.userNotFound", "The user was not found.", false),
        AdminWriteOutcome.Protected => Error(context, 409, "user.owner_protected", "errors.admin.ownerProtected", "The owner account cannot be changed here.", false),
        _ => Error(context, 400, "validation.failed", "errors.validation.failed", "The account details are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")])
    };
});

api.MapGet("/admin/projects", (HttpContext context, AdminRepository admin, string? workflowStatus, string? priority, string? search, int page = 1, int pageSize = 20) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    return Results.Ok(admin.ListProjects(workflowStatus, priority, search, Math.Max(1, page), Math.Clamp(pageSize, 1, 100)));
});

api.MapGet("/admin/projects/{id}", (string id, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var project = admin.GetProject(id);
    return project is null ? Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false) : Results.Ok(project);
});

api.MapPut("/admin/projects/{id}/workflow", (string id, UpdateProjectWorkflowRequest? request, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.UpdateWorkflow(id, request);
    if (result.Outcome == AdminWriteOutcome.NotFound) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (result.Outcome != AdminWriteOutcome.Saved) return Error(context, 400, "validation.failed", "errors.validation.failed", "The workflow values are invalid.", false, [new FieldErrorDto(result.Field ?? "request", "invalid", "errors.validation.invalid")]);
    return Results.Ok(admin.GetProject(id));
});

api.MapPost("/admin/projects/{id}/notes", (string id, AddAdminNoteRequest? request, HttpContext context, AdminRepository admin) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var result = admin.AddNote(id, user.Id, request, out var note);
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
    if (!Can(user, "admin.projects.manage")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Administrator permission is required.", false);
    var detail = admin.GetProject(id);
    var asset = detail is null ? null : (detail.Project.Book.SourceAssets ?? []).Concat(detail.Project.VoiceAndReferences.Assets).FirstOrDefault(item => item.Id == fileId);
    if (detail is null || asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var folder = Path.Combine(dataDirectory, "uploads", detail.OwnerId, id);
    var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").SingleOrDefault() : null;
    if (path is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    return asset.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
        ? Results.File(path, asset.ContentType, enableRangeProcessing: true)
        : Results.File(path, asset.ContentType, asset.FileName, enableRangeProcessing: true);
});

api.MapGet("/voices", (HttpContext context) =>
    Results.Ok(FormOptionCatalog.VoicesForLocale(Locale(context))));

api.MapGet("/voices/{id}/sample", (string id) =>
{
    if (!FormOptionCatalog.EnabledVoiceIds().Contains(id)) return Results.NotFound();
    var path = Path.Combine(voiceSampleDirectory, $"{id}.wav");
    return File.Exists(path) ? Results.File(path, "audio/wav", enableRangeProcessing: true) : Results.NotFound();
});

api.MapGet("/projects", (HttpContext context, ProjectRepository projects, string? status, string? search, int page = 1, int pageSize = 10) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    page = Math.Max(1, page);
    pageSize = Math.Clamp(pageSize, 1, 100);
    return Results.Ok(projects.List(user.Id, status, search, page, pageSize));
});

api.MapPost("/projects", (HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    return Results.Ok(projects.Create(user.Id));
});

api.MapGet("/projects/{id}", (string id, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Permission is required.", false);
    var project = projects.Get(user.Id, id);
    return project is null
        ? Error(context, 404, "project.not_found", "errors.project.notFound", "The task was not found.", false)
        : Results.Ok(project);
});

api.MapPut("/projects/{id}/draft", (string id, SaveDraftRequest? request, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false, [new FieldErrorDto("request", "required", "errors.validation.required")]);
    var fieldErrors = DraftValidator.Validate(request);
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Some fields are invalid.", false, fieldErrors);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The task was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This task is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This draft was changed elsewhere. Reload before saving again.", false, currentVersion: current.Version);
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

api.MapPut("/projects/{id}/creative", (string id, SaveCreativeRequest? request, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var fieldErrors = CreativeValidator.Validate(request);
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "Some fields are invalid.", false, fieldErrors);
    var result = projects.SaveCreative(user.Id, id, request!);
    return result.Outcome switch
    {
        SaveOutcome.Saved => Results.Ok(result.Draft),
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: result.CurrentVersion)
    };
});

api.MapPut("/projects/{id}/voice-and-references", (string id, SaveVoiceAndReferencesRequest? request, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (request is not null && current.Version != request.Version)
        return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before saving again.", false, currentVersion: current.Version);
    var fieldErrors = VoiceAndReferencesValidator.Validate(request);
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

api.MapPost("/projects/{id}/validate", (string id, ValidateProjectRequest? request, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.submit")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Submit permission is required.", false);
    if (request is null) return Error(context, 400, "validation.failed", "errors.validation.failed", "The request body is required.", false);
    var current = projects.Get(user.Id, id);
    if (current is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before validating.", false, currentVersion: current.Version);
    var fieldErrors = SubmitValidator.Validate(current);
    return Results.Ok(new ValidationResultDto(fieldErrors.Length == 0, fieldErrors));
});

api.MapPost("/projects/{id}/submit", (string id, SubmitProjectRequest? request, HttpContext context, ProjectRepository projects) =>
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
        var replay = projects.Submit(user.Id, id, request.Version, request.IdempotencyKey);
        return replay.Outcome == SaveOutcome.Saved
            ? Results.Ok(replay.Draft)
            : Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: replay.CurrentVersion);
    }
    if (current.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: current.Version);
    if (current.Version != request.Version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before submitting.", false, currentVersion: current.Version);
    var fieldErrors = SubmitValidator.Validate(current);
    if (fieldErrors.Length > 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The application is incomplete.", false, fieldErrors);
    var result = projects.Submit(user.Id, id, request.Version, request.IdempotencyKey);
    return result.Outcome switch
    {
        SaveOutcome.Saved => Results.Ok(result.Draft),
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before submitting.", false, currentVersion: result.CurrentVersion)
    };
});

api.MapPost("/projects/{id}/files", async (string id, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var project = projects.Get(user.Id, id);
    if (project is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (project.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false);
    if (!context.Request.HasFormContentType) return Error(context, 400, "validation.failed", "errors.validation.failed", "A multipart form is required.", false);
    var form = await context.Request.ReadFormAsync(context.RequestAborted);
    var categoryId = form["categoryId"].ToString();
    if (!int.TryParse(form["version"].ToString(), out var version)) return Error(context, 400, "validation.failed", "errors.validation.failed", "The draft version is required.", false);
    var catalog = FormOptionCatalog.ForLocale("en-US");
    var category = catalog.SourceCategories.Concat(catalog.ReferenceCategories).FirstOrDefault(item => item.Id == categoryId);
    var file = form.Files.GetFile("file");
    if (category is null || file is null || file.Length <= 0)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The file or category is invalid.", false);
    var contentType = NormalizeContentType(file.ContentType, file.FileName);
    if (project.Version != version) return Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before uploading.", false, currentVersion: project.Version);
    var storedAssets = FormOptionCatalog.SourceCategoryIds.Contains(categoryId) ? project.Book.SourceAssets ?? [] : project.VoiceAndReferences.Assets;
    var assetField = FormOptionCatalog.SourceCategoryIds.Contains(categoryId) ? "book.sourceAssets" : "voiceAndReferences.assets";
    if (storedAssets.Count(asset => asset.CategoryId == categoryId) >= category.MaxFiles)
        return Error(context, 400, "validation.failed", "errors.validation.failed", "The category file limit was reached.", false, [new FieldErrorDto(assetField, "too_many", "errors.validation.too_many")]);
    if (file.Length > category.MaxBytes || !category.Accept.Contains(contentType, StringComparer.OrdinalIgnoreCase) || !await HasExpectedSignature(file, contentType, context.RequestAborted))
        return Error(context, 400, "validation.file", "errors.validation.file", "The file type or size is not allowed.", false);

    var fileId = Guid.NewGuid().ToString("N");
    var safeName = SanitizeFileName(file.FileName);
    var folder = Path.Combine(dataDirectory, "uploads", user.Id, id);
    Directory.CreateDirectory(folder);
    var path = Path.Combine(folder, $"{fileId}_{safeName}");
    try
    {
        await using var output = File.Create(path);
        await file.CopyToAsync(output, context.RequestAborted);
    }
    catch
    {
        if (File.Exists(path)) File.Delete(path);
        throw;
    }
    context.RequestAborted.ThrowIfCancellationRequested();
    var asset = new ReferenceAssetDto(fileId, categoryId, safeName, contentType, file.Length, $"/api/projects/{id}/files/{fileId}");
    var result = projects.AddAsset(user.Id, id, version, asset);
    if (result.Outcome == SaveOutcome.Saved) return Results.Ok(new UploadReferenceResultDto(result.Draft!, asset));
    File.Delete(path);
    return result.Outcome switch
    {
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before uploading.", false, currentVersion: result.CurrentVersion)
    };
}).DisableAntiforgery();

api.MapGet("/projects/{id}/files/{fileId}", (string id, string fileId, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.read")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Read permission is required.", false);
    var project = projects.Get(user.Id, id);
    var asset = project is null ? null : (project.Book.SourceAssets ?? []).Concat(project.VoiceAndReferences.Assets).FirstOrDefault(item => item.Id == fileId);
    if (asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var folder = Path.Combine(dataDirectory, "uploads", user.Id, id);
    var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").SingleOrDefault() : null;
    if (path is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    return asset.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
        ? Results.File(path, asset.ContentType, enableRangeProcessing: true)
        : Results.File(path, asset.ContentType, asset.FileName, enableRangeProcessing: true);
});

api.MapDelete("/projects/{id}/files/{fileId}", (string id, string fileId, int version, HttpContext context, ProjectRepository projects) =>
{
    var user = CurrentUser(context);
    if (user is null) return Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false);
    if (!Can(user, "tasks.write")) return Error(context, 403, "auth.forbidden", "errors.auth.forbidden", "Write permission is required.", false);
    var project = projects.Get(user.Id, id);
    if (project is null) return Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false);
    if (project.Status != "draft") return Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false);
    if (!Guid.TryParseExact(fileId, "N", out _)) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var asset = (project.Book.SourceAssets ?? []).Concat(project.VoiceAndReferences.Assets).FirstOrDefault(item => item.Id == fileId);
    if (asset is null) return Error(context, 404, "file.not_found", "errors.http.notFound", "The file was not found.", false);
    var result = projects.RemoveAsset(user.Id, id, version, fileId);
    if (result.Outcome != SaveOutcome.Saved) return result.Outcome switch
    {
        SaveOutcome.NotFound => Error(context, 404, "project.not_found", "errors.project.notFound", "The application was not found.", false),
        SaveOutcome.NotEditable => Error(context, 409, "project.not_editable", "errors.project.notEditable", "This application is read-only.", false, currentVersion: result.CurrentVersion),
        _ => Error(context, 409, "project.version_conflict", "errors.project.versionConflict", "This application changed elsewhere. Reload before deleting.", false, currentVersion: result.CurrentVersion)
    };
    var folder = Path.Combine(dataDirectory, "uploads", user.Id, id);
    var path = Directory.Exists(folder) ? Directory.EnumerateFiles(folder, $"{fileId}_*").SingleOrDefault() : null;
    if (path is not null)
    {
        try { File.Delete(path); }
        catch (Exception exception) { app.Logger.LogWarning(exception, "Could not remove detached reference file {FileId}", fileId); }
    }
    return Results.Ok(result.Draft);
});

app.Run();

static CurrentUserDto? CurrentUser(HttpContext context)
{
    var userId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
    return string.IsNullOrWhiteSpace(userId) ? null : context.RequestServices.GetRequiredService<UserRepository>().Get(userId);
}

static Task SignIn(HttpContext context, CurrentUserDto user, bool persistent)
{
    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, user.Id), new Claim(ClaimTypes.Name, user.DisplayName)],
        CookieAuthenticationDefaults.AuthenticationScheme);
    var properties = new AuthenticationProperties
    {
        IsPersistent = persistent,
        AllowRefresh = true,
        ExpiresUtc = DateTimeOffset.UtcNow.Add(persistent ? TimeSpan.FromDays(30) : TimeSpan.FromHours(8))
    };
    return context.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity), properties);
}
static bool Can(CurrentUserDto user, string permission) => user.Permissions.Contains(permission, StringComparer.Ordinal);
static string Locale(HttpContext context)
{
    var value = context.Request.Headers.AcceptLanguage.ToString();
    return value.StartsWith("en-US", StringComparison.OrdinalIgnoreCase) ? "en-US" : "zh-CN";
}

static string NormalizeContentType(string contentType, string fileName)
{
    var expected = Path.GetExtension(fileName).ToLowerInvariant() switch
    {
        ".txt" => "text/plain", ".pdf" => "application/pdf", ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".mp4" => "video/mp4", ".mov" => "video/quicktime",
        _ => "application/octet-stream"
    };
    return string.IsNullOrWhiteSpace(contentType) || contentType.Equals("application/octet-stream", StringComparison.OrdinalIgnoreCase) || contentType.Equals(expected, StringComparison.OrdinalIgnoreCase)
        ? expected : "application/octet-stream";
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
