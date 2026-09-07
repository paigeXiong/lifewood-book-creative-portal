using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;
public sealed class ConfigurationRemovalTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-config-remove-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly ProjectRepository projects;
    private readonly FileCategoryRepository files;
    private readonly VoiceReferenceRepository voices;
    private readonly CharacterPresetRepository presets;
    private readonly FormOptionRepository options;
    public ConfigurationRemovalTests()
    {
        Directory.CreateDirectory(root); connection = "Data Source=" + Path.Combine(root, "db") + ";Pooling=False";
        projects = new(connection); projects.Initialize();
        files = new(connection); files.Initialize(); voices = new(connection); voices.Initialize();
        presets = new(connection); options = new(connection); options.Initialize();
    }
    private void Sql(string sql, string json)
    {
        using var db = new SqliteConnection(connection); db.Open(); using var command = db.CreateCommand();
        command.CommandText = sql; command.Parameters.AddWithValue("$json", json); command.ExecuteNonQuery();
    }
    [Fact] public void RemovedFileAndVoiceCannotBeReseededOrRevived()
    {
        var file = files.ListAdmin("source")[0]; var voice = voices.ListAdmin()[0];
        Assert.Equal("conflict", files.Remove(file.Scope, file.Id, null));
        Assert.Equal("conflict", voices.Remove(voice.Id, null));
        Assert.Null(files.Remove(file.Scope, file.Id, file.UpdatedAt));
        Assert.Null(voices.Remove(voice.Id, voice.UpdatedAt));
        files.Initialize(); voices.Initialize();
        Assert.DoesNotContain(files.ListAdmin(file.Scope), x => x.Id == file.Id);
        Assert.Null(files.FindEnabled(file.Id)); Assert.DoesNotContain(files.ForLocale(file.Scope, "en-US", false), x => x.Id == file.Id);
        Assert.DoesNotContain(voices.ListAdmin(), x => x.Id == voice.Id);
        Assert.False(voices.Exists(voice.Id)); Assert.DoesNotContain(voice.Id, voices.EnabledIds());
        Assert.False(voices.SetAudioAvailable(voice.Id, true, out _));
        Assert.Equal(FileCategoryWriteOutcome.Conflict, files.Upsert(file.Scope, file.Id,
            new(file.LabelZhCn, file.LabelEnUs, null, null, file.Accept, file.MaxBytes, file.MaxFiles, false, false, true, 0), out _).Outcome);
        Assert.Equal(VoiceWriteOutcome.Conflict, voices.Upsert(voice.Id,
            new(voice.NameZhCn, voice.NameEnUs, "描述", "Description", [], false, true, 0, null), new HashSet<string>(), out _).Outcome);
    }
    [Theory]
    [InlineData("book_json", "{\"sourceAssets\":[{\"categoryId\":\"book-cover\"}]}" , "file")]
    [InlineData("voice_json", "{\"voiceover\":{\"selectedVoiceIds\":[\"warm-storyteller\"]}}", "voice")]
    [InlineData("voice_json", "{\"voiceover\":{\"preferredVoiceId\":\"warm-storyteller\"}}", "voice")]
    public void ProjectReferencesBlockDeletion(string column, string json, string kind)
    {
        projects.Create("owner"); Sql($"UPDATE projects SET {column}=$json", json);
        Assert.Equal("referenced", Remove(kind));
    }
    [Theory]
    [InlineData("file", "{\"categoryId\":\"book-cover\"}")]
    [InlineData("voice", "{\"selectedVoiceIds\":[\"warm-storyteller\"]}")]
    public void RevisionHistoryBlocksDeletion(string kind, string json)
    {
        new RevisionStore(connection).Initialize();
        Sql("INSERT INTO revision_rounds(id,project_id,created_at,reasons,before_snapshot) VALUES('round','old-project','now','[]',$json)", json);
        Assert.Equal("referenced", Remove(kind));
    }
    [Theory]
    [InlineData("file", "book_json", "{\"sourceAssets\":[{\"categoryId\":\"book-cover\"}]}")]
    [InlineData("voice", "voice_json", "{\"voiceover\":{\"selectedVoiceIds\":[\"warm-storyteller\"]}}")]
    public void StaleValidatedWritesCannotReferenceRemovedConfiguration(string kind, string column, string json)
    {
        projects.Create("owner"); Assert.Null(Remove(kind));
        var error = Assert.Throws<SqliteException>(() => Sql($"UPDATE projects SET {column}=$json", json));
        Assert.Contains("config.option_removed", error.Message);
    }
    private string? Remove(string kind)
    {
        if (kind == "file") { var item = files.ListAdmin("source").Single(x => x.Id == "book-cover"); return files.Remove(item.Scope, item.Id, item.UpdatedAt); }
        var voice = voices.ListAdmin().Single(x => x.Id == "warm-storyteller"); return voices.Remove(voice.Id, voice.UpdatedAt);
    }
    [Fact] public void PresetRemovalPreservesProjectSnapshotAndSurvivesRestart()
    {
        var project = projects.Create("owner"); var preset = presets.List()[0];
        var before = projects.Get("owner", project.Id)!;
        Assert.Equal("conflict", presets.Remove(preset.Id, null));
        Assert.Null(presets.Remove(preset.Id, preset.UpdatedAt));
        projects.Initialize();
        Assert.DoesNotContain(presets.List(), x => x.Id == preset.Id);
        Assert.DoesNotContain(presets.ForLocale("en-US"), x => x.PresetId == preset.Id);
        Assert.Equal("conflict", presets.Save(preset.Id, new(preset.ZhCn, preset.EnUs, true, 0, null), options, out _));
        Assert.Equal("missing", presets.SetImage(preset.Id, preset.UpdatedAt, "/new.png", out _));
        var after = projects.Get("owner", project.Id)!;
        Assert.Equal(before.Creative.Characters, after.Creative.Characters);
    }
    [Fact] public void RemovedPresetsAndVoicesDoNotKeepUnreferencedFormOptionsLocked()
    {
        foreach (var item in presets.List()) Assert.Null(presets.Remove(item.Id, item.UpdatedAt));
        foreach (var item in voices.ListAdmin()) Assert.Null(voices.Remove(item.Id, item.UpdatedAt));
        var role = options.ListAdmin("role-types").Single(x => x.Id == "protagonist");
        var tag = options.ListAdmin("voice-tags").Single(x => x.Id == "warm");
        Assert.Null(options.Remove(role.GroupId, role.Id, role.UpdatedAt));
        Assert.Null(options.Remove(tag.GroupId, tag.Id, tag.UpdatedAt));
        projects.Initialize(); voices.Initialize(); options.Initialize();
        Assert.Empty(presets.List()); Assert.Empty(voices.ListAdmin());
    }
    public void Dispose() => Directory.Delete(root, true);
}
