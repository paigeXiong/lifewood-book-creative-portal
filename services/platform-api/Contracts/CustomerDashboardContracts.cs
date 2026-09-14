namespace Lifewood.PlatformApi.Contracts;

public sealed record DashboardCounts(int Total, int ActionRequired, int Active, int Downloadable);
public sealed record DashboardStatus(string Id, int Count);
public sealed record DashboardDay(string Date, int Submissions, int Resubmissions, int Deliveries, int Projects);
public sealed record DashboardProject(string Id, string ProjectName, string BookTitle, string? TaskNumber, string Status, string WorkflowStatus, string UpdatedAt);
public sealed record DashboardActivity(string Id, string Kind, string OccurredAt, DashboardProject Project);
public sealed record DashboardActivityPage(DashboardActivity[] Items, int Total, int Page, int PageSize);
public sealed record CustomerDashboardDto(string Month, string TimeZone, string HistoryCompleteFrom, string GeneratedAt,
    DashboardCounts Counts, DashboardStatus[] Statuses, DashboardDay[] Days, DashboardActivityPage Activities, DashboardProject[] RecentProjects);
