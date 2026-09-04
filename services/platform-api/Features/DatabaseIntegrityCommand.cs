using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Features;

internal static class DatabaseIntegrityCommand
{
    public static bool TryRun(string[] args, out int exitCode)
    {
        exitCode = 0;
        if (args.Length != 2 || !args[0].Equals("--validate-database", StringComparison.Ordinal))
            return false;

        try
        {
            var path = Path.GetFullPath(args[1]);
            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false
            };
            using var connection = new SqliteConnection(builder.ConnectionString);
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA quick_check;";
            var result = command.ExecuteScalar() as string;
            if (string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
                return true;

            Console.Error.WriteLine("SQLite quick_check failed. / SQLite 完整性检查失败。");
            exitCode = 1;
            return true;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine("SQLite database validation failed / SQLite 数据库校验失败: " + exception.Message);
            exitCode = 1;
            return true;
        }
    }
}
