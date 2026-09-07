using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Xunit;
namespace Lifewood.PlatformApi.Tests;

public sealed class CharacterPresetTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lw-presets-" + Guid.NewGuid().ToString("N"));
    private readonly ProjectRepository projects;
    private readonly CharacterPresetRepository presets;
    private readonly FormOptionRepository options;
    public CharacterPresetTests()
    {
        Directory.CreateDirectory(root); var connection = "Data Source=" + Path.Combine(root,"test.db") + ";Pooling=False";
        projects = new(connection); projects.Initialize(); presets = new(connection); options = new(connection); options.Initialize();
    }
    private static UpsertCharacterPresetRequest Request(AdminCharacterPresetDto p) => new(p.ZhCn,p.EnUs,p.Enabled,p.SortOrder,p.UpdatedAt);
    [Fact] public void EditsAndImagesOnlyAffectNewProjectsAndSurviveRestart()
    {
        var original = projects.Create("owner",locale:"zh-CN"); var item = presets.List()[0];
        var request = Request(item) with { ZhCn = item.ZhCn with {Name="新主角"}, EnUs = item.EnUs with {Name="New hero"}, SortOrder=999 };
        Assert.Null(presets.Save(item.Id,request,options,out var saved));
        Assert.Null(presets.SetImage(item.Id,saved!.UpdatedAt,"/api/character-preset-images/old.png",out saved));
        var next = projects.Create("owner",locale:"en-US"); var hero = next.Creative.Characters.Single(x=>x.PresetId==item.Id);
        Assert.Equal("New hero",hero.Name); Assert.Equal("/api/character-preset-images/old.png",hero.PresetImageUrl);
        Assert.Null(presets.SetImage(item.Id,saved!.UpdatedAt,"/api/character-preset-images/new.png",out saved));
        Assert.Equal("/api/character-preset-images/old.png",hero.PresetImageUrl);
        Assert.NotEqual("新主角",original.Creative.Characters.Single(x=>x.PresetId==item.Id).Name);
        presets.Initialize(); Assert.Equal("New hero",presets.List().Single(x=>x.Id==item.Id).EnUs.Name);
        Assert.Null(presets.Save(item.Id,Request(saved!) with {Enabled=false},options,out _));
        Assert.DoesNotContain(projects.Create("owner").Creative.Characters,x=>x.PresetId==item.Id);
        Assert.NotEqual(original.Creative.Characters[0].Id,next.Creative.Characters[0].Id);
    }
    [Fact] public void StaleMetadataAndImagesCannotOverwriteAnotherAdmin()
    {
        var item=presets.List()[0]; Assert.Null(presets.Save(item.Id,Request(item),options,out _));
        Assert.Equal("conflict",presets.Save(item.Id,Request(item),options,out _));
        Assert.Equal("conflict",presets.SetImage(item.Id,item.UpdatedAt,"/wrong.png",out _));
    }
    [Fact] public void CustomPresetsValidateAndCannotBeForgedByCustomers()
    {
        var template=presets.List()[0];
        Assert.Null(presets.Save("custom-hero",Request(template) with {ExpectedUpdatedAt=null},options,out _));
        var draft=projects.Create("owner"); var creative=draft.Creative;
        Assert.Empty(CreativeValidator.Validate(new(draft.Version,creative),options,draft));
        var forged=creative with { Characters=creative.Characters.Select(c=>c with {PresetImageUrl="https://untrusted.example/photo"}).ToArray() };
        Assert.Contains(CreativeValidator.Validate(new(draft.Version,forged),options,draft),x=>x.Field.EndsWith("presetImageUrl"));
        Assert.Equal("invalid",presets.Save("invalid/../id",Request(template),options,out _));
        Assert.Equal("invalid",presets.Save("empty-name",Request(template) with {ExpectedUpdatedAt=null,ZhCn=template.ZhCn with{Name=" "}},options,out _));
    }
    [Fact] public void EnabledPresetsRespectTheTwelveCharacterFormLimit()
    {
        var p=presets.List()[0];
        for(var i=0;i<5;i++)Assert.Null(presets.Save("extra-"+i,Request(p) with{ExpectedUpdatedAt=null},options,out _));
        Assert.Equal("limit",presets.Save("one-too-many",Request(p) with{ExpectedUpdatedAt=null},options,out _));
        Assert.Null(presets.Save("disabled-extra",Request(p) with{ExpectedUpdatedAt=null,Enabled=false},options,out _));
        Assert.Equal(12,projects.Create("owner").Creative.Characters.Length);
    }
    public void Dispose(){Directory.Delete(root,true);}
}
