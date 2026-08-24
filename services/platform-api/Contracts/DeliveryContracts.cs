namespace Lifewood.PlatformApi.Contracts;

public sealed record FinalDeliveryDto(
    string Id,
    string ProjectId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string? Note,
    DateTimeOffset PublishedAt);
