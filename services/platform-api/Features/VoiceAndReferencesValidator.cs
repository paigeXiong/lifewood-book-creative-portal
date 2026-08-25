using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class VoiceAndReferencesValidator
{
    public static FieldErrorDto[] Validate(SaveVoiceAndReferencesRequest? request, IReadOnlySet<string> enabledVoiceIds)
    {
        var errors = new List<FieldErrorDto>();
        if (request?.VoiceAndReferences is null)
        {
            errors.Add(Error("voiceAndReferences", "required"));
            return [.. errors];
        }

        var step = request.VoiceAndReferences;
        var voice = step.Voiceover;
        if (voice is null) errors.Add(Error("voiceAndReferences.voiceover", "required"));
        else
        {
            Action<List<FieldErrorDto>, string, string?, IReadOnlySet<string>> optionRule =
                request.RequireComplete ? RequiredOption : OptionalOption;
            optionRule(errors, "voiceAndReferences.voiceover.contentLanguageId", voice.ContentLanguageId, FormOptionCatalog.ContentLanguageIds);
            optionRule(errors, "voiceAndReferences.voiceover.narrationToneId", voice.NarrationToneId, FormOptionCatalog.NarrationToneIds);
            optionRule(errors, "voiceAndReferences.voiceover.speechRateId", voice.SpeechRateId, FormOptionCatalog.SpeechRateIds);
            OptionalOption(errors, "voiceAndReferences.voiceover.voiceGenderId", voice.VoiceGenderId, FormOptionCatalog.VoiceGenderIds);
            OptionalOption(errors, "voiceAndReferences.voiceover.voiceAgeId", voice.VoiceAgeId, FormOptionCatalog.VoiceAgeIds);
            OptionalOption(errors, "voiceAndReferences.voiceover.accentId", voice.AccentId, FormOptionCatalog.AccentIds);
            OptionalOption(errors, "voiceAndReferences.voiceover.emotionStyleId", voice.EmotionStyleId, FormOptionCatalog.VoiceEmotionIds);
            Max(errors, "voiceAndReferences.voiceover.pronunciationNotes", voice.PronunciationNotes, 200);
            Max(errors, "voiceAndReferences.voiceover.customVoiceDescription", voice.CustomVoiceDescription, 300);
            if (voice.SelectedVoiceIds is null) errors.Add(Error("voiceAndReferences.voiceover.selectedVoiceIds", "required"));
            var selectedVoiceIds = voice.SelectedVoiceIds ?? [];
            Options(errors, "voiceAndReferences.voiceover.selectedVoiceIds", selectedVoiceIds, enabledVoiceIds, FormOptionCatalog.MaxSelectedVoices);
            if (!string.IsNullOrWhiteSpace(voice.PreferredVoiceId) && !selectedVoiceIds.Contains(voice.PreferredVoiceId, StringComparer.Ordinal))
                errors.Add(Error("voiceAndReferences.voiceover.preferredVoiceId", "invalid"));
        }

        if (step.Assets is null) errors.Add(Error("voiceAndReferences.assets", "required"));
        var assets = step.Assets ?? [];
        if (assets.Length > 38) errors.Add(Error("voiceAndReferences.assets", "too_many"));
        var categories = FormOptionCatalog.ForLocale("en-US").ReferenceCategories.ToDictionary(item => item.Id, StringComparer.Ordinal);
        foreach (var asset in assets)
        {
            if (asset is null) { errors.Add(Error("voiceAndReferences.assets", "invalid")); continue; }
            if (string.IsNullOrWhiteSpace(asset.Id) || string.IsNullOrWhiteSpace(asset.CategoryId) || string.IsNullOrWhiteSpace(asset.FileName) ||
                string.IsNullOrWhiteSpace(asset.ContentType) || string.IsNullOrWhiteSpace(asset.Url))
            {
                errors.Add(Error("voiceAndReferences.assets", "invalid"));
                continue;
            }
            if (!categories.TryGetValue(asset.CategoryId, out var category)) errors.Add(Error("voiceAndReferences.assets", "unknown_option"));
            else if (asset.SizeBytes > category.MaxBytes || !category.Accept.Contains(asset.ContentType, StringComparer.OrdinalIgnoreCase)) errors.Add(Error("voiceAndReferences.assets", "file"));
            if (!Guid.TryParseExact(asset.Id, "N", out _) || string.IsNullOrWhiteSpace(asset.FileName) || asset.SizeBytes <= 0) errors.Add(Error("voiceAndReferences.assets", "invalid"));
        }
        foreach (var group in assets.Where(asset => asset is not null && !string.IsNullOrWhiteSpace(asset.CategoryId)).GroupBy(asset => asset.CategoryId))
            if (categories.TryGetValue(group.Key, out var category) && group.Count() > category.MaxFiles) errors.Add(Error("voiceAndReferences.assets", "too_many"));
        if (step.CompetitorUrls is null) errors.Add(Error("voiceAndReferences.competitorUrls", "required"));
        var competitorUrls = step.CompetitorUrls ?? [];
        if (competitorUrls.Length > 5) errors.Add(Error("voiceAndReferences.competitorUrls", "too_many"));
        foreach (var url in competitorUrls)
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps)) errors.Add(Error("voiceAndReferences.competitorUrls", "url"));

        var direction = step.CreativeDirection;
        if (direction is null) errors.Add(Error("voiceAndReferences.creativeDirection", "required"));
        else
        {
            if (direction.CoreMessage is null) errors.Add(Error("voiceAndReferences.creativeDirection.coreMessage", "required"));
            if (request.RequireComplete && string.IsNullOrWhiteSpace(direction.CoreMessage)) errors.Add(Error("voiceAndReferences.creativeDirection.coreMessage", "required"));
            Max(errors, "voiceAndReferences.creativeDirection.coreMessage", direction.CoreMessage, 300);
            Max(errors, "voiceAndReferences.creativeDirection.requiredScenes", direction.RequiredScenes, 300);
            Max(errors, "voiceAndReferences.creativeDirection.authorPreferences", direction.AuthorPreferences, 300);
            Max(errors, "voiceAndReferences.creativeDirection.closingMessage", direction.ClosingMessage, 300);
            Max(errors, "voiceAndReferences.creativeDirection.musicMood", direction.MusicMood, 200);
            Max(errors, "voiceAndReferences.creativeDirection.avoidContent", direction.AvoidContent, 200);
        }
        return [.. errors];
    }

    private static void RequiredOption(List<FieldErrorDto> errors, string field, string? value, IReadOnlySet<string> allowed)
    {
        if (string.IsNullOrWhiteSpace(value)) errors.Add(Error(field, "required")); else if (!allowed.Contains(value)) errors.Add(Error(field, "unknown_option"));
    }
    private static void OptionalOption(List<FieldErrorDto> errors, string field, string? value, IReadOnlySet<string> allowed)
    { if (!string.IsNullOrWhiteSpace(value) && !allowed.Contains(value)) errors.Add(Error(field, "unknown_option")); }
    private static void Options(List<FieldErrorDto> errors, string field, string[] values, IReadOnlySet<string> allowed, int max)
    { if (values.Length > max) errors.Add(Error(field, "too_many")); if (values.Any(value => !allowed.Contains(value))) errors.Add(Error(field, "unknown_option")); }
    private static void Max(List<FieldErrorDto> errors, string field, string? value, int max)
    { if (value?.Length > max) errors.Add(Error(field, "max_length")); }
    private static FieldErrorDto Error(string field, string code) => new(field, code, $"errors.validation.{code}");
}
