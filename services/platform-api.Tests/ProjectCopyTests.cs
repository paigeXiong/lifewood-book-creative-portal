using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;
namespace Lifewood.PlatformApi.Tests;
public sealed class ProjectCopyTests:IDisposable {
 private readonly string root=Path.Combine(Path.GetTempPath(),"portal-copy-"+Guid.NewGuid().ToString("N"));
 private readonly ProjectRepository projects;
 public ProjectCopyTests(){Directory.CreateDirectory(root);projects=new("Data Source="+Path.Combine(root,"test.db")+";Pooling=False");projects.Initialize();new RevisionStore("Data Source="+Path.Combine(root,"test.db")+";Pooling=False").Initialize();}
 [Fact] public void CopyKeepsTextButStartsIndependentDraftWithoutFilesOrWorkflow(){
  var original=projects.Create("owner");
  var file=new ReferenceAssetDto("file","cover","cover.png","image/png",10,"/api/projects/source/files/file");
  var saved=projects.Save("owner",original.Id,new(original.Version,original.Project with { ProjectName="Book campaign",Deadline="2026-12-01" },original.Book with { Title="A book",SourceAssets=[file] })).Draft!;
  saved=projects.SaveCreative("owner",original.Id,new(saved.Version,saved.Creative with { StyleReferenceImages=[file],StyleReferenceImageUrls=[file.Url],Characters=saved.Creative.Characters.Select(c=>c with {ReferenceImages=[file],ReferenceImageUrls=[file.Url]}).ToArray() })).Draft!;
  saved=projects.SaveVoiceAndReferences("owner",original.Id,new(saved.Version,saved.VoiceAndReferences with { Assets=[file] })).Draft!;
  Assert.Equal(SaveOutcome.Saved,projects.Submit("owner",original.Id,saved.Version,"submitted-key",null).Outcome);
  var result=projects.Copy("owner",original.Id,"request",10);var copy=result.Draft!;
  Assert.Equal("saved",result.Outcome);Assert.NotEqual(original.Id,copy.Id);Assert.Equal("A book",copy.Book.Title);Assert.Equal("Book campaign",copy.Project.ProjectName);
  Assert.Equal("draft",copy.Status);Assert.Null(copy.TaskNumber);Assert.Equal("new",copy.WorkflowStatus);Assert.Equal(1,copy.Version);Assert.Null(copy.Project.Deadline);Assert.Empty(copy.Book.SourceAssets!);
  Assert.Empty(copy.VoiceAndReferences.Assets);Assert.Empty(copy.Creative.StyleReferenceImageUrls);Assert.Empty(copy.Creative.StyleReferenceImages!);
  Assert.All(copy.Creative.Characters,c=>{Assert.Empty(c.ReferenceImageUrls);Assert.Empty(c.ReferenceImages!);});
  Assert.Single(projects.Get("owner",original.Id)!.Book.SourceAssets!);
  projects.Save("owner",copy.Id,new(copy.Version,copy.Project,copy.Book with{Title="Changed"}));Assert.Equal("A book",projects.Get("owner",original.Id)!.Book.Title);
 }
 [Fact] public void OwnershipLimitsAndRetriesCannotCreateExtraDrafts(){
  var source=projects.Create("owner");
  Assert.Equal("missing",projects.Copy("other",source.Id,"key",10).Outcome);
  Assert.Equal("limit",projects.Copy("owner",source.Id,"key",1).Outcome);
  var copy=projects.Copy("owner",source.Id,"key",2).Draft!;
  Assert.Equal(copy.Id,projects.Copy("owner",source.Id,"key",2).Draft!.Id);
  Assert.Equal(2,projects.CountDrafts("owner"));
  Assert.Equal("conflict",projects.Copy("owner",copy.Id,"key",3).Outcome);
  projects.DeleteDraft("owner",copy.Id,copy.Version);
  Assert.Null(projects.Copy("owner",source.Id,"key",2).Draft);Assert.Equal(1,projects.CountDrafts("owner"));
 }
 public void Dispose(){SqliteConnection.ClearAllPools();Directory.Delete(root,true);}
}
