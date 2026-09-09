namespace Lifewood.PlatformApi.Contracts;
public sealed record PresenceHeartbeatRequest(string TabId, bool Visible, bool Interacted);
public sealed record UserPresenceDto(string Status, DateTimeOffset? LastActiveAt, DateTimeOffset? LastLoginAt);
public sealed record UserPresenceStatsDto(int Online, int TodayActive, int Enabled, int Unassigned);
public sealed record AdminUserDetailsDto(AdminUserDto User, int SubmittedProjects, int PendingProjects);
