using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal static class FileCategoryScopes
{
    public const string Source = "source";
    public const string Reference = "reference";
    public static readonly IReadOnlySet<string> All = new HashSet<string>([Source, Reference], StringComparer.Ordinal);
}
internal sealed record FileCategoryDefinition(string Scope, ReferenceCategoryDto Category);
internal enum FileCategoryWriteOutcome { Saved, Invalid, Conflict }
internal sealed record FileCategoryWriteResult(FileCategoryWriteOutcome Outcome, string? Field = null);

internal sealed class FileCategoryRepository(string connectionString)
{
    public void Initialize()
    {
        using var connection = Open();
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS file_categories (
              scope TEXT NOT NULL, id TEXT NOT NULL UNIQUE, label_zh_cn TEXT NOT NULL, label_en_us TEXT NOT NULL,
              description_zh_cn TEXT NULL, description_en_us TEXT NULL, accept_values TEXT NOT NULL,
              max_bytes INTEGER NOT NULL, max_files INTEGER NOT NULL, allows_url INTEGER NOT NULL DEFAULT 0,
              required INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
              sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(scope,id)
            );
            CREATE INDEX IF NOT EXISTS ix_file_categories_scope_order ON file_categories(scope,enabled DESC,sort_order,id);
            """);
        var zh = FormOptionCatalog.ForLocale("zh-CN");
        var en = FormOptionCatalog.ForLocale("en-US");
        using var transaction = connection.BeginTransaction();
        Seed(connection, transaction, FileCategoryScopes.Source, zh.SourceCategories, en.SourceCategories);
        Seed(connection, transaction, FileCategoryScopes.Reference, zh.ReferenceCategories, en.ReferenceCategories);
        using (var migration = connection.CreateCommand())
        {
            migration.Transaction = transaction;
            migration.CommandText = """
                CREATE TABLE IF NOT EXISTS file_category_migrations (id TEXT PRIMARY KEY);
                UPDATE file_categories SET enabled=0,required=0,updated_at=$now
                WHERE scope='source' AND id IN ('key-chapters','brand-guidelines','authorization')
                  AND NOT EXISTS (SELECT 1 FROM file_category_migrations WHERE id='basic-book-intake-v1');
                UPDATE file_categories SET max_files=6,updated_at=$now
                WHERE id='book-cover' AND max_files=1
                  AND NOT EXISTS (SELECT 1 FROM file_category_migrations WHERE id='basic-book-intake-v1');
                INSERT OR IGNORE INTO file_category_migrations(id) VALUES('basic-book-intake-v1');
                UPDATE file_categories SET required=0,updated_at=$now,
                  label_zh_cn=CASE WHEN label_zh_cn='全书或节选' THEN '全书或节选（可选）' ELSE label_zh_cn END,
                  label_en_us=CASE WHEN label_en_us='Manuscript or excerpt' THEN 'Manuscript or excerpt (optional)' ELSE label_en_us END
                WHERE scope='source' AND id='manuscript'
                  AND NOT EXISTS (SELECT 1 FROM file_category_migrations WHERE id='optional-manuscript-v1');
                INSERT OR IGNORE INTO file_category_migrations(id) VALUES('optional-manuscript-v1');
                """;
            migration.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            migration.ExecuteNonQuery();
        }
        transaction.Commit();
    }

    public ReferenceCategoryDto[] ForLocale(string scope, string locale, bool enabledOnly = true)
    {
        if (!FileCategoryScopes.All.Contains(scope)) return [];
        var english = locale.Equals("en-US", StringComparison.OrdinalIgnoreCase);
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id,label_zh_cn,label_en_us,description_zh_cn,description_en_us,accept_values,max_bytes,max_files,allows_url,required
            FROM file_categories WHERE scope=$scope AND ($enabledOnly=0 OR enabled=1) ORDER BY sort_order,id;
            """;
        command.Parameters.AddWithValue("$scope", scope);
        command.Parameters.AddWithValue("$enabledOnly", enabledOnly ? 1 : 0);
        using var reader = command.ExecuteReader();
        var result = new List<ReferenceCategoryDto>();
        while (reader.Read()) result.Add(new(reader.GetString(0), reader.GetString(english ? 2 : 1),
            reader.IsDBNull(english ? 4 : 3) ? null : reader.GetString(english ? 4 : 3), Split(reader.GetString(5)),
            reader.GetInt64(6), reader.GetInt32(7), reader.GetInt32(8) == 1, reader.GetInt32(9) == 1));
        return [.. result];
    }

