using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using System.Text;
using System.Text.Json;
using Lifewood.PlatformApi.Serialization;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class AuditRepository(string connectionString, string dataDirectory)
{
    private readonly object pendingLock = new();
    public SemaphoreSlim ConfigurationGate { get; } = new(1, 1);
    private string PendingPath => Path.Combine(dataDirectory, "audit-pending.ndjson");

    public void Initialize()
    {
        using var connection = Open();
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS audit_events (
                id TEXT PRIMARY KEY,
                actor_user_id TEXT NOT NULL,
                actor_name TEXT NOT NULL,
                actor_email TEXT NOT NULL,
                action_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NULL,
                occurred_at TEXT NOT NULL,
                trace_id TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_audit_events_occurred ON audit_events(occurred_at DESC);
            CREATE INDEX IF NOT EXISTS ix_audit_events_action_occurred ON audit_events(action_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS ix_audit_events_actor_occurred ON audit_events(actor_user_id, occurred_at DESC);
            """);
        using var columns = connection.CreateCommand();
        columns.CommandText = "PRAGMA table_info(audit_events)";
        using var reader = columns.ExecuteReader();
        var hasContext = false;
        while (reader.Read()) if (reader.GetString(1) == "context_json") hasContext = true;
        reader.Close();
        if (!hasContext) Execute(connection, "ALTER TABLE audit_events ADD COLUMN context_json TEXT NULL;");
        FlushPending();
    }

    public void Record(CurrentUserDto actor, AuditActionMatch action, string traceId, AuditSnapshot? before = null, AuditSnapshot? after = null)
    {
        AuditContextDto? recorded = null;
        try { recorded = AuditTargets.RecordContext(after ?? Capture(action), before); }
        catch (Exception ex) when (ex is SqliteException or IOException or UnauthorizedAccessException) { /* Persist the core event even if optional enrichment is unavailable. */ }
        var item = new AuditEventDto(
            Guid.NewGuid().ToString("N"), actor.Id, actor.DisplayName, actor.Email ?? "",
            action.ActionId, action.TargetType, action.TargetId, DateTimeOffset.UtcNow, traceId,
            recorded);
        lock (pendingLock)
        {
            FlushPendingCore();
            if (!TryInsert(item)) AppendPending(item);
        }
    }

    private bool TryInsert(AuditEventDto item)
    {
        try
        {
            using var connection = Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
            INSERT OR IGNORE INTO audit_events(id, actor_user_id, actor_name, actor_email, action_id, target_type, target_id, occurred_at, trace_id, context_json)
            VALUES($id, $actorUserId, $actorName, $actorEmail, $actionId, $targetType, $targetId, $occurredAt, $traceId, $context);
            """;
            command.Parameters.AddWithValue("$id", item.Id);
            command.Parameters.AddWithValue("$actorUserId", item.ActorUserId);
            command.Parameters.AddWithValue("$actorName", item.ActorName);
            command.Parameters.AddWithValue("$actorEmail", item.ActorEmail);
            command.Parameters.AddWithValue("$actionId", item.ActionId);
            command.Parameters.AddWithValue("$targetType", item.TargetType);
            command.Parameters.AddWithValue("$targetId", (object?)item.TargetId ?? DBNull.Value);
            command.Parameters.AddWithValue("$occurredAt", item.OccurredAt.ToUniversalTime().ToString("O"));
            command.Parameters.AddWithValue("$traceId", item.TraceId);
            command.Parameters.AddWithValue("$context", item.Context is null ? DBNull.Value : JsonSerializer.Serialize(item.Context, AppJsonContext.Default.AuditContextDto));
            command.ExecuteNonQuery();
            return true;
        }
        catch (SqliteException)
        {
            return false;
        }
    }

    public PagedAuditEventsDto List(string? search, string? actionId, string? from, string? to, int page, int pageSize)
    {
        FlushPending();
        using var connection = Open();
        const string where = """
            WHERE ($search = '' OR actor_name LIKE '%' || $search || '%' COLLATE NOCASE
                OR actor_email LIKE '%' || $search || '%' COLLATE NOCASE
                OR IFNULL(target_id, '') LIKE '%' || $search || '%' COLLATE NOCASE
                OR trace_id LIKE '%' || $search || '%' COLLATE NOCASE
                OR json_extract(context_json, '$.labelZh') LIKE '%' || $search || '%' COLLATE NOCASE
                OR json_extract(context_json, '$.labelEn') LIKE '%' || $search || '%' COLLATE NOCASE)
              AND ($actionId = '' OR action_id = $actionId)
              AND ($from = '' OR occurred_at >= $from)
              AND ($to = '' OR occurred_at < $to)
            """;
        using var count = connection.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM audit_events {where};";
        AddFilters(count, search, actionId, from, to);
        var total = Convert.ToInt32(count.ExecuteScalar());

        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT id, actor_user_id, actor_name, actor_email, action_id, target_type, target_id, occurred_at, trace_id, context_json
            FROM audit_events {where}
            ORDER BY occurred_at DESC, id DESC
            LIMIT $pageSize OFFSET $offset;
            """;
        AddFilters(command, search, actionId, from, to);
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", (long)(page - 1) * pageSize);
        using var reader = command.ExecuteReader();
        var items = new List<AuditEventDto>();
        while (reader.Read())
            items.Add(new(
                reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6),
                DateTimeOffset.Parse(reader.GetString(7)), reader.GetString(8),
                reader.IsDBNull(9) ? null : JsonSerializer.Deserialize(reader.GetString(9), AppJsonContext.Default.AuditContextDto)));
        return new([.. items], page, pageSize, total);
    }

    public AuditSnapshot? Capture(AuditActionMatch action) => AuditTargets.Capture(connectionString, action);

    public AuditEventDto Present(AuditEventDto item)
    {
        var current = Capture(new(item.ActionId, item.TargetType, item.TargetId));
        var context = item.Context is { LabelZh: not null } or { LabelEn: not null } ? item.Context : (current is null ? new AuditContextDto(null, null, "unavailable", null) : new(current.LabelZh, current.LabelEn, "current", current.Path));
        return item with { Context = context with { Path = current?.Path } };
    }

    private static void AddFilters(SqliteCommand command, string? search, string? actionId, string? from, string? to)
    {
        command.Parameters.AddWithValue("$search", search?.Trim() ?? "");
        command.Parameters.AddWithValue("$actionId", actionId?.Trim() ?? "");
        command.Parameters.AddWithValue("$from", NormalizeInstant(from));
        command.Parameters.AddWithValue("$to", NormalizeInstant(to));
    }

    private static string NormalizeInstant(string? value) =>
        DateTimeOffset.TryParse(value, out var instant) ? instant.ToUniversalTime().ToString("O") : "";

    private void FlushPending()
    {
        lock (pendingLock) FlushPendingCore();
    }

    private void FlushPendingCore()
    {
        if (!File.Exists(PendingPath)) return;
        var replayComplete = true;
        foreach (var line in File.ReadLines(PendingPath))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            AuditEventDto? item;
            try { item = JsonSerializer.Deserialize(line, AppJsonContext.Default.AuditEventDto); }
            catch (JsonException) { replayComplete = false; continue; }
            if (item is null || !TryInsert(item)) replayComplete = false;
        }
        if (replayComplete) File.Delete(PendingPath);
    }

    private void AppendPending(AuditEventDto item)
    {
        Directory.CreateDirectory(dataDirectory);
        using var stream = new FileStream(PendingPath, FileMode.Append, FileAccess.Write, FileShare.Read);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false), leaveOpen: true);
        writer.WriteLine(JsonSerializer.Serialize(item, AppJsonContext.Default.AuditEventDto));
        writer.Flush();
        stream.Flush(flushToDisk: true);
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        Execute(connection, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
        return connection;
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
