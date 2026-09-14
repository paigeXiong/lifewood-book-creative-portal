using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class FileCategoryLabelMigrationTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-label-migration-" + Guid.NewGuid().ToString("N"));
    private readonly string connection;
    private readonly FileCategoryRepository files;
    public FileCategoryLabelMigrationTests()
    {
        Directory.CreateDirectory(root);
        connection = "Data Source=" + Path.Combine(root, "db") + ";Pooling=False";
        new ProjectRepository(connection).Initialize();
        files = new(connection);
        files.Initialize();
    }
    private void Sql(string sql)
    {
        using var db = new SqliteConnection(connection); db.Open();
        using var command = db.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery();
    }
    private string Value(string sql)
    {
        using var db = new SqliteConnection(connection); db.Open();
        using var command = db.CreateCommand(); command.CommandText = sql;
        return Convert.ToString(command.ExecuteScalar())!;
    }
    private void SimulateOldDefaults() => Sql("""
        DELETE FROM file_category_migrations WHERE id='plain-file-labels-v1';
        UPDATE file_categories SET label_zh_cn='全书或节选（可选）',label_en_us='Manuscript or excerpt (optional)',
            description_zh_cn='PDF、DOCX 或 TXT',description_en_us='PDF, DOCX, or TXT' WHERE id='manuscript';
        UPDATE file_categories SET label_zh_cn='情绪板',label_en_us='Moodboard' WHERE id='moodboard';
        """);
    [Fact]
    public void FreshDefaultsUsePlainBilingualLabels()
    {
        Assert.Equal("书籍正文", files.ForLocale("source", "zh-CN").Single(x => x.Id == "manuscript").Label);
        Assert.Equal("Book text", files.ForLocale("source", "en-US").Single(x => x.Id == "manuscript").Label);
        Assert.Equal("风格参考拼图", files.ForLocale("reference", "zh-CN").Single(x => x.Id == "moodboard").Label);
        Assert.Equal("Visual inspiration board", files.ForLocale("reference", "en-US").Single(x => x.Id == "moodboard").Label);
    }
    [Fact]
    public void UpgradePreservesStableReferencesAndRunsOnlyOnce()
    {
        SimulateOldDefaults();
        new ProjectRepository(connection).Create("owner");
        new RevisionStore(connection).Initialize();
        Sql("""
            UPDATE projects SET book_json='{"sourceAssets":[{"categoryId":"manuscript","name":"book.pdf"}]}';
            INSERT INTO revision_rounds(id,project_id,created_at,reasons,before_snapshot)
            VALUES('round','historic-project','now','[]','{"label":"全书或节选（可选）","categoryId":"manuscript"}');
            UPDATE file_categories SET max_bytes=123456,max_files=3,enabled=0 WHERE id='manuscript';
            """);
        var book = Value("SELECT book_json FROM projects LIMIT 1");
        var snapshot = Value("SELECT before_snapshot FROM revision_rounds WHERE id='round'");
        files.Initialize();
        var category = files.ListAdmin("source").Single(x => x.Id == "manuscript");
        Assert.Equal("书籍正文", category.LabelZhCn); Assert.Equal("Book text", category.LabelEnUs);
        Assert.Contains("选填", category.DescriptionZhCn); Assert.Contains("Optional", category.DescriptionEnUs);
        Assert.Equal(123456, category.MaxBytes); Assert.Equal(3, category.MaxFiles); Assert.False(category.Enabled);
        Assert.Equal(book, Value("SELECT book_json FROM projects LIMIT 1"));
        Assert.Equal(snapshot, Value("SELECT before_snapshot FROM revision_rounds WHERE id='round'"));
        files.Initialize();
        Assert.Equal(category.UpdatedAt, files.ListAdmin("source").Single(x => x.Id == "manuscript").UpdatedAt);
        Sql("UPDATE file_categories SET label_zh_cn='全书或节选' WHERE id='manuscript'");
        files.Initialize();
        Assert.Equal("全书或节选", files.ListAdmin("source").Single(x => x.Id == "manuscript").LabelZhCn);
    }
    [Fact]
    public void CustomLabelsDescriptionsAndRequiredSettingArePreservedPerLanguage()
    {
        SimulateOldDefaults();
        Sql("""
            UPDATE file_categories SET label_zh_cn='客户定稿',description_zh_cn='请提供定稿',required=1 WHERE id='manuscript';
            UPDATE file_categories SET label_en_us='Our inspiration',description_en_us='Custom guidance' WHERE id='moodboard';
            """);
        files.Initialize();
        var book = files.ListAdmin("source").Single(x => x.Id == "manuscript");
        Assert.Equal("客户定稿", book.LabelZhCn); Assert.Equal("请提供定稿", book.DescriptionZhCn);
        Assert.Equal("Book text", book.LabelEnUs); Assert.Equal("PDF, DOCX, or TXT", book.DescriptionEnUs); Assert.True(book.Required);
        var board = files.ListAdmin("reference").Single(x => x.Id == "moodboard");
        Assert.Equal("风格参考拼图", board.LabelZhCn); Assert.Equal("Our inspiration", board.LabelEnUs); Assert.Equal("Custom guidance", board.DescriptionEnUs);
    }
    [Fact]
    public void RemovedCategoriesAreNotRenamedOrRevived()
    {
        SimulateOldDefaults();
        var category = files.ListAdmin("reference").Single(x => x.Id == "moodboard");
        Assert.Null(files.Remove("reference", category.Id, category.UpdatedAt));
        files.Initialize();
        Assert.DoesNotContain(files.ListAdmin("reference"), x => x.Id == "moodboard");
        Assert.Equal("情绪板", Value("SELECT label_zh_cn FROM file_categories WHERE id='moodboard'"));
    }
    public void Dispose() => Directory.Delete(root, true);
}
