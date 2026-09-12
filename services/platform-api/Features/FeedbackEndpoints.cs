using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Lifewood.PlatformApi.Persistence;
namespace Lifewood.PlatformApi.Features;
internal static class FeedbackEndpoints
{
    public static void MapFeedback(this RouteGroupBuilder api,Func<HttpContext,CurrentUserDto?> currentUser) {
        var group=api.MapGroup("");
        group.AddEndpointFilter(async (c,next)=> {
            if(currentUser(c.HttpContext) is not {} user)return Results.Unauthorized();
            if(c.HttpContext.Request.Path.StartsWithSegments("/api/admin/feedback")&&!user.Permissions.Contains("admin.feedback.manage"))return Results.Forbid();
            c.HttpContext.Response.Headers.CacheControl="no-store";return await next(c);
        });
        group.MapGet("/feedback/catalog",(string? locale)=> {
            var en=locale=="en-US";
            return Results.Ok(new FeedbackCatalog([new("bug",en?"Platform issue":"平台问题"),new("suggestion",en?"Suggestion":"改进建议"),new("other",en?"Other":"其他")],
              [new("pending",en?"Pending":"待处理"),new("processing",en?"In progress":"处理中"),new("resolved",en?"Resolved":"已解决")],FeedbackRepository.ScreenshotMaxBytes,FeedbackRepository.ScreenshotSourceMaxBytes));
        });
        group.MapPost("/feedback",(CreateFeedbackRequest input,HttpContext c,FeedbackRepository repository)=> {
            if(!Guid.TryParseExact(input.Id,"N",out _)||!FeedbackRepository.Categories.Contains(input.Category)||input.Description?.Trim() is not {Length:>=5 and <=4000}||
               input.PagePath is null||input.PagePath.Length>300||!input.PagePath.StartsWith('/')||input.PagePath.StartsWith("//")||input.PagePath.Any(x=>char.IsControl(x)||x is '?' or '#' or '\\'))
                return Failure(c,400,"invalid");
            byte[]? screenshot=null;
            if(input.ScreenshotBase64 is not null) {
                if(input.ScreenshotBase64.Length>1_333_336)return Failure(c,400,"image");
                try{screenshot=Convert.FromBase64String(input.ScreenshotBase64);}catch(FormatException){return Failure(c,400,"image");}
                if(screenshot.Length is <12 or >FeedbackRepository.ScreenshotMaxBytes||!IsImage(screenshot,input.ScreenshotType))return Failure(c,400,"image");
            } else if(input.ScreenshotType is not null)return Failure(c,400,"image");
            return repository.Create(currentUser(c)!.Id,input,screenshot) switch {
                "ok"=>Results.NoContent(), "limited"=>Failure(c,429,"limited"), "forbidden"=>Results.Forbid(), _=>Failure(c,409,"conflict")
            };
        });
        group.MapGet("/admin/feedback",(FeedbackRepository repository,int page=1,string? search=null,string? status=null)=>Results.Ok(repository.List(page,search,status)));
        group.MapGet("/admin/feedback/{id}",(string id,FeedbackRepository repository)=>repository.Detail(id) is {} detail?Results.Ok(detail):Results.NotFound());
        group.MapPut("/admin/feedback/{id}",(string id,UpdateFeedbackRequest input,HttpContext c,FeedbackRepository repository)=> {
            if(input.Version<1||!FeedbackRepository.Statuses.Contains(input.Status)||input.Reply?.Length>4000)return Failure(c,400,"invalid");
            return repository.Update(id,currentUser(c)!.Id,input)?Results.NoContent():Failure(c,409,"conflict");
        });
        group.MapGet("/admin/feedback/{id}/screenshot",(string id,HttpContext c,FeedbackRepository repository)=> {
            c.Response.Headers["X-Content-Type-Options"]="nosniff";
            c.Response.Headers.ContentSecurityPolicy="sandbox; default-src 'none'";
            return repository.Screenshot(id) is {} image?Results.File(image.Data,image.Type):Results.NotFound();
        });
        group.MapGet("/notifications/{id:long}/feedback",(long id,HttpContext c,FeedbackRepository repository)=>repository.Notice(currentUser(c)!.Id,id) is {} notice?Results.Ok(notice):Results.NotFound());
    }
    private static IResult Failure(HttpContext c,int status,string code)=>Results.Json(new ApiErrorDto("feedback."+code,"feedback.errors."+code,"Unable to save feedback.",null,false,c.TraceIdentifier),AppJsonContext.Default.ApiErrorDto,statusCode:status);
    private static bool IsImage(byte[] data,string? type)=>type switch {
        "image/png"=>data.AsSpan(0,8).SequenceEqual(new byte[]{137,80,78,71,13,10,26,10}),
        "image/jpeg"=>data[0]==255&&data[1]==216&&data[2]==255,
        "image/webp"=>data.AsSpan(0,4).SequenceEqual("RIFF"u8)&&data.AsSpan(8,4).SequenceEqual("WEBP"u8), _=>false
    };
}
