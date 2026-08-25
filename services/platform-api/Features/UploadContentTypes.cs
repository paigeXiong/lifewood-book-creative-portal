namespace Lifewood.PlatformApi.Features;

internal static class UploadContentTypes
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(
    [
        "image/jpeg",
        "image/png",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "video/mp4",
        "video/quicktime",
        "text/plain"
    ], StringComparer.OrdinalIgnoreCase);
}
