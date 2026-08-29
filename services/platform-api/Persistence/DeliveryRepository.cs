using Lifewood.PlatformApi.Contracts;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class DeliveryRepository(string connectionString)
{
    public void Initialize()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS project_deliveries (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                uploader_user_id TEXT NOT NULL,
                file_name TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                note TEXT NULL,
                published_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                FOREIGN KEY(uploader_user_id) REFERENCES users(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS ix_project_deliveries_project_published
                ON project_deliveries(project_id, published_at DESC);
            """;
        command.ExecuteNonQuery();
        if (!HasColumn(connection, "project_deliveries", "revoked_at")) Execute(connection, "ALTER TABLE project_deliveries ADD COLUMN revoked_at TEXT NULL;");
        Execute(connection, """
            UPDATE project_deliveries AS older
            SET revoked_at = older.published_at
            WHERE older.revoked_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM project_deliveries AS newer
                  WHERE newer.project_id = older.project_id
                    AND newer.revoked_at IS NULL
                    AND (newer.published_at > older.published_at
                         OR (newer.published_at = older.published_at AND newer.id > older.id))
              );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_project_deliveries_one_active
                ON project_deliveries(project_id) WHERE revoked_at IS NULL;
            """);
    }

    public FinalDeliveryDto[] List(string projectId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.id, d.project_id, d.file_name, d.content_type, d.size_bytes, d.note, d.published_at, d.revoked_at
            FROM project_deliveries d
            WHERE d.project_id = $projectId AND d.revoked_at IS NULL ORDER BY d.published_at DESC;
            """;
        command.Parameters.AddWithValue("$projectId", projectId);
        using var reader = command.ExecuteReader();
        var items = new List<FinalDeliveryDto>();
        while (reader.Read()) items.Add(Read(reader));
        return [.. items];
    }
    public FinalDeliveryDto[] ListForAdmin(string projectId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.id, d.project_id, d.file_name, d.content_type, d.size_bytes, d.note, d.published_at, d.revoked_at
            FROM project_deliveries d
            WHERE d.project_id = $projectId ORDER BY d.published_at DESC;
            """;
        command.Parameters.AddWithValue("$projectId", projectId);
        using var reader = command.ExecuteReader();
        var items = new List<FinalDeliveryDto>();
        while (reader.Read()) items.Add(Read(reader));
        return [.. items];
    }

    public (string ProjectId, string DeliveryId)[] ListRevokedFileKeys()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT project_id, id FROM project_deliveries WHERE revoked_at IS NOT NULL;";
        using var reader = command.ExecuteReader();
        var items = new List<(string ProjectId, string DeliveryId)>();
        while (reader.Read()) items.Add((reader.GetString(0), reader.GetString(1)));
        return [.. items];
    }

    public FinalDeliveryDto? Find(string projectId, string deliveryId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d.id, d.project_id, d.file_name, d.content_type, d.size_bytes, d.note, d.published_at, d.revoked_at
            FROM project_deliveries d
            WHERE d.project_id = $projectId AND d.id = $deliveryId AND d.revoked_at IS NULL;
            """;
        command.Parameters.AddWithValue("$projectId", projectId);
        command.Parameters.AddWithValue("$deliveryId", deliveryId);
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader) : null;
    }

    public AdminWriteResult Publish(string deliveryId, string projectId, string uploaderUserId, string fileName, string contentType, long sizeBytes, string? note, out FinalDeliveryDto? delivery)
    {
        delivery = null;
        var normalizedNote = string.IsNullOrWhiteSpace(note) ? null : note.Trim();
        if (normalizedNote?.Length > 2000) return new(AdminWriteOutcome.Invalid, "note");
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        using var project = connection.CreateCommand();
        project.Transaction = transaction;
        project.CommandText = "SELECT status FROM projects WHERE id = $id;";
        project.Parameters.AddWithValue("$id", projectId);
        var submissionStatus = project.ExecuteScalar() as string;
        if (submissionStatus is null) return new(AdminWriteOutcome.NotFound);
        if (!submissionStatus.Equals("submitted", StringComparison.Ordinal)) return new(AdminWriteOutcome.Conflict, "projectStatus");

        using var activeDelivery = connection.CreateCommand();
        activeDelivery.Transaction = transaction;
        activeDelivery.CommandText = "SELECT EXISTS(SELECT 1 FROM project_deliveries WHERE project_id = $projectId AND revoked_at IS NULL);";
        activeDelivery.Parameters.AddWithValue("$projectId", projectId);
        if (Convert.ToInt32(activeDelivery.ExecuteScalar()) == 1) return new(AdminWriteOutcome.Conflict, "activeDelivery");

        using var uploader = connection.CreateCommand();
        uploader.Transaction = transaction;
        uploader.CommandText = "SELECT display_name FROM users WHERE id = $id AND is_active = 1;";
        uploader.Parameters.AddWithValue("$id", uploaderUserId);
        var uploaderName = uploader.ExecuteScalar() as string;
        if (uploaderName is null) return new(AdminWriteOutcome.Invalid, "uploader");

        var now = DateTimeOffset.UtcNow;
        using var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO project_deliveries(id, project_id, uploader_user_id, file_name, content_type, size_bytes, note, published_at)
            VALUES ($id, $projectId, $uploaderId, $fileName, $contentType, $sizeBytes, $note, $publishedAt);
            """;
        insert.Parameters.AddWithValue("$id", deliveryId);
        insert.Parameters.AddWithValue("$projectId", projectId);
        insert.Parameters.AddWithValue("$uploaderId", uploaderUserId);
        insert.Parameters.AddWithValue("$fileName", fileName);
        insert.Parameters.AddWithValue("$contentType", contentType);
        insert.Parameters.AddWithValue("$sizeBytes", sizeBytes);
        insert.Parameters.AddWithValue("$note", (object?)normalizedNote ?? DBNull.Value);
        insert.Parameters.AddWithValue("$publishedAt", now.ToString("O"));
        try { insert.ExecuteNonQuery(); }
        catch (SqliteException exception) when (exception.SqliteExtendedErrorCode == 2067)
        {
            return new(AdminWriteOutcome.Conflict, "activeDelivery");
        }

        using var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = "UPDATE projects SET workflow_status = 'completed', workflow_updated_at = $now WHERE id = $id;";
        update.Parameters.AddWithValue("$now", now.ToString("O"));
        update.Parameters.AddWithValue("$id", projectId);
        update.ExecuteNonQuery();
        transaction.Commit();
        delivery = new(deliveryId, projectId, fileName, contentType, sizeBytes, normalizedNote, now);
        return new(AdminWriteOutcome.Saved);
    }
    public AdminWriteResult Revoke(string projectId, string deliveryId)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        var now = DateTimeOffset.UtcNow.ToString("O");
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE project_deliveries SET revoked_at = $now WHERE project_id = $projectId AND id = $deliveryId AND revoked_at IS NULL;";
        command.Parameters.AddWithValue("$now", now);
        command.Parameters.AddWithValue("$projectId", projectId);
        command.Parameters.AddWithValue("$deliveryId", deliveryId);
        if (command.ExecuteNonQuery() != 1) return new(AdminWriteOutcome.NotFound);

        using var remaining = connection.CreateCommand();
        remaining.Transaction = transaction;
        remaining.CommandText = "SELECT COUNT(*) FROM project_deliveries WHERE project_id = $projectId AND revoked_at IS NULL;";
        remaining.Parameters.AddWithValue("$projectId", projectId);
        if (Convert.ToInt32(remaining.ExecuteScalar()) == 0)
        {
            using var restoreWorkflow = connection.CreateCommand();
            restoreWorkflow.Transaction = transaction;
            restoreWorkflow.CommandText = "UPDATE projects SET workflow_status = 'in_production', workflow_updated_at = $now WHERE id = $projectId AND workflow_status = 'completed';";
            restoreWorkflow.Parameters.AddWithValue("$now", now);
            restoreWorkflow.Parameters.AddWithValue("$projectId", projectId);
            restoreWorkflow.ExecuteNonQuery();
        }
        transaction.Commit();
        return new(AdminWriteOutcome.Saved);
    }

    private static FinalDeliveryDto Read(SqliteDataReader reader) => new(
        reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetInt64(4),
        reader.IsDBNull(5) ? null : reader.GetString(5), DateTimeOffset.Parse(reader.GetString(6)),
        reader.FieldCount > 7 && !reader.IsDBNull(7) ? DateTimeOffset.Parse(reader.GetString(7)) : null);

    private static bool HasColumn(SqliteConnection connection, string table, string column)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info({table});";
        using var reader = command.ExecuteReader();
        while (reader.Read())
            if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true;
        return false;
    }

    private static void Execute(SqliteConnection connection, string sql)
    { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";
        command.ExecuteNonQuery();
        return connection;
    }
}
