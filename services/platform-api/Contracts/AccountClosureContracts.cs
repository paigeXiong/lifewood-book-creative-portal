namespace Lifewood.PlatformApi.Contracts;
public sealed record AccountClosurePreview(string Email,DateTimeOffset UpdatedAt,int OwnedProjects,int AssignedProjects);
public sealed record CloseAccountRequest(string ConfirmEmail,DateTimeOffset ExpectedUpdatedAt);
