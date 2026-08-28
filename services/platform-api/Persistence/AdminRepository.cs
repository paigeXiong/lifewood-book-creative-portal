using System.Net.Mail;
using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Serialization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.Sqlite;

namespace Lifewood.PlatformApi.Persistence;

internal enum AdminWriteOutcome { Saved, NotFound, Invalid, Conflict, Protected }
internal sealed record AdminWriteResult(AdminWriteOutcome Outcome, string? Field = null);

internal sealed class AdminRepository(string connectionString)
{
    private static readonly IReadOnlySet<string> CreatableRoles = new HashSet<string>(["customer", "admin"], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> UpdatableRoles = new HashSet<string>(["owner", "customer", "admin"], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> WorkflowStatuses = new HashSet<string>(["new", "contacting", "confirmed", "in_production", "awaiting_customer", "completed", "closed"], StringComparer.Ordinal);
    private static readonly IReadOnlySet<string> Priorities = new HashSet<string>(["low", "normal", "high", "urgent"], StringComparer.Ordinal);
    private readonly PasswordHasher<PasswordTarget> passwordHasher = new();

    public void Initialize()
    {
        using var connection = Open();
        OrganizationSchema.Ensure(connection);
        if (!HasColumn(connection, "users", "is_active")) Execute(connection, "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
        if (!HasColumn(connection, "projects", "workflow_status")) Execute(connection, "ALTER TABLE projects ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'new';");
        if (!HasColumn(connection, "projects", "priority")) Execute(connection, "ALTER TABLE projects ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';");
        if (!HasColumn(connection, "projects", "workflow_updated_at")) Execute(connection, "ALTER TABLE projects ADD COLUMN workflow_updated_at TEXT NULL;");
        Execute(connection, "UPDATE projects SET workflow_updated_at = updated_at WHERE workflow_updated_at IS NULL;");
        if (!HasColumn(connection, "projects", "assignee_user_id")) Execute(connection, "ALTER TABLE projects ADD COLUMN assignee_user_id TEXT NULL;");
        Execute(connection, """
            CREATE TABLE IF NOT EXISTS project_notes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                author_user_id TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_project_notes_project_created ON project_notes(project_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_projects_workflow_updated ON projects(workflow_status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS ix_projects_status ON projects(status);
            CREATE INDEX IF NOT EXISTS ix_projects_priority ON projects(priority);
            """);
        Execute(connection, """
            UPDATE projects
            SET workflow_status = 'new', priority = 'normal', assignee_user_id = NULL, workflow_updated_at = updated_at
            WHERE status = 'submitted' AND workflow_updated_at < updated_at;
            """);
    }

    public AdminUserDto[] ListAssignees()
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT u.id, u.email, u.display_name, u.phone, u.role, u.is_active, o.id, o.name, u.created_at, u.updated_at
            FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
            WHERE u.is_active = 1 AND u.role IN ('owner', 'admin')
            ORDER BY u.display_name COLLATE NOCASE;
            """;
        using var reader = command.ExecuteReader();
        var items = new List<AdminUserDto>();
        while (reader.Read()) items.Add(ReadUser(reader));
        return [.. items];
    }

    public AdminOverviewDto GetOverview()
    {
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: true);
        var overview = new AdminOverviewDto(
            Count(connection, transaction, "SELECT COUNT(*) FROM projects WHERE status = 'submitted';"),
            Count(connection, transaction, "SELECT COUNT(*) FROM projects WHERE status = 'submitted' AND assignee_user_id IS NULL AND workflow_status NOT IN ('completed', 'closed');"),
            Count(connection, transaction, "SELECT COUNT(*) FROM users;"),
            Count(connection, transaction, "SELECT COUNT(*) FROM users WHERE is_active = 1;"),
            GroupCounts(connection, transaction, "SELECT status, COUNT(*) FROM projects WHERE status = 'submitted' GROUP BY status ORDER BY status;"),
            GroupCounts(connection, transaction, "SELECT workflow_status, COUNT(*) FROM projects WHERE status = 'submitted' GROUP BY workflow_status ORDER BY workflow_status;"),
            GroupCounts(connection, transaction, "SELECT priority, COUNT(*) FROM projects WHERE status = 'submitted' GROUP BY priority ORDER BY priority;"));
        transaction.Commit();
        return overview;
    }
    public PagedAdminUsersDto ListUsers(string? search, string? role, int page, int pageSize)
    {
        using var connection = Open();
        const string where = "WHERE ($search = '' OR u.display_name LIKE '%' || $search || '%' COLLATE NOCASE OR u.email LIKE '%' || $search || '%' COLLATE NOCASE OR u.phone LIKE '%' || $search || '%' COLLATE NOCASE OR o.name LIKE '%' || $search || '%' COLLATE NOCASE) AND ($role = '' OR u.role = $role)";
        using var count = connection.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM users u LEFT JOIN organizations o ON o.id = u.organization_id {where};";
        AddUserFilters(count, search, role);
        var total = Convert.ToInt32(count.ExecuteScalar());
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT u.id, u.email, u.display_name, u.phone, u.role, u.is_active, o.id, o.name, u.created_at, u.updated_at FROM users u LEFT JOIN organizations o ON o.id = u.organization_id {where} ORDER BY u.created_at DESC LIMIT $pageSize OFFSET $offset;";
        AddUserFilters(command, search, role);
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", (long)(page - 1) * pageSize);
        using var reader = command.ExecuteReader();
        var items = new List<AdminUserDto>();
        while (reader.Read()) items.Add(ReadUser(reader));
        return new([.. items], page, pageSize, total);
    }

    public AdminUserDto? GetUser(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT u.id, u.email, u.display_name, u.phone, u.role, u.is_active, o.id, o.name, u.created_at, u.updated_at FROM users u LEFT JOIN organizations o ON o.id = u.organization_id WHERE u.id = $id;";
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        return reader.Read() ? ReadUser(reader) : null;
    }

    public AdminWriteResult CreateUser(CreateUserRequest? request, out AdminUserDto? user)
    {
        user = null;
        if (request is null || string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length is < 2 or > 100) return new(AdminWriteOutcome.Invalid, "displayName");
        var candidateEmail = request.Email?.Trim() ?? "";
        if (candidateEmail.Length is 0 or > 254 || !MailAddress.TryCreate(candidateEmail, out var address) || address is null) return new(AdminWriteOutcome.Invalid, "email");
        if (!address.Address.Equals(candidateEmail, StringComparison.OrdinalIgnoreCase)) return new(AdminWriteOutcome.Invalid, "email");
        if (string.IsNullOrEmpty(request.Password) || request.Password.Length is < 12 or > 128) return new(AdminWriteOutcome.Invalid, "password");
        if (!CreatableRoles.Contains(request.Role)) return new(AdminWriteOutcome.Invalid, "role");
        var id = Guid.NewGuid().ToString("N");
        var email = candidateEmail;
        var displayName = request.DisplayName.Trim();
        var phone = NormalizePhone(request.Phone);
        if (phone is { Length: > 50 }) return new(AdminWriteOutcome.Invalid, "phone");
        var now = DateTimeOffset.UtcNow;
        var passwordHash = passwordHasher.HashPassword(new PasswordTarget(id), request.Password);
        try
        {
            using var connection = Open();
            using var transaction = connection.BeginTransaction(deferred: false);
            if (!CanAssignOrganization(connection, transaction, request.OrganizationId, null)) return new(AdminWriteOutcome.Invalid, "organizationId");
            using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO users(id, email, normalized_email, display_name, phone, password_hash, role, is_active, organization_id, created_at, updated_at)
                VALUES ($id, $email, $normalizedEmail, $displayName, $phone, $passwordHash, $role, 1, $organizationId, $now, $now);
                """;
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$email", email);
            command.Parameters.AddWithValue("$normalizedEmail", email.ToUpperInvariant());
            command.Parameters.AddWithValue("$displayName", displayName);
            command.Parameters.AddWithValue("$phone", DbValue(phone));
            command.Parameters.AddWithValue("$passwordHash", passwordHash);
            command.Parameters.AddWithValue("$role", request.Role);
            command.Parameters.AddWithValue("$organizationId", DbValue(request.OrganizationId));
            command.Parameters.AddWithValue("$now", now.ToString("O"));
            command.ExecuteNonQuery();
            transaction.Commit();
            user = GetUser(id);
            return new(AdminWriteOutcome.Saved);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return new(AdminWriteOutcome.Conflict, "email");
        }
    }

    public AdminWriteResult UpdateUser(string id, UpdateUserRequest? request, out AdminUserDto? user)
    {
        user = null;
        if (request is null || string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Trim().Length is < 2 or > 100) return new(AdminWriteOutcome.Invalid, "displayName");
        if (!UpdatableRoles.Contains(request.Role)) return new(AdminWriteOutcome.Invalid, "role");
        var phone = NormalizePhone(request.Phone);
        if (phone is { Length: > 50 }) return new(AdminWriteOutcome.Invalid, "phone");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        using var existing = connection.CreateCommand();
        existing.Transaction = transaction;
        existing.CommandText = "SELECT role, organization_id FROM users WHERE id = $id;";
        existing.Parameters.AddWithValue("$id", id);
        using var existingReader = existing.ExecuteReader();
        if (!existingReader.Read()) return new(AdminWriteOutcome.NotFound);
        var currentRole = existingReader.GetString(0);
        var currentOrganizationId = existingReader.IsDBNull(1) ? null : existingReader.GetString(1);
        if (currentRole == "owner" && (request.Role != "owner" || !request.Active)) return new(AdminWriteOutcome.Protected, "role");
        if (currentRole != "owner" && request.Role == "owner") return new(AdminWriteOutcome.Protected, "role");
        existingReader.Close();
        if (!CanAssignOrganization(connection, transaction, request.OrganizationId, currentOrganizationId)) return new(AdminWriteOutcome.Invalid, "organizationId");
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE users SET display_name = $displayName, phone = $phone, role = $role, is_active = $active, organization_id = $organizationId, updated_at = $now WHERE id = $id;";
        command.Parameters.AddWithValue("$displayName", request.DisplayName.Trim());
        command.Parameters.AddWithValue("$phone", DbValue(phone));
        command.Parameters.AddWithValue("$role", request.Role);
        command.Parameters.AddWithValue("$active", request.Active ? 1 : 0);
        command.Parameters.AddWithValue("$organizationId", DbValue(request.OrganizationId));
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.ExecuteNonQuery();
        transaction.Commit();
        user = GetUser(id);
        return new(AdminWriteOutcome.Saved);
    }

    public PagedAdminProjectsDto ListProjects(string? workflowStatus, string? priority, string? search, int page, int pageSize)
    {
        using var connection = Open();
        const string where = """
            WHERE p.status = 'submitted'
              AND ($workflow = '' OR p.workflow_status = $workflow)
              AND ($priority = '' OR p.priority = $priority)
              AND ($search = '' OR p.task_number LIKE '%' || $search || '%' COLLATE NOCASE OR u.display_name LIKE '%' || $search || '%' COLLATE NOCASE OR u.email LIKE '%' || $search || '%' COLLATE NOCASE OR json_extract(p.project_json, '$.projectName') LIKE '%' || $search || '%' COLLATE NOCASE OR json_extract(p.book_json, '$.title') LIKE '%' || $search || '%' COLLATE NOCASE)
            """;
        using var count = connection.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM projects p JOIN users u ON u.id = p.owner_id {where};";
        AddProjectFilters(count, workflowStatus, priority, search);
        var total = Convert.ToInt32(count.ExecuteScalar());
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT p.id, p.task_number, p.status, p.workflow_status, p.priority, p.owner_id, u.display_name, u.email,
                   p.assignee_user_id, a.display_name, p.project_json, p.book_json, p.created_at, COALESCE(p.workflow_updated_at, p.updated_at)
            FROM projects p JOIN users u ON u.id = p.owner_id LEFT JOIN users a ON a.id = p.assignee_user_id
            {where} ORDER BY COALESCE(p.workflow_updated_at, p.updated_at) DESC LIMIT $pageSize OFFSET $offset;
            """;
        AddProjectFilters(command, workflowStatus, priority, search);
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", (long)(page - 1) * pageSize);
        using var reader = command.ExecuteReader();
        var items = new List<AdminProjectSummaryDto>();
        while (reader.Read()) items.Add(ReadProjectSummary(reader));
        return new([.. items], page, pageSize, total);
    }

    public AdminProjectDetailDto? GetProject(string id)
    {
        using var connection = Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT p.id, p.task_number, p.status, p.version, p.project_json, p.book_json, p.creative_json, p.voice_json,
                   p.created_at, p.updated_at, p.owner_id, u.display_name, u.email, p.workflow_status, p.priority,
                   p.assignee_user_id, a.display_name, COALESCE(p.workflow_updated_at, p.updated_at)
            FROM projects p JOIN users u ON u.id = p.owner_id LEFT JOIN users a ON a.id = p.assignee_user_id
            WHERE p.id = $id AND p.status = 'submitted';
            """;
        command.Parameters.AddWithValue("$id", id);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        var project = ReadDraft(reader);
        var ownerId = reader.GetString(10);
        var ownerName = reader.GetString(11);
        var ownerEmail = reader.GetString(12);
        var workflow = reader.GetString(13);
        var priority = reader.GetString(14);
        var assigneeId = reader.IsDBNull(15) ? null : reader.GetString(15);
        var assigneeName = reader.IsDBNull(16) ? null : reader.GetString(16);
        var workflowUpdatedAt = DateTimeOffset.Parse(reader.GetString(17));
        reader.Close();
        return new(project, ownerId, ownerName, ownerEmail, workflow, priority, assigneeId, assigneeName, workflowUpdatedAt, ListNotes(connection, id));
    }

    public AdminWriteResult UpdateWorkflow(string id, UpdateProjectWorkflowRequest? request)
    {
        if (request is null || !WorkflowStatuses.Contains(request.WorkflowStatus)) return new(AdminWriteOutcome.Invalid, "workflowStatus");
        if (!Priorities.Contains(request.Priority)) return new(AdminWriteOutcome.Invalid, "priority");
        using var connection = Open();
        using var transaction = connection.BeginTransaction(deferred: false);
        if (request.AssigneeUserId is not null)
        {
            using var assignee = connection.CreateCommand();
            assignee.Transaction = transaction;
            assignee.CommandText = "SELECT COUNT(*) FROM users WHERE id = $id AND is_active = 1 AND role IN ('owner', 'admin');";
            assignee.Parameters.AddWithValue("$id", request.AssigneeUserId);
            if (Convert.ToInt32(assignee.ExecuteScalar()) == 0) return new(AdminWriteOutcome.Invalid, "assigneeUserId");
        }
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "UPDATE projects SET workflow_status = $workflow, priority = $priority, assignee_user_id = $assignee, workflow_updated_at = $now WHERE id = $id AND status = 'submitted' AND COALESCE(workflow_updated_at, updated_at) = $expectedWorkflowUpdatedAt;";
        command.Parameters.AddWithValue("$workflow", request.WorkflowStatus);
        command.Parameters.AddWithValue("$priority", request.Priority);
        command.Parameters.AddWithValue("$assignee", (object?)request.AssigneeUserId ?? DBNull.Value);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$expectedWorkflowUpdatedAt", request.ExpectedWorkflowUpdatedAt.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        if (command.ExecuteNonQuery() == 1)
        {
            transaction.Commit();
            return new(AdminWriteOutcome.Saved);
        }
        using var exists = connection.CreateCommand();
        exists.Transaction = transaction;
        exists.CommandText = "SELECT COUNT(*) FROM projects WHERE id = $id AND status = 'submitted';";
        exists.Parameters.AddWithValue("$id", id);
        return Convert.ToInt32(exists.ExecuteScalar()) == 1
            ? new(AdminWriteOutcome.Conflict, "workflowUpdatedAt")
            : new(AdminWriteOutcome.NotFound);
    }

    public AdminWriteResult AddNote(string projectId, string authorUserId, AddAdminNoteRequest? request, out AdminNoteDto? note)
    {
        note = null;
        var body = request?.Body.Trim();
        if (string.IsNullOrWhiteSpace(body) || body.Length > 4000) return new(AdminWriteOutcome.Invalid, "body");
        using var connection = Open();
        using var exists = connection.CreateCommand();
        exists.CommandText = "SELECT COUNT(*) FROM projects WHERE id = $id AND status = 'submitted';";
        exists.Parameters.AddWithValue("$id", projectId);
        if (Convert.ToInt32(exists.ExecuteScalar()) == 0) return new(AdminWriteOutcome.NotFound);
        var id = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO project_notes(id, project_id, author_user_id, body, created_at) VALUES ($id, $projectId, $authorId, $body, $createdAt);";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$projectId", projectId);
        command.Parameters.AddWithValue("$authorId", authorUserId);
        command.Parameters.AddWithValue("$body", body);
        command.Parameters.AddWithValue("$createdAt", now.ToString("O"));
        command.ExecuteNonQuery();
        using var touch = connection.CreateCommand();
        touch.CommandText = "UPDATE projects SET workflow_updated_at = $now WHERE id = $id;";
        touch.Parameters.AddWithValue("$now", now.ToString("O"));
        touch.Parameters.AddWithValue("$id", projectId);
        touch.ExecuteNonQuery();
        var author = GetUser(authorUserId)!;
        note = new(id, projectId, authorUserId, author.DisplayName, body, now);
        return new(AdminWriteOutcome.Saved);
    }

