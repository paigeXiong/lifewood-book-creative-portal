using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class ColorToneTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-tone-tests-" + Guid.NewGuid().ToString("N"));
    private string ConnectionString => "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";

    [Fact]
    public void MigrationRetiresOldDefaultsWithoutRewritingProjectsOrAdminChoices()
    {
        Directory.CreateDirectory(root);
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        new UserRepository(ConnectionString, root).Initialize();
        new AdminRepository(ConnectionString).Initialize();
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        var draft = projects.Create("owner");
        var oldCreative = draft.Creative with { ImageStyleTagIds = ["natural-light", "vintage"] };
        Assert.Equal(SaveOutcome.Saved, projects.SaveCreative("owner", draft.Id, new(draft.Version, oldCreative)).Outcome);

        // Recreate the pre-upgrade catalog and migration ledger.
        options.Upsert(FormOptionGroups.ImageStyleTags, "natural-light", new("自然光", "Natural light", null, null, null, null, true, 0), out _);
        options.Upsert(FormOptionGroups.ImageStyleTags, "vintage", new("复古", "Vintage", null, null, null, null, true, 40), out _);
        options.Upsert(FormOptionGroups.ImageStyleTags, "modern", new("品牌色", "Brand colors", null, null, null, null, true, 50), out _);
        using (var connection = new SqliteConnection(ConnectionString))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM form_option_catalog_migrations WHERE id = 'image-style-color-tones-v1'; DELETE FROM form_options WHERE group_id = 'image-style-tags' AND id IN ('natural-color', 'warm-tone', 'cool-tone', 'black-and-white');";
            command.ExecuteNonQuery();
        }
        options.Initialize();
        Assert.Equal(oldCreative.ImageStyleTagIds, projects.Get("owner", draft.Id)!.Creative.ImageStyleTagIds);
        Assert.False(options.ListAdmin(FormOptionGroups.ImageStyleTags).Single(item => item.Id == "natural-light").Enabled);
        Assert.Equal("复古", options.ListAdmin(FormOptionGroups.ImageStyleTags).Single(item => item.Id == "vintage").LabelZhCn);
        Assert.True(options.ListAdmin(FormOptionGroups.ImageStyleTags).Single(item => item.Id == "modern").Enabled);
        foreach (var locale in new[] { "zh-CN", "en-US" })
        {
            var expected = FormOptionCatalog.ForLocale(locale).ImageStyleTags;
            Assert.Equal(4, expected.Length);
            foreach (var item in expected)
                Assert.Contains(options.ForLocale(locale).ImageStyleTags, stored => stored.Id == item.Id && stored.Label == item.Label);
            Assert.DoesNotContain(options.ForLocale(locale).ImageStyleTags, item => item.Id == "vintage");
            Assert.Contains(options.ForLocale(locale).LegacyImageStyleTags!, item => item.Id == "vintage" && item.Label == (locale == "zh-CN" ? "复古" : "Vintage"));
        }
        var natural = options.ListAdmin(FormOptionGroups.ImageStyleTags).Single(item => item.Id == "natural-color");
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.ImageStyleTags, natural.Id,
            new("原色定制", "Custom natural", null, null, null, null, false, 99, natural.UpdatedAt), out _).Outcome);
        options.Initialize();
        var retained = options.ListAdmin(FormOptionGroups.ImageStyleTags).Single(item => item.Id == natural.Id);
        Assert.False(retained.Enabled);
        Assert.Equal(99, retained.SortOrder);
        Assert.Equal("原色定制", retained.LabelZhCn);
    }

    [Fact]
    public void SavesAllowOneToneOrExistingLegacySubsetButRejectNewCombinations()
    {
        Directory.CreateDirectory(root);
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        new UserRepository(ConnectionString, root).Initialize();
        new AdminRepository(ConnectionString).Initialize();
        var draft = projects.Create("owner");
        var legacy = draft with { Creative = draft.Creative with { ImageStyleTagIds = ["natural-light", "vintage", "modern"] } };
        FieldErrorDto[] Validate(string[] ids, TaskDraftDto current) => CreativeValidator.Validate(
            new(current.Version, current.Creative with { ImageStyleTagIds = ids }), options, current);
        Assert.Empty(Validate([], draft));
        Assert.Empty(Validate(["warm-tone"], draft));
        Assert.Contains(Validate(["warm-tone", "cool-tone"], draft), error => error.Code == "too_many");
        Assert.Contains(Validate(["vintage"], draft), error => error.Code == "unknown_option");
        Assert.Empty(Validate(legacy.Creative.ImageStyleTagIds, legacy));
        Assert.Empty(Validate(["natural-light", "vintage"], legacy));
        Assert.Empty(Validate(["cool-tone"], legacy));
        Assert.Contains(Validate(["vintage", "warm-tone"], legacy), error => error.Code == "too_many");
        Assert.Contains(Validate(["vintage", "vintage"], legacy), error => error.Code == "unknown_option");
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }
}
