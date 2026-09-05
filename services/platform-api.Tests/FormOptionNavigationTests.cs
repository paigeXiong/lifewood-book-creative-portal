using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using System.Text.Json;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class FormOptionNavigationTests
{
    [Theory]
    [InlineData("zh-CN")]
    [InlineData("en-US")]
    public void NavigationExposesEveryEditableGroupExactlyOnceAndSupportsAot(string locale)
    {
        var sections = FormOptionNavigation.ForLocale(locale);
        var groups = sections.SelectMany(section => section.Groups).ToArray();
        Assert.Equal(FormOptionGroups.Configurable.Count, groups.Length);
        Assert.True(FormOptionGroups.Configurable.SetEquals(groups.Select(group => group.Id)));
        Assert.All(sections, section => Assert.False(string.IsNullOrWhiteSpace(section.Label)));
        Assert.All(groups, group => Assert.False(string.IsNullOrWhiteSpace(group.Label)));
        var json = JsonSerializer.Serialize(sections, AppJsonContext.Default.FormOptionSectionDtoArray);
        Assert.Contains("groups", json);
    }

    [Fact]
    public void LocaleChangesLabelsWithoutChangingNavigationIds()
    {
        var zh = FormOptionNavigation.ForLocale("zh-CN");
        var en = FormOptionNavigation.ForLocale("en-US");
        Assert.Equal(zh.SelectMany(s => s.Groups).Select(g => g.Id), en.SelectMany(s => s.Groups).Select(g => g.Id));
        Assert.NotEqual(zh[0].Label, en[0].Label);
    }
}
