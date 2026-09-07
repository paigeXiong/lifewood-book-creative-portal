using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class FormOptionRemovalTests : IDisposable
{
    private readonly string root=Path.Combine(Path.GetTempPath(),"lw-option-remove-"+Guid.NewGuid().ToString("N"));
    private readonly string connection; private readonly FormOptionRepository options; private readonly ProjectRepository projects;
    public FormOptionRemovalTests(){Directory.CreateDirectory(root);connection="Data Source="+Path.Combine(root,"db")+";Pooling=False";projects=new(connection);projects.Initialize();options=new(connection);options.Initialize();}
    private AdminFormOptionDto Add(string group,string id="test-option") {Assert.Equal(FormOptionWriteOutcome.Saved,options.Upsert(group,id,new("测试","Test",null,null,null,null,true,100),out var value).Outcome);return value!;}
    private void Sql(string sql,string value){using var db=new SqliteConnection(connection);db.Open();using var cmd=db.CreateCommand();cmd.CommandText=sql;cmd.Parameters.AddWithValue("$value",value);cmd.ExecuteNonQuery();}
    [Fact] public void UnusedBuiltInRemovalSurvivesSeedingAndRejectsStaleWrites()
    {
        var item=options.ListAdmin(FormOptionGroups.VideoGoals)[0];
        Assert.Equal("conflict",options.Remove(item.GroupId,item.Id,null));
        Assert.Null(options.Remove(item.GroupId,item.Id,item.UpdatedAt));options.Initialize();
        Assert.DoesNotContain(options.ListAdmin(item.GroupId),x=>x.Id==item.Id);Assert.DoesNotContain(item.Id,options.EnabledIds(item.GroupId));
        Assert.Equal(FormOptionWriteOutcome.Conflict,options.Upsert(item.GroupId,item.Id,new("不能复活","Cannot revive",null,null,null,null,true,0),out _).Outcome);
    }
    [Theory]
    [InlineData("video-goals","project_json","{\"videoGoalId\":\"test-option\"}")]
    [InlineData("audiences","project_json","{\"audienceIds\":[\"test-option\"]}")]
    [InlineData("genres","book_json","{\"genreId\":\"test-option\"}")]
    [InlineData("mood-tags","creative_json","{\"moodTagIds\":[\"test-option\"]}")]
    [InlineData("voice-genders","voice_json","{\"voiceover\":{\"voiceGenderId\":\"test-option\"}}")]
    public void ProjectSelectionsBlockRemoval(string group,string column,string json)
    {
        var item=Add(group);projects.Create("owner");Sql($"UPDATE projects SET {column}=$value",json);
        Assert.Equal("referenced",options.Remove(group,item.Id,item.UpdatedAt));
    }
    [Fact] public void PresetsVoiceTagsAndRevisionHistoryBlockRemoval()
    {
        var role=options.ListAdmin(FormOptionGroups.RoleTypes).Single(x=>x.Id=="protagonist");Assert.Equal("referenced",options.Remove(role.GroupId,role.Id,role.UpdatedAt));
        new VoiceReferenceRepository(connection).Initialize();var tag=options.ListAdmin(FormOptionGroups.VoiceTags).Single(x=>x.Id=="warm");Assert.Equal("referenced",options.Remove(tag.GroupId,tag.Id,tag.UpdatedAt));
        new RevisionStore(connection).Initialize();var history=Add(FormOptionGroups.Genres);
        Sql("INSERT INTO revision_rounds(id,project_id,created_at,reasons,before_snapshot) VALUES('round','old-project','now','[]',$value)","{\"book\":{\"genreId\":\"test-option\"}}");
        Assert.Equal("referenced",options.Remove(history.GroupId,history.Id,history.UpdatedAt));
    }
    [Fact] public void SameIdentifierInDifferentGroupsDoesNotCreateFalseReferences()
    {
        projects.Create("owner");var item=Add(FormOptionGroups.VideoGoals,"protagonist");Assert.Null(options.Remove(item.GroupId,item.Id,item.UpdatedAt));
    }
    [Fact] public void SaveThatValidatedBeforeRemovalCannotIntroduceADeletedReference()
    {
        var item=Add(FormOptionGroups.VideoGoals);projects.Create("owner");
        Assert.Contains(item.Id,options.EnabledIds(item.GroupId));
        Assert.Null(options.Remove(item.GroupId,item.Id,item.UpdatedAt));
        var error=Assert.Throws<SqliteException>(()=>Sql("UPDATE projects SET project_json=$value","{\"videoGoalId\":\"test-option\"}"));
        Assert.Contains("config.option_removed",error.Message);
    }
    [Fact] public void RestartPreservesCustomizedPresetAfterItsOriginalRoleWasRemoved()
    {
        var presets=new CharacterPresetRepository(connection);var preset=presets.List().Single(x=>x.Id=="protagonist");
        Assert.Null(presets.Save(preset.Id,new(preset.ZhCn with{RoleTypeId="supporting"},preset.EnUs with{RoleTypeId="supporting"},true,preset.SortOrder,preset.UpdatedAt),options,out _));
        var role=options.ListAdmin(FormOptionGroups.RoleTypes).Single(x=>x.Id=="protagonist");Assert.Null(options.Remove(role.GroupId,role.Id,role.UpdatedAt));
        projects.Initialize();options.Initialize();
        Assert.Equal("supporting",presets.List().Single(x=>x.Id==preset.Id).ZhCn.RoleTypeId);
        Assert.DoesNotContain(options.ListAdmin(role.GroupId),x=>x.Id==role.Id);
    }
    public void Dispose(){Directory.Delete(root,true);}
}
