using Lifewood.PlatformApi.Contracts;
namespace Lifewood.PlatformApi.Features;

internal static class CreatorInfo
{
    // Legacy drafts could have empty customer fields. Repair only missing values
    // from the authenticated owner, retaining already captured creator details.
    public static ProjectInfoDto FillMissing(ProjectInfoDto project, CurrentUserDto creator) => project with {
        ClientName = Value(project.ClientName, Value(creator.Organization?.Name, Value(creator.ClientName, creator.DisplayName))),
        ContactName = Value(project.ContactName, creator.DisplayName),
        Email = Value(project.Email, creator.Email),
        Phone = string.IsNullOrWhiteSpace(project.Phone) ? creator.Phone : project.Phone
    };
    private static string Value(string? captured, string? fallback) => string.IsNullOrWhiteSpace(captured) ? fallback ?? "" : captured;
}