    private static AdminNoteDto[] ListNotes(SqliteConnection connection, string projectId)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT n.id, n.project_id, n.author_user_id, u.display_name, n.body, n.created_at
            FROM project_notes n
            JOIN users u ON u.id = n.author_user_id
            JOIN projects p ON p.id = n.project_id
            WHERE n.project_id = $projectId AND n.created_at >= p.updated_at
            ORDER BY n.created_at DESC;
            """;
        command.Parameters.AddWithValue("$projectId", projectId);
        using var reader = command.ExecuteReader();
        var notes = new List<AdminNoteDto>();
        while (reader.Read()) notes.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), DateTimeOffset.Parse(reader.GetString(5))));
        return [.. notes];
    }

    private static AdminProjectSummaryDto ReadProjectSummary(SqliteDataReader reader)
    {
        var project = JsonSerializer.Deserialize(reader.GetString(10), AppJsonContext.Default.ProjectInfoDto) ?? throw new InvalidDataException("Project JSON is invalid.");
        var book = JsonSerializer.Deserialize(reader.GetString(11), AppJsonContext.Default.BookInfoDto) ?? throw new InvalidDataException("Book JSON is invalid.");
        return new(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), project.ProjectName, project.ClientName, book.Title, book.AuthorName,
            book.SourceAssets?.FirstOrDefault(asset => asset.CategoryId == "book-cover")?.Url, reader.GetString(2), reader.GetString(3), reader.GetString(4),
            reader.GetString(5), reader.GetString(6), reader.GetString(7), reader.IsDBNull(8) ? null : reader.GetString(8), reader.IsDBNull(9) ? null : reader.GetString(9),
            DateTimeOffset.Parse(reader.GetString(12)), DateTimeOffset.Parse(reader.GetString(13)));
    }

    private static TaskDraftDto ReadDraft(SqliteDataReader reader)
    {
        var project = JsonSerializer.Deserialize(reader.GetString(4), AppJsonContext.Default.ProjectInfoDto) ?? throw new InvalidDataException("Project JSON is invalid.");
        var book = JsonSerializer.Deserialize(reader.GetString(5), AppJsonContext.Default.BookInfoDto) ?? throw new InvalidDataException("Book JSON is invalid.");
        var creative = JsonSerializer.Deserialize(reader.GetString(6), AppJsonContext.Default.CreativeInfoDto) ?? throw new InvalidDataException("Creative JSON is invalid.");
        creative = creative with
        {
            StyleReferenceImages = creative.StyleReferenceImages ?? [],
            Characters = creative.Characters.Select(character => character with { ReferenceImages = character.ReferenceImages ?? [] }).ToArray()
        };
        var voice = JsonSerializer.Deserialize(reader.GetString(7), AppJsonContext.Default.VoiceAndReferencesInfoDto) ?? throw new InvalidDataException("Voice JSON is invalid.");
        return new(reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1), reader.GetString(2), reader.GetInt32(3), project, book with { SourceAssets = book.SourceAssets ?? [] }, creative, voice, DateTimeOffset.Parse(reader.GetString(8)), DateTimeOffset.Parse(reader.GetString(9)));
    }

    private static int Count(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        return Convert.ToInt32(command.ExecuteScalar());
    }

    private static AdminCountDto[] GroupCounts(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        using var reader = command.ExecuteReader();
        var items = new List<AdminCountDto>();
        while (reader.Read()) items.Add(new(reader.GetString(0), reader.GetInt32(1)));
        return [.. items];
    }

    public PagedAdminOrganizationsDto ListOrganizations(string? search, int page, int pageSize)
    {
        using var connection = Open();
        const string where = "WHERE ($search = '' OR o.name LIKE '%' || $search || '%' COLLATE NOCASE)";
        using var count = connection.CreateCommand();
        count.CommandText = $"SELECT COUNT(*) FROM organizations o {where};";
        count.Parameters.AddWithValue("$search", search?.Trim() ?? "");
        var total = Convert.ToInt32(count.ExecuteScalar());
        using var command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT o.id, o.name, o.is_active, COUNT(u.id), o.created_at, o.updated_at
            FROM organizations o LEFT JOIN users u ON u.organization_id = o.id
            {where}
            GROUP BY o.id, o.name, o.is_active, o.created_at, o.updated_at
            ORDER BY o.name COLLATE NOCASE
            LIMIT $pageSize OFFSET $offset;
            """;
        command.Parameters.AddWithValue("$search", search?.Trim() ?? "");
        command.Parameters.AddWithValue("$pageSize", pageSize);
        command.Parameters.AddWithValue("$offset", (long)(page - 1) * pageSize);
        using var reader = command.ExecuteReader();
        var items = new List<AdminOrganizationDto>();
        while (reader.Read()) items.Add(ReadOrganization(reader));
        return new([.. items], page, pageSize, total);
    }

    public AdminWriteResult CreateOrganization(CreateOrganizationRequest? request, out AdminOrganizationDto? organization)
    {
        organization = null;
        var name = request?.Name?.Trim() ?? "";
        if (name.Length is < 2 or > 120) return new(AdminWriteOutcome.Invalid, "name");
        var id = Guid.NewGuid().ToString("N");
        var now = DateTimeOffset.UtcNow;
        try
        {
            using var connection = Open();
            using var command = connection.CreateCommand();
            command.CommandText = "INSERT INTO organizations(id, name, normalized_name, is_active, created_at, updated_at) VALUES ($id, $name, $normalizedName, 1, $now, $now);";
            command.Parameters.AddWithValue("$id", id);
            command.Parameters.AddWithValue("$name", name);
            command.Parameters.AddWithValue("$normalizedName", name.ToUpperInvariant());
            command.Parameters.AddWithValue("$now", now.ToString("O"));
            command.ExecuteNonQuery();
            organization = new(id, name, true, 0, now, now);
            return new(AdminWriteOutcome.Saved);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return new(AdminWriteOutcome.Conflict, "name");
        }
    }

    public AdminWriteResult UpdateOrganization(string id, UpdateOrganizationRequest? request, out AdminOrganizationDto? organization)
    {
        organization = null;
        var name = request?.Name?.Trim() ?? "";
        if (name.Length is < 2 or > 120) return new(AdminWriteOutcome.Invalid, "name");
        try
        {
            using var connection = Open();
            using var command = connection.CreateCommand();
            command.CommandText = "UPDATE organizations SET name = $name, normalized_name = $normalizedName, is_active = $active, updated_at = $now WHERE id = $id;";
            command.Parameters.AddWithValue("$name", name);
            command.Parameters.AddWithValue("$normalizedName", name.ToUpperInvariant());
            command.Parameters.AddWithValue("$active", request!.Active ? 1 : 0);
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            command.Parameters.AddWithValue("$id", id);
            if (command.ExecuteNonQuery() == 0) return new(AdminWriteOutcome.NotFound);
            organization = GetOrganization(connection, id);
            return new(AdminWriteOutcome.Saved);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return new(AdminWriteOutcome.Conflict, "name");
        }
    }
    private static AdminUserDto ReadUser(SqliteDataReader reader) => new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(4), reader.GetInt32(5) == 1, reader.IsDBNull(6) ? null : new OrganizationDto(reader.GetString(6), reader.GetString(7)), DateTimeOffset.Parse(reader.GetString(8)), DateTimeOffset.Parse(reader.GetString(9)), reader.IsDBNull(3) ? null : reader.GetString(3));
    private static AdminOrganizationDto ReadOrganization(SqliteDataReader reader) => new(reader.GetString(0), reader.GetString(1), reader.GetInt32(2) == 1, reader.GetInt32(3), DateTimeOffset.Parse(reader.GetString(4)), DateTimeOffset.Parse(reader.GetString(5)));
    private static AdminOrganizationDto? GetOrganization(SqliteConnection connection, string id) { using var command = connection.CreateCommand(); command.CommandText = "SELECT o.id, o.name, o.is_active, COUNT(u.id), o.created_at, o.updated_at FROM organizations o LEFT JOIN users u ON u.organization_id = o.id WHERE o.id = $id GROUP BY o.id, o.name, o.is_active, o.created_at, o.updated_at;"; command.Parameters.AddWithValue("$id", id); using var reader = command.ExecuteReader(); return reader.Read() ? ReadOrganization(reader) : null; }
    private static bool CanAssignOrganization(SqliteConnection connection, SqliteTransaction transaction, string? requestedId, string? currentId) { if (string.IsNullOrWhiteSpace(requestedId)) return true; var id = requestedId.Trim(); using var command = connection.CreateCommand(); command.Transaction = transaction; command.CommandText = "SELECT is_active FROM organizations WHERE id = $id;"; command.Parameters.AddWithValue("$id", id); var value = command.ExecuteScalar(); return value is not null && (Convert.ToInt32(value) == 1 || id == currentId); }
    private static string? NormalizePhone(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static object DbValue(string? value) => string.IsNullOrWhiteSpace(value) ? DBNull.Value : value.Trim();
    private static void AddUserFilters(SqliteCommand command, string? search, string? role) { command.Parameters.AddWithValue("$search", search?.Trim() ?? ""); command.Parameters.AddWithValue("$role", role?.Trim() ?? ""); }
    private static void AddProjectFilters(SqliteCommand command, string? workflow, string? priority, string? search) { command.Parameters.AddWithValue("$workflow", workflow?.Trim() ?? ""); command.Parameters.AddWithValue("$priority", priority?.Trim() ?? ""); command.Parameters.AddWithValue("$search", search?.Trim() ?? ""); }
    private static void Execute(SqliteConnection connection, string sql) { using var command = connection.CreateCommand(); command.CommandText = sql; command.ExecuteNonQuery(); }
    private static bool HasColumn(SqliteConnection connection, string table, string column) { using var command = connection.CreateCommand(); command.CommandText = $"PRAGMA table_info({table});"; using var reader = command.ExecuteReader(); while (reader.Read()) if (reader.GetString(1).Equals(column, StringComparison.Ordinal)) return true; return false; }
    private SqliteConnection Open() { var connection = new SqliteConnection(connectionString); connection.Open(); Execute(connection, "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); return connection; }
    private sealed record PasswordTarget(string Id);
}
