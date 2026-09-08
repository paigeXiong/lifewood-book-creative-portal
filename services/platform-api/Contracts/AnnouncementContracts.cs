namespace Lifewood.PlatformApi.Contracts;
public sealed record AnnouncementInput(string? TitleZh, string? BodyZh, string? TitleEn, string? BodyEn, string Placement, string Audience, string[] Languages, string[] OrganizationIds, string? StartsAt, string? EndsAt, long Version = 0, string? Title = null, string? Body = null, int? DisplayDays = null);
public sealed record AnnouncementDocument(string Id, long Sequence, AnnouncementInput Content, string Status, long Version, string CreatedAt, int Recipients);
public sealed record AnnouncementPage(AnnouncementDocument[] Items, long? NextCursor);
public sealed record AnnouncementItem(string Id, long Sequence, string Title, string Body, string PublishedAt, bool Dismissed, bool Popup);
public sealed record AnnouncementFeed(AnnouncementItem[] Items, long? NextCursor);
public sealed record AnnouncementVersion(long Version);

public sealed record DismissAnnouncementsRequest(string[] Ids);

public sealed record AnnouncementPreview(int? Count);
