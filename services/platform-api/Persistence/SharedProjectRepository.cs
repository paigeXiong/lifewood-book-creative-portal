using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Persistence;

internal sealed partial class ProjectRepository
{
    // Resolve membership on every read; never trust an organization ID from the client.
    internal const string VisibleProjects = """
        (owner_id = $ownerId OR owner_id IN (
            SELECT member.id FROM users actor
            JOIN organizations org ON org.id = actor.organization_id AND org.is_active = 1
            JOIN users member ON member.organization_id = org.id AND member.closed_at IS NULL
            WHERE actor.id = $ownerId AND actor.is_active = 1 AND actor.closed_at IS NULL))
        """;

    public TaskDraftDto? GetVisible(string actorId, string id)
    {
        using var db = Open();
        using var command = db.CreateCommand();
        command.CommandText = $"SELECT owner_id FROM projects WHERE id=$id AND {VisibleProjects}";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$ownerId", actorId);
        var owner = command.ExecuteScalar() as string;
        if (owner is null) return null;
        var draft = Get(owner, id);
        return draft is null ? null : draft with { Creator = Creator(owner), CanEdit = owner == actorId };
    }

    private ProjectCreatorDto? Creator(string ownerId)
    {
        using var db = Open(); using var command = db.CreateCommand();
        command.CommandText = "SELECT display_name FROM users WHERE id=$id AND closed_at IS NULL";
        command.Parameters.AddWithValue("$id", ownerId);
        return command.ExecuteScalar() is string name
            ? new(ownerId, name, $"/api/me/organization/members/{Uri.EscapeDataString(ownerId)}/avatar") : null;
    }
}
