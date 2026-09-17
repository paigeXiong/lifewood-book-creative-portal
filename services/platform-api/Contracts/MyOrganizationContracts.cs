namespace Lifewood.PlatformApi.Contracts;

public sealed record MyOrganizationInfo(string Name, bool Active, int MemberCount);
public sealed record MyOrganizationMember(string Id, string DisplayName, string RoleLabel, bool Active, bool IsSelf, string AvatarUrl);
public sealed record MyOrganizationLabels(string Members, string Search, string Empty, string Unassigned, string Active, string Inactive, string You);
public sealed record MyOrganizationPage(MyOrganizationInfo? Organization, MyOrganizationMember[] Items, int Page, int PageSize, int Total, MyOrganizationLabels Labels);
public sealed record OrganizationMemberLabels(string Name, string Organization, string Role);
public sealed record OrganizationMemberProfile(string Id, string DisplayName, string RoleLabel, string OrganizationName, string AvatarUrl, OrganizationMemberLabels Labels);
public sealed record OrganizationMemberCounts(int Submitted, int InProgress, int ActionRequired, int Completed);
public sealed record OrganizationMemberProject(string Id, string Name, string StatusLabel, string Status, string? SubmittedAt, bool CanOpen);
public sealed record MemberActivityDay(string Date, bool Collected, int Logins, int ActivePeriods);
public sealed record MemberActivityCalendar(string TrackedFrom, MemberActivityDay[] Days);
public sealed record OrganizationMemberActivity(UserPresenceDto Presence, string PresenceLabel, OrganizationMemberCounts Counts,
    OrganizationMemberProject[] Projects, int Total, int Page, int PageSize, Dictionary<string, string> Labels, MemberActivityCalendar Calendar);
