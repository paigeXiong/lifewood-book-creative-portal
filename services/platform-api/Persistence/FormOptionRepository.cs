using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal enum FormOptionWriteOutcome { Saved, Invalid, Conflict }
internal sealed record FormOptionWriteResult(FormOptionWriteOutcome Outcome, string? Field = null);

internal static class FormOptionGroups
{
    public const string Brands = "brands";
    public const string VideoGoals = "video-goals";
    public const string Audiences = "audiences";
    public const string Genres = "genres";
    public const string ContentLanguages = "content-languages";
    public const string VideoDurations = "video-durations";
    public const string PublishingPlatforms = "publishing-platforms";
    public const string RoleTypes = "role-types";
    public const string AgeRanges = "age-ranges";
    public const string Genders = "genders";
    public const string VisualStyles = "visual-styles";
    public const string MoodTags = "mood-tags";
    public const string ImageStyleTags = "image-style-tags";
    public const string PaceTags = "pace-tags";
    public const string NarrationTones = "narration-tones";
    public const string SpeechRates = "speech-rates";
    public const string VoiceGenders = "voice-genders";
    public const string VoiceAges = "voice-ages";
    public const string Accents = "accents";
    public const string VoiceEmotions = "voice-emotions";

    public static readonly IReadOnlySet<string> Configurable = new HashSet<string>(
        [Brands, VideoGoals, Audiences, Genres, ContentLanguages, VideoDurations, PublishingPlatforms,
         RoleTypes, AgeRanges, Genders, VisualStyles, MoodTags, ImageStyleTags, PaceTags,
         NarrationTones, SpeechRates, VoiceGenders, VoiceAges, Accents, VoiceEmotions],
        StringComparer.Ordinal);
}

