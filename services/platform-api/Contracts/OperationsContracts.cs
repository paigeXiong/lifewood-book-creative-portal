namespace Lifewood.PlatformApi.Contracts;

public sealed record FollowupDto(DateTimeOffset? DueAt, int Version);
public sealed record UpdateFollowupRequest(DateTimeOffset? DueAt, int ExpectedVersion);
public sealed record WorkbenchQueueDto(string Id, string Label, int Count);
public sealed record WorkbenchProjectDto(string Id, string? TaskNumber, string ProjectName, string BookTitle,
    string OwnerName, string? AssigneeName, string WorkflowStatus, string Priority, string Status,
    DateTimeOffset? DueAt, DateTimeOffset UpdatedAt);
public sealed record WorkbenchDto(WorkbenchQueueDto[] Queues, WorkbenchProjectDto[] Items, int Page,
    int PageSize, int Total, DateTimeOffset ServerTime);
