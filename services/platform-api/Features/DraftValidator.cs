using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class DraftValidator
{
    public static FieldErrorDto[] Validate(SaveDraftRequest? request)
    {
        var errors = new List<FieldErrorDto>();
        if (request is null) return [Error("request", "required")];
        if (request.Project is null)
        {
            errors.Add(Error("project", "required"));
            return errors.ToArray();
        }
        if (request.Book is null)
        {
            errors.Add(Error("book", "required"));
            return errors.ToArray();
        }

        Max(errors, "project.clientName", request.Project.ClientName, 200);
        Max(errors, "project.contactName", request.Project.ContactName, 100);
        Max(errors, "project.email", request.Project.Email, 254);
        Max(errors, "project.phone", request.Project.Phone, 50, optional: true);
        Max(errors, "project.projectName", request.Project.ProjectName, 200);
        Max(errors, "book.title", request.Book.Title, 200);
        Max(errors, "book.subtitle", request.Book.Subtitle, 200, optional: true);
        Max(errors, "book.authorName", request.Book.AuthorName, 100);
        Max(errors, "book.sellingPoint", request.Book.SellingPoint, 150);
        Max(errors, "book.synopsis", request.Book.Synopsis, 600);

        if (!string.IsNullOrWhiteSpace(request.Project.Email) &&
            !System.Net.Mail.MailAddress.TryCreate(request.Project.Email, out _))
            errors.Add(Error("project.email", "email"));

        if (request.Project.AudienceIds is null)
            errors.Add(Error("project.audienceIds", "required"));
        else if (request.Project.AudienceIds.Length > 30)
            errors.Add(Error("project.audienceIds", "too_many"));

        if (request.Book.PublishingPlatformIds is null)
            errors.Add(Error("book.publishingPlatformIds", "required"));
        else if (request.Book.PublishingPlatformIds.Length > 30)
            errors.Add(Error("book.publishingPlatformIds", "too_many"));

        if (!string.IsNullOrWhiteSpace(request.Project.Deadline) &&
            !DateOnly.TryParseExact(request.Project.Deadline, "yyyy-MM-dd", out _))
            errors.Add(Error("project.deadline", "date"));
        else if (DateOnly.TryParseExact(request.Project.Deadline, "yyyy-MM-dd", out var deadline) && deadline < DateOnly.FromDateTime(DateTime.Today))
            errors.Add(Error("project.deadline", "past_date"));

        Option(errors, "project.brandId", request.Project.BrandId, FormOptionCatalog.BrandIds, optional: true);
        Option(errors, "project.videoGoalId", request.Project.VideoGoalId, FormOptionCatalog.VideoGoalIds, optional: true);
        Options(errors, "project.audienceIds", request.Project.AudienceIds, FormOptionCatalog.AudienceIds);
        Option(errors, "book.genreId", request.Book.GenreId, FormOptionCatalog.GenreIds, optional: true);
        Option(errors, "book.contentLanguageId", request.Book.ContentLanguageId, FormOptionCatalog.ContentLanguageIds, optional: true);
        Option(errors, "book.videoDurationId", request.Book.VideoDurationId, FormOptionCatalog.VideoDurationIds, optional: true);
        Options(errors, "book.publishingPlatformIds", request.Book.PublishingPlatformIds, FormOptionCatalog.PublishingPlatformIds);

        var assets = request.Book.SourceAssets;
        if (assets is null) errors.Add(Error("book.sourceAssets", "required"));
        else
        {
            var categories = FormOptionCatalog.ForLocale("en-US").SourceCategories.ToDictionary(item => item.Id, StringComparer.Ordinal);
            foreach (var asset in assets)
            {
                if (asset is null || string.IsNullOrWhiteSpace(asset.Id) || string.IsNullOrWhiteSpace(asset.CategoryId) ||
                    string.IsNullOrWhiteSpace(asset.FileName) || string.IsNullOrWhiteSpace(asset.ContentType) || string.IsNullOrWhiteSpace(asset.Url) ||
                    !Guid.TryParseExact(asset.Id, "N", out _) || asset.SizeBytes <= 0)
                {
                    errors.Add(Error("book.sourceAssets", "invalid"));
                    continue;
                }
                if (!categories.TryGetValue(asset.CategoryId, out var category)) errors.Add(Error("book.sourceAssets", "unknown_option"));
                else if (asset.SizeBytes > category.MaxBytes || !category.Accept.Contains(asset.ContentType, StringComparer.OrdinalIgnoreCase)) errors.Add(Error("book.sourceAssets", "file"));
            }
            foreach (var group in assets.Where(asset => asset is not null && !string.IsNullOrWhiteSpace(asset.CategoryId)).GroupBy(asset => asset.CategoryId))
                if (categories.TryGetValue(group.Key, out var category) && group.Count() > category.MaxFiles) errors.Add(Error("book.sourceAssets", "too_many"));
        }

        return errors.ToArray();
    }

    private static void Max(List<FieldErrorDto> errors, string field, string? value, int length, bool optional = false)
    {
        if (value is null && !optional)
        {
            errors.Add(Error(field, "required"));
        }
        else if (value is not null && value.Length > length)
        {
            errors.Add(Error(field, "max_length"));
        }
    }

    private static FieldErrorDto Error(string field, string code) =>
        new(field, code, $"errors.validation.{code}");

    private static void Option(List<FieldErrorDto> errors, string field, string? value, IReadOnlySet<string> allowed, bool optional = false)
    {
        if (string.IsNullOrWhiteSpace(value)) { if (!optional) errors.Add(Error(field, "required")); return; }
        if (value.Length > 80 || !allowed.Contains(value)) errors.Add(Error(field, "unknown_option"));
    }

    private static void Options(List<FieldErrorDto> errors, string field, string[]? values, IReadOnlySet<string> allowed)
    {
        if (values is null) return;
        if (values.Distinct(StringComparer.Ordinal).Count() != values.Length || values.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 80 || !allowed.Contains(value)))
            errors.Add(Error(field, "unknown_option"));
    }
}
