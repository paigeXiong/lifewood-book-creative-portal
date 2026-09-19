using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
namespace Lifewood.PlatformApi.Features;
internal static class InvitationEndpoints {
 public static void MapInvitations(this RouteGroupBuilder api,Func<HttpContext,CurrentUserDto?> currentUser) {
  var group=api.MapGroup("");
  group.AddEndpointFilter(async(ctx,next)=>{ctx.HttpContext.Response.Headers.CacheControl="no-store";return await next(ctx);});
  var admin=group.MapGroup("/admin/invitations");
  admin.AddEndpointFilter(async(ctx,next)=>{var user=currentUser(ctx.HttpContext);if(user is null)return Results.Unauthorized();if(!user.Permissions.Contains("admin.users.manage"))return Results.StatusCode(403);return await next(ctx);});
  admin.MapGet("",(InvitationRepository r,HttpContext c,string? q,string? status,string? organization,int? page)=>{
   if(q?.Length>160 || status is not (null or "" or "active" or "used" or "expired" or "disabled") || page is <1 or >100000)return Fail(c,"invalid");
   return Results.Ok(r.List(q,status,organization,page??1));
  });
  admin.MapPost("",(CreateInvitation input,InvitationRepository r,MailSettings settings,HttpContext c)=>{var result=r.Create(input,currentUser(c)!.Id);if(result is null)return Fail(c,"invalid");c.Items[AuditActionCatalog.TargetIdItemKey]=result.Id;return Results.Ok(result with {PublicUrl=settings.PublicUrl});});
  admin.MapPost("/{id}/reveal",(string id,InvitationRepository r,MailSettings settings,HttpContext c)=>r.Reveal(id) is {} result?Results.Ok(result with {PublicUrl=settings.PublicUrl}):Fail(c,"unavailable"));
  admin.MapPost("/{id}/disable",(string id,InvitationRepository r)=>r.Disable(id)?Results.NoContent():Results.NotFound());
  admin.MapGet("/{id}/members",(string id,int? page,InvitationRepository r,HttpContext c)=>page is <1 or >100000?Fail(c,"invalid"):Results.Ok(r.Members(id,page??1)));
  var auth=group.MapGroup("/auth/invitations").RequireRateLimiting("authentication");
  auth.MapPost("/lookup",(InvitationCodeRequest input,InvitationRepository r,HttpContext c)=>input.Code is {Length:>0 and <=64} && r.Lookup(input.Code) is {} result?Results.Ok(result):Fail(c,"unavailable"));
  auth.MapPost("/inspect",(InvitationCodeRequest input,InvitationRepository r,HttpContext c)=>input.Code is {Length:64} && r.InspectToken(input.Code) is {} result?Results.Ok(result):Fail(c,"invalidLink"));
  auth.MapPost("/email",async(InvitationEmailRequest input,InvitationRepository r,EmailRepository emails,MailSettings settings,HttpContext c)=>{
   if(!settings.Ready)return Fail(c,"mailUnavailable",503);
   if(input.Code is not {Length:>0 and <=64} || input.Email is not {Length:>0 and <=254} || input.Locale is not ("zh-CN" or "en-US"))return Fail(c,"invalid");
   var timer=System.Diagnostics.Stopwatch.StartNew();
   var challenge=r.Challenge(input);
   if(challenge is not null){try {emails.QueueInvitation(challenge);}catch {r.RevokeChallenge(challenge.Token);throw;}}
   var remaining=TimeSpan.FromMilliseconds(300)-timer.Elapsed;
   if(remaining>TimeSpan.Zero)await Task.Delay(remaining,c.RequestAborted);
   return Results.NoContent();
  });
  auth.MapPost("/register",(InvitationRegistration input,InvitationRepository r,HttpContext c)=>r.Register(input)?Results.NoContent():Fail(c,"invalidLink"));
 }
 private static IResult Fail(HttpContext c,string code,int status=400)=>Results.Json(new ApiErrorDto("invitation."+code,"invitation.errors."+code,"Unable to complete invitation request.",null,false,c.TraceIdentifier),AppJsonContext.Default.ApiErrorDto,statusCode:status);
}
