using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;

namespace Lifewood.PlatformApi.Features;

internal static class CreativeValidator
{
    public static FieldErrorDto[] Validate(SaveCreativeRequest? request, FormOptionRepository options, TaskDraftDto? current = null)
    {
        if (request?.Creative is null) return [Error("creative", "required")];
        var creative = request.Creative;
        var previous = current?.Creative;
        var errors = new List<FieldErrorDto>();
        if (creative.Characters is null) errors.Add(Error("creative.characters", "required"));
        else if (creative.Characters.Length > 12) errors.Add(Error("creative.characters", "too_many"));
        else
        {
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < creative.Characters.Length; index++)
            {
                var character = creative.Characters[index];
                var prefix = $"creative.characters.{index}";
                if (character is null) { errors.Add(Error(prefix, "required")); continue; }
                var previousCharacter = previous?.Characters.FirstOrDefault(item => item.Id == character.Id);
                if (string.IsNullOrWhiteSpace(character.Id) || character.Id.Length > 80 || !ids.Add(character.Id)) errors.Add(Error($"{prefix}.id", "invalid"));
                Text(errors, $"{prefix}.name", character.Name, 80);
                Text(errors, $"{prefix}.storyRole", character.StoryRole, 200);
                Text(errors, $"{prefix}.personality", character.Personality, 300);
                Text(errors, $"{prefix}.appearance", character.Appearance, 300);
                Text(errors, $"{prefix}.clothing", character.Clothing, 200, true);
                Text(errors, $"{prefix}.emotion", character.Emotion, 150, true);
                Text(errors, $"{prefix}.voiceHint", character.VoiceHint, 100, true);
                Option(errors, $"{prefix}.roleTypeId", character.RoleTypeId, Allowed(options, FormOptionGroups.RoleTypes, previousCharacter?.RoleTypeId), true);
                Option(errors, $"{prefix}.ageRangeId", character.AgeRangeId, Allowed(options, FormOptionGroups.AgeRanges, previousCharacter?.AgeRangeId), true);
                Option(errors, $"{prefix}.genderId", character.GenderId, Allowed(options, FormOptionGroups.Genders, previousCharacter?.GenderId), true);
                Urls(errors, $"{prefix}.referenceImageUrls", character.ReferenceImageUrls, 6);
            }
        }

        Option(errors, "creative.visualStyleId", creative.VisualStyleId, Allowed(options, FormOptionGroups.VisualStyles, previous?.VisualStyleId), true);
        Options(errors, "creative.moodTagIds", creative.MoodTagIds, AllowedMany(options, FormOptionGroups.MoodTags, previous?.MoodTagIds), 6);
        Options(errors, "creative.imageStyleTagIds", creative.ImageStyleTagIds, AllowedMany(options, FormOptionGroups.ImageStyleTags, previous?.ImageStyleTagIds), 6);
        Options(errors, "creative.paceTagIds", creative.PaceTagIds, AllowedMany(options, FormOptionGroups.PaceTags, previous?.PaceTagIds), 4);
        Urls(errors, "creative.styleReferenceImageUrls", creative.StyleReferenceImageUrls, 6);
        return [.. errors];
    }

    private static IReadOnlySet<string> Allowed(FormOptionRepository options, string groupId, params string?[] previous)
        => AllowedMany(options, groupId, previous.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));

    private static IReadOnlySet<string> AllowedMany(FormOptionRepository options, string groupId, IEnumerable<string>? previous)
    {
        var allowed = new HashSet<string>(options.EnabledIds(groupId), StringComparer.Ordinal);
        if (previous is not null) allowed.UnionWith(previous.Where(value => !string.IsNullOrWhiteSpace(value)));
        return allowed;
    }

    private static void Text(List<FieldErrorDto> errors, string field, string? value, int max, bool optional = false)
    {
        if (value is null) { if (!optional) errors.Add(Error(field, "required")); }
        else if (value.Length > max) errors.Add(Error(field, "max_length"));
    }

    private static void Option(List<FieldErrorDto> errors, string field, string? value, IReadOnlySet<string> allowed, bool optional)
    {
        if (string.IsNullOrWhiteSpace(value)) { if (!optional) errors.Add(Error(field, "required")); return; }
        if (!allowed.Contains(value)) errors.Add(Error(field, "unknown_option"));
    }

    private static void Options(List<FieldErrorDto> errors, string field, string[]? values, IReadOnlySet<string> allowed, int max)
    {
        if (values is null) { errors.Add(Error(field, "required")); return; }
        if (values.Length > max) errors.Add(Error(field, "too_many"));
        if (values.Distinct(StringComparer.Ordinal).Count() != values.Length || values.Any(value => !allowed.Contains(value))) errors.Add(Error(field, "unknown_option"));
    }

    private static void Urls(List<FieldErrorDto> errors, string field, string[]? values, int max)
    {
        if (values is null) { errors.Add(Error(field, "required")); return; }
        if (values.Length > max) errors.Add(Error(field, "too_many"));
        if (values.Any(value => value.Length > 2_000 || !Uri.TryCreate(value, UriKind.RelativeOrAbsolute, out _))) errors.Add(Error(field, "url"));
    }

    private static FieldErrorDto Error(string field, string code) => new(field, code, $"errors.validation.{code}");
}
