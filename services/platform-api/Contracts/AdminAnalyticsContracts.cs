namespace Lifewood.PlatformApi.Contracts;

public sealed record AdminAnalyticsDay(string Date, int Submitted, int Completed);
public sealed record AdminAnalyticsDto(
    int Days, string TimeZone, DateTimeOffset GeneratedAt, DateTimeOffset TrackingStartedAt,
    int Submitted, int Completed, int DurationSamples, double? AverageDays, double? MedianDays,
    int UntrackedCompleted, AdminCountDto[] Queues, AdminCountDto[] Aging, AdminAnalyticsDay[] Trend);
