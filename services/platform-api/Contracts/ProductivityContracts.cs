namespace Lifewood.PlatformApi.Contracts;
public sealed record BatchProjectVersion(string Id,DateTimeOffset WorkflowVersion,int FollowupVersion);
public sealed record BatchProjectPreview(string Id,string Name,DateTimeOffset WorkflowVersion,int FollowupVersion);
public sealed record BatchProjectRequest(string Action,BatchProjectVersion[] Items,string? Priority=null,string? AssigneeId=null,DateTimeOffset? DueAt=null);
public sealed record BatchProjectResult(string Id,string Outcome);
public sealed record TrendPoint(string Date,int Submitted,int Delivered,int Overdue);
public sealed record TrendReport(TrendPoint[] Days,DateTimeOffset ServerTime);
