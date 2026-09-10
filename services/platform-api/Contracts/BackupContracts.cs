namespace Lifewood.PlatformApi.Contracts;
public sealed record BackupFile(string Path, long Size, string Sha256);
public sealed record BackupManifest(int Format, string Version, DateTimeOffset CreatedAt, BackupFile[] Files);
public sealed record BackupPolicy(bool Enabled = false, string Frequency = "daily", int Hour = 2, int DayOfWeek = 0, string TimeZoneId = "Asia/Shanghai", int RetainDays = 30, int RetainCount = 10);
public sealed record BackupSchedule(BackupPolicy Policy, DateTimeOffset? NextRunAt);
public sealed record BackupRecord(string Id, DateTimeOffset CreatedAt, string Source, string Status, long? Size = null, int? FileCount = null, string? Sha256 = null, string? ErrorCode = null, string? VerificationStatus = null, DateTimeOffset? VerifiedAt = null);
public sealed record BackupPage(BackupRecord[] Items, int Page, int PageSize, int Total, BackupSchedule Schedule, BackupRecord? Current, bool Paused, RestoreStatusFilter[]? VerificationFilters = null);

public sealed record RestorePreview(string Token, string BackupId, DateTimeOffset CreatedAt, int FileCount, long ExpandedSize, DateTimeOffset ExpiresAt);
public sealed record RestoreRequest(string Token, string Confirmation);
public sealed record RestoreState(string Id, string BackupId, string Status, DateTimeOffset UpdatedAt, string? SafetyBackupId = null, string? ErrorCode = null);
public sealed record RestoreOverview(bool Available, RestoreState? Current, string? UnavailableReason = null);
public sealed record RestoreJournal(RestoreState State, string DataDirectory, string StorageDirectory, string? CoordinationDirectory, int ParentPid, string Executable, string[] Arguments, string WorkingDirectory, DateTimeOffset? StartedAt = null, DateTimeOffset? BackupCreatedAt = null, string? ActorId = null);

public sealed record LocalProcessReceipt(int Id, string Path, string LaunchId);

public sealed record RestoreHistoryRecord(RestoreState State, DateTimeOffset StartedAt, DateTimeOffset? BackupCreatedAt, string? ActorId);
public sealed record RestoreHistoryItem(string Id, DateTimeOffset StartedAt, DateTimeOffset UpdatedAt, DateTimeOffset? BackupCreatedAt, string? ActorName, string Status, string? ErrorCode, BackupRecord? SafetyBackup);
public sealed record RestoreStatusFilter(string Value, string MessageKey);
public sealed record RestoreHistoryPage(RestoreHistoryItem[] Items, int Page, int PageSize, int Total, bool Incomplete, RestoreStatusFilter[] Statuses);
