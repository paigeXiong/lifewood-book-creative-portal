using System.Xml.Linq;
using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class OrganizationAvatarTests
{
    [Theory][InlineData("lifewood")][InlineData("生命之木出版集团")][InlineData("Book & <Studio>")][InlineData("📚 Story House")]
    public void GeneratesStableSafeSixToOneWordmarks(string name)
    {
        var svg=AvatarImage.CreateOrganization(name);Assert.Equal(svg,AvatarImage.CreateOrganization(name));
        var root=XDocument.Parse(svg).Root!;Assert.Equal("600",root.Attribute("width")!.Value);Assert.Equal("100",root.Attribute("height")!.Value);
        Assert.Equal(2,root.Elements().Count());var text=root.Elements().Single(x=>x.Name.LocalName=="text");Assert.Equal(name.ToUpperInvariant(),text.Value);
        Assert.DoesNotContain(root.Descendants(),x=>x.Name.LocalName=="script");
    }
    [Fact] public void LongNamesAreBoundedAndMarkupIsEscaped()
    {
        var root=XDocument.Parse(AvatarImage.CreateOrganization(new string('中',120))).Root!;
        var text=root.Elements().Single(x=>x.Name.LocalName=="text");Assert.EndsWith("…",text.Value);Assert.True(text.Value.Length<=20);
        Assert.True(double.Parse(text.Attribute("textLength")!.Value,System.Globalization.CultureInfo.InvariantCulture)<=530);
        Assert.Contains("&lt;",AvatarImage.CreateOrganization("<script>&"));
        XDocument.Parse(AvatarImage.CreateOrganization("Test\u0001 Group"));
    }
}
