using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

// HTTP callers always provide the authenticated actor. A null actor supports trusted internal callers.
internal static class ProjectAccess
{
    public static bool Allows(SqliteConnection connection, SqliteTransaction? transaction, string projectId, string? actorId)
    {
        if (actorId is null) return true;
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=$actor AND u.is_active=1
                WHERE p.id=$project AND (u.role IN ('owner','admin') OR (u.role='operator' AND p.assignee_user_id=u.id)));
            """;
        command.Parameters.AddWithValue("$actor", actorId);
        command.Parameters.AddWithValue("$project", projectId);
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }
}
