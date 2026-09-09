namespace Lifewood.PlatformApi.Contracts;
public sealed record SavedViewDto(string Id,string Area,string Name,Dictionary<string,string> Filters,int Version);
public sealed record SaveViewRequest(string Name,Dictionary<string,string> Filters,int Version=0);
public sealed record ResumeStepDto(string ProjectId,string Step);
public sealed record SaveResumeRequest(string Step);