    public FileCategoryDefinition? FindEnabled(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT scope,id,label_en_us,description_en_us,accept_values,max_bytes,max_files,allows_url,required FROM file_categories WHERE id=$id AND enabled=1;";
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(reader.GetString(0), new(reader.GetString(1), reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3), Split(reader.GetString(4)), reader.GetInt64(5),
            reader.GetInt32(6), reader.GetInt32(7) == 1, reader.GetInt32(8) == 1)) : null;
    }

    public AdminFileCategoryDto[] ListAdmin(string scope)
    {
        if (!FileCategoryScopes.All.Contains(scope)) return [];
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT scope,id,label_zh_cn,label_en_us,description_zh_cn,description_en_us,accept_values,max_bytes,max_files,
                   allows_url,required,enabled,sort_order,updated_at FROM file_categories WHERE scope=$scope ORDER BY sort_order,id;
            """;
        command.Parameters.AddWithValue("$scope", scope);
        using var reader = command.ExecuteReader();
        var result = new List<AdminFileCategoryDto>();
        while (reader.Read()) result.Add(Read(reader));
        return [.. result];
    }

    public FileCategoryWriteResult Upsert(string scope, string id, UpsertFileCategoryRequest? request, out AdminFileCategoryDto? item)
    {
        item = null;
        if (!FileCategoryScopes.All.Contains(scope)) return new(FileCategoryWriteOutcome.Invalid, "scope");
        if (!ValidId(id)) return new(FileCategoryWriteOutcome.Invalid, "id");
        if (request is null) return new(FileCategoryWriteOutcome.Invalid, "request");
        if (!ValidText(request.LabelZhCn, 100) || !ValidText(request.LabelEnUs, 100)) return new(FileCategoryWriteOutcome.Invalid, "label");
        if (!OptionalText(request.DescriptionZhCn, 300) || !OptionalText(request.DescriptionEnUs, 300)) return new(FileCategoryWriteOutcome.Invalid, "description");
        if (request.Accept is null || request.Accept.Length is < 1 or > 20 || request.Accept.Any(value => string.IsNullOrWhiteSpace(value) || value.Length > 150 || !UploadContentTypes.All.Contains(value)) || request.Accept.Distinct(StringComparer.OrdinalIgnoreCase).Count() != request.Accept.Length)
            return new(FileCategoryWriteOutcome.Invalid, "accept");
        if (request.MaxBytes is < 1_000 or > 500_000_000) return new(FileCategoryWriteOutcome.Invalid, "maxBytes");
        if (request.MaxFiles is < 1 or > 50) return new(FileCategoryWriteOutcome.Invalid, "maxFiles");
        if (request.SortOrder is < 0 or > 10000) return new(FileCategoryWriteOutcome.Invalid, "sortOrder");
        if (scope == FileCategoryScopes.Reference && request.Required) return new(FileCategoryWriteOutcome.Invalid, "required");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        var current = Get(connection, scope, id, transaction);
        if (current is not null && request.ExpectedUpdatedAt != current.UpdatedAt) return new(FileCategoryWriteOutcome.Conflict);
        if (current is null && request.ExpectedUpdatedAt is not null) return new(FileCategoryWriteOutcome.Conflict);
        try
        {
            Save(connection, transaction, scope, id, request with {
                LabelZhCn=request.LabelZhCn.Trim(), LabelEnUs=request.LabelEnUs.Trim(),
                DescriptionZhCn=Clean(request.DescriptionZhCn), DescriptionEnUs=Clean(request.DescriptionEnUs),
                Accept=request.Accept.Select(value => value.Trim().ToLowerInvariant()).ToArray()
            });
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19) { return new(FileCategoryWriteOutcome.Invalid, "id"); }
        item = Get(connection, scope, id, transaction);
        transaction.Commit();
        return new(FileCategoryWriteOutcome.Saved);
    }

    private static void Seed(SqliteConnection connection, SqliteTransaction transaction, string scope, ReferenceCategoryDto[] zh, ReferenceCategoryDto[] en)
    {
        var zhById = zh.ToDictionary(item => item.Id, StringComparer.Ordinal);
        for (var index = 0; index < en.Length; index++)
        {
            var item = en[index];
            using var exists = connection.CreateCommand();
            exists.Transaction = transaction;
            exists.CommandText = "SELECT COUNT(*) FROM file_categories WHERE id=$id;";
            exists.Parameters.AddWithValue("$id", item.Id);
            if (Convert.ToInt32(exists.ExecuteScalar()) != 0) continue;
            var local = zhById[item.Id];
            Save(connection, transaction, scope, item.Id, new(local.Label,item.Label,local.Description,item.Description,item.Accept,item.MaxBytes,item.MaxFiles,item.AllowsUrl,item.Required,true,index*10));
        }
    }

    private static void Save(SqliteConnection connection, SqliteTransaction transaction, string scope, string id, UpsertFileCategoryRequest request)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO file_categories(scope,id,label_zh_cn,label_en_us,description_zh_cn,description_en_us,accept_values,max_bytes,max_files,allows_url,required,enabled,sort_order,updated_at)
            VALUES($scope,$id,$zh,$en,$dzh,$den,$accept,$bytes,$files,$url,$required,$enabled,$sort,$updated)
            ON CONFLICT(scope,id) DO UPDATE SET label_zh_cn=excluded.label_zh_cn,label_en_us=excluded.label_en_us,
              description_zh_cn=excluded.description_zh_cn,description_en_us=excluded.description_en_us,
              accept_values=excluded.accept_values,max_bytes=excluded.max_bytes,max_files=excluded.max_files,
              allows_url=excluded.allows_url,required=excluded.required,enabled=excluded.enabled,
              sort_order=excluded.sort_order,updated_at=excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$scope",scope); command.Parameters.AddWithValue("$id",id);
        command.Parameters.AddWithValue("$zh",request.LabelZhCn); command.Parameters.AddWithValue("$en",request.LabelEnUs);
        command.Parameters.AddWithValue("$dzh",(object?)request.DescriptionZhCn??DBNull.Value); command.Parameters.AddWithValue("$den",(object?)request.DescriptionEnUs??DBNull.Value);
        command.Parameters.AddWithValue("$accept",string.Join('\n',request.Accept)); command.Parameters.AddWithValue("$bytes",request.MaxBytes);
        command.Parameters.AddWithValue("$files",request.MaxFiles); command.Parameters.AddWithValue("$url",request.AllowsUrl?1:0);
        command.Parameters.AddWithValue("$required",request.Required?1:0); command.Parameters.AddWithValue("$enabled",request.Enabled?1:0);
        command.Parameters.AddWithValue("$sort",request.SortOrder); command.Parameters.AddWithValue("$updated",DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();
    }

    private static AdminFileCategoryDto? Get(SqliteConnection connection,string scope,string id,SqliteTransaction transaction)
    {
        using var command=connection.CreateCommand(); command.Transaction=transaction;
        command.CommandText="SELECT scope,id,label_zh_cn,label_en_us,description_zh_cn,description_en_us,accept_values,max_bytes,max_files,allows_url,required,enabled,sort_order,updated_at FROM file_categories WHERE scope=$scope AND id=$id;";
        command.Parameters.AddWithValue("$scope",scope); command.Parameters.AddWithValue("$id",id);
        using var reader=command.ExecuteReader(); return reader.Read()?Read(reader):null;
    }
    private static AdminFileCategoryDto Read(SqliteDataReader r)=>new(r.GetString(0),r.GetString(1),r.GetString(2),r.GetString(3),r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:r.GetString(5),Split(r.GetString(6)),r.GetInt64(7),r.GetInt32(8),r.GetInt32(9)==1,r.GetInt32(10)==1,r.GetInt32(11)==1,r.GetInt32(12),DateTimeOffset.Parse(r.GetString(13),System.Globalization.CultureInfo.InvariantCulture));
    private static string[] Split(string value)=>value.Split('\n',StringSplitOptions.RemoveEmptyEntries|StringSplitOptions.TrimEntries);
    private static string? Clean(string? value)=>string.IsNullOrWhiteSpace(value)?null:value.Trim();
    private static bool ValidText(string? value,int max)=>!string.IsNullOrWhiteSpace(value)&&value.Trim().Length<=max;
    private static bool OptionalText(string? value,int max)=>value is null||value.Trim().Length<=max;
    private static bool ValidId(string value)=>value.Length is >=2 and <=64&&value.All(c=>char.IsAsciiLetterOrDigit(c)||c=='-');
    private static void Execute(SqliteConnection c,string sql){using var command=c.CreateCommand();command.CommandText=sql;command.ExecuteNonQuery();}
    private SqliteConnection Open(){var c=new SqliteConnection(connectionString);c.Open();Execute(c,"PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");return c;}
}
