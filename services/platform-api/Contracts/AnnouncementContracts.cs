namespace Lifewood.PlatformApi.Contracts;
public sealed record AnnouncementInput(string? TitleZh, string? BodyZh, string? TitleEn, string? BodyEn, string Placement, string Audience, string[] Languages, string[] OrganizationIds, string? StartsAt, string? EndsAt, long Version = 0, string? Title = null, string? Body = null, int? DisplayDays = null);
public sealed record AnnouncementDocument(string Id, long Sequence, AnnouncementInput Content, string Status, long Version, string CreatedAt, int Recipients, DateTimeOffset? ScheduledAt = null);
public sealed record AnnouncementPage(AnnouncementDocument[] Items, long? NextCursor);
public sealed record AnnouncementItem(string Id, long Sequence, string Title, string Body, string PublishedAt, bool Dismissed, bool Popup, bool Banner = false);
public sealed record AnnouncementFeed(AnnouncementItem[] Items, long? NextCursor);
public sealed record AnnouncementVersion(long Version);

public sealed record DismissAnnouncementsRequest(string[] Ids);

public sealed record AnnouncementPreview(int? Count);

public sealed record ScheduleAnnouncementRequest(long Version, DateTimeOffset RunAt);
public sealed record AnnouncementJob(string Id, string AnnouncementId, string Title, string Status, DateTimeOffset RunAt, DateTimeOffset? FinishedAt, string? ErrorCode);
public sealed record AnnouncementJobsPage(AnnouncementJob[] Items, int Page, int Total, int Pending, DateTimeOffset? NextRunAt);
