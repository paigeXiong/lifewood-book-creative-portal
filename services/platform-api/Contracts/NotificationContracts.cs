namespace Lifewood.PlatformApi.Contracts;
public sealed record NotificationItem(long Id,string Kind,string ProjectId,string ProjectTitle,string Actor,string CreatedAt,bool Read,bool Archived,string State,string TargetId,string Title,string Level);
public sealed record NotificationPage(NotificationItem[] Items,long? NextCursor,long Watermark,int Unread);
public sealed record NotificationCounts(int Unread,long Watermark);
public sealed record NotificationSelection(long[]? Ids,long? Through,string Action);
public sealed record NotificationPreferences(bool Toast=true,bool Sound=false,string? QuietStart=null,string? QuietEnd=null,string TimeZone="UTC",string[]? MutedKinds=null);
public sealed record NotificationRule(string Kind,string TitleZh,string TitleEn,string Level,bool Enabled=true,bool AllowMute=true,string Audience="responsible",int Version=1);
public sealed record NotificationRules(NotificationRule[] Items,int RetentionDays);
public sealed record NotificationRetention(int Days);
public sealed record NotificationLog(long Id,string Kind,string ProjectId,string CreatedAt,string Status,int Attempts,int Recipients,string? Error);
public sealed record NotificationLogPage(NotificationLog[] Items,long? NextCursor,int Pending,int Failed);

public sealed record NotificationTarget(string Path);
