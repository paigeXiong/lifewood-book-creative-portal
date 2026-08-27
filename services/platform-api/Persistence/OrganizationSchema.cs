using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal static class OrganizationSchema
{
    public static void Ensure(SqliteConnection connection)
    {
        EnsureOrganizationTable(connection);
        if (!HasTable(connection, "users")) return;
        if (!HasColumn(connection, "users", "organization_id"))
            Execute(connection, "ALTER TABLE users ADD COLUMN organization_id TEXT NULL;");
        Execute(connection, """
            CREATE INDEX IF NOT EXISTS ix_users_organization ON users(organization_id);
            CREATE TRIGGER IF NOT EXISTS trg_users_organization_insert
            BEFORE INSERT ON users
            WHEN NEW.organization_id IS NOT NULL
              AND NOT EXISTS(SELECT 1 FROM organizations WHERE id = NEW.organization_id)
            BEGIN
                SELECT RAISE(ABORT, 'organization_not_found');
            END;
            CREATE TRIGGER IF NOT EXISTS trg_users_organization_update
            BEFORE UPDATE OF organization_id ON users
            WHEN NEW.organization_id IS NOT NULL
              AND NOT EXISTS(SELECT 1 FROM organizations WHERE id = NEW.organization_id)
            BEGIN
                SELECT RAISE(ABORT, 'organization_not_found');
            END;
            CREATE TRIGGER IF NOT EXISTS trg_organizations_delete_membership
            AFTER DELETE ON organizations
            BEGIN
                UPDATE users SET organization_id = NULL WHERE organization_id = OLD.id;
            END;
            """);
    }

    public static void EnsureOrganizationTable(SqliteConnection connection)
    {
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS organizations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL UNIQUE,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """);
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static bool HasColumn(SqliteConnection connection, string table, string column)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"PRAGMA table_info({table});";
        using var reader = command.ExecuteReader();
        while (reader.Read())
            if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true;
        return false;
    }

    private static bool HasTable(SqliteConnection connection, string table)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name;";
        command.Parameters.AddWithValue("$name", table);
        return Convert.ToInt32(command.ExecuteScalar()) == 1;
    }
}
