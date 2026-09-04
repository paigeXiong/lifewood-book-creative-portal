using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Serialization;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal sealed class ProjectRepository(string connectionString)
{
    public void Initialize()
    {
        using var connection = Open();
        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;";
            pragma.ExecuteNonQuery();
        }
        using var transaction = connection.BeginTransaction();
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                task_number TEXT NULL,
                status TEXT NOT NULL,
                version INTEGER NOT NULL,
                project_json TEXT NOT NULL,
                book_json TEXT NOT NULL,
                creative_json TEXT NOT NULL DEFAULT '{"characters":[],"moodTagIds":[],"imageStyleTagIds":[],"paceTagIds":[],"styleReferenceImageUrls":[]}',
                voice_json TEXT NOT NULL DEFAULT '{"voiceover":{"selectedVoiceIds":[]},"assets":[],"competitorUrls":[],"creativeDirection":{"coreMessage":""}}',
                submission_key TEXT NULL,
                submission_snapshot_json TEXT NULL,
                workflow_status TEXT NOT NULL DEFAULT 'new',
                priority TEXT NOT NULL DEFAULT 'normal',
                assignee_user_id TEXT NULL,
                workflow_updated_at TEXT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_projects_owner_updated
                ON projects(owner_id, updated_at DESC);
            INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                VALUES (1, $appliedAt);
            """;
        command.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
        command.ExecuteNonQuery();

        if (!HasColumn(connection, transaction, "projects", "creative_json"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = """
                ALTER TABLE projects ADD COLUMN creative_json TEXT NOT NULL
                    DEFAULT '{"characters":[],"moodTagIds":[],"imageStyleTagIds":[],"paceTagIds":[],"styleReferenceImageUrls":[]}';
                """;
            migration.ExecuteNonQuery();
        }
        using (var markMigration = connection.CreateCommand())
        {
            markMigration.Transaction = transaction;
            markMigration.CommandText = "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, $appliedAt);";
            markMigration.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
            markMigration.ExecuteNonQuery();
        }

        if (!HasColumn(connection, transaction, "projects", "voice_json"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = """
                ALTER TABLE projects ADD COLUMN voice_json TEXT NOT NULL
                    DEFAULT '{"voiceover":{"selectedVoiceIds":[]},"assets":[],"competitorUrls":[],"creativeDirection":{"coreMessage":""}}';
                """;
            migration.ExecuteNonQuery();
        }
        using (var markMigration = connection.CreateCommand())
        {
            markMigration.Transaction = transaction;
            markMigration.CommandText = "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, $appliedAt);";
            markMigration.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
            markMigration.ExecuteNonQuery();
        }

        if (!HasColumn(connection, transaction, "projects", "submission_key"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN submission_key TEXT NULL;";
            migration.ExecuteNonQuery();
        }
        using (var markMigration = connection.CreateCommand())
        {
            markMigration.Transaction = transaction;
            markMigration.CommandText = "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, $appliedAt);";
            markMigration.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
            markMigration.ExecuteNonQuery();
        }

        if (!HasColumn(connection, transaction, "projects", "submission_snapshot_json"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN submission_snapshot_json TEXT NULL;";
            migration.ExecuteNonQuery();
        }
        using (var markMigration = connection.CreateCommand())
        {
            markMigration.Transaction = transaction;
            markMigration.CommandText = "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, $appliedAt);";
            markMigration.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
            markMigration.ExecuteNonQuery();
        }

        if (!HasColumn(connection, transaction, "projects", "workflow_status"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'new';";
            migration.ExecuteNonQuery();
        }
        if (!HasColumn(connection, transaction, "projects", "priority"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';";
            migration.ExecuteNonQuery();
        }
        if (!HasColumn(connection, transaction, "projects", "assignee_user_id"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN assignee_user_id TEXT NULL;";
            migration.ExecuteNonQuery();
        }
        if (!HasColumn(connection, transaction, "projects", "workflow_updated_at"))
        {
            using var migration = connection.CreateCommand();
            migration.Transaction = transaction;
            migration.CommandText = "ALTER TABLE projects ADD COLUMN workflow_updated_at TEXT NULL;";
            migration.ExecuteNonQuery();
        }
        using (var markMigration = connection.CreateCommand())
        {
            markMigration.Transaction = transaction;
            markMigration.CommandText = "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (6, $appliedAt);";
            markMigration.Parameters.AddWithValue("$appliedAt", DateTimeOffset.UtcNow.ToString("O"));
            markMigration.ExecuteNonQuery();
        }

        UpgradeLegacyCharacterPresets(connection, transaction);
        transaction.Commit();
    }

    private static void UpgradeLegacyCharacterPresets(SqliteConnection connection, SqliteTransaction transaction)
    {
        using var check = connection.CreateCommand();
        check.Transaction = transaction;
        check.CommandText = "SELECT COUNT(*) FROM schema_migrations WHERE version = 7;";
        if (Convert.ToInt32(check.ExecuteScalar()) != 0) return;

        var drafts = new List<(string Id, CreativeInfoDto Creative)>();
        using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = "SELECT id, creative_json FROM projects WHERE status = 'draft';";
            using var reader = read.ExecuteReader();
            while (reader.Read()) drafts.Add((reader.GetString(0), DeserializeCreative(reader.GetString(1))));
        }
        foreach (var (id, creative) in drafts)
        {
            var upgraded = creative.Characters.Select(CharacterPresetCatalog.UpgradeLegacy).ToArray();
            if (upgraded.SequenceEqual(creative.Characters)) continue;
            using var update = connection.CreateCommand();
            update.Transaction = transaction;
            update.CommandText = "UPDATE projects SET creative_json=$creative, version=version+1, updated_at=$now WHERE id=$id;";
            update.Parameters.AddWithValue("$creative", JsonSerializer.Serialize(creative with { Characters = upgraded }, AppJsonContext.Default.CreativeInfoDto));
            update.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            update.Parameters.AddWithValue("$id", id);
            update.ExecuteNonQuery();
        }
        using var mark = connection.CreateCommand();
        mark.Transaction = transaction;
        mark.CommandText = "INSERT INTO schema_migrations(version,applied_at) VALUES(7,$now);";
        mark.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        mark.ExecuteNonQuery();
    }

    public PagedProjectsDto List(string ownerId, string? status, string? search, int page, int pageSize, string? sortBy = null, string? sortDirection = null)
    {
        using var connection = Open();
        var sortExpression = sortBy switch
        {
            "project" => "COALESCE(NULLIF(TRIM(json_extract(book_json, '$.title')), ''), NULLIF(TRIM(json_extract(project_json, '$.projectName')), ''), '') COLLATE NOCASE",
            "author" => "COALESCE(json_extract(book_json, '$.authorName'), '') COLLATE NOCASE",
            "status" => "CASE WHEN status = 'draft' THEN 0 WHEN workflow_status = 'new' THEN 1 WHEN workflow_status = 'contacting' THEN 2 WHEN workflow_status = 'confirmed' THEN 3 WHEN workflow_status = 'in_production' THEN 4 WHEN workflow_status = 'awaiting_customer' THEN 5 WHEN workflow_status = 'completed' THEN 6 WHEN workflow_status = 'closed' THEN 7 ELSE 8 END",
            _ => "updated_at"
        };
        var direction = string.Equals(sortDirection, "asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";
        const string where = """
            WHERE owner_id = $ownerId
              AND ($status = '' OR status = $status)
              AND ($search = '' OR
                   json_extract(project_json, '$.projectName') LIKE '%' || $search || '%' COLLATE NOCASE OR
                   json_extract(book_json, '$.title') LIKE '%' || $search || '%' COLLATE NOCASE OR
                   json_extract(book_json, '$.authorName') LIKE '%' || $search || '%' COLLATE NOCASE)
            """;
        using var countCommand = connection.CreateCommand();
        countCommand.CommandText = $"SELECT COUNT(*) FROM projects {where};";
        AddListParameters(countCommand, ownerId, status, search);
        var total = Convert.ToInt32(countCommand.ExecuteScalar());

        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT id, task_number, status, version, project_json, book_json, creative_json, voice_json, created_at, updated_at, workflow_status
            FROM projects
            {where}
            ORDER BY {sortExpression} {direction}, id ASC
            LIMIT $pageSize OFFSET $offset;
            """;
        AddListParameters(command, ownerId, status, search);
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", (long)(page - 1) * pageSize);

        var rows = new List<TaskDraftDto>();
        using var reader = command.ExecuteReader();
        while (reader.Read()) rows.Add(ReadDraft(reader));

        return new PagedProjectsDto(rows.Select(ToSummary).ToArray(), page, pageSize, total);
    }

    public ProjectStatsDto GetStats(string ownerId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT
                COUNT(*),
                COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'submitted' AND COALESCE(workflow_status, 'new') NOT IN ('completed', 'closed') THEN 1 ELSE 0 END), 0),
                COALESCE(SUM(CASE WHEN status = 'submitted' AND workflow_status = 'completed' THEN 1 ELSE 0 END), 0)
            FROM projects
            WHERE owner_id = $ownerId;
            """;
        command.Parameters.AddWithValue("$ownerId", ownerId);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return new ProjectStatsDto(0, 0, 0, 0);
        return new ProjectStatsDto(reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetInt32(3));
    }

    public TaskDraftDto Create(string ownerId, string clientName = "", string contactName = "", string email = "", string? phone = null, string locale = "zh-CN")
    {
        var now = DateTimeOffset.UtcNow;
        var draft = new TaskDraftDto(
            Guid.NewGuid().ToString("N"), null, "draft", 1,
            new ProjectInfoDto(clientName, contactName, email, phone, null, "", null, null, []),
            new BookInfoDto("", null, "", null, "", "", null, null, [], []),
            EmptyCreative() with { Characters = CharacterPresetCatalog.Create(locale) },
            EmptyVoiceAndReferences(),
            now, now);
        Insert(ownerId, draft);
        return draft;
    }

    public int CountDrafts(string ownerId)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM projects WHERE owner_id = $ownerId AND status = 'draft';";
        command.Parameters.AddWithValue("$ownerId", ownerId);
        return Convert.ToInt32(command.ExecuteScalar());
    }

    public TaskDraftDto? Get(string ownerId, string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, task_number, status, version, project_json, book_json, creative_json, voice_json, created_at, updated_at, workflow_status
            FROM projects WHERE owner_id = $ownerId AND id = $id;
            """;
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadDraft(reader) : null;
    }

    public SaveResult Save(string ownerId, string id, SaveDraftRequest request)
    {
        var now = DateTimeOffset.UtcNow;
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE projects
            SET project_json = $project, book_json = $book, version = version + 1, updated_at = $updatedAt
            WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version
            RETURNING task_number, status, version, creative_json, voice_json, created_at, updated_at;
            """;
        command.Parameters.AddWithValue("$project", JsonSerializer.Serialize(request.Project, AppJsonContext.Default.ProjectInfoDto));
        command.Parameters.AddWithValue("$book", JsonSerializer.Serialize(request.Book, AppJsonContext.Default.BookInfoDto));
        command.Parameters.AddWithValue("$updatedAt", now.ToString("O"));
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$version", request.Version);
        using var reader = command.ExecuteReader();
        if (reader.Read())
        {
            var saved = new TaskDraftDto(
                id, reader.IsDBNull(0) ? null : reader.GetString(0), reader.GetString(1), reader.GetInt32(2),
                request.Project, request.Book, DeserializeCreative(reader.GetString(3)), DeserializeVoiceAndReferences(reader.GetString(4)), DateTimeOffset.Parse(reader.GetString(5)), DateTimeOffset.Parse(reader.GetString(6)));
            return new SaveResult(SaveOutcome.Saved, saved, saved.Version);
        }
        reader.Close();
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        return current.Status != "draft"
            ? new SaveResult(SaveOutcome.NotEditable, current, current.Version)
            : new SaveResult(SaveOutcome.VersionConflict, current, current.Version);
    }

    public SaveResult DeleteDraft(string ownerId, string id, int version)
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction();
        if (HasTable(connection, transaction, "project_notes"))
        {
            using var notes = connection.CreateCommand();
            notes.Transaction = transaction;
            notes.CommandText = "DELETE FROM project_notes WHERE project_id = $id AND EXISTS (SELECT 1 FROM projects WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version);";
            notes.Parameters.AddWithValue("$ownerId", ownerId);
            notes.Parameters.AddWithValue("$id", id);
            notes.Parameters.AddWithValue("$version", version);
            notes.ExecuteNonQuery();
        }
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM projects WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version;";
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$version", version);
        if (command.ExecuteNonQuery() == 1)
        {
            transaction.Commit();
            return new SaveResult(SaveOutcome.Saved, null, null);
        }
        transaction.Rollback();
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        return current.Status != "draft"
            ? new SaveResult(SaveOutcome.NotEditable, current, current.Version)
            : new SaveResult(SaveOutcome.VersionConflict, current, current.Version);
    }

    public SaveResult SaveCreative(string ownerId, string id, SaveCreativeRequest request)
    {
        var now = DateTimeOffset.UtcNow;
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE projects
            SET creative_json = $creative, version = version + 1, updated_at = $updatedAt
            WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version
            RETURNING task_number, status, version, project_json, book_json, voice_json, created_at, updated_at;
            """;
        command.Parameters.AddWithValue("$creative", JsonSerializer.Serialize(request.Creative, AppJsonContext.Default.CreativeInfoDto));
        command.Parameters.AddWithValue("$updatedAt", now.ToString("O"));
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$version", request.Version);
        using var reader = command.ExecuteReader();
        if (reader.Read())
        {
            var project = JsonSerializer.Deserialize(reader.GetString(3), AppJsonContext.Default.ProjectInfoDto) ?? throw new InvalidDataException("Project JSON is invalid.");
            var book = DeserializeBook(reader.GetString(4));
            var saved = new TaskDraftDto(id, reader.IsDBNull(0) ? null : reader.GetString(0), reader.GetString(1), reader.GetInt32(2),
                project, book, request.Creative, DeserializeVoiceAndReferences(reader.GetString(5)), DateTimeOffset.Parse(reader.GetString(6)), DateTimeOffset.Parse(reader.GetString(7)));
            return new SaveResult(SaveOutcome.Saved, saved, saved.Version);
        }
        reader.Close();
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        return current.Status != "draft"
            ? new SaveResult(SaveOutcome.NotEditable, current, current.Version)
            : new SaveResult(SaveOutcome.VersionConflict, current, current.Version);
    }

    public SaveResult SaveVoiceAndReferences(string ownerId, string id, SaveVoiceAndReferencesRequest request)
    {
        request = request with { VoiceAndReferences = request.VoiceAndReferences with
        {
            Voiceover = NarrationSettings.Normalize(request.VoiceAndReferences.Voiceover)
        } };
        var now = DateTimeOffset.UtcNow;
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE projects
            SET voice_json = $voice, project_json = COALESCE($project, project_json), version = version + 1, updated_at = $updatedAt
            WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version
            RETURNING task_number, status, version, project_json, book_json, creative_json, created_at, updated_at;
            """;
        command.Parameters.AddWithValue("$project", request.Project is null ? DBNull.Value : JsonSerializer.Serialize(request.Project, AppJsonContext.Default.ProjectInfoDto));
        command.Parameters.AddWithValue("$voice", JsonSerializer.Serialize(request.VoiceAndReferences, AppJsonContext.Default.VoiceAndReferencesInfoDto));
        command.Parameters.AddWithValue("$updatedAt", now.ToString("O"));
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$version", request.Version);
        using var reader = command.ExecuteReader();
        if (reader.Read())
        {
            var project = JsonSerializer.Deserialize(reader.GetString(3), AppJsonContext.Default.ProjectInfoDto) ?? throw new InvalidDataException("Project JSON is invalid.");
            var book = DeserializeBook(reader.GetString(4));
            var saved = new TaskDraftDto(id, reader.IsDBNull(0) ? null : reader.GetString(0), reader.GetString(1), reader.GetInt32(2),
                project, book, DeserializeCreative(reader.GetString(5)), request.VoiceAndReferences, DateTimeOffset.Parse(reader.GetString(6)), DateTimeOffset.Parse(reader.GetString(7)));
            return new SaveResult(SaveOutcome.Saved, saved, saved.Version);
        }
        reader.Close();
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        return current.Status != "draft"
            ? new SaveResult(SaveOutcome.NotEditable, current, current.Version)
            : new SaveResult(SaveOutcome.VersionConflict, current, current.Version);
    }

    public SaveResult AddAsset(string ownerId, string id, int version, ReferenceAssetDto asset, string target, string? characterId = null)
    {
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        if (current.Status != "draft") return new SaveResult(SaveOutcome.NotEditable, current, current.Version);
        if (target == "source")
        {
            var updatedBook = current.Book with { SourceAssets = [.. current.Book.SourceAssets ?? [], asset] };
            return Save(ownerId, id, new SaveDraftRequest(version, current.Project, updatedBook));
        }
        if (target == "creative-style")
        {
            var updatedCreative = current.Creative with { StyleReferenceImages = [.. current.Creative.StyleReferenceImages ?? [], asset] };
            return SaveCreative(ownerId, id, new SaveCreativeRequest(version, updatedCreative));
        }
        if (target == "creative-character" && !string.IsNullOrWhiteSpace(characterId))
        {
            var found = false;
            var updatedCharacters = current.Creative.Characters.Select(character =>
            {
                if (character.Id != characterId) return character;
                found = true;
                return character with { ReferenceImages = [.. character.ReferenceImages ?? [], asset] };
            }).ToArray();
            if (!found) return new SaveResult(SaveOutcome.NotFound, current, current.Version);
            return SaveCreative(ownerId, id, new SaveCreativeRequest(version, current.Creative with { Characters = updatedCharacters }));
        }
        var updated = current.VoiceAndReferences with { Assets = [.. current.VoiceAndReferences.Assets, asset] };
        return SaveVoiceAndReferences(ownerId, id, new SaveVoiceAndReferencesRequest(version, updated));
    }

    public SaveResult RemoveAsset(string ownerId, string id, int version, string fileId)
    {
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        if (current.Status != "draft") return new SaveResult(SaveOutcome.NotEditable, current, current.Version);
        if ((current.Book.SourceAssets ?? []).Any(asset => asset.Id == fileId))
        {
            var updatedBook = current.Book with { SourceAssets = (current.Book.SourceAssets ?? []).Where(asset => asset.Id != fileId).ToArray() };
            return Save(ownerId, id, new SaveDraftRequest(version, current.Project, updatedBook));
        }
        if ((current.Creative.StyleReferenceImages ?? []).Any(asset => asset.Id == fileId))
        {
            var updatedCreative = current.Creative with { StyleReferenceImages = current.Creative.StyleReferenceImages!.Where(asset => asset.Id != fileId).ToArray() };
            return SaveCreative(ownerId, id, new SaveCreativeRequest(version, updatedCreative));
        }
        if (current.Creative.Characters.Any(character => (character.ReferenceImages ?? []).Any(asset => asset.Id == fileId)))
        {
            var updatedCharacters = current.Creative.Characters.Select(character => character with
            {
                ReferenceImages = (character.ReferenceImages ?? []).Where(asset => asset.Id != fileId).ToArray()
            }).ToArray();
            return SaveCreative(ownerId, id, new SaveCreativeRequest(version, current.Creative with { Characters = updatedCharacters }));
        }
        var updated = current.VoiceAndReferences with { Assets = current.VoiceAndReferences.Assets.Where(asset => asset.Id != fileId).ToArray() };
        return SaveVoiceAndReferences(ownerId, id, new SaveVoiceAndReferencesRequest(version, updated));
    }

    public SaveResult Submit(string ownerId, string id, int version, string idempotencyKey, SubmissionConfigurationSnapshotDto? snapshot)
    {
        var now = DateTimeOffset.UtcNow;
        var taskNumber = $"LW-{now:yyMMdd}-{id[..6].ToUpperInvariant()}";
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE projects
            SET task_number = $taskNumber, status = 'submitted', submission_key = $idempotencyKey, version = version + 1,
                project_json = CASE WHEN TRIM(COALESCE(json_extract(project_json, '$.projectName'), '')) = ''
                    THEN json_set(project_json, '$.projectName', TRIM(COALESCE(json_extract(book_json, '$.title'), '')))
                    ELSE project_json END,
                submission_snapshot_json = $snapshot, updated_at = $updatedAt, workflow_status = 'new', priority = 'normal', assignee_user_id = NULL, workflow_updated_at = $updatedAt
            WHERE owner_id = $ownerId AND id = $id AND status = 'draft' AND version = $version
            RETURNING id, task_number, status, version, project_json, book_json, creative_json, voice_json, created_at, updated_at, workflow_status;
            """;
        command.Parameters.AddWithValue("$taskNumber", taskNumber);
        command.Parameters.AddWithValue("$updatedAt", now.ToString("O"));
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$version", version);
        command.Parameters.AddWithValue("$idempotencyKey", idempotencyKey);
        command.Parameters.AddWithValue("$snapshot", snapshot is null ? DBNull.Value : JsonSerializer.Serialize(snapshot, AppJsonContext.Default.SubmissionConfigurationSnapshotDto));
        using var reader = command.ExecuteReader();
        if (reader.Read())
        {
            var submitted = ReadDraft(reader);
            return new SaveResult(SaveOutcome.Saved, submitted, submitted.Version);
        }
        reader.Close();
        var current = Get(ownerId, id);
        if (current is null) return new SaveResult(SaveOutcome.NotFound, null, null);
        if (current.Status == "submitted" && SubmissionKeyMatches(ownerId, id, idempotencyKey))
            return new SaveResult(SaveOutcome.Saved, current, current.Version);
        return current.Status != "draft"
            ? new SaveResult(SaveOutcome.NotEditable, current, current.Version)
            : new SaveResult(SaveOutcome.VersionConflict, current, current.Version);
    }

    private void Insert(string ownerId, TaskDraftDto draft, SqliteConnection? existingConnection = null, SqliteTransaction? transaction = null)
    {
        var ownsConnection = existingConnection is null;
        var connection = existingConnection ?? Open();
        try
        {
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO projects (id, owner_id, task_number, status, version, project_json, book_json, creative_json, voice_json, created_at, updated_at)
                VALUES ($id, $ownerId, $taskNumber, $status, $version, $project, $book, $creative, $voice, $createdAt, $updatedAt);
                """;
            command.Parameters.AddWithValue("$id", draft.Id);
            command.Parameters.AddWithValue("$ownerId", ownerId);
            command.Parameters.AddWithValue("$taskNumber", (object?)draft.TaskNumber ?? DBNull.Value);
            command.Parameters.AddWithValue("$status", draft.Status);
            command.Parameters.AddWithValue("$version", draft.Version);
            command.Parameters.AddWithValue("$project", JsonSerializer.Serialize(draft.Project, AppJsonContext.Default.ProjectInfoDto));
            command.Parameters.AddWithValue("$book", JsonSerializer.Serialize(draft.Book, AppJsonContext.Default.BookInfoDto));
            command.Parameters.AddWithValue("$creative", JsonSerializer.Serialize(draft.Creative, AppJsonContext.Default.CreativeInfoDto));
            command.Parameters.AddWithValue("$voice", JsonSerializer.Serialize(draft.VoiceAndReferences, AppJsonContext.Default.VoiceAndReferencesInfoDto));
            command.Parameters.AddWithValue("$createdAt", draft.CreatedAt.ToString("O"));
            command.Parameters.AddWithValue("$updatedAt", draft.UpdatedAt.ToString("O"));
            command.ExecuteNonQuery();
        }
        finally
        {
            if (ownsConnection) connection.Dispose();
        }
    }

    private SqliteConnection Open()
    {
        var connection = new SqliteConnection(connectionString);
        connection.Open();
        using var pragma = connection.CreateCommand();
        pragma.CommandText = "PRAGMA busy_timeout=5000;";
        pragma.ExecuteNonQuery();
        return connection;
    }

    private bool SubmissionKeyMatches(string ownerId, string id, string idempotencyKey)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT submission_key FROM projects WHERE owner_id = $ownerId AND id = $id;";
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        return command.ExecuteScalar() is string stored && stored.Equals(idempotencyKey, StringComparison.Ordinal);
    }

    private static void AddListParameters(SqliteCommand command, string ownerId, string? status, string? search)
    {
        command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$status", status?.Trim() ?? "");
        command.Parameters.AddWithValue("$search", search?.Trim() ?? "");
    }

    private static TaskDraftDto ReadDraft(SqliteDataReader reader)
    {
        var project = JsonSerializer.Deserialize(reader.GetString(4), AppJsonContext.Default.ProjectInfoDto)
            ?? throw new InvalidDataException("Project JSON is invalid.");
        var book = DeserializeBook(reader.GetString(5));
        var creative = DeserializeCreative(reader.GetString(6));
        var voice = DeserializeVoiceAndReferences(reader.GetString(7));
        return new TaskDraftDto(
            reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetString(2), reader.GetInt32(3),
            project, book, creative, voice, DateTimeOffset.Parse(reader.GetString(8)), DateTimeOffset.Parse(reader.GetString(9)),
            reader.FieldCount > 10 && !reader.IsDBNull(10) ? reader.GetString(10) : null);
    }

    private static CreativeInfoDto DeserializeCreative(string json)
    {
        var creative = JsonSerializer.Deserialize(json, AppJsonContext.Default.CreativeInfoDto) ?? throw new InvalidDataException("Creative JSON is invalid.");
        return creative with
        {
            StyleReferenceImages = creative.StyleReferenceImages ?? [],
            Characters = creative.Characters.Select(character => character with { ReferenceImages = character.ReferenceImages ?? [] }).ToArray()
        };
    }

    public SubmissionConfigurationSnapshotDto? GetSubmissionSnapshot(string ownerId, string id) =>
        ReadSubmissionSnapshot("SELECT submission_snapshot_json FROM projects WHERE owner_id = $ownerId AND id = $id AND status = 'submitted';", ownerId, id);

    public SubmissionConfigurationSnapshotDto? GetSubmissionSnapshotForAdmin(string id) =>
        ReadSubmissionSnapshot("SELECT submission_snapshot_json FROM projects WHERE id = $id AND status = 'submitted';", null, id);

    private SubmissionConfigurationSnapshotDto? ReadSubmissionSnapshot(string sql, string? ownerId, string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        if (ownerId is not null) command.Parameters.AddWithValue("$ownerId", ownerId);
        command.Parameters.AddWithValue("$id", id);
        return command.ExecuteScalar() is string json
            ? JsonSerializer.Deserialize(json, AppJsonContext.Default.SubmissionConfigurationSnapshotDto)
            : null;
    }

    private static BookInfoDto DeserializeBook(string json)
    {
        var book = JsonSerializer.Deserialize(json, AppJsonContext.Default.BookInfoDto) ?? throw new InvalidDataException("Book JSON is invalid.");
        return book with { SourceAssets = book.SourceAssets ?? [] };
    }

    private static VoiceAndReferencesInfoDto DeserializeVoiceAndReferences(string json) =>
        JsonSerializer.Deserialize(json, AppJsonContext.Default.VoiceAndReferencesInfoDto) ?? throw new InvalidDataException("Voice JSON is invalid.");

    private static CreativeInfoDto EmptyCreative() => new([], null, [], [], [], [], []);
    private static VoiceAndReferencesInfoDto EmptyVoiceAndReferences() => new(new(null, null, null, null, null, null, null, null, [], null, null), [], [], new("", null, null, null, null, null));

    private static bool HasTable(SqliteConnection connection, SqliteTransaction transaction, string table)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $table;";
        command.Parameters.AddWithValue("$table", table);
        return command.ExecuteScalar() is not null;
    }
    private static bool HasColumn(SqliteConnection connection, SqliteTransaction transaction, string table, string column)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"PRAGMA table_info({table});";
        using var reader = command.ExecuteReader();
        while (reader.Read()) if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true;
        return false;
    }

    private static ProjectSummaryDto ToSummary(TaskDraftDto task) => new(
        task.Id, task.TaskNumber, task.Version,
        string.IsNullOrWhiteSpace(task.Project.ProjectName) ? "—" : task.Project.ProjectName,
        string.IsNullOrWhiteSpace(task.Project.ClientName) ? "—" : task.Project.ClientName,
        string.IsNullOrWhiteSpace(task.Book.Title) ? "—" : task.Book.Title,
        string.IsNullOrWhiteSpace(task.Book.AuthorName) ? "—" : task.Book.AuthorName,
        task.Book.SourceAssets?.FirstOrDefault(asset => asset.CategoryId == "book-cover")?.Url,
        task.Status, task.CreatedAt, task.UpdatedAt, task.WorkflowStatus);
}

internal enum SaveOutcome { Saved, NotFound, NotEditable, VersionConflict }
internal sealed record SaveResult(SaveOutcome Outcome, TaskDraftDto? Draft, int? CurrentVersion);
