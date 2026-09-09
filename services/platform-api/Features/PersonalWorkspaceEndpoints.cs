using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal static class PersonalWorkspaceEndpoints{
 public static void MapPersonalWorkspace(this RouteGroupBuilder api,Func<HttpContext,CurrentUserDto?> current){
  api.MapGet("/me/views/{area}",(string area,HttpContext c,PersonalWorkspaceRepository repo)=>current(c) is {} u?Results.Ok(repo.List(u.Id,area)):Results.Unauthorized());
  api.MapPut("/me/views/{area}/{id}",(string area,string id,SaveViewRequest request,HttpContext c,PersonalWorkspaceRepository repo)=>current(c) is {} u?(repo.Save(u.Id,area,id,request)?Results.NoContent():Results.Conflict(new ApiErrorDto("views.conflict","productivity.viewConflict","Cannot save this view. Refresh and check its name and limit.",null,true,c.TraceIdentifier))):Results.Unauthorized());
  api.MapDelete("/me/views/{id}",(string id,int version,HttpContext c,PersonalWorkspaceRepository repo)=>current(c) is {} u?(repo.Delete(u.Id,id,version)?Results.NoContent():Results.Conflict()):Results.Unauthorized());
  api.MapGet("/me/resume",(string ids,HttpContext c,PersonalWorkspaceRepository repo)=>current(c) is {} u?Results.Ok(repo.ResumeSteps(u.Id,ids.Split(',',StringSplitOptions.RemoveEmptyEntries))):Results.Unauthorized());
  api.MapPut("/projects/{id}/resume",(string id,SaveResumeRequest request,HttpContext c,PersonalWorkspaceRepository repo)=>current(c) is {} u?(repo.Resume(u.Id,id,request.Step)?Results.NoContent():Results.NotFound()):Results.Unauthorized());
 }
}
