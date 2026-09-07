using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal enum VoiceWriteOutcome { Saved, Invalid, Conflict }

internal sealed record VoiceWriteResult(VoiceWriteOutcome Outcome, string? Field = null);

internal sealed class VoiceReferenceRepository(string connectionString)
{
    public void Initialize()
    {
        using var connection = Open();
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS voice_references (
                id TEXT PRIMARY KEY,
                name_zh_cn TEXT NOT NULL,
                name_en_us TEXT NOT NULL,
                description_zh_cn TEXT NOT NULL,
                description_en_us TEXT NOT NULL,
                audio_url TEXT NULL,
                tag_ids TEXT NOT NULL,
                recommended INTEGER NOT NULL DEFAULT 0,
                enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_voice_references_order ON voice_references(enabled DESC, sort_order, id);
            """);

        ConfigurationRemoval.Initialize(connection, "voice_references");
        using var transaction = connection.BeginTransaction();
        var zh = Features.FormOptionCatalog.VoicesForLocale("zh-CN");
        var en = Features.FormOptionCatalog.VoicesForLocale("en-US");
        for (var index = 0; index < en.Length; index++)
        {
            using var exists = connection.CreateCommand();
            exists.Transaction = transaction;
            exists.CommandText = "SELECT COUNT(*) FROM voice_references WHERE id = $id;";
            exists.Parameters.AddWithValue("$id", en[index].Id);
            if (Convert.ToInt32(exists.ExecuteScalar()) != 0) continue;
            var request = new UpsertVoiceReferenceRequest(
                zh[index].Name,
                en[index].Name,
                zh[index].Description,
                en[index].Description,
                en[index].TagIds,
                en[index].Recommended,
                en[index].Enabled,
                index * 10,
                null);
            Save(connection, en[index].Id, request, transaction, en[index].AudioUrl);
        }
        transaction.Commit();
        ConfigurationRemoval.InstallProjectGuards(connection, "voice_references", ["selectedVoiceIds", "preferredVoiceId"]);
    }

    public VoiceReferenceDto[] ForLocale(string locale)
    {
        var english = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name_zh_cn, name_en_us, description_zh_cn, description_en_us,
                   audio_url, tag_ids, recommended, enabled
            FROM voice_references
            WHERE enabled = 1 AND is_removed = 0
            ORDER BY sort_order, id;
            """;
        using var reader = command.ExecuteReader();
        var items = new List<VoiceReferenceDto>();
        while (reader.Read())
        {
            items.Add(new(
                reader.GetString(0),
                reader.GetString(english ? 2 : 1),
                reader.GetString(english ? 4 : 3),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                SplitTags(reader.GetString(6)),
                reader.GetInt32(7) == 1,
                reader.GetInt32(8) == 1));
        }
        return [.. items];
    }

    public AdminVoiceReferenceDto[] ListAdmin()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name_zh_cn, name_en_us, description_zh_cn, description_en_us,
                   audio_url, tag_ids, recommended, enabled, sort_order, updated_at
            FROM voice_references WHERE is_removed = 0
            ORDER BY sort_order, id;
            """;
        using var reader = command.ExecuteReader();
        var items = new List<AdminVoiceReferenceDto>();
        while (reader.Read()) items.Add(ReadAdmin(reader));
        return [.. items];
    }

    public VoiceWriteResult Upsert(string id, UpsertVoiceReferenceRequest? request, IReadOnlySet<string> enabledTagIds, out AdminVoiceReferenceDto? item)
    {
        item = null;
        if (!ValidId(id)) return new(VoiceWriteOutcome.Invalid, "id");
        if (request is null) return new(VoiceWriteOutcome.Invalid, "request");
        if (!ValidText(request.NameZhCn, 1, 80)) return new(VoiceWriteOutcome.Invalid, "nameZhCn");
        if (!ValidText(request.NameEnUs, 1, 80)) return new(VoiceWriteOutcome.Invalid, "nameEnUs");
        if (!ValidText(request.DescriptionZhCn, 1, 500)) return new(VoiceWriteOutcome.Invalid, "descriptionZhCn");
        if (!ValidText(request.DescriptionEnUs, 1, 500)) return new(VoiceWriteOutcome.Invalid, "descriptionEnUs");
        if (request.SortOrder is < 0 or > 10000) return new(VoiceWriteOutcome.Invalid, "sortOrder");

        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        if (ConfigurationRemoval.IsRemoved(connection, transaction, "voice_references", id)) return new(VoiceWriteOutcome.Conflict);
        var previous = GetAdmin(connection, id, transaction);
        if (previous is null ? request.ExpectedUpdatedAt is not null : request.ExpectedUpdatedAt != previous.UpdatedAt)
            return new(VoiceWriteOutcome.Conflict, "expectedUpdatedAt");
        var allowedTagIds = new HashSet<string>(enabledTagIds, StringComparer.Ordinal);
        if (previous is not null) allowedTagIds.UnionWith(previous.TagIds);
        if (request.TagIds is null || request.TagIds.Length > 12 || request.TagIds.Any(tag => !allowedTagIds.Contains(tag)))
            return new(VoiceWriteOutcome.Invalid, "tagIds");

        Save(connection, id, request with
        {
            NameZhCn = request.NameZhCn.Trim(),
            NameEnUs = request.NameEnUs.Trim(),
            DescriptionZhCn = request.DescriptionZhCn.Trim(),
            DescriptionEnUs = request.DescriptionEnUs.Trim(),
            TagIds = [.. request.TagIds.Distinct(StringComparer.Ordinal)]
        }, transaction, preserveAudio: true);
        transaction.Commit();
        item = GetAdmin(connection, id);
        return new(VoiceWriteOutcome.Saved);
    }
    public string? Remove(string id, string? expected)
    {
        using var db = Open(); using var tx = db.BeginTransaction(deferred: false);
        var current = GetAdmin(db, id, tx);
        if (current is null) return "missing";
        if (expected != current.UpdatedAt) return "conflict";
        if (ConfigurationRemoval.IsReferenced(db, tx, id, ["selectedVoiceIds", "preferredVoiceId"])) return "referenced";
        ConfigurationRemoval.Mark(db, tx, "voice_references", id); tx.Commit(); return null;
    }

    public void ReconcileAudioAvailability(Func<string, bool> hasSample)
    {
        foreach (var voice in ListAdmin())
        {
            var available = hasSample(voice.Id);
            if (available != (voice.AudioUrl is not null)) SetAudioAvailable(voice.Id, available, out _);
        }
    }
    public bool Exists(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM voice_references WHERE id = $id AND is_removed = 0;";
        command.Parameters.AddWithValue("$id", id);
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }

    public bool SetAudioAvailable(string id, bool available, out AdminVoiceReferenceDto? item)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE voice_references SET audio_url = $audioUrl, updated_at = $updatedAt WHERE id = $id AND is_removed = 0;
            """;
        command.Parameters.AddWithValue("$audioUrl", available ? $"/api/voices/{id}/sample" : DBNull.Value);
        command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        if (command.ExecuteNonQuery() != 1) { item = null; return false; }
        item = GetAdmin(connection, id);
        return true;
    }

