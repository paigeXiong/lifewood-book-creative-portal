using Lifewood.TestApi.Contracts;
using Lifewood.TestApi.Features;
using Lifewood.TestApi.Persistence;
using Lifewood.TestApi.Serialization;

var builder = WebApplication.CreateSlimBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 510_000_000);
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => options.MultipartBodyLengthLimit = 510_000_000);

builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonContext.Default));
builder.Services.AddOpenApi();

var dataDirectory = Path.Combine(builder.Environment.ContentRootPath, "data");
var voiceSampleDirectory = Path.Combine(AppContext.BaseDirectory, "assets", "voice-samples");
Directory.CreateDirectory(dataDirectory);
var repository = new ProjectRepository($"Data Source={Path.Combine(dataDirectory, "test-tasks.db")}");
repository.Initialize();
builder.Services.AddSingleton(repository);

var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.Append("X-Request-Id", context.TraceIdentifier);
    try { await next(); }
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

if (app.Environment.IsDevelopment()) app.MapOpenApi();

var api = app.MapGroup("/api");

api.MapGet("/health", () => TypedResults.Ok(new HealthDto("ok")));
if (app.Environment.IsDevelopment())
{
    api.MapGet("/auth/test-users", (HttpContext context) => IsLoopback(context)
        ? Results.Ok(TestUsers.All())
        : Error(context, 404, "http.not_found", "errors.http.notFound", "Not found.", false));
    api.MapPost("/auth/login", (LoginRequest request, HttpContext context) =>
    {
        if (!IsLoopback(context)) return Error(context, 404, "http.not_found", "errors.http.notFound", "Not found.", false);
        var user = TestUsers.Find(request.UserId);
        if (user is null) return Error(context, 400, "auth.unknown_user", "errors.auth.unknownUser", "Unknown local test user.", false);
        context.Response.Cookies.Append("lw_test_user", user.Id, new CookieOptions
        {
            HttpOnly = true, SameSite = SameSiteMode.Strict, Secure = false, IsEssential = true, MaxAge = TimeSpan.FromHours(8)
        });
        return Results.Ok(user);
    });
    api.MapPost("/auth/logout", (HttpContext context) => { context.Response.Cookies.Delete("lw_test_user"); return Results.NoContent(); });
}

api.MapGet("/me", (HttpContext context) =>
{
    var user = CurrentUser(context);
    return user is null
        ? Error(context, 401, "auth.unauthorized", "errors.auth.unauthorized", "Sign in is required.", false)
        : Results.Ok(user);
});

api.MapGet("/form-options", (HttpContext context) =>
    Results.Ok(FormOptionCatalog.ForLocale(Locale(context))));

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
    if (!context.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment() || !IsLoopback(context)) return null;
    return context.Request.Cookies.TryGetValue("lw_test_user", out var id) ? TestUsers.Find(id) : null;
}

static bool Can(CurrentUserDto user, string permission) => user.Permissions.Contains(permission, StringComparer.Ordinal);
static bool IsLoopback(HttpContext context) => context.Connection.RemoteIpAddress is { } ip && System.Net.IPAddress.IsLoopback(ip);

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