internal sealed class FormOptionRepository(string connectionString)
{
    public void Initialize()
    {
        using var connection = Open();
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS form_options (
                group_id TEXT NOT NULL,
                id TEXT NOT NULL,
                label_zh_cn TEXT NOT NULL,
                label_en_us TEXT NOT NULL,
                description_zh_cn TEXT NULL,
                description_en_us TEXT NULL,
                tone TEXT NULL,
                preview_color TEXT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (group_id, id)
            );
            CREATE INDEX IF NOT EXISTS ix_form_options_group_order
                ON form_options(group_id, enabled DESC, sort_order, id);
            """);

        var zh = FormOptionCatalog.ForLocale("zh-CN");
        var en = FormOptionCatalog.ForLocale("en-US");
        using var transaction = connection.BeginTransaction();
        foreach (var (groupId, zhItems, enItems) in DefaultGroups(zh, en))
        {
            var zhById = zhItems.ToDictionary(item => item.Id, StringComparer.Ordinal);
            for (var index = 0; index < enItems.Length; index++)
            {
                var enItem = enItems[index];
                if (!zhById.TryGetValue(enItem.Id, out var zhItem))
                    throw new InvalidOperationException($"Missing zh-CN form option for {groupId}/{enItem.Id}.");
                using var exists = connection.CreateCommand();
                exists.Transaction = transaction;
                exists.CommandText = "SELECT COUNT(*) FROM form_options WHERE group_id = $group AND id = $id;";
                exists.Parameters.AddWithValue("$group", groupId);
                exists.Parameters.AddWithValue("$id", enItem.Id);
                if (Convert.ToInt32(exists.ExecuteScalar()) != 0) continue;
                Save(connection, groupId, enItem.Id, new(
                    zhItem.Label, enItem.Label,
                    zhItem.Description, enItem.Description,
                    enItem.Tone, enItem.PreviewColor,
                    true, index * 10), transaction);
            }
        }
        transaction.Commit();
    }

    public FormOptionsDto ForLocale(string locale)
    {
        var defaults = FormOptionCatalog.ForLocale(locale);
        return defaults with
        {
            Brands = EnabledForLocale(FormOptionGroups.Brands, locale),
            VideoGoals = EnabledForLocale(FormOptionGroups.VideoGoals, locale),
            Audiences = EnabledForLocale(FormOptionGroups.Audiences, locale),
            Genres = EnabledForLocale(FormOptionGroups.Genres, locale),
            ContentLanguages = EnabledForLocale(FormOptionGroups.ContentLanguages, locale),
            VideoDurations = EnabledForLocale(FormOptionGroups.VideoDurations, locale),
            PublishingPlatforms = EnabledForLocale(FormOptionGroups.PublishingPlatforms, locale),
            RoleTypes = EnabledForLocale(FormOptionGroups.RoleTypes, locale),
            AgeRanges = EnabledForLocale(FormOptionGroups.AgeRanges, locale),
            Genders = EnabledForLocale(FormOptionGroups.Genders, locale),
            VisualStyles = EnabledForLocale(FormOptionGroups.VisualStyles, locale),
            MoodTags = EnabledForLocale(FormOptionGroups.MoodTags, locale),
            ImageStyleTags = EnabledForLocale(FormOptionGroups.ImageStyleTags, locale),
            PaceTags = EnabledForLocale(FormOptionGroups.PaceTags, locale),
            NarrationTones = EnabledForLocale(FormOptionGroups.NarrationTones, locale),
            SpeechRates = EnabledForLocale(FormOptionGroups.SpeechRates, locale),
            VoiceGenders = EnabledForLocale(FormOptionGroups.VoiceGenders, locale),
            VoiceAges = EnabledForLocale(FormOptionGroups.VoiceAges, locale),
            Accents = EnabledForLocale(FormOptionGroups.Accents, locale),
            VoiceEmotions = EnabledForLocale(FormOptionGroups.VoiceEmotions, locale)
        };
    }

    public AdminFormOptionDto[] ListAdmin(string groupId)
    {
        if (!FormOptionGroups.Configurable.Contains(groupId)) return [];
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT group_id, id, label_zh_cn, label_en_us, description_zh_cn, description_en_us,
                   tone, preview_color, enabled, sort_order, updated_at
            FROM form_options WHERE group_id = $group ORDER BY sort_order, id;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        using var reader = command.ExecuteReader();
        var items = new List<AdminFormOptionDto>();
        while (reader.Read()) items.Add(ReadAdmin(reader));
        return [.. items];
    }

    public IReadOnlySet<string> EnabledIds(string groupId)
    {
        if (!FormOptionGroups.Configurable.Contains(groupId)) return new HashSet<string>(StringComparer.Ordinal);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id FROM form_options WHERE group_id = $group AND enabled = 1;";
        command.Parameters.AddWithValue("$group", groupId);
        using var reader = command.ExecuteReader();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        while (reader.Read()) ids.Add(reader.GetString(0));
        return ids;
    }

    public FormOptionWriteResult Upsert(string groupId, string id, UpsertFormOptionRequest? request, out AdminFormOptionDto? item)
    {
        item = null;
        if (!FormOptionGroups.Configurable.Contains(groupId)) return new(FormOptionWriteOutcome.Invalid, "groupId");
        if (!ValidId(id)) return new(FormOptionWriteOutcome.Invalid, "id");
        if (request is null) return new(FormOptionWriteOutcome.Invalid, "request");
        if (!ValidText(request.LabelZhCn, 100)) return new(FormOptionWriteOutcome.Invalid, "labelZhCn");
        if (!ValidText(request.LabelEnUs, 100)) return new(FormOptionWriteOutcome.Invalid, "labelEnUs");
        if (!OptionalText(request.DescriptionZhCn, 300)) return new(FormOptionWriteOutcome.Invalid, "descriptionZhCn");
        if (!OptionalText(request.DescriptionEnUs, 300)) return new(FormOptionWriteOutcome.Invalid, "descriptionEnUs");
        if (request.SortOrder is < 0 or > 10000) return new(FormOptionWriteOutcome.Invalid, "sortOrder");
        if (request.Tone is not null && request.Tone is not ("neutral" or "info" or "warning" or "success" or "danger"))
            return new(FormOptionWriteOutcome.Invalid, "tone");
        if (request.PreviewColor is not null && !ValidColor(request.PreviewColor)) return new(FormOptionWriteOutcome.Invalid, "previewColor");

        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        var current = GetAdmin(connection, groupId, id, transaction);
        if (current is not null && request.ExpectedUpdatedAt != current.UpdatedAt) return new(FormOptionWriteOutcome.Conflict);
        if (current is null && request.ExpectedUpdatedAt is not null) return new(FormOptionWriteOutcome.Conflict);

        Save(connection, groupId, id, request with
        {
            LabelZhCn = request.LabelZhCn.Trim(),
            LabelEnUs = request.LabelEnUs.Trim(),
            DescriptionZhCn = NullIfBlank(request.DescriptionZhCn),
            DescriptionEnUs = NullIfBlank(request.DescriptionEnUs),
            PreviewColor = NullIfBlank(request.PreviewColor)
        }, transaction);
        item = GetAdmin(connection, groupId, id, transaction);
        transaction.Commit();
        return new(FormOptionWriteOutcome.Saved);
    }

    private ConfigOptionDto[] EnabledForLocale(string groupId, string locale)
    {
        var english = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, label_zh_cn, label_en_us, description_zh_cn, description_en_us, tone, preview_color
            FROM form_options WHERE group_id = $group AND enabled = 1 ORDER BY sort_order, id;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        using var reader = command.ExecuteReader();
        var items = new List<ConfigOptionDto>();
        while (reader.Read()) items.Add(new(
            reader.GetString(0), reader.GetString(english ? 2 : 1),
            reader.IsDBNull(english ? 4 : 3) ? null : reader.GetString(english ? 4 : 3),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6)));
        return [.. items];
    }

    private static IEnumerable<(string GroupId, ConfigOptionDto[] Zh, ConfigOptionDto[] En)> DefaultGroups(FormOptionsDto zh, FormOptionsDto en)
    {
        yield return (FormOptionGroups.Brands, zh.Brands, en.Brands);
        yield return (FormOptionGroups.VideoGoals, zh.VideoGoals, en.VideoGoals);
        yield return (FormOptionGroups.Audiences, zh.Audiences, en.Audiences);
        yield return (FormOptionGroups.Genres, zh.Genres, en.Genres);
        yield return (FormOptionGroups.ContentLanguages, zh.ContentLanguages, en.ContentLanguages);
        yield return (FormOptionGroups.VideoDurations, zh.VideoDurations, en.VideoDurations);
        yield return (FormOptionGroups.PublishingPlatforms, zh.PublishingPlatforms, en.PublishingPlatforms);
        yield return (FormOptionGroups.RoleTypes, zh.RoleTypes, en.RoleTypes);
        yield return (FormOptionGroups.AgeRanges, zh.AgeRanges, en.AgeRanges);
        yield return (FormOptionGroups.Genders, zh.Genders, en.Genders);
        yield return (FormOptionGroups.VisualStyles, zh.VisualStyles, en.VisualStyles);
        yield return (FormOptionGroups.MoodTags, zh.MoodTags, en.MoodTags);
        yield return (FormOptionGroups.ImageStyleTags, zh.ImageStyleTags, en.ImageStyleTags);
        yield return (FormOptionGroups.PaceTags, zh.PaceTags, en.PaceTags);
        yield return (FormOptionGroups.NarrationTones, zh.NarrationTones, en.NarrationTones);
        yield return (FormOptionGroups.SpeechRates, zh.SpeechRates, en.SpeechRates);
        yield return (FormOptionGroups.VoiceGenders, zh.VoiceGenders, en.VoiceGenders);
        yield return (FormOptionGroups.VoiceAges, zh.VoiceAges, en.VoiceAges);
        yield return (FormOptionGroups.Accents, zh.Accents, en.Accents);
        yield return (FormOptionGroups.VoiceEmotions, zh.VoiceEmotions, en.VoiceEmotions);
    }

    private static void Save(SqliteConnection connection, string groupId, string id, UpsertFormOptionRequest request, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO form_options(group_id, id, label_zh_cn, label_en_us, description_zh_cn, description_en_us,
                                     tone, preview_color, enabled, sort_order, updated_at)
            VALUES($group, $id, $labelZh, $labelEn, $descriptionZh, $descriptionEn,
                   $tone, $previewColor, $enabled, $sortOrder, $updatedAt)
            ON CONFLICT(group_id, id) DO UPDATE SET
                label_zh_cn = excluded.label_zh_cn, label_en_us = excluded.label_en_us,
                description_zh_cn = excluded.description_zh_cn, description_en_us = excluded.description_en_us,
                tone = excluded.tone, preview_color = excluded.preview_color,
                enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$labelZh", request.LabelZhCn);
        command.Parameters.AddWithValue("$labelEn", request.LabelEnUs);
        command.Parameters.AddWithValue("$descriptionZh", (object?)request.DescriptionZhCn ?? DBNull.Value);
        command.Parameters.AddWithValue("$descriptionEn", (object?)request.DescriptionEnUs ?? DBNull.Value);
        command.Parameters.AddWithValue("$tone", (object?)request.Tone ?? DBNull.Value);
        command.Parameters.AddWithValue("$previewColor", (object?)request.PreviewColor ?? DBNull.Value);
        command.Parameters.AddWithValue("$enabled", request.Enabled ? 1 : 0);
        command.Parameters.AddWithValue("$sortOrder", request.SortOrder);
        command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    private static AdminFormOptionDto? GetAdmin(SqliteConnection connection, string groupId, string id, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT group_id, id, label_zh_cn, label_en_us, description_zh_cn, description_en_us,
                   tone, preview_color, enabled, sort_order, updated_at
            FROM form_options WHERE group_id = $group AND id = $id;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadAdmin(reader) : null;
    }

    private static AdminFormOptionDto ReadAdmin(SqliteDataReader reader) => new(
        reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
        reader.IsDBNull(4) ? null : reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5),
        reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.GetInt32(8) == 1, reader.GetInt32(9),
        DateTimeOffset.Parse(reader.GetString(10), System.Globalization.CultureInfo.InvariantCulture));

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static bool ValidText(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool OptionalText(string? value, int max) => value is null || value.Trim().Length <= max;
    private static bool ValidColor(string value) => value.Length == 7 && value[0] == '#' && value[1..].All(Uri.IsHexDigit);
    private static bool ValidId(string value) => value.Length is >= 2 and <= 64 && value.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
    private static void Execute(SqliteConnection connection, string sql) { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private SqliteConnection Open() { var connection = new SqliteConnection(connectionString); connection.Open(); Execute(connection, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); return connection; }
}
