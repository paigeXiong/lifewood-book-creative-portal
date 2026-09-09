using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal static class ProductivityEndpoints{
 public static void MapProductivity(this RouteGroupBuilder api,Func<HttpContext,CurrentUserDto?> current){
  api.MapGet("/admin/reports",(HttpContext c,TrendRepository repo,string from,string to,int offset=0,string? organization=null,string? assignee=null)=>{
   var user=current(c);if(user is null)return Results.Unauthorized();if(!user.Permissions.Contains("admin.projects.read"))return Results.Forbid();
   if(!DateOnly.TryParseExact(from,"yyyy-MM-dd",out var start)||!DateOnly.TryParseExact(to,"yyyy-MM-dd",out var end)||end<start||end.DayNumber-start.DayNumber>365||offset is < -840 or >840||organization?.Length>200||assignee?.Length>200)return Results.BadRequest(new ApiErrorDto("reports.range","productivity.invalidRange","Choose a valid date range of up to 366 days.",null,false,c.TraceIdentifier));
   c.Response.Headers.CacheControl="no-store";return Results.Ok(repo.Read(user.Id,start,end,offset,organization,assignee));
  });
  api.MapGet("/admin/projects/batch-preview",(HttpContext c,AdminRepository admin,OperationsRepository operations,string ids)=>{
   var user=current(c);if(user is null)return Results.Unauthorized();if(!user.Permissions.Contains("admin.projects.workflow"))return Results.Forbid();
   var selected=ids.Split(',',StringSplitOptions.RemoveEmptyEntries).Distinct().ToArray();if(selected.Length is <1 or >50)return Results.BadRequest();
   var items=new List<BatchProjectPreview>();foreach(var id in selected){var detail=admin.GetProject(id,user.Id);var followup=operations.GetFollowup(id,user.Id);if(detail is null||followup is null)continue;items.Add(new(id,detail.Project.Project.ProjectName,detail.WorkflowUpdatedAt,followup.Version));}
   c.Response.Headers.CacheControl="no-store";return Results.Ok(items.ToArray());
  });
  api.MapPost("/admin/projects/batch",(HttpContext c,AdminRepository admin,OperationsRepository operations,AuditRepository audit,BatchProjectRequest request)=>{
   var user=current(c);if(user is null)return Results.Unauthorized();if(!user.Permissions.Contains("admin.projects.workflow")||request.Action=="assign"&&!user.Permissions.Contains("admin.projects.assign"))return Results.Forbid();
   if(request.Action is not ("priority" or "assign" or "followup")||request.Items is not {Length:>=1 and <=50}||request.Items.Any(x=>x is null||string.IsNullOrWhiteSpace(x.Id)||x.Id.Length>100)||request.Items.Select(x=>x.Id).Distinct().Count()!=request.Items.Length)return Results.BadRequest();
   var results=new List<BatchProjectResult>();foreach(var item in request.Items){
    var fresh=current(c);if(fresh is null||!fresh.Permissions.Contains("admin.projects.workflow")||request.Action=="assign"&&!fresh.Permissions.Contains("admin.projects.assign")){results.Add(new(item.Id,"Protected"));continue;}
    var detail=admin.GetProject(item.Id,fresh.Id);if(detail is null){results.Add(new(item.Id,"NotFound"));continue;}
    var result=request.Action=="followup"?operations.SetFollowup(item.Id,fresh.Id,new(request.DueAt,item.FollowupVersion)):admin.UpdateWorkflow(item.Id,new(detail.WorkflowStatus,request.Action=="priority"?request.Priority??"":detail.Priority,request.Action=="assign"?request.AssigneeId:detail.AssigneeUserId,item.WorkflowVersion),fresh.Id,fresh.Id,fresh.Permissions.Contains("admin.projects.assign"),allowReturnedFields:true);
    if(result.Outcome==AdminWriteOutcome.Saved)audit.Record(fresh,new AuditActionMatch(request.Action=="followup"?"project.followup_update":"project.workflow_update","project",item.Id),c.TraceIdentifier);
    results.Add(new(item.Id,result.Outcome.ToString()));
   }
   return Results.Ok(results.ToArray());
  });
 }
}