    public IReadOnlySet<string> EnabledIds()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT id FROM voice_references WHERE enabled = 1 AND is_removed = 0;";
        using var reader = command.ExecuteReader();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        while (reader.Read()) ids.Add(reader.GetString(0));
        return ids;
    }

    private static void Save(SqliteConnection connection, string id, UpsertVoiceReferenceRequest request, SqliteTransaction? transaction = null, string? audioUrl = null, bool preserveAudio = false)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO voice_references(
                id, name_zh_cn, name_en_us, description_zh_cn, description_en_us,
                audio_url, tag_ids, recommended, enabled, sort_order, updated_at)
            VALUES(
                $id, $nameZh, $nameEn, $descriptionZh, $descriptionEn,
                $audioUrl, $tags, $recommended, $enabled, $sortOrder, $updatedAt)
            ON CONFLICT(id) DO UPDATE SET
                name_zh_cn = excluded.name_zh_cn,
                name_en_us = excluded.name_en_us,
                description_zh_cn = excluded.description_zh_cn,
                description_en_us = excluded.description_en_us,
                audio_url = CASE WHEN $preserveAudio = 1 THEN voice_references.audio_url ELSE excluded.audio_url END,
                tag_ids = excluded.tag_ids,
                recommended = excluded.recommended,
                enabled = excluded.enabled,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$nameZh", request.NameZhCn);
        command.Parameters.AddWithValue("$nameEn", request.NameEnUs);
        command.Parameters.AddWithValue("$descriptionZh", request.DescriptionZhCn);
        command.Parameters.AddWithValue("$descriptionEn", request.DescriptionEnUs);
        command.Parameters.AddWithValue("$audioUrl", (object?)audioUrl ?? DBNull.Value);
        command.Parameters.AddWithValue("$preserveAudio", preserveAudio ? 1 : 0);
        command.Parameters.AddWithValue("$tags", string.Join(',', request.TagIds));
        command.Parameters.AddWithValue("$recommended", request.Recommended ? 1 : 0);
        command.Parameters.AddWithValue("$enabled", request.Enabled ? 1 : 0);
        command.Parameters.AddWithValue("$sortOrder", request.SortOrder);
        command.Parameters.AddWithValue("$updatedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }
    private static AdminVoiceReferenceDto? GetAdmin(SqliteConnection connection, string id, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT id, name_zh_cn, name_en_us, description_zh_cn, description_en_us,
                   audio_url, tag_ids, recommended, enabled, sort_order, updated_at
            FROM voice_references WHERE id = $id AND is_removed = 0;
            """;
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadAdmin(reader) : null;
    }

    private static AdminVoiceReferenceDto ReadAdmin(SqliteDataReader reader) => new(
        reader.GetString(0),
        reader.GetString(1),
        reader.GetString(2),
        reader.GetString(3),
        reader.GetString(4),
        reader.IsDBNull(5) ? null : reader.GetString(5),
        SplitTags(reader.GetString(6)),
        reader.GetInt32(7) == 1,
        reader.GetInt32(8) == 1,
        reader.GetInt32(9),
        reader.GetString(10));

    private static string[] SplitTags(string value) =>
        value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static bool ValidText(string? value, int min, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length >= min && value.Trim().Length <= max;

    private static bool ValidId(string value) =>
        value.Length is >= 2 and <= 64 &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character == '-');

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        Execute(connection, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
        return connection;
    }
}
