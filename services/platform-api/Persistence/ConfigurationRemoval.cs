using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

// Retain rows to reserve identifiers and keep built-in seeding from restoring deleted configuration.
internal static class ConfigurationRemoval
{
    public static void Initialize(SqliteConnection db, string table)
    {
        using var command = db.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name='is_removed';";
        if (Convert.ToInt32(command.ExecuteScalar()) == 0)
        {
            command.CommandText = $"ALTER TABLE {table} ADD COLUMN is_removed INTEGER NOT NULL DEFAULT 0;";
            command.ExecuteNonQuery();
        }
    }

    public static bool IsRemoved(SqliteConnection db, SqliteTransaction tx, string table, string id)
    {
        using var command = db.CreateCommand(); command.Transaction = tx;
        command.CommandText = $"SELECT is_removed FROM {table} WHERE id=$id;";
        command.Parameters.AddWithValue("$id", id);
        return Convert.ToInt32(command.ExecuteScalar() ?? 0) == 1;
    }

    public static void Mark(SqliteConnection db, SqliteTransaction tx, string table, string id)
    {
        using var command = db.CreateCommand(); command.Transaction = tx;
        command.CommandText = $"UPDATE {table} SET is_removed=1 WHERE id=$id;";
        command.Parameters.AddWithValue("$id", id); command.ExecuteNonQuery();
    }

    private static bool Exists(SqliteConnection db, string table, SqliteTransaction? tx = null)
    {
        using var command = db.CreateCommand(); command.Transaction = tx;
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$table;";
        command.Parameters.AddWithValue("$table", table);
        return Convert.ToInt32(command.ExecuteScalar()) > 0;
    }

    public static bool IsReferenced(SqliteConnection db, SqliteTransaction tx, string id, string[] fields)
    {
        foreach (var (table, columns) in new (string, string[])[] {
            ("projects", ["project_json", "book_json", "creative_json", "voice_json", "submission_snapshot_json"]),
            ("revision_rounds", ["before_snapshot", "after_snapshot"])
        })
        {
            if (!Exists(db, table, tx)) continue;
            foreach (var column in columns)
            foreach (var field in fields)
            {
                using var command = db.CreateCommand(); command.Transaction = tx;
                command.CommandText = $"SELECT 1 FROM {table}, json_tree({column}) j WHERE j.type='text' AND j.atom=$id AND (j.key=$field OR j.path LIKE '%.' || $field) LIMIT 1;";
                command.Parameters.AddWithValue("$id", id); command.Parameters.AddWithValue("$field", field);
                if (command.ExecuteScalar() is not null) return true;
            }
        }
        return false;
    }

    // Guard writes that validated against an earlier catalogue, before the delete transaction committed.
    public static void InstallProjectGuards(SqliteConnection db, string table, string[] fields)
    {
        if (!Exists(db, "projects")) return;
        string[] columns = ["project_json", "book_json", "creative_json", "voice_json"];
        var fieldCheck = string.Join(" OR ", fields.Select(field => $"(j.key='{field}' OR j.path LIKE '%.{field}')"));
        var check = string.Join(" OR ", columns.Select(column => $"EXISTS(SELECT 1 FROM {table} c, json_tree(NEW.{column}) j WHERE c.is_removed=1 AND j.type='text' AND j.atom=c.id AND ({fieldCheck}))"));
        foreach (var operation in new[] { "INSERT", "UPDATE OF " + string.Join(',', columns) })
        {
            using var command = db.CreateCommand();
            command.CommandText = $"CREATE TRIGGER IF NOT EXISTS projects_removed_{table}_{(operation == "INSERT" ? "insert" : "update")} BEFORE {operation} ON projects WHEN {check} BEGIN SELECT RAISE(ABORT,'config.option_removed'); END;";
            command.ExecuteNonQuery();
        }
    }
}
