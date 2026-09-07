using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class CharacterPresetRepository(string connectionString)
{
    public void Initialize()
    {
        using var db = Open();
        using (var schema = db.CreateCommand()) { schema.CommandText = "CREATE TABLE IF NOT EXISTS character_presets (id TEXT PRIMARY KEY, document TEXT NOT NULL);"; schema.ExecuteNonQuery(); }
        ConfigurationRemoval.Initialize(db, "character_presets");
        using var transaction = db.BeginTransaction();
        using var command = db.CreateCommand(); command.Transaction = transaction;
        command.CommandText = "CREATE TABLE IF NOT EXISTS character_presets (id TEXT PRIMARY KEY, document TEXT NOT NULL);";
        command.ExecuteNonQuery();
        var zh = CharacterPresetCatalog.Create("zh-CN"); var en = CharacterPresetCatalog.Create("en-US");
        for (var i = 0; i < zh.Length; i++)
        {
            var id = zh[i].PresetId!;
            // Skip existing seeds before INSERT: BEFORE INSERT guards also run for INSERT OR IGNORE.
            command.CommandText = "SELECT COUNT(*) FROM character_presets WHERE id=$id;";
            command.Parameters.Clear(); command.Parameters.AddWithValue("$id", id);
            if (Convert.ToInt32(command.ExecuteScalar()) != 0) continue;
            var preset = new AdminCharacterPresetDto(id, Clean(zh[i], id), Clean(en[i], id), $"/character-presets/{id}.png", true, i * 10, DateTimeOffset.UtcNow.ToString("O"));
            command.CommandText = "INSERT OR IGNORE INTO character_presets(id,document) VALUES ($id,$doc);";
            command.Parameters.Clear(); command.Parameters.AddWithValue("$id", id); command.Parameters.AddWithValue("$doc", Serialize(preset)); command.ExecuteNonQuery();
        }
        transaction.Commit();
    }
    public AdminCharacterPresetDto[] List()
    {
        using var db = Open(); return Read(db).OrderBy(x => x.SortOrder).ThenBy(x => x.Id).ToArray();
    }
    public CharacterInfoDto[] ForLocale(string locale) => List().Where(x => x.Enabled).Select(x =>
        (locale == "en-US" ? x.EnUs : x.ZhCn) with { Id = Guid.NewGuid().ToString("N"), PresetId = x.Id, PresetImageUrl = x.ImageUrl ?? "" }).ToArray();

    // All writes take a SQLite write transaction, so limits and optimistic versions are checked atomically.
    public string? Save(string id, UpsertCharacterPresetRequest? request, FormOptionRepository options, out AdminCharacterPresetDto? saved)
    {
        saved = null;
        if (id.Length is < 2 or > 64 || id.Any(c => !char.IsAsciiLetterOrDigit(c) && c != '-')) return "invalid";
        if (request is null || !Valid(request.ZhCn) || !Valid(request.EnUs) || request.SortOrder is < 0 or > 10000) return "invalid";
        using var db = Open(); using var tx = db.BeginTransaction();
        if (ConfigurationRemoval.IsRemoved(db, tx, "character_presets", id)) return "conflict";
        var all = Read(db, tx); var previous = all.FirstOrDefault(x => x.Id == id);
        if (previous is null ? request.ExpectedUpdatedAt is not null : previous.UpdatedAt != request.ExpectedUpdatedAt) return "conflict";
        if (previous is null && all.Count >= 100 || request.Enabled && all.Count(x => x.Enabled && x.Id != id) >= 12) return "limit";
        bool Allowed(string group, string? value, string? old) => string.IsNullOrEmpty(value) || value == old || options.EnabledIds(group).Contains(value);
        foreach (var (value, old) in new[] { (request.ZhCn, previous?.ZhCn), (request.EnUs, previous?.EnUs) })
            if (!Allowed(FormOptionGroups.RoleTypes, value.RoleTypeId, old?.RoleTypeId) || !Allowed(FormOptionGroups.AgeRanges, value.AgeRangeId, old?.AgeRangeId) || !Allowed(FormOptionGroups.Genders, value.GenderId, old?.GenderId)) return "invalid";
        saved = new(id, Clean(request.ZhCn, id), Clean(request.EnUs, id), previous?.ImageUrl, request.Enabled, request.SortOrder, DateTimeOffset.UtcNow.ToString("O"));
        Write(db, tx, saved); tx.Commit(); return null;
    }
    public string? SetImage(string id, string? expected, string? imageUrl, out AdminCharacterPresetDto? saved)
    {
        saved = null; using var db = Open(); using var tx = db.BeginTransaction();
        var previous = Read(db, tx).FirstOrDefault(x => x.Id == id);
        if (previous is null) return "missing";
        if (previous.UpdatedAt != expected) return "conflict";
        saved = previous with { ImageUrl = imageUrl, UpdatedAt = DateTimeOffset.UtcNow.ToString("O") };
        Write(db, tx, saved); tx.Commit(); return null;
    }
    public string? Remove(string id, string? expected)
    {
        using var db = Open(); using var tx = db.BeginTransaction(deferred: false);
        var current = Read(db, tx).FirstOrDefault(x => x.Id == id);
        if (current is null) return "missing";
        if (expected != current.UpdatedAt) return "conflict";
        // Projects own full character snapshots, including immutable image URLs; retain image files.
        ConfigurationRemoval.Mark(db, tx, "character_presets", id); tx.Commit(); return null;
    }

    private static CharacterInfoDto Clean(CharacterInfoDto c, string id) => c with {
        Id = id, PresetId = id, PresetImageUrl = null, Name = c.Name.Trim(), StoryRole = c.StoryRole.Trim(), Personality = c.Personality.Trim(), Appearance = c.Appearance.Trim(),
        Clothing = c.Clothing?.Trim(), Emotion = c.Emotion?.Trim(), VoiceHint = c.VoiceHint?.Trim(), ReferenceImageUrls = [], ReferenceImages = []
    };
    private static bool Valid(CharacterInfoDto? c) => c is not null && !string.IsNullOrWhiteSpace(c.Name) && c.Name.Length <= 80 &&
        c.StoryRole is { Length: <= 200 } && c.Personality is { Length: <= 300 } && c.Appearance is { Length: <= 300 } &&
        (c.Clothing?.Length ?? 0) <= 200 && (c.Emotion?.Length ?? 0) <= 150 && (c.VoiceHint?.Length ?? 0) <= 100;
    private static List<AdminCharacterPresetDto> Read(SqliteConnection db, SqliteTransaction? tx = null)
    {
        using var command = db.CreateCommand(); command.Transaction = tx; command.CommandText = "SELECT document FROM character_presets WHERE is_removed=0;";
        using var reader = command.ExecuteReader(); var list = new List<AdminCharacterPresetDto>();
        while (reader.Read()) list.Add(JsonSerializer.Deserialize(reader.GetString(0), AppJsonContext.Default.AdminCharacterPresetDto)!); return list;
    }
    private static string Serialize(AdminCharacterPresetDto value) => JsonSerializer.Serialize(value, AppJsonContext.Default.AdminCharacterPresetDto);
    private static void Write(SqliteConnection db, SqliteTransaction tx, AdminCharacterPresetDto value)
    {
        using var command = db.CreateCommand(); command.Transaction = tx;
        command.CommandText = "INSERT INTO character_presets(id,document) VALUES ($id,$doc) ON CONFLICT(id) DO UPDATE SET document=$doc;";
        command.Parameters.AddWithValue("$id", value.Id); command.Parameters.AddWithValue("$doc", Serialize(value)); command.ExecuteNonQuery();
    }
    private SqliteConnection Open() { var db = new SqliteConnection(connectionString); db.Open(); return db; }
}
