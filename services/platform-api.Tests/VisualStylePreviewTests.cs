using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class VisualStylePreviewTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-style-tests-" + Guid.NewGuid().ToString("N"));

    [Fact]
    public void BuiltInExamplesUseStableUrlsInBothLocalesAndExistingCatalogs()
    {
        Directory.CreateDirectory(root);
        var repository = new FormOptionRepository("Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False");
        repository.Initialize();
        foreach (var locale in new[] { "zh-CN", "en-US" })
        {
            var defaults = FormOptionCatalog.ForLocale(locale).VisualStyles;
            var stored = repository.ForLocale(locale).VisualStyles;
            Assert.Equal(6, defaults.Length);
            Assert.Equal(6, defaults.Select(item => item.PreviewImageUrl).Distinct().Count());
            foreach (var item in defaults)
            {
                Assert.Equal($"/style-previews/{item.Id}-v1.jpg", item.PreviewImageUrl);
                Assert.Equal(item.PreviewImageUrl, stored.Single(value => value.Id == item.Id).PreviewImageUrl);
            }
            Assert.All(repository.ForLocale(locale).Genres, item => Assert.Null(item.PreviewImageUrl));
        }
        var current = repository.ListAdmin(FormOptionGroups.VisualStyles).Single(item => item.Id == "cinematic");
        Assert.Equal(FormOptionWriteOutcome.Saved, repository.Upsert(FormOptionGroups.VisualStyles, current.Id,
            new("定制名称", "Edited name", null, null, null, "#112233", true, 27, current.UpdatedAt), out _).Outcome);
        repository.Initialize();
        var edited = repository.ForLocale("zh-CN").VisualStyles.Single(item => item.Id == current.Id);
        Assert.Equal("定制名称", edited.Label);
        Assert.Equal("#112233", edited.PreviewColor);
        Assert.Equal("/style-previews/cinematic-v1.jpg", edited.PreviewImageUrl);
        Assert.Null(FormOptionCatalog.VisualStylePreviewUrl("custom"));
        Assert.Null(FormOptionCatalog.VisualStylePreviewUrl("../cinematic"));
    }

    public void Dispose()
    {
        if (Directory.Exists(root)) Directory.Delete(root, true);
    }
}
