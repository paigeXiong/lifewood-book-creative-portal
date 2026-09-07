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
    public const string VoiceTags = "voice-tags";

    public static readonly IReadOnlySet<string> Configurable = new HashSet<string>(
        [Brands, VideoGoals, Audiences, Genres, ContentLanguages, VideoDurations, PublishingPlatforms,
         RoleTypes, AgeRanges, Genders, VisualStyles, MoodTags, ImageStyleTags, PaceTags,
         NarrationTones, SpeechRates, VoiceGenders, VoiceAges, Accents, VoiceEmotions, VoiceTags],
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
                allows_custom_value INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (group_id, id)
            );
            CREATE INDEX IF NOT EXISTS ix_form_options_group_order
                ON form_options(group_id, enabled DESC, sort_order, id);
            CREATE TABLE IF NOT EXISTS form_option_catalog_migrations (
                id TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            """);
        if (!HasColumn(connection, "form_options", "is_removed")) Execute(connection, "ALTER TABLE form_options ADD COLUMN is_removed INTEGER NOT NULL DEFAULT 0;");
        var zh = FormOptionCatalog.ForLocale("zh-CN");
        foreach (var column in new[] { "preview_image_url", "preview_video_url" })
            if (!HasColumn(connection, "form_options", column))
                Execute(connection, $"ALTER TABLE form_options ADD COLUMN {column} TEXT NULL;");
        var en = FormOptionCatalog.ForLocale("en-US");
        if (!HasColumn(connection, "form_options", "allows_custom_value"))
        {
            using var migration = connection.BeginTransaction();
            using var addColumn = connection.CreateCommand();
            addColumn.Transaction = migration;
            addColumn.CommandText = "ALTER TABLE form_options ADD COLUMN allows_custom_value INTEGER NOT NULL DEFAULT 0;";
            addColumn.ExecuteNonQuery();
            foreach (var customOption in en.VideoDurations.Where(option => option.AllowsCustomValue))
            {
                using var migrateCustom = connection.CreateCommand();
                migrateCustom.Transaction = migration;
                migrateCustom.CommandText = "UPDATE form_options SET allows_custom_value = 1 WHERE group_id = $group AND id = $id;";
                migrateCustom.Parameters.AddWithValue("$group", FormOptionGroups.VideoDurations);
                migrateCustom.Parameters.AddWithValue("$id", customOption.Id);
                migrateCustom.ExecuteNonQuery();
            }
            migration.Commit();
        }

        using var transaction = connection.BeginTransaction();
        ApplyCatalogMigration(connection, transaction, "remove-tiktok-platform-v1", () =>
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "UPDATE form_options SET enabled = 0 WHERE group_id = $group AND id = 'tiktok';";
            command.Parameters.AddWithValue("$group", FormOptionGroups.PublishingPlatforms);
            command.ExecuteNonQuery();
        });
        ApplyCatalogMigration(connection, transaction, "image-style-color-tones-v1", () =>
            MigrateColorTones(connection, transaction));
        ApplyCatalogMigration(connection, transaction, "content-language-autonyms-v1", () =>
            MigrateDefaultContentLanguageLabels(connection, transaction));
        ApplyCatalogMigration(connection, transaction, "broad-project-taxonomy-v1", () =>
            MigrateBroadProjectTaxonomy(connection, transaction));
        ApplyCatalogMigration(connection, transaction, "broad-project-taxonomy-order-v1", () =>
            NormalizeBroadProjectTaxonomyOrder(connection, transaction));
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
                    true, index * 10, AllowsCustomValue: enItem.AllowsCustomValue), transaction);
            }
        }
        transaction.Commit();
        InstallRemovalGuards(connection);
    }

    private static void MigrateColorTones(SqliteConnection connection, SqliteTransaction transaction)
    {
        // Retire only untouched built-ins; preserve administrator names and all project selections.
        (string Id, string Zh, string En)[] legacy =
        [
            ("natural-light", "自然光", "Natural light"), ("high-contrast", "高对比", "High contrast"),
            ("soft-texture", "柔和质感", "Soft texture"), ("graphic-shapes", "图形构成", "Graphic shapes"),
            ("vintage", "复古", "Vintage"), ("modern", "现代", "Modern")
        ];
        foreach (var item in legacy)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE form_options SET enabled = 0
                WHERE group_id = $group AND id = $id
                  AND label_zh_cn = $zh AND label_en_us = $en;
                """;
            command.Parameters.AddWithValue("$group", FormOptionGroups.ImageStyleTags);
            command.Parameters.AddWithValue("$id", item.Id);
            command.Parameters.AddWithValue("$zh", item.Zh);
            command.Parameters.AddWithValue("$en", item.En);
            command.ExecuteNonQuery();
        }
    }

    private static void ApplyCatalogMigration(SqliteConnection connection, SqliteTransaction transaction, string id, Action migrate)
    {
        using var exists = connection.CreateCommand();
        exists.Transaction = transaction;
        exists.CommandText = "SELECT COUNT(*) FROM form_option_catalog_migrations WHERE id = $id;";
        exists.Parameters.AddWithValue("$id", id);
        if (Convert.ToInt32(exists.ExecuteScalar()) != 0) return;

        migrate();
        using var record = connection.CreateCommand();
        record.Transaction = transaction;
        record.CommandText = "INSERT INTO form_option_catalog_migrations(id, applied_at) VALUES($id, $appliedAt);";
        record.Parameters.AddWithValue("$id", id);
        record.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
        record.ExecuteNonQuery();
    }

    private static void MigrateDefaultContentLanguageLabels(SqliteConnection connection, SqliteTransaction transaction)
    {
        UpdateLegacyDefault("en-US", "英语（美国）", "English (US)", "English (United States)");
        UpdateLegacyDefault("en-GB", "英语（英国）", "English (UK)", "English (United Kingdom)");
        UpdateLegacyDefault("zh-CN", "简体中文", "Chinese (Simplified)", "简体中文");

        void UpdateLegacyDefault(string id, string previousZhCn, string previousEnUs, string autonym)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE form_options
                SET label_zh_cn = $autonym, label_en_us = $autonym
                WHERE group_id = $group AND id = $id
                  AND label_zh_cn = $previousZhCn AND label_en_us = $previousEnUs;
                """;
            command.Parameters.AddWithValue("$autonym", autonym);
            command.Parameters.AddWithValue("$group", FormOptionGroups.ContentLanguages);
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$previousZhCn", previousZhCn);
            command.Parameters.AddWithValue("$previousEnUs", previousEnUs);
            command.ExecuteNonQuery();
        }
    }

    private static void MigrateBroadProjectTaxonomy(SqliteConnection connection, SqliteTransaction transaction)
    {
        DisableLegacyDefaults(FormOptionGroups.VideoGoals,
        [
            ("book-trailer", "图书预告片", "Book trailer"),
            ("new-release-launch", "新书发布", "New release launch"),
            ("series-promotion", "系列图书推广", "Book series promotion"),
            ("social-promotion", "社交媒体推广", "Social promotion"),
            ("audiobook-promotion", "有声书推广", "Audiobook promotion"),
            ("author-event", "作者活动", "Author event"),
            ("crowdfunding-campaign", "众筹推广", "Crowdfunding campaign"),
            ("educational-overview", "教育内容介绍", "Educational overview"),
            ("internal-presentation", "内部展示", "Internal presentation")
        ]);
        DisableLegacyDefaults(FormOptionGroups.Audiences,
        [
            ("parents", "家长", "Parents"),
            ("librarians-booksellers", "图书馆员与书商", "Librarians and booksellers"),
            ("book-clubs", "读书会", "Book clubs"),
            ("existing-readers", "现有读者与粉丝", "Existing readers and fans")
        ]);
        DisableLegacyDefaults(FormOptionGroups.Genres,
        [
            ("adventure", "冒险", "Adventure"),
            ("fantasy", "奇幻", "Fantasy"),
            ("science-fiction", "科幻", "Science fiction"),
            ("mystery-thriller", "悬疑与惊悚", "Mystery and thriller"),
            ("romance", "爱情", "Romance"),
            ("history", "历史", "History"),
            ("inspirational", "励志", "Inspirational"),
            ("education", "教育", "Education"),
            ("business", "商业", "Business"),
            ("self-help", "个人成长", "Self-help"),
            ("children", "儿童读物", "Children's books"),
            ("poetry", "诗歌", "Poetry")
        ]);
        UpdateLegacyDefaultLabel(FormOptionGroups.Genres, "fiction", "通俗小说", "General fiction", "小说", "Fiction");

        void DisableLegacyDefaults(string groupId, (string Id, string LabelZhCn, string LabelEnUs)[] items)
        {
            foreach (var item in items)
            {
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    UPDATE form_options SET enabled = 0
                    WHERE group_id = $group AND id = $id AND enabled = 1
                      AND label_zh_cn = $labelZhCn AND label_en_us = $labelEnUs;
                    """;
                command.Parameters.AddWithValue("$group", groupId);
                command.Parameters.AddWithValue("$id", item.Id);
                command.Parameters.AddWithValue("$labelZhCn", item.LabelZhCn);
                command.Parameters.AddWithValue("$labelEnUs", item.LabelEnUs);
                command.ExecuteNonQuery();
            }
        }

        void UpdateLegacyDefaultLabel(string groupId, string id, string previousZhCn, string previousEnUs, string labelZhCn, string labelEnUs)
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                UPDATE form_options SET label_zh_cn = $labelZhCn, label_en_us = $labelEnUs
                WHERE group_id = $group AND id = $id
                  AND label_zh_cn = $previousZhCn AND label_en_us = $previousEnUs;
                """;
            command.Parameters.AddWithValue("$group", groupId);
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$previousZhCn", previousZhCn);
            command.Parameters.AddWithValue("$previousEnUs", previousEnUs);
            command.Parameters.AddWithValue("$labelZhCn", labelZhCn);
            command.Parameters.AddWithValue("$labelEnUs", labelEnUs);
            command.ExecuteNonQuery();
        }
    }

    private static void NormalizeBroadProjectTaxonomyOrder(SqliteConnection connection, SqliteTransaction transaction)
    {
        SetDefaultOrder(FormOptionGroups.VideoGoals,
        [
            ("brand-awareness", "品牌认知", "Brand awareness"),
            ("launch-promotion", "上市推广", "Launch promotion"),
            ("audience-engagement", "受众互动", "Audience engagement"),
            ("sales-conversion", "销售转化", "Sales conversion"),
            ("knowledge-communication", "知识传播", "Knowledge communication"),
            ("event-support", "活动支持", "Event support"),
            ("internal-communication", "内部沟通", "Internal communication")
        ]);
        SetDefaultOrder(FormOptionGroups.Audiences,
        [
            ("children", "儿童", "Children"),
            ("young-adults", "青少年", "Young adults"),
            ("adults", "成年人", "Adults"),
            ("families", "家庭", "Families"),
            ("educators", "教育工作者", "Educators"),
            ("professionals", "行业从业者", "Industry professionals"),
            ("seniors", "银发人群", "Seniors"),
            ("general", "大众", "General audience")
        ]);
        SetDefaultOrder(FormOptionGroups.Genres,
        [
            ("fiction", "小说", "Fiction"),
            ("nonfiction", "非虚构", "Nonfiction"),
            ("children-young-adult", "儿童与青少年读物", "Children and young adult"),
            ("biography-memoir", "传记与回忆录", "Biography and memoir"),
            ("education-academic", "教育与学术", "Education and academic"),
            ("business-professional", "商业与专业", "Business and professional"),
            ("self-help-lifestyle", "个人成长与生活", "Self-help and lifestyle"),
            ("religion-spirituality", "宗教与心灵成长", "Religion and spirituality"),
            ("history-society", "历史与社会", "History and society"),
            ("arts-culture", "艺术与文化", "Arts and culture"),
            ("poetry-literature", "诗歌与文学", "Poetry and literature"),
            ("comics-graphic-novels", "漫画与图像小说", "Comics and graphic novels")
        ]);

        void SetDefaultOrder(string groupId, (string Id, string LabelZhCn, string LabelEnUs)[] items)
        {
            for (var index = 0; index < items.Length; index++)
            {
                var item = items[index];
                using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    UPDATE form_options SET sort_order = $sortOrder
                    WHERE group_id = $group AND id = $id
                      AND label_zh_cn = $labelZhCn AND label_en_us = $labelEnUs;
                    """;
                command.Parameters.AddWithValue("$sortOrder", index * 10);
                command.Parameters.AddWithValue("$group", groupId);
                command.Parameters.AddWithValue("$id", item.Id);
                command.Parameters.AddWithValue("$labelZhCn", item.LabelZhCn);
                command.Parameters.AddWithValue("$labelEnUs", item.LabelEnUs);
                command.ExecuteNonQuery();
            }
        }
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
            LegacyImageStyleTags = EnabledForLocale(FormOptionGroups.ImageStyleTags, locale, enabled: false),
            PaceTags = EnabledForLocale(FormOptionGroups.PaceTags, locale),
            NarrationTones = EnabledForLocale(FormOptionGroups.NarrationTones, locale),
            SpeechRates = EnabledForLocale(FormOptionGroups.SpeechRates, locale),
            VoiceGenders = EnabledForLocale(FormOptionGroups.VoiceGenders, locale),
            VoiceAges = EnabledForLocale(FormOptionGroups.VoiceAges, locale),
            Accents = EnabledForLocale(FormOptionGroups.Accents, locale),
            VoiceEmotions = EnabledForLocale(FormOptionGroups.VoiceEmotions, locale),
            VoiceTags = EnabledForLocale(FormOptionGroups.VoiceTags, locale)
        };
    }

    public AdminFormOptionDto[] ListAdmin(string groupId)
    {
        if (!FormOptionGroups.Configurable.Contains(groupId)) return [];
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT group_id, id, label_zh_cn, label_en_us, description_zh_cn, description_en_us,
                   tone, preview_color, allows_custom_value, enabled, sort_order, updated_at, preview_image_url, preview_video_url
            FROM form_options WHERE group_id = $group AND is_removed = 0 ORDER BY sort_order, id;
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
        command.CommandText = "SELECT id FROM form_options WHERE group_id = $group AND enabled = 1 AND is_removed = 0;";
        command.Parameters.AddWithValue("$group", groupId);
        using var reader = command.ExecuteReader();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        while (reader.Read()) ids.Add(reader.GetString(0));
        return ids;
    }

    private static void InstallRemovalGuards(SqliteConnection connection)
    {
        bool Exists(string table) {using var c=connection.CreateCommand();c.CommandText="SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$table";c.Parameters.AddWithValue("$table",table);return Convert.ToInt32(c.ExecuteScalar())>0;}
        var fieldCase = "CASE f.group_id " + string.Join(" ", FormOptionGroups.Configurable.Select(g => $"WHEN '{g}' THEN '{ReferenceField(g)}'")) + " END";
        foreach(var (table,columns) in new (string,string[])[] { ("projects",["project_json","book_json","creative_json","voice_json"]),("character_presets",["document"]) })
        {
            if(!Exists(table))continue;
            var check = string.Join(" OR ",columns.Select(column=>$"EXISTS(SELECT 1 FROM form_options f, json_tree(NEW.{column}) j WHERE f.is_removed=1 AND j.type='text' AND j.atom=f.id AND (j.key=({fieldCase}) OR j.path LIKE '%.' || ({fieldCase})))"));
            foreach(var operation in new[]{"INSERT","UPDATE OF " + string.Join(',',columns)})
            {
                var trigger = $"{table}_removed_option_{(operation=="INSERT"?"insert":"update")}";
                Execute(connection,$"CREATE TRIGGER IF NOT EXISTS {trigger} BEFORE {operation} ON {table} WHEN {check} BEGIN SELECT RAISE(ABORT,'config.option_removed'); END;");
            }
        }
        if(Exists("voice_references")) foreach(var operation in new[]{"INSERT","UPDATE OF tag_ids"})
            Execute(connection,$"CREATE TRIGGER IF NOT EXISTS voices_removed_option_{(operation=="INSERT"?"insert":"update")} BEFORE {operation} ON voice_references WHEN EXISTS(SELECT 1 FROM form_options f WHERE f.group_id='voice-tags' AND f.is_removed=1 AND instr(',' || NEW.tag_ids || ',', ',' || f.id || ',')>0) BEGIN SELECT RAISE(ABORT,'config.option_removed'); END;");
    }

    public string? Remove(string groupId, string id, DateTimeOffset? expectedUpdatedAt)
    {
        if (!FormOptionGroups.Configurable.Contains(groupId) || !ValidId(id)) return "missing";
        using var connection = Open(); using var transaction = connection.BeginTransaction(deferred: false);
        if (IsRemoved(connection, transaction, groupId, id)) return "missing";
        var current = GetAdmin(connection, groupId, id, transaction);
        if (current is null) return "missing";
        if (expectedUpdatedAt != current.UpdatedAt) return "conflict";
        if (IsReferenced(connection, transaction, groupId, id)) return "referenced";
        using var command = connection.CreateCommand(); command.Transaction = transaction;
        // Keep a tombstone so built-in seeding cannot recreate removed items on restart.
        command.CommandText = "UPDATE form_options SET is_removed=1, enabled=0, updated_at=$now WHERE group_id=$group AND id=$id;";
        command.Parameters.AddWithValue("$group",groupId);command.Parameters.AddWithValue("$id",id);command.Parameters.AddWithValue("$now",DateTimeOffset.UtcNow.ToString("O"));command.ExecuteNonQuery();
        transaction.Commit(); return null;
    }
    private static bool IsRemoved(SqliteConnection connection, SqliteTransaction transaction, string group, string id)
    {
        using var command=connection.CreateCommand();command.Transaction=transaction;
        command.CommandText="SELECT is_removed FROM form_options WHERE group_id=$group AND id=$id;";
        command.Parameters.AddWithValue("$group",group);command.Parameters.AddWithValue("$id",id);
        return Convert.ToInt32(command.ExecuteScalar() ?? 0)==1;
    }
    private static string ReferenceField(string group) => group switch {
            FormOptionGroups.Brands=>"brandId", FormOptionGroups.VideoGoals=>"videoGoalId", FormOptionGroups.Audiences=>"audienceIds",
            FormOptionGroups.Genres=>"genreId", FormOptionGroups.ContentLanguages=>"contentLanguageId", FormOptionGroups.VideoDurations=>"videoDurationId",
            FormOptionGroups.PublishingPlatforms=>"publishingPlatformIds", FormOptionGroups.RoleTypes=>"roleTypeId", FormOptionGroups.AgeRanges=>"ageRangeId",
            FormOptionGroups.Genders=>"genderId", FormOptionGroups.VisualStyles=>"visualStyleId", FormOptionGroups.MoodTags=>"moodTagIds",
            FormOptionGroups.ImageStyleTags=>"imageStyleTagIds", FormOptionGroups.PaceTags=>"paceTagIds", FormOptionGroups.NarrationTones=>"narrationToneId",
            FormOptionGroups.SpeechRates=>"speechRateId", FormOptionGroups.VoiceGenders=>"voiceGenderId", FormOptionGroups.VoiceAges=>"voiceAgeId",
            FormOptionGroups.Accents=>"accentId", FormOptionGroups.VoiceEmotions=>"emotionStyleId", FormOptionGroups.VoiceTags=>"tagIds", _=>throw new InvalidOperationException()
        };

    private static bool IsReferenced(SqliteConnection connection, SqliteTransaction transaction, string group, string id)
    {
        var field = ReferenceField(group);
        bool Exists(string table) {using var c=connection.CreateCommand();c.Transaction=transaction;c.CommandText="SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$table";c.Parameters.AddWithValue("$table",table);return Convert.ToInt32(c.ExecuteScalar())>0;}
        foreach(var (table,columns) in new (string,string[])[] {
            ("projects",["project_json","book_json","creative_json","voice_json","submission_snapshot_json"]),
            ("revision_rounds",["before_snapshot","after_snapshot"]), ("character_presets",["document"])
        })
        {
            if(!Exists(table))continue;
            foreach(var column in columns)
            {
                using var command=connection.CreateCommand();command.Transaction=transaction;
                // Table/column names come only from the fixed schema list above; values stay parameterized.
                var activeOnly = table == "character_presets" ? "character_presets.is_removed=0 AND " : "";
                command.CommandText=$"SELECT 1 FROM {table}, json_tree({column}) AS j WHERE {activeOnly}j.type='text' AND j.atom=$id AND (j.key=$field OR j.path LIKE '%.' || $field) LIMIT 1;";
                command.Parameters.AddWithValue("$id",id);command.Parameters.AddWithValue("$field",field);
                if(command.ExecuteScalar() is not null)return true;
            }
        }
        if(group==FormOptionGroups.VoiceTags && Exists("voice_references"))
        {
            using var command=connection.CreateCommand();command.Transaction=transaction;command.CommandText="SELECT 1 FROM voice_references WHERE is_removed=0 AND instr(',' || tag_ids || ',', ',' || $id || ',') > 0 LIMIT 1;";command.Parameters.AddWithValue("$id",id);
            if(command.ExecuteScalar() is not null)return true;
        }
        return false;
    }

    public bool AllowsCustomValue(string groupId, string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || !FormOptionGroups.Configurable.Contains(groupId)) return false;
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT allows_custom_value FROM form_options WHERE group_id = $group AND id = $id;";
        command.Parameters.AddWithValue("$group", groupId);
        command.Parameters.AddWithValue("$id", id);
        return Convert.ToInt32(command.ExecuteScalar() ?? 0) == 1;
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
        if (!ValidMediaUrl(request.PreviewImageUrl)) return new(FormOptionWriteOutcome.Invalid, "previewImageUrl");
        if (!ValidMediaUrl(request.PreviewVideoUrl)) return new(FormOptionWriteOutcome.Invalid, "previewVideoUrl");

        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        if (IsRemoved(connection, transaction, groupId, id)) return new(FormOptionWriteOutcome.Conflict);
        var current = GetAdmin(connection, groupId, id, transaction);
        if (current is not null && request.ExpectedUpdatedAt != current.UpdatedAt) return new(FormOptionWriteOutcome.Conflict);
        if (current is null && request.ExpectedUpdatedAt is not null) return new(FormOptionWriteOutcome.Conflict);

        Save(connection, groupId, id, request with
        {
            LabelZhCn = request.LabelZhCn.Trim(),
            LabelEnUs = request.LabelEnUs.Trim(),
            DescriptionZhCn = NullIfBlank(request.DescriptionZhCn),
            DescriptionEnUs = NullIfBlank(request.DescriptionEnUs),
            PreviewColor = NullIfBlank(request.PreviewColor),
            PreviewImageUrl = NullIfBlank(request.PreviewImageUrl)?.Trim(),
            PreviewVideoUrl = NullIfBlank(request.PreviewVideoUrl)?.Trim()
        }, transaction);
        item = GetAdmin(connection, groupId, id, transaction);
        transaction.Commit();
        return new(FormOptionWriteOutcome.Saved);
    }

    private ConfigOptionDto[] EnabledForLocale(string groupId, string locale, bool enabled = true)
    {
        var english = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, label_zh_cn, label_en_us, description_zh_cn, description_en_us, tone, preview_color, allows_custom_value, preview_image_url, preview_video_url
            FROM form_options WHERE group_id = $group AND enabled = $enabled AND is_removed = 0 ORDER BY sort_order, id;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        command.Parameters.AddWithValue("$enabled", enabled ? 1 : 0);
        using var reader = command.ExecuteReader();
        var items = new List<ConfigOptionDto>();
        while (reader.Read()) items.Add(new(
            reader.GetString(0), reader.GetString(english ? 2 : 1),
            reader.IsDBNull(english ? 4 : 3) ? null : reader.GetString(english ? 4 : 3),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetString(6),
            reader.GetInt32(7) == 1,
            reader.IsDBNull(8) ? (groupId == FormOptionGroups.VisualStyles ? FormOptionCatalog.VisualStylePreviewUrl(reader.GetString(0)) : null) : reader.GetString(8),
            reader.IsDBNull(9) ? null : reader.GetString(9)));
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
        yield return (FormOptionGroups.VoiceTags, zh.VoiceTags, en.VoiceTags);
    }

    private static void Save(SqliteConnection connection, string groupId, string id, UpsertFormOptionRequest request, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO form_options(group_id, id, label_zh_cn, label_en_us, description_zh_cn, description_en_us,
                                     tone, preview_color, allows_custom_value, enabled, sort_order, updated_at, preview_image_url, preview_video_url)
            VALUES($group, $id, $labelZh, $labelEn, $descriptionZh, $descriptionEn,
                   $tone, $previewColor, $allowsCustomValue, $enabled, $sortOrder, $updatedAt, $previewImage, $previewVideo)
            ON CONFLICT(group_id, id) DO UPDATE SET
                label_zh_cn = excluded.label_zh_cn, label_en_us = excluded.label_en_us,
                description_zh_cn = excluded.description_zh_cn, description_en_us = excluded.description_en_us,
                tone = excluded.tone, preview_color = excluded.preview_color,
                allows_custom_value = excluded.allows_custom_value,
                enabled = excluded.enabled, sort_order = excluded.sort_order, updated_at = excluded.updated_at,
                preview_image_url = excluded.preview_image_url, preview_video_url = excluded.preview_video_url;
            """;
        command.Parameters.AddWithValue("$group", groupId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$labelZh", request.LabelZhCn);
        command.Parameters.AddWithValue("$labelEn", request.LabelEnUs);
        command.Parameters.AddWithValue("$descriptionZh", (object?)request.DescriptionZhCn ?? DBNull.Value);
        command.Parameters.AddWithValue("$descriptionEn", (object?)request.DescriptionEnUs ?? DBNull.Value);
        command.Parameters.AddWithValue("$tone", (object?)request.Tone ?? DBNull.Value);
        command.Parameters.AddWithValue("$previewColor", (object?)request.PreviewColor ?? DBNull.Value);
        command.Parameters.AddWithValue("$previewImage", (object?)request.PreviewImageUrl ?? DBNull.Value);
        command.Parameters.AddWithValue("$previewVideo", (object?)request.PreviewVideoUrl ?? DBNull.Value);
        command.Parameters.AddWithValue("$allowsCustomValue", request.AllowsCustomValue ? 1 : 0);
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
                   tone, preview_color, allows_custom_value, enabled, sort_order, updated_at, preview_image_url, preview_video_url
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
        reader.GetInt32(8) == 1, reader.GetInt32(9) == 1, reader.GetInt32(10),
        DateTimeOffset.Parse(reader.GetString(11), System.Globalization.CultureInfo.InvariantCulture),
        reader.IsDBNull(12) ? null : reader.GetString(12), reader.IsDBNull(13) ? null : reader.GetString(13));

    private static bool ValidMediaUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        value = value.Trim();
        if (value.Length > 2048 || value.Any(char.IsControl) || value.Contains('\\')) return false;
        return (value.StartsWith('/') && !value.StartsWith("//") && Uri.IsWellFormedUriString(value, UriKind.Relative)) ||
            (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https" && string.IsNullOrEmpty(uri.UserInfo));
    }

    private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static bool ValidText(string? value, int max) => !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;
    private static bool OptionalText(string? value, int max) => value is null || value.Trim().Length <= max;
    private static bool ValidColor(string value) => value.Length == 7 && value[0] == '#' && value[1..].All(Uri.IsHexDigit);
    private static bool ValidId(string value) => value.Length is >= 2 and <= 64 && value.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');
    private static bool HasColumn(SqliteConnection connection, string table, string column)
    { using var command = connection.CreateCommand(); command.CommandText = $"PRAGMA table_info({table});"; using var reader = command.ExecuteReader(); while (reader.Read()) if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true; return false; }
    private static void Execute(SqliteConnection connection, string sql) { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private SqliteConnection Open() { var connection = new SqliteConnection(connectionString); connection.Open(); Execute(connection, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); return connection; }
}
