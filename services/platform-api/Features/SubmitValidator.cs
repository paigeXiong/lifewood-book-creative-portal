using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;

namespace Lifewood.PlatformApi.Features;

internal static class SubmitValidator
{
    public static FieldErrorDto[] Validate(TaskDraftDto draft, IReadOnlySet<string> enabledVoiceIds, FormOptionRepository options, FileCategoryRepository fileCategories)
    {
        var errors = new List<FieldErrorDto>();
        errors.AddRange(DraftValidator.Validate(new SaveDraftRequest(draft.Version, draft.Project, draft.Book), options, fileCategories, draft));
        errors.AddRange(CreativeValidator.Validate(new SaveCreativeRequest(draft.Version, draft.Creative), options, draft));
        errors.AddRange(VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(draft.Version, draft.VoiceAndReferences, true), enabledVoiceIds, options, fileCategories, draft));

        Required(errors, "project.clientName", draft.Project.ClientName);
        Required(errors, "project.contactName", draft.Project.ContactName);
        Required(errors, "project.email", draft.Project.Email);
        Required(errors, "project.videoGoalId", draft.Project.VideoGoalId);
        if (draft.Project.AudienceIds.Length == 0) errors.Add(Error("project.audienceIds"));
        Required(errors, "book.title", draft.Book.Title);
        Required(errors, "book.authorName", draft.Book.AuthorName);
        Required(errors, "book.genreId", draft.Book.GenreId);
        Required(errors, "book.contentLanguageId", draft.Book.ContentLanguageId);
        Required(errors, "book.videoDurationId", draft.Book.VideoDurationId);
        foreach (var category in fileCategories.ForLocale(FileCategoryScopes.Source, "en-US").Where(category => category.Required))
            if (!(draft.Book.SourceAssets ?? []).Any(asset => asset.CategoryId == category.Id)) errors.Add(Error($"book.sourceAssets.{category.Id}"));
        if (draft.Creative.Characters.Length == 0) errors.Add(Error("creative.characters"));
        foreach (var (character, index) in draft.Creative.Characters.Select((value, index) => (value, index)))
        {
            Required(errors, $"creative.characters.{index}.roleTypeId", character.RoleTypeId);
            Required(errors, $"creative.characters.{index}.name", character.Name);
            Required(errors, $"creative.characters.{index}.storyRole", character.StoryRole);
            Required(errors, $"creative.characters.{index}.personality", character.Personality);
            Required(errors, $"creative.characters.{index}.appearance", character.Appearance);
        }
        Required(errors, "creative.visualStyleId", draft.Creative.VisualStyleId);
        return errors.Distinct().ToArray();
    }

    private static void Required(List<FieldErrorDto> errors, string field, string? value)
    { if (string.IsNullOrWhiteSpace(value)) errors.Add(Error(field)); }

    private static FieldErrorDto Error(string field) => new(field, "required", "errors.validation.required");
}
