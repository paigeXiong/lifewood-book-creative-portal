using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Microsoft.Data.Sqlite;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class PersistenceIntegrationTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-platform-tests-" + Guid.NewGuid().ToString("N"));
    private string ConnectionString => "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";

    public PersistenceIntegrationTests() => Directory.CreateDirectory(root);

    [Fact]
    public void BookIntakeMigrationDisablesOldSourceTypesOnlyOnce()
    {
        var categories = new FileCategoryRepository(ConnectionString);
        categories.Initialize();
        var legacy = new UpsertFileCategoryRequest("旧分类", "Old category", null, null, ["application/pdf"], 1000000, 1, false, true, true, 3);
        Assert.Equal(FileCategoryWriteOutcome.Saved, categories.Upsert(FileCategoryScopes.Source,"key-chapters",legacy,out _).Outcome);
        Execute("DELETE FROM file_category_migrations WHERE id='basic-book-intake-v1';");
        Execute("UPDATE file_categories SET max_files=1 WHERE id='book-cover';");
        categories.Initialize();
        Assert.Null(categories.FindEnabled("key-chapters"));
        var cover=categories.ListAdmin(FileCategoryScopes.Source).Single(c=>c.Id=="book-cover");
        Assert.Equal(6,cover.MaxFiles);
        Execute("UPDATE file_categories SET max_files=4 WHERE id='book-cover';");
        categories.Initialize();
        Assert.Equal(4,categories.FindEnabled("book-cover")!.Category.MaxFiles);
        Assert.Equal(4,categories.ListAdmin(FileCategoryScopes.Source).Length); // Legacy metadata is retained.
    }

    [Fact]
    public void SubmissionAllowsOmittedHookSynopsisButRequiresBasicInformation()
    {
        var projects = new ProjectRepository(ConnectionString); projects.Initialize();
        var options = new FormOptionRepository(ConnectionString); options.Initialize();
        var categories = new FileCategoryRepository(ConnectionString); categories.Initialize();
        var draft=projects.Create("owner-id");
        var errors=SubmitValidator.Validate(draft,new HashSet<string>(),options,categories);
        foreach(var field in new[]{"book.sellingPoint","book.synopsis","book.sourceAssets.manuscript","project.projectName"})
            Assert.DoesNotContain(errors,e=>e.Field==field);
        Assert.Contains(errors,e=>e.Field=="book.sourceAssets.book-cover");
        Assert.Contains(errors,e=>e.Field=="book.title");
        Assert.Contains(errors,e=>e.Field=="project.videoGoalId");
        Assert.Contains(errors,e=>e.Field=="project.audienceIds");
    }

    [Fact]
    public void ExistingManuscriptCategoryBecomesOptional()
    {
        var categories = new FileCategoryRepository(ConnectionString);
        categories.Initialize();
        Execute("UPDATE file_categories SET required=1,label_zh_cn='全书或节选',label_en_us='Manuscript or excerpt' WHERE id='manuscript';");
        Execute("DELETE FROM file_category_migrations WHERE id='optional-manuscript-v1';");
        categories.Initialize();
        categories.Initialize();
        foreach (var locale in new[] { "zh-CN", "en-US" })
        {
            var source = categories.ForLocale(FileCategoryScopes.Source, locale);
            Assert.False(source.Single(item => item.Id == "manuscript").Required);
            Assert.True(source.Single(item => item.Id == "book-cover").Required);
        }
    }

    [Fact]
    public void PresetMigrationUpdatesOnlyDraftDefaultsAndRunsOnce()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var draft = projects.Create("owner-id", locale: "zh-CN");
        var first = draft.Creative.Characters[0] with { Name = "主角", AgeRangeId = null, GenderId = null };
        var custom = draft.Creative.Characters[1] with { Name = "自定义名字", AgeRangeId = "senior", GenderId = "neutral" };
        projects.SaveCreative("owner-id", draft.Id, new(draft.Version, draft.Creative with { Characters = [first, custom] }));
        var submitted = projects.Create("owner-id");
        projects.SaveCreative("owner-id", submitted.Id, new(submitted.Version, submitted.Creative with { Characters = [first] }));
        Execute("UPDATE projects SET status='submitted' WHERE id=$id;", ("$id", submitted.Id));
        Execute("DELETE FROM schema_migrations WHERE version=7;");

        projects.Initialize();
        var upgraded = projects.Get("owner-id", draft.Id)!;
        Assert.Equal(2, upgraded.Creative.Characters.Length);
        Assert.Equal("米拉", upgraded.Creative.Characters[0].Name);
        Assert.Equal("young-adult", upgraded.Creative.Characters[0].AgeRangeId);
        Assert.Equal("female", upgraded.Creative.Characters[0].GenderId);
        Assert.Equal(custom.Name, upgraded.Creative.Characters[1].Name);
        Assert.Equal("senior", upgraded.Creative.Characters[1].AgeRangeId);
        Assert.Equal("neutral", upgraded.Creative.Characters[1].GenderId);
        Assert.Equal("主角", projects.Get("owner-id", submitted.Id)!.Creative.Characters[0].Name);
        projects.SaveCreative("owner-id", draft.Id, new(upgraded.Version, upgraded.Creative with { Characters = [] }));
        projects.Initialize();
        Assert.Empty(projects.Get("owner-id", draft.Id)!.Creative.Characters);
    }

    [Fact]
    public void VisualStyleMediaPersistsAndRejectsUnsafeUrls()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        var current = options.ListAdmin(FormOptionGroups.VisualStyles).Single(item => item.Id == "cinematic");
        var request = new UpsertFormOptionRequest(current.LabelZhCn, current.LabelEnUs, null, null, null, null,
            true, 0, current.UpdatedAt, PreviewImageUrl: "/style-previews/poster.jpg", PreviewVideoUrl: "https://media.example.test/style.mp4");
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.VisualStyles, current.Id, request, out var saved).Outcome);
        options.Initialize();
        Assert.Equal(request.PreviewVideoUrl, options.ListAdmin(FormOptionGroups.VisualStyles).Single(item => item.Id == current.Id).PreviewVideoUrl);
        foreach (var locale in new[] { "zh-CN", "en-US" })
        {
            var style = options.ForLocale(locale).VisualStyles.Single(item => item.Id == current.Id);
            Assert.Equal(request.PreviewImageUrl, style.PreviewImageUrl);
            Assert.Equal(request.PreviewVideoUrl, style.PreviewVideoUrl);
        }
        foreach (var url in new[] { "javascript:alert(1)", "//example.test/video.mp4", "file:///tmp/video.mp4" })
            Assert.Equal(FormOptionWriteOutcome.Invalid, options.Upsert(FormOptionGroups.VisualStyles, current.Id,
                request with { ExpectedUpdatedAt = saved!.UpdatedAt, PreviewVideoUrl = url }, out _).Outcome);
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.VisualStyles, current.Id,
            request with { ExpectedUpdatedAt = saved!.UpdatedAt, PreviewVideoUrl = null }, out _).Outcome);
        Assert.Null(options.ForLocale("en-US").VisualStyles.Single(item => item.Id == current.Id).PreviewVideoUrl);
    }

    [Fact]
    public void SubmissionDefaultsBlankProjectNameToBookTitle()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var draft = projects.Create("owner-id");
        var saved = projects.Save("owner-id", draft.Id, new(draft.Version, draft.Project with { ProjectName=" " }, draft.Book with { Title="Book title" })).Draft!;
        var submitted = projects.Submit("owner-id", draft.Id, saved.Version, "name-fallback", null).Draft!;
        Assert.Equal("Book title", submitted.Project.ProjectName);
        Assert.Equal("Book title", projects.Get("owner-id", draft.Id)!.Project.ProjectName);
    }

    [Fact]
    public void DraftDeletionProtectsNewerAndSubmittedProjects()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        new UserRepository(ConnectionString, root).Initialize();
        new AdminRepository(ConnectionString).Initialize();
        var draft = projects.Create("owner-id");

        Assert.Equal(SaveOutcome.VersionConflict, projects.DeleteDraft("owner-id", draft.Id, draft.Version + 1).Outcome);
        Assert.NotNull(projects.Get("owner-id", draft.Id));
        Execute("UPDATE projects SET status = 'submitted' WHERE id = $id;", ("$id", draft.Id));
        Assert.Equal(SaveOutcome.NotEditable, projects.DeleteDraft("owner-id", draft.Id, draft.Version).Outcome);
        Assert.NotNull(projects.Get("owner-id", draft.Id));

        var removable = projects.Create("owner-id");
        Assert.Equal(SaveOutcome.Saved, projects.DeleteDraft("owner-id", removable.Id, removable.Version).Outcome);
        Assert.Null(projects.Get("owner-id", removable.Id));
    }

    [Fact]
    public async Task StorageQuotaCountsExistingDataAndSerializesReservations()
    {
        var quotaRoot = Path.Combine(root, "quota");
        Directory.CreateDirectory(quotaRoot);
        await File.WriteAllBytesAsync(Path.Combine(quotaRoot, "existing.bin"), new byte[8]);
        var quota = new StorageQuota(quotaRoot, new PlatformLimits(3, 10, 20));

        Assert.Null(await quota.TryReserveAsync(3, CancellationToken.None));
        await using var reservation = await quota.TryReserveAsync(2, CancellationToken.None);
        Assert.NotNull(reservation);
    }

    [Fact]
    public void DraftCountOnlyIncludesEditableDrafts()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var first = projects.Create("owner-id");
        projects.Create("owner-id");
        projects.Create("other-owner");
        Execute("UPDATE projects SET status = 'submitted' WHERE id = $id;", ("$id", first.Id));

        Assert.Equal(1, projects.CountDrafts("owner-id"));
    }

    [Fact]
    public void ProjectStatsAreScopedToOwnerAndUseWorkflowState()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        new UserRepository(ConnectionString, root).Initialize();
        new AdminRepository(ConnectionString).Initialize();
        projects.Create("owner-id");
        var active = projects.Create("owner-id");
        var completed = projects.Create("owner-id");
        projects.Create("other-owner");
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'in_production' WHERE id = $id;", ("$id", active.Id));
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'completed' WHERE id = $id;", ("$id", completed.Id));

        var stats = projects.GetStats("owner-id");

        Assert.Equal(3, stats.Total);
        Assert.Equal(1, stats.Drafts);
        Assert.Equal(1, stats.Active);
        Assert.Equal(1, stats.Completed);
    }

    [Fact]
    public void ProjectListSortsServerSideBeforePagination()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();

        TaskDraftDto Add(string title, string author, string updatedAt)
        {
            var draft = projects.Create("owner-id");
            var saved = projects.Save("owner-id", draft.Id, new SaveDraftRequest(
                draft.Version,
                draft.Project with { ProjectName = title + " campaign" },
                draft.Book with { Title = title, AuthorName = author }));
            Assert.Equal(SaveOutcome.Saved, saved.Outcome);
            Execute("UPDATE projects SET updated_at = $updatedAt WHERE id = $id;", ("$updatedAt", updatedAt), ("$id", draft.Id));
            return Assert.IsType<TaskDraftDto>(saved.Draft);
        }

        var beta = Add("Beta", "Alice", "2026-01-02T00:00:00+00:00");
        var alpha = Add("Alpha", "Charlie", "2026-01-03T00:00:00+00:00");
        var gamma = Add("Gamma", "Bob", "2026-01-01T00:00:00+00:00");
        var delta = Add("Delta", "Dora", "2026-01-04T00:00:00+00:00");
        var epsilon = Add("Epsilon", "Eve", "2026-01-05T00:00:00+00:00");
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'completed' WHERE id = $id;", ("$id", beta.Id));
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'contacting' WHERE id = $id;", ("$id", gamma.Id));
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'confirmed' WHERE id = $id;", ("$id", delta.Id));
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'awaiting_customer' WHERE id = $id;", ("$id", epsilon.Id));

        var firstProjectPage = projects.List("owner-id", null, null, 1, 2, "project", "asc");
        Assert.Equal([alpha.Id, beta.Id], firstProjectPage.Items.Select(item => item.Id).ToArray());
        var authorDescending = projects.List("owner-id", null, null, 1, 10, "author", "desc");
        Assert.Equal([epsilon.Id, delta.Id, alpha.Id, gamma.Id, beta.Id], authorDescending.Items.Select(item => item.Id).ToArray());
        var newestFirst = projects.List("owner-id", null, null, 1, 10, "updated", "desc");
        Assert.Equal([epsilon.Id, delta.Id, alpha.Id, beta.Id, gamma.Id], newestFirst.Items.Select(item => item.Id).ToArray());
        var workflowAscending = projects.List("owner-id", null, null, 1, 10, "status", "asc");
        Assert.Equal([alpha.Id, gamma.Id, delta.Id, epsilon.Id, beta.Id], workflowAscending.Items.Select(item => item.Id).ToArray());
    }

    [Fact]
    public void AdminOverviewAggregatesProjectsUsersWorkflowAndPriority()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<CurrentUserDto>(users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);
        var submitted = projects.Create(owner.Id);
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'contacting', priority = 'urgent' WHERE id = $id;", ("$id", submitted.Id));

        var overview = admin.GetOverview();

        Assert.Equal(1, overview.TotalProjects);
        Assert.Equal(1, overview.UnassignedProjects);
        Assert.Equal(1, overview.TotalUsers);
        Assert.Equal(1, overview.ActiveUsers);
        Assert.DoesNotContain(overview.SubmissionStatuses, item => item.Id == "draft");
        Assert.Equal(1, overview.SubmissionStatuses.Single(item => item.Id == "submitted").Count);
        Assert.Equal(1, overview.WorkflowStatuses.Single(item => item.Id == "contacting").Count);
        Assert.Equal(1, overview.Priorities.Single(item => item.Id == "urgent").Count);

        var listed = admin.ListProjects(null, null, null, 1, 20);
        Assert.Equal(1, listed.Total);
        Assert.Equal(submitted.Id, Assert.Single(listed.Items).Id);
        Assert.Null(admin.GetProject(draft.Id));
        Assert.Equal(AdminWriteOutcome.NotFound, admin.UpdateWorkflow(draft.Id, new("contacting", "normal", null, DateTimeOffset.UtcNow)).Outcome);
        Assert.Equal(AdminWriteOutcome.NotFound, admin.AddNote(draft.Id, owner.Id, new("Must not be added"), out _).Outcome);

        var workflow = Assert.IsType<AdminProjectDetailDto>(admin.GetProject(submitted.Id));
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateWorkflow(submitted.Id, new("confirmed", "high", owner.Id, workflow.WorkflowUpdatedAt)).Outcome);
        Assert.Equal(AdminWriteOutcome.Conflict, admin.UpdateWorkflow(submitted.Id, new("contacting", "normal", null, workflow.WorkflowUpdatedAt)).Outcome);

        Execute("CREATE TRIGGER fail_note_touch BEFORE UPDATE OF workflow_updated_at ON projects BEGIN SELECT RAISE(ABORT, 'simulated touch failure'); END;");
        Assert.Throws<SqliteException>(() => admin.AddNote(submitted.Id, owner.Id, new("Must roll back"), out _));
        Assert.Equal(0L, ScalarLong("SELECT COUNT(*) FROM project_notes WHERE project_id = $id;", ("$id", submitted.Id)));
        Execute("DROP TRIGGER fail_note_touch;");

        Assert.Equal(AdminWriteOutcome.Saved, admin.AddNote(submitted.Id, owner.Id, new("Atomic note"), out var note).Outcome);
        Assert.Equal("Atomic note", Assert.IsType<AdminNoteDto>(note).Body);
        var detailWithNote = Assert.IsType<AdminProjectDetailDto>(admin.GetProject(submitted.Id));
        Assert.Equal("Atomic note", Assert.Single(detailWithNote.Notes).Body);
    }

    [Fact]
    public void AuditEventsAreSearchableFilterableAndPagedWithoutSensitivePayloads()
    {
        var audit = new AuditRepository(ConnectionString, root);
        audit.Initialize();
        var actor = new CurrentUserDto("owner-1", null, "Owner Name", null, "owner@example.test", null, ["owner"], ["admin.access"], "en-US", null);
        audit.Record(actor, new AuditActionMatch("project.workflow_update", "project", "project-42"), "trace-project");
        audit.Record(actor, new AuditActionMatch("user.password_reset", "user", "customer-7"), "trace-user");

        var filtered = audit.List("project-42", "project.workflow_update", null, null, 1, 30);

        var item = Assert.Single(filtered.Items);
        Assert.Equal(1, filtered.Total);
        Assert.Equal("Owner Name", item.ActorName);
        Assert.Equal("project.workflow_update", item.ActionId);
        Assert.Equal("project-42", item.TargetId);
        Assert.Equal("trace-project", item.TraceId);
        Assert.DoesNotContain("password", string.Join('|', item.ActorName, item.ActorEmail, item.TargetId, item.TraceId), StringComparison.OrdinalIgnoreCase);
        Assert.Empty(audit.List(null, "missing.action", null, null, 1, 30).Items);
        var datedPage = audit.List(null, null, DateTimeOffset.UtcNow.AddDays(-1).ToString("O"), DateTimeOffset.UtcNow.AddDays(1).ToString("O"), 1, 1);
        Assert.Equal(2, datedPage.Total);
        Assert.Single(datedPage.Items);

        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var schema = connection.CreateCommand();
        schema.CommandText = "PRAGMA table_info(audit_events);";
        using var reader = schema.ExecuteReader();
        var columns = new List<string>();
        while (reader.Read()) columns.Add(reader.GetString(1));
        Assert.DoesNotContain(columns, column => column.Contains("password", StringComparison.OrdinalIgnoreCase) || column is "body" or "payload");
    }

    [Fact]
    public void SubmissionResetsLegacyDraftFollowUpWithoutDeletingHistoricalData()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<CurrentUserDto>(users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);

        Execute("UPDATE projects SET workflow_status = 'confirmed', priority = 'high', assignee_user_id = $owner, workflow_updated_at = '2000-01-01T00:00:00Z' WHERE id = $id;", ("$owner", owner.Id), ("$id", draft.Id));
        Execute("INSERT INTO project_notes(id, project_id, author_user_id, body, created_at) VALUES ('legacy-note', $id, $owner, 'Must remain stored but hidden', '2000-01-01T00:00:00Z');", ("$id", draft.Id), ("$owner", owner.Id));

        var snapshot = new SubmissionConfigurationSnapshotDto(
            1,
            DateTimeOffset.UtcNow,
            [new AdminFormOptionDto("brands", "brand-a", "品牌 A", "Brand A", null, null, null, null, false, true, 0, DateTimeOffset.UtcNow)],
            [],
            []);
        var submitted = projects.Submit(owner.Id, draft.Id, draft.Version, "submission-key", snapshot);

        Assert.Equal(SaveOutcome.Saved, submitted.Outcome);
        var storedSnapshot = Assert.IsType<SubmissionConfigurationSnapshotDto>(projects.GetSubmissionSnapshot(owner.Id, draft.Id));
        Assert.Equal("品牌 A", Assert.Single(storedSnapshot.FormOptions).LabelZhCn);
        Assert.Equal("Brand A", Assert.Single(storedSnapshot.FormOptions).LabelEnUs);
        Assert.Equal("Brand A", Assert.Single(Assert.IsType<SubmissionConfigurationSnapshotDto>(projects.GetSubmissionSnapshotForAdmin(draft.Id)).FormOptions).LabelEnUs);
        var replacementSnapshot = snapshot with
        {
            FormOptions = [snapshot.FormOptions[0] with { LabelZhCn = "被覆盖", LabelEnUs = "Overwritten" }]
        };
        var replay = projects.Submit(owner.Id, draft.Id, Assert.IsType<TaskDraftDto>(submitted.Draft).Version, "submission-key", replacementSnapshot);
        Assert.Equal(SaveOutcome.Saved, replay.Outcome);
        Assert.Equal("Brand A", Assert.Single(Assert.IsType<SubmissionConfigurationSnapshotDto>(projects.GetSubmissionSnapshot(owner.Id, draft.Id)).FormOptions).LabelEnUs);
        var detail = Assert.IsType<AdminProjectDetailDto>(admin.GetProject(draft.Id));
        Assert.Equal("new", detail.WorkflowStatus);
        Assert.Equal("normal", detail.Priority);
        Assert.Null(detail.AssigneeUserId);
        Assert.Empty(detail.Notes);
        Assert.Equal(1L, ScalarLong("SELECT COUNT(*) FROM project_notes WHERE project_id = $id;", ("$id", draft.Id)));
        Assert.True(DateTimeOffset.Parse(Assert.IsType<string>(Scalar("SELECT workflow_updated_at FROM projects WHERE id = $id;", ("$id", draft.Id)))).Year > 2000);

        Execute("UPDATE projects SET workflow_status = 'contacting', priority = 'urgent', assignee_user_id = $owner, workflow_updated_at = '2000-01-01T00:00:00.0000000+00:00' WHERE id = $id;", ("$owner", owner.Id), ("$id", draft.Id));
        admin.Initialize();
        var migrated = Assert.IsType<AdminProjectDetailDto>(admin.GetProject(draft.Id));
        Assert.Equal("new", migrated.WorkflowStatus);
        Assert.Equal("normal", migrated.Priority);
        Assert.Null(migrated.AssigneeUserId);
    }

    [Fact]
    public void OrganizationsPersistUserAssignmentsWithoutExpandingProjectVisibility()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<CurrentUserDto>(users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);

        Assert.Equal(AdminWriteOutcome.Saved, admin.CreateOrganization(new("Lifewood Books"), out var organizationResult).Outcome);
        var organization = Assert.IsType<AdminOrganizationDto>(organizationResult);
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateUser(owner.Id, new("Owner", "owner", true, organization.Id, "+86 138 0000 0000"), out var updatedOwner).Outcome);
        Assert.Equal(organization.Id, Assert.IsType<AdminUserDto>(updatedOwner).Organization?.Id);
        Assert.Equal("+86 138 0000 0000", updatedOwner.Phone);

        Assert.Equal(AdminWriteOutcome.Saved, admin.CreateUser(new("Reader", "reader@example.test", "customer-password-123", "customer", organization.Id, "+1 555 0100"), out var createdUser).Outcome);
        var customer = Assert.IsType<AdminUserDto>(createdUser);
        Assert.Equal("Lifewood Books", customer.Organization?.Name);
        Assert.Equal("Lifewood Books", users.Authenticate("reader@example.test", "customer-password-123").User?.Organization?.Name);
        Assert.Equal("+1 555 0100", users.Authenticate("reader@example.test", "customer-password-123").User?.Phone);
        Assert.Equal(2, Assert.Single(admin.ListOrganizations("Lifewood", 1, 20).Items).MemberCount);
        Assert.Equal(customer.Id, Assert.Single(admin.ListUsers("Lifewood Books", null, 1, 20).Items, item => item.Role == "customer").Id);

        Assert.Equal(0, users.GetSessionVersion(customer.Id));
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateUser(customer.Id, new("Reader", "customer", false, organization.Id), out _).Outcome);
        Assert.Equal(1L, ScalarLong("SELECT session_version FROM users WHERE id = $id;", ("$id", customer.Id)));
        Assert.Null(users.GetSessionVersion(customer.Id));
        Assert.Null(users.Get(customer.Id, 0));
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateUser(customer.Id, new("Reader", "customer", true, organization.Id), out _).Outcome);
        Assert.Equal(1, users.GetSessionVersion(customer.Id));
        Assert.Null(users.Get(customer.Id, 0));
        Assert.NotNull(users.Get(customer.Id, 1));

        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateOrganization(organization.Id, new("Lifewood Publishing", false), out _).Outcome);
        Assert.Equal("Lifewood Publishing", users.Get(customer.Id)?.Organization?.Name);
        Assert.Equal(AdminWriteOutcome.Invalid, admin.CreateUser(new("Other", "other@example.test", "customer-password-123", "customer", organization.Id), out _).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved, admin.UpdateUser(customer.Id, new("Reader", "customer", true, organization.Id), out _).Outcome);

        var customerProject = projects.Create(customer.Id);
        Assert.Null(projects.Get(owner.Id, customerProject.Id));
    }

    [Fact]
    public void OrganizationMigrationAddsIntegrityGuardsToLegacyUserTables()
    {
        using (var connection = new SqliteConnection(ConnectionString))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL,
                    normalized_email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    failed_attempts INTEGER NOT NULL DEFAULT 0,
                    locked_until TEXT NULL,
                    session_version INTEGER NOT NULL DEFAULT 0,
                    avatar_file_name TEXT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO users(id, email, normalized_email, display_name, password_hash, role, created_at, updated_at)
                VALUES ('legacy-user', 'legacy@example.test', 'LEGACY@EXAMPLE.TEST', 'Legacy', 'hash', 'customer', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
                """;
            command.ExecuteNonQuery();
        }

        new UserRepository(ConnectionString, root).Initialize();

        Assert.True(HasColumn("users", "organization_id"));
        Assert.True(HasColumn("users", "phone"));
        Assert.Equal(3L, ScalarLong("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_%organization%';"));
        Execute("INSERT INTO organizations(id, name, normalized_name, is_active, created_at, updated_at) VALUES ('org-legacy', 'Legacy Org', 'LEGACY ORG', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');");
        Execute("UPDATE users SET organization_id = 'org-legacy' WHERE id = 'legacy-user';");
        Assert.Throws<SqliteException>(() => Execute("UPDATE users SET organization_id = 'missing-org' WHERE id = 'legacy-user';"));
        Assert.Equal("org-legacy", Scalar("SELECT organization_id FROM users WHERE id = 'legacy-user';"));

        Execute("DELETE FROM organizations WHERE id = 'org-legacy';");
        Assert.Null(Scalar("SELECT organization_id FROM users WHERE id = 'legacy-user';"));
    }

    [Theory]
    [InlineData("POST", "/api/admin/users", "user.create", "user", null)]
    [InlineData("PUT", "/api/admin/users/user-1", "user.update", "user", "user-1")]
    [InlineData("PUT", "/api/admin/users/user-1/password", "user.password_reset", "user", "user-1")]
    [InlineData("POST", "/api/admin/organizations", "organization.create", "organization", null)]
    [InlineData("PUT", "/api/admin/organizations/org-1", "organization.update", "organization", "org-1")]
    [InlineData("PUT", "/api/admin/projects/project-1/workflow", "project.workflow_update", "project", "project-1")]
    [InlineData("POST", "/api/admin/projects/project-1/notes", "project.note_add", "project", "project-1")]
    [InlineData("POST", "/api/admin/projects/project-1/deliveries", "delivery.publish", "delivery", null)]
    [InlineData("DELETE", "/api/admin/projects/project-1/deliveries/delivery-1", "delivery.revoke", "delivery", "delivery-1")]
    [InlineData("PUT", "/api/admin/file-categories/source/cover", "file_category.upsert", "file_category", "source/cover")]
    [InlineData("PUT", "/api/admin/form-options/genres/memoir", "form_option.upsert", "form_option", "genres/memoir")]
    [InlineData("PUT", "/api/admin/voices/voice-1", "voice.upsert", "voice", "voice-1")]
    [InlineData("POST", "/api/admin/voices/voice-1/sample", "voice.sample_upload", "voice", "voice-1")]
    [InlineData("DELETE", "/api/admin/voices/voice-1/sample", "voice.sample_remove", "voice", "voice-1")]
    public void AuditActionMappingCoversAdministratorWriteRoutes(string method, string path, string actionId, string targetType, string? targetId)
    {
        var action = Assert.IsType<AuditActionMatch>(AuditActionCatalog.Resolve(method, path));
        Assert.Equal(actionId, action.ActionId);
        Assert.Equal(targetType, action.TargetType);
        Assert.Equal(targetId, action.TargetId);
    }

    [Fact]
    public void AuditEventsUseDurablePendingQueueWhenDatabaseIsBusy()
    {
        var audit = new AuditRepository(ConnectionString, root);
        audit.Initialize();
        var actor = new CurrentUserDto("owner-1", null, "Owner", null, "owner@example.test", null, ["owner"], ["admin.access"], "en-US", null);
        using var blocker = new SqliteConnection(ConnectionString);
        blocker.Open();
        using var lockCommand = blocker.CreateCommand();
        lockCommand.CommandText = "BEGIN EXCLUSIVE;";
        lockCommand.ExecuteNonQuery();

        audit.Record(actor, new AuditActionMatch("user.update", "user", "user-1"), "trace-pending");
        Assert.True(File.Exists(Path.Combine(root, "audit-pending.ndjson")));

        lockCommand.CommandText = "COMMIT;";
        lockCommand.ExecuteNonQuery();
        var replayed = audit.List("trace-pending", null, null, null, 1, 30);
        Assert.Single(replayed.Items);
        Assert.False(File.Exists(Path.Combine(root, "audit-pending.ndjson")));
    }

    [Fact]
    public void UserMigrationAndPasswordUpdatesRevokeOldSessionVersions()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();

        Execute("ALTER TABLE users DROP COLUMN session_version;");
        Execute("ALTER TABLE users DROP COLUMN is_active;");
        Execute("ALTER TABLE users DROP COLUMN locale;");
        Execute("ALTER TABLE users DROP COLUMN client_name;");
        users.Initialize();
        Assert.True(HasColumn("users", "session_version"));
        Assert.True(HasColumn("users", "is_active"));
        Assert.True(HasColumn("users", "locale"));
        Assert.True(HasColumn("users", "client_name"));

        var created = users.CreateOwner("Owner", "owner@example.test", "initial-password-123");
        Assert.Equal(AccountCreateOutcome.Created, created.Outcome);
        var user = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(created.User);
        Assert.Equal(0, users.GetSessionVersion(user.Id));

        var changed = users.ChangePassword(user.Id, "initial-password-123", "updated-password-456");
        Assert.Equal(PasswordUpdateOutcome.Updated, changed.Outcome);
        Assert.Null(users.Get(user.Id, 0));
        Assert.NotNull(users.Get(user.Id, 1));

        var reset = users.ResetPassword(user.Id, "reset-password-789");
        Assert.Equal(PasswordUpdateOutcome.Updated, reset.Outcome);
        Assert.Null(users.Get(user.Id, 1));
        Assert.NotNull(users.Get(user.Id, 2));
    }

    [Fact]
    public void PasswordsRequireEightToOneHundredTwentyEightCharacters()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();

        var tooShort = users.CreateOwner("Short Password", "short@example.test", "1234567");
        Assert.Equal(AccountCreateOutcome.Invalid, tooShort.Outcome);
        Assert.Equal("password", tooShort.Field);

        var created = users.CreateOwner("Eight Characters", "eight@example.test", "12345678");
        Assert.Equal(AccountCreateOutcome.Created, created.Outcome);
        var user = Assert.IsType<CurrentUserDto>(created.User);

        Assert.Equal(PasswordUpdateOutcome.Invalid, users.ChangePassword(user.Id, "12345678", "7654321").Outcome);
        Assert.Equal(PasswordUpdateOutcome.Updated, users.ChangePassword(user.Id, "12345678", "abcdefgh").Outcome);
        Assert.Equal(PasswordUpdateOutcome.Invalid, users.ResetPassword(user.Id, "7654321").Outcome);
        Assert.Equal(PasswordUpdateOutcome.Updated, users.ResetPassword(user.Id, "87654321").Outcome);
    }

    [Fact]
    public void OwnerProfilePersistsContactAndOrganizationForNewDraftDefaults()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();

        var created = users.CreateOwner("Owner Name", "owner@example.test", "initial-password-123", " 123 456 ", " Deseret Book ", "en-US");
        var owner = Assert.IsType<CurrentUserDto>(created.User);
        Assert.Equal("123 456", owner.Phone);
        Assert.Equal("Deseret Book", owner.Organization?.Name);
        Assert.Equal("Deseret Book", owner.ClientName);
        Assert.Equal("en-US", owner.Locale);

        var preference = users.UpdatePreferences(owner.Id, "zh-CN");
        Assert.Equal(ProfileUpdateOutcome.Updated, preference.Outcome);
        Assert.Equal("zh-CN", preference.User?.Locale);
        Assert.Equal("zh-CN", users.Get(owner.Id)?.Locale);
        Assert.Equal(ProfileUpdateOutcome.Invalid, users.UpdatePreferences(owner.Id, "fr-FR").Outcome);

        var updated = users.UpdateProfile(owner.Id, " Updated Owner ", " 987 654 ", " Updated Client ");
        Assert.Equal(ProfileUpdateOutcome.Updated, updated.Outcome);
        var current = Assert.IsType<CurrentUserDto>(updated.User);
        Assert.Equal("Updated Owner", current.DisplayName);
        Assert.Equal("987 654", current.Phone);
        Assert.Equal("Updated Client", current.ClientName);
        Assert.Equal("Deseret Book", current.Organization?.Name);

        var draft = projects.Create(current.Id, current.ClientName ?? current.Organization?.Name ?? current.DisplayName, current.DisplayName, current.Email ?? "", current.Phone);
        Assert.Equal("Updated Client", draft.Project.ClientName);
        Assert.Equal("Updated Owner", draft.Project.ContactName);
        Assert.Equal("owner@example.test", draft.Project.Email);
        Assert.Equal("987 654", draft.Project.Phone);
    }

    [Fact]
    public void SubmissionSnapshotMigrationUpgradesExistingProjectDatabaseTransactionally()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        Execute("ALTER TABLE projects DROP COLUMN submission_snapshot_json;");
        Execute("DELETE FROM schema_migrations WHERE version = 5;");

        projects.Initialize();

        Assert.True(HasColumn("projects", "submission_snapshot_json"));
        Assert.Equal(1L, ScalarLong("SELECT COUNT(*) FROM schema_migrations WHERE version = 5;"));
    }

    [Fact]
    public void AvatarInitializationCleansOrphansAndRemovalWorksDuringAnActiveRead()
    {
        new ProjectRepository(ConnectionString).Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        new AdminRepository(ConnectionString).Initialize();
        var owner = Assert.IsType<CurrentUserDto>(users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var avatarDirectory = Path.Combine(root, "avatars");
        Directory.CreateDirectory(avatarDirectory);
        var currentFile = $"{owner.Id}-current.png";
        File.WriteAllBytes(Path.Combine(avatarDirectory, currentFile), [1, 2, 3]);
        File.WriteAllBytes(Path.Combine(avatarDirectory, "orphan.png"), [4]);
        File.WriteAllBytes(Path.Combine(avatarDirectory, "interrupted.png.uploading"), [5]);
        File.WriteAllBytes(Path.Combine(avatarDirectory, "unmanaged.txt"), [6]);
        Execute("UPDATE users SET avatar_file_name = $fileName WHERE id = $id;", ("$fileName", currentFile), ("$id", owner.Id));

        users.Initialize();

        Assert.True(File.Exists(Path.Combine(avatarDirectory, currentFile)));
        Assert.False(File.Exists(Path.Combine(avatarDirectory, "orphan.png")));
        Assert.False(File.Exists(Path.Combine(avatarDirectory, "interrupted.png.uploading")));
        Assert.True(File.Exists(Path.Combine(avatarDirectory, "unmanaged.txt")));
        using var activeRead = Assert.IsType<StoredAvatar>(users.OpenAvatar(owner.Id)).Stream;
        var restored = Assert.IsType<CurrentUserDto>(users.RemoveAvatar(owner.Id));
        Assert.False(restored.HasCustomAvatar);
        Assert.False(File.Exists(Path.Combine(avatarDirectory, currentFile)));
    }

    [Fact]
    public async Task AsyncKeyedLockReleasesUnusedKeys()
    {
        var keyedLock = new AsyncKeyedLock();
        var first = await keyedLock.AcquireAsync("shared-project", CancellationToken.None);
        var waiting = keyedLock.AcquireAsync("shared-project", CancellationToken.None).AsTask();
        await Task.Yield();
        Assert.False(waiting.IsCompleted);

        var independent = await keyedLock.AcquireAsync("other-project", CancellationToken.None).AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await independent.DisposeAsync();

        using (var cancellation = new CancellationTokenSource())
        {
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => keyedLock.AcquireAsync("shared-project", cancellation.Token).AsTask());
        }
        Assert.Equal(1, keyedLock.Count);

        await first.DisposeAsync();
        var second = await waiting.WaitAsync(TimeSpan.FromSeconds(1));
        await second.DisposeAsync();
        await second.DisposeAsync();
        Assert.Equal(0, keyedLock.Count);

        for (var index = 0; index < 100; index++)
        {
            await using var lease = await keyedLock.AcquireAsync($"project-{index}", CancellationToken.None);
        }
        Assert.Equal(0, keyedLock.Count);
    }

    [Fact]
    public void RevokedDeliveryCleanupDeletesOnlyTheTargetPhysicalFile()
    {
        var folder = Path.Combine(root, "deliveries", "project-1");
        Directory.CreateDirectory(folder);
        var revoked = Path.Combine(folder, "delivery-1_final.mp4");
        var retained = Path.Combine(folder, "delivery-2_final.mp4");
        File.WriteAllBytes(revoked, [1, 2, 3]);
        File.WriteAllBytes(retained, [4, 5, 6]);

        DeliveryEndpoints.DeleteDeliveryFiles(root, "project-1", "delivery-1", Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance);

        Assert.False(File.Exists(revoked));
        Assert.True(File.Exists(retained));
    }

    [Fact]
    public void RevokingLastDeliveryHidesFileAndRestoresProductionWorkflow()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(
            users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'in_production' WHERE id = $id;", ("$id", draft.Id));

        var deliveries = new DeliveryRepository(ConnectionString);
        deliveries.Initialize();
        Execute("DROP INDEX ux_project_deliveries_one_active;");
        Execute("ALTER TABLE project_deliveries DROP COLUMN revoked_at;");
        deliveries.Initialize();
        Assert.True(HasColumn("project_deliveries", "revoked_at"));

        var publish = deliveries.Publish("delivery-1", draft.Id, owner.Id, "final.mp4", "video/mp4", 42, "Ready", out var delivery);
        Assert.Equal(AdminWriteOutcome.Saved, publish.Outcome);
        Assert.NotNull(delivery);
        Assert.Equal("completed", Scalar("SELECT workflow_status FROM projects WHERE id = $id;", ("$id", draft.Id)));
        Assert.Single(deliveries.List(draft.Id));

        var revoke = deliveries.Revoke(draft.Id, "delivery-1");
        Assert.Equal(AdminWriteOutcome.Saved, revoke.Outcome);
        Assert.Empty(deliveries.List(draft.Id));
        Assert.Null(deliveries.Find(draft.Id, "delivery-1"));
        Assert.NotNull(Assert.Single(deliveries.ListForAdmin(draft.Id)).RevokedAt);
        Assert.Equal("in_production", Scalar("SELECT workflow_status FROM projects WHERE id = $id;", ("$id", draft.Id)));
    }

    [Fact]
    public async Task FinalDeliveryAllowsOnlyOneActiveRecordAcrossSequentialAndConcurrentPublishes()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(
            users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);
        Execute("UPDATE projects SET status = 'submitted', workflow_status = 'in_production' WHERE id = $id;", ("$id", draft.Id));
        var deliveries = new DeliveryRepository(ConnectionString);
        deliveries.Initialize();

        using var gate = new ManualResetEventSlim(false);
        var attempts = Enumerable.Range(1, 2).Select(index => Task.Run(() =>
        {
            gate.Wait();
            return new DeliveryRepository(ConnectionString).Publish(
                $"delivery-{index}", draft.Id, owner.Id, $"final-{index}.mp4", "video/mp4", 42, null, out _).Outcome;
        })).ToArray();
        gate.Set();
        var outcomes = await Task.WhenAll(attempts);

        Assert.Single(outcomes, outcome => outcome == AdminWriteOutcome.Saved);
        Assert.Single(outcomes, outcome => outcome == AdminWriteOutcome.Conflict);
        var active = Assert.Single(deliveries.List(draft.Id));
        var sequential = deliveries.Publish("delivery-3", draft.Id, owner.Id, "final-3.mp4", "video/mp4", 42, null, out _);
        Assert.Equal(AdminWriteOutcome.Conflict, sequential.Outcome);
        Assert.Equal("activeDelivery", sequential.Field);
        Assert.Equal(AdminWriteOutcome.Saved, deliveries.Revoke(draft.Id, active.Id).Outcome);
        Assert.Equal(AdminWriteOutcome.Saved, deliveries.Publish("delivery-4", draft.Id, owner.Id, "final-4.mp4", "video/mp4", 42, null, out _).Outcome);
        Assert.Equal("delivery-4", Assert.Single(deliveries.List(draft.Id)).Id);
    }

    [Fact]
    public void FinalDeliveryInitializationMigratesLegacyDuplicateActiveRecords()
    {
        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var users = new UserRepository(ConnectionString, root);
        users.Initialize();
        var admin = new AdminRepository(ConnectionString);
        admin.Initialize();
        var owner = Assert.IsType<Lifewood.PlatformApi.Contracts.CurrentUserDto>(
            users.CreateOwner("Owner", "owner@example.test", "initial-password-123").User);
        var draft = projects.Create(owner.Id);
        Execute("UPDATE projects SET status = 'submitted' WHERE id = $id;", ("$id", draft.Id));
        var deliveries = new DeliveryRepository(ConnectionString);
        deliveries.Initialize();
        Execute("DROP INDEX ux_project_deliveries_one_active;");
        Execute("INSERT INTO project_deliveries(id, project_id, uploader_user_id, file_name, content_type, size_bytes, published_at) VALUES ('legacy-old', $projectId, $userId, 'old.mp4', 'video/mp4', 1, '2026-01-01T00:00:00+00:00');", ("$projectId", draft.Id), ("$userId", owner.Id));
        Execute("INSERT INTO project_deliveries(id, project_id, uploader_user_id, file_name, content_type, size_bytes, published_at) VALUES ('legacy-new', $projectId, $userId, 'new.mp4', 'video/mp4', 1, '2026-01-02T00:00:00+00:00');", ("$projectId", draft.Id), ("$userId", owner.Id));

        deliveries.Initialize();

        Assert.Equal("legacy-new", Assert.Single(deliveries.List(draft.Id)).Id);
        var history = deliveries.ListForAdmin(draft.Id);
        Assert.Equal(2, history.Length);
        Assert.NotNull(history.Single(item => item.Id == "legacy-old").RevokedAt);
        Assert.Null(history.Single(item => item.Id == "legacy-new").RevokedAt);
    }

    [Fact]
    public void VoiceReferencesPersistBilingualContentAndRespectEnabledState()
    {
        var voices = new VoiceReferenceRepository(ConnectionString);
        voices.Initialize();
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        Assert.Equal(4, voices.ListAdmin().Length);
        Execute("DELETE FROM voice_references WHERE id = 'grounded-narrator';");
        Execute("UPDATE voice_references SET name_en_us = 'Edited by admin' WHERE id = 'warm-storyteller';");
        voices.Initialize();
        Assert.Equal(4, voices.ListAdmin().Length);
        Assert.Equal("Edited by admin", voices.ListAdmin().Single(value => value.Id == "warm-storyteller").NameEnUs);


        var request = new UpsertVoiceReferenceRequest(
            "测试音色",
            "Test voice",
            "中文描述",
            "English description",
            ["warm", "clear"],
            true,
            true,
            5,
            null);
        var saved = voices.Upsert("test-voice", request, options.EnabledIds(FormOptionGroups.VoiceTags), out var item);
        Assert.Equal(VoiceWriteOutcome.Saved, saved.Outcome);
        Assert.NotNull(item);
        Assert.Equal("测试音色", voices.ForLocale("zh-CN").Single(value => value.Id == "test-voice").Name);
        Assert.Equal("Test voice", voices.ForLocale("en-US").Single(value => value.Id == "test-voice").Name);
        Assert.Contains("test-voice", voices.EnabledIds());

        var disabled = voices.Upsert("test-voice", request with { Enabled = false, ExpectedUpdatedAt = item!.UpdatedAt }, options.EnabledIds(FormOptionGroups.VoiceTags), out _);
        Assert.Equal(VoiceWriteOutcome.Saved, disabled.Outcome);
        Assert.DoesNotContain(voices.ForLocale("zh-CN"), value => value.Id == "test-voice");
        Assert.DoesNotContain("test-voice", voices.EnabledIds());

        Assert.True(voices.SetAudioAvailable("test-voice", true, out var withAudio));
        Assert.Equal("/api/voices/test-voice/sample", withAudio!.AudioUrl);
        voices.ReconcileAudioAvailability(_ => false);
        Assert.Null(voices.ListAdmin().Single(value => value.Id == "test-voice").AudioUrl);

        Execute("UPDATE form_options SET enabled = 0 WHERE group_id = $group AND id = $id;", ("$group", FormOptionGroups.VoiceTags), ("$id", "clear"));
        var currentVoice = voices.ListAdmin().Single(value => value.Id == "test-voice");
        var retainedLegacyTag = voices.Upsert("test-voice", request with { ExpectedUpdatedAt = currentVoice.UpdatedAt }, options.EnabledIds(FormOptionGroups.VoiceTags), out _);
        Assert.Equal(VoiceWriteOutcome.Saved, retainedLegacyTag.Outcome);
        var staleVoice = voices.Upsert("test-voice", request with { ExpectedUpdatedAt = currentVoice.UpdatedAt }, options.EnabledIds(FormOptionGroups.VoiceTags), out _);
        Assert.Equal(VoiceWriteOutcome.Conflict, staleVoice.Outcome);
        var rejectedDisabledTag = voices.Upsert("new-voice", request, options.EnabledIds(FormOptionGroups.VoiceTags), out _);
        Assert.Equal(VoiceWriteOutcome.Invalid, rejectedDisabledTag.Outcome);
        Assert.Equal("tagIds", rejectedDisabledTag.Field);
    }

    [Fact]
    public void ContentLanguageOptionsUseAutonymsAndOnlyMigrateLegacyDefaults()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();

        Assert.Equal("English (United States)", options.ForLocale("zh-CN").ContentLanguages.Single(value => value.Id == "en-US").Label);
        Assert.Equal("English (United Kingdom)", options.ForLocale("en-US").ContentLanguages.Single(value => value.Id == "en-GB").Label);
        Assert.Equal("简体中文", options.ForLocale("en-US").ContentLanguages.Single(value => value.Id == "zh-CN").Label);
        Assert.Equal("Español (Latinoamérica)", options.ForLocale("zh-CN").ContentLanguages.Single(value => value.Id == "es-419").Label);
        Assert.Equal("日本語", options.ForLocale("en-US").ContentLanguages.Single(value => value.Id == "ja-JP").Label);
        Assert.Equal("العربية", options.ForLocale("zh-CN").ContentLanguages.Single(value => value.Id == "ar").Label);
        Assert.Equal(16, options.ForLocale("zh-CN").ContentLanguages.Length);

        // Simulate a database that has not applied the one-time language migration.
        Execute("DELETE FROM form_option_catalog_migrations WHERE id = 'content-language-autonyms-v1';");
        Execute("UPDATE form_options SET label_zh_cn = '英语（美国）', label_en_us = 'English (US)' WHERE group_id = $group AND id = 'en-US';", ("$group", FormOptionGroups.ContentLanguages));
        Execute("UPDATE form_options SET label_zh_cn = '客户自定义英语', label_en_us = 'English (UK)' WHERE group_id = $group AND id = 'en-GB';", ("$group", FormOptionGroups.ContentLanguages));

        options.Initialize();

        var migrated = options.ListAdmin(FormOptionGroups.ContentLanguages).Single(value => value.Id == "en-US");
        Assert.Equal("English (United States)", migrated.LabelZhCn);
        Assert.Equal("English (United States)", migrated.LabelEnUs);
        var customized = options.ListAdmin(FormOptionGroups.ContentLanguages).Single(value => value.Id == "en-GB");
        Assert.Equal("客户自定义英语", customized.LabelZhCn);
        Assert.Equal("English (UK)", customized.LabelEnUs);
    }

    [Fact]
    public void ProjectFormDefaultsCoverCommonBookCampaignScenarios()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();

        var zhCn = options.ForLocale("zh-CN");
        var enUs = options.ForLocale("en-US");
        Assert.Equal(7, zhCn.VideoGoals.Length);
        Assert.Equal(8, zhCn.Audiences.Length);
        Assert.Equal(12, zhCn.Genres.Length);
        Assert.Equal(7, zhCn.VideoDurations.Length);
        Assert.Equal(10, zhCn.PublishingPlatforms.Length);
        Assert.DoesNotContain(zhCn.PublishingPlatforms, value => value.Id == "tiktok");
        Assert.Contains(zhCn.VideoGoals, value => value.Id == "brand-awareness" && value.Label == "品牌认知");
        Assert.Contains(enUs.Audiences, value => value.Id == "adults" && value.Label == "Adults");
        Assert.Contains(zhCn.Genres, value => value.Id == "biography-memoir" && value.Label == "传记与回忆录");
        Assert.Contains(enUs.Genres, value => value.Id == "comics-graphic-novels" && value.Label == "Comics and graphic novels");
        Assert.DoesNotContain(zhCn.VideoGoals, value => value.Id == "book-trailer");
        Assert.DoesNotContain(zhCn.Audiences, value => value.Id == "book-clubs");
        Assert.DoesNotContain(zhCn.Genres, value => value.Id == "fantasy");
        Assert.Equal(["brand-awareness", "launch-promotion", "audience-engagement", "sales-conversion", "knowledge-communication", "event-support", "internal-communication"], zhCn.VideoGoals.Select(value => value.Id).ToArray());
        Assert.Equal(["children", "young-adults", "adults", "families", "educators", "professionals", "seniors", "general"], zhCn.Audiences.Select(value => value.Id).ToArray());
        Assert.Equal("fiction", zhCn.Genres[0].Id);
        Assert.Equal("comics-graphic-novels", zhCn.Genres[^1].Id);
        Assert.Contains(enUs.PublishingPlatforms, value => value.Id == "email-newsletter" && value.Label == "Email newsletter");
        Assert.True(zhCn.VideoDurations.Single(value => value.Id == "custom").AllowsCustomValue);

        var legacyRequest = new UpsertFormOptionRequest(
            "图书预告片", "Book trailer", null, null, null, null, true, 500);
        Assert.Equal(FormOptionWriteOutcome.Saved,
            options.Upsert(FormOptionGroups.VideoGoals, "book-trailer", legacyRequest, out _).Outcome);
        Execute("DELETE FROM form_option_catalog_migrations WHERE id = 'broad-project-taxonomy-v1';");
        options.Initialize();
        Assert.DoesNotContain(options.ForLocale("zh-CN").VideoGoals, value => value.Id == "book-trailer");

        var disabledLegacy = options.ListAdmin(FormOptionGroups.VideoGoals).Single(value => value.Id == "book-trailer");
        var reenableRequest = new UpsertFormOptionRequest(
            disabledLegacy.LabelZhCn, disabledLegacy.LabelEnUs,
            disabledLegacy.DescriptionZhCn, disabledLegacy.DescriptionEnUs,
            disabledLegacy.Tone, disabledLegacy.PreviewColor, true, disabledLegacy.SortOrder,
            disabledLegacy.UpdatedAt, disabledLegacy.AllowsCustomValue);
        Assert.Equal(FormOptionWriteOutcome.Saved,
            options.Upsert(FormOptionGroups.VideoGoals, disabledLegacy.Id, reenableRequest, out _).Outcome);
        options.Initialize();
        Assert.Contains(options.ForLocale("zh-CN").VideoGoals, value => value.Id == "book-trailer");
    }

    [Fact]
    public void ExistingPublishingCatalogRetiresTikTokInBothLocales()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(
            FormOptionGroups.PublishingPlatforms, "tiktok",
            new("TikTok", "TikTok", null, null, null, null, true, 20), out _).Outcome);
        Execute("DELETE FROM form_option_catalog_migrations WHERE id = 'remove-tiktok-platform-v1';");

        options.Initialize();
        options.Initialize();

        Assert.DoesNotContain(options.ForLocale("zh-CN").PublishingPlatforms, item => item.Id == "tiktok");
        Assert.DoesNotContain(options.ForLocale("en-US").PublishingPlatforms, item => item.Id == "tiktok");
        Assert.False(options.ListAdmin(FormOptionGroups.PublishingPlatforms).Single(item => item.Id == "tiktok").Enabled);
    }

    [Fact]
    public async Task FormOptionsPersistBilingualContentAndKeepDisabledIdsForExistingDrafts()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        var fileCategories = new FileCategoryRepository(ConnectionString);
        fileCategories.Initialize();
        Assert.Equal(3, fileCategories.ListAdmin(FileCategoryScopes.Source).Length);
        Assert.Equal(8, fileCategories.ListAdmin(FileCategoryScopes.Reference).Length);
        Assert.Contains(fileCategories.ListAdmin(FileCategoryScopes.Reference), value => value.Id == "character-reference" && value.MaxFiles == 6);
        Assert.Contains(fileCategories.ListAdmin(FileCategoryScopes.Reference), value => value.Id == "style-reference" && value.MaxFiles == 6);
        var coverCategory = fileCategories.ListAdmin(FileCategoryScopes.Source).Single(value => value.Id == "book-cover");
        var coverUpdate = new UpsertFileCategoryRequest(
            "封面文件", "Cover file", coverCategory.DescriptionZhCn, coverCategory.DescriptionEnUs,
            coverCategory.Accept, 12_000_000, 2, coverCategory.AllowsUrl, coverCategory.Required,
            true, coverCategory.SortOrder, coverCategory.UpdatedAt);
        Assert.Equal(FileCategoryWriteOutcome.Saved, fileCategories.Upsert(FileCategoryScopes.Source, coverCategory.Id, coverUpdate, out var updatedCover).Outcome);
        Assert.NotNull(updatedCover);
        Assert.Equal(12_000_000, fileCategories.ForLocale(FileCategoryScopes.Source, "en-US").Single(value => value.Id == "book-cover").MaxBytes);
        Assert.Equal("封面文件", fileCategories.ForLocale(FileCategoryScopes.Source, "zh-CN").Single(value => value.Id == "book-cover").Label);
        Assert.Equal(FileCategoryWriteOutcome.Saved, fileCategories.Upsert(FileCategoryScopes.Source, coverCategory.Id, coverUpdate with { Enabled = false, ExpectedUpdatedAt = updatedCover!.UpdatedAt }, out _).Outcome);
        Assert.Null(fileCategories.FindEnabled("book-cover"));
        Assert.DoesNotContain(fileCategories.ForLocale(FileCategoryScopes.Source, "zh-CN"), value => value.Id == "book-cover");
        var referenceCategory = fileCategories.ListAdmin(FileCategoryScopes.Reference).First();
        var invalidRequiredReference = new UpsertFileCategoryRequest(
            referenceCategory.LabelZhCn, referenceCategory.LabelEnUs, referenceCategory.DescriptionZhCn, referenceCategory.DescriptionEnUs,
            referenceCategory.Accept, referenceCategory.MaxBytes, referenceCategory.MaxFiles, referenceCategory.AllowsUrl, true,
            referenceCategory.Enabled, referenceCategory.SortOrder, referenceCategory.UpdatedAt);
        Assert.Equal(FileCategoryWriteOutcome.Invalid, fileCategories.Upsert(FileCategoryScopes.Reference, referenceCategory.Id, invalidRequiredReference, out _).Outcome);
        Assert.Equal(3, options.ListAdmin(FormOptionGroups.Brands).Length);

        var request = new UpsertFormOptionRequest(
            "合作品牌",
            "Partner brand",
            "中文说明",
            "English description",
            null,
            null,
            true,
            5);
        var saved = options.Upsert(FormOptionGroups.Brands, "partner-brand", request, out var item);
        Assert.Equal(FormOptionWriteOutcome.Saved, saved.Outcome);
        Assert.NotNull(item);
        Assert.Equal("合作品牌", options.ForLocale("zh-CN").Brands.Single(value => value.Id == "partner-brand").Label);
        Assert.Equal("Partner brand", options.ForLocale("en-US").Brands.Single(value => value.Id == "partner-brand").Label);

        var disabled = options.Upsert(FormOptionGroups.Brands, "partner-brand", request with { Enabled = false, ExpectedUpdatedAt = item!.UpdatedAt }, out var disabledItem);
        Assert.Equal(FormOptionWriteOutcome.Saved, disabled.Outcome);
        Assert.NotNull(disabledItem);
        var stale = options.Upsert(FormOptionGroups.Brands, "partner-brand", request with { ExpectedUpdatedAt = item.UpdatedAt }, out _);
        Assert.Equal(FormOptionWriteOutcome.Conflict, stale.Outcome);

        var outcomes = await Task.WhenAll(
            Task.Run(() => options.Upsert(FormOptionGroups.Brands, "partner-brand", request with { LabelEnUs = "Concurrent A", Enabled = false, ExpectedUpdatedAt = disabledItem!.UpdatedAt }, out _).Outcome),
            Task.Run(() => options.Upsert(FormOptionGroups.Brands, "partner-brand", request with { LabelEnUs = "Concurrent B", Enabled = false, ExpectedUpdatedAt = disabledItem!.UpdatedAt }, out _).Outcome)
        );
        Assert.Single(outcomes, outcome => outcome == FormOptionWriteOutcome.Saved);
        Assert.Single(outcomes, outcome => outcome == FormOptionWriteOutcome.Conflict);
        Assert.DoesNotContain(options.ForLocale("zh-CN").Brands, value => value.Id == "partner-brand");
        Assert.Contains(options.ListAdmin(FormOptionGroups.Brands), value => value.Id == "partner-brand" && !value.Enabled);

        var projects = new ProjectRepository(ConnectionString);
        projects.Initialize();
        var baseline = projects.Create("owner-id");
        var bulkCategory = new UpsertFileCategoryRequest(
            "批量参考", "Bulk reference", null, null, ["image/jpeg"], 2_000_000, 50, false, false, true, 500);
        Assert.Equal(FileCategoryWriteOutcome.Saved, fileCategories.Upsert(FileCategoryScopes.Reference, "bulk-reference", bulkCategory, out _).Outcome);
        var bulkAssets = Enumerable.Range(0, 39).Select(index => new ReferenceAssetDto(
            Guid.NewGuid().ToString("N"), "bulk-reference", $"image-{index}.jpg", "image/jpeg", 1000, $"/files/{index}")).ToArray();
        var bulkDraft = baseline with
        {
            VoiceAndReferences = baseline.VoiceAndReferences with { Assets = bulkAssets }
        };
        var bulkErrors = VoiceAndReferencesValidator.Validate(
            new SaveVoiceAndReferencesRequest(bulkDraft.Version, bulkDraft.VoiceAndReferences, false),
            new HashSet<string>(), options, fileCategories);
        Assert.DoesNotContain(bulkErrors, error => error.Field == "voiceAndReferences.assets" && error.Code == "too_many");

        var linkCategory = fileCategories.ListAdmin(FileCategoryScopes.Reference).Single(value => value.AllowsUrl);
        var disableLinks = new UpsertFileCategoryRequest(
            linkCategory.LabelZhCn, linkCategory.LabelEnUs, linkCategory.DescriptionZhCn, linkCategory.DescriptionEnUs,
            linkCategory.Accept, linkCategory.MaxBytes, linkCategory.MaxFiles, false, false,
            linkCategory.Enabled, linkCategory.SortOrder, linkCategory.UpdatedAt);
        Assert.Equal(FileCategoryWriteOutcome.Saved, fileCategories.Upsert(FileCategoryScopes.Reference, linkCategory.Id, disableLinks, out _).Outcome);
        var linkDraft = baseline with
        {
            VoiceAndReferences = baseline.VoiceAndReferences with { CompetitorUrls = ["https://example.test/reference"] }
        };
        Assert.Contains(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(linkDraft.Version, linkDraft.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, baseline),
            error => error.Field == "voiceAndReferences.competitorUrls" && error.Code == "unknown_option");
        Assert.DoesNotContain(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(linkDraft.Version, linkDraft.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, linkDraft),
            error => error.Field == "voiceAndReferences.competitorUrls" && error.Code == "unknown_option");
        var legacy = baseline with { Project = baseline.Project with { BrandId = "partner-brand" } };
        var legacyErrors = DraftValidator.Validate(new SaveDraftRequest(legacy.Version, legacy.Project, legacy.Book), options, fileCategories, legacy);
        Assert.DoesNotContain(legacyErrors, error => error.Field == "project.brandId");

        var introducedErrors = DraftValidator.Validate(new SaveDraftRequest(legacy.Version, legacy.Project, legacy.Book), options, fileCategories, baseline);
        Assert.Contains(introducedErrors, error => error.Field == "project.brandId" && error.Code == "unknown_option");

        var customDurationOption = options.ListAdmin(FormOptionGroups.VideoDurations).Single(value => value.Id == "custom");
        Assert.True(customDurationOption.AllowsCustomValue);
        Assert.True(options.ForLocale("zh-CN").VideoDurations.Single(value => value.Id == "custom").AllowsCustomValue);
        var customDuration = baseline with { Book = baseline.Book with { VideoDurationId = "custom", CustomVideoDuration = "45 秒" } };
        Assert.DoesNotContain(
            DraftValidator.Validate(new SaveDraftRequest(customDuration.Version, customDuration.Project, customDuration.Book), options, fileCategories, baseline),
            error => error.Field == "book.customVideoDuration");
        var missingCustomDuration = customDuration with { Book = customDuration.Book with { CustomVideoDuration = "" } };
        Assert.Contains(
            DraftValidator.Validate(new SaveDraftRequest(missingCustomDuration.Version, missingCustomDuration.Project, missingCustomDuration.Book), options, fileCategories, baseline),
            error => error.Field == "book.customVideoDuration" && error.Code == "required");
        var unexpectedCustomDuration = baseline with { Book = baseline.Book with { VideoDurationId = "30s", CustomVideoDuration = "45 秒" } };
        Assert.Contains(
            DraftValidator.Validate(new SaveDraftRequest(unexpectedCustomDuration.Version, unexpectedCustomDuration.Project, unexpectedCustomDuration.Book), options, fileCategories, baseline),
            error => error.Field == "book.customVideoDuration" && error.Code == "unknown_option");
        var disableCustomDuration = new UpsertFormOptionRequest(
            customDurationOption.LabelZhCn, customDurationOption.LabelEnUs, customDurationOption.DescriptionZhCn, customDurationOption.DescriptionEnUs,
            customDurationOption.Tone, customDurationOption.PreviewColor, customDurationOption.Enabled, customDurationOption.SortOrder, customDurationOption.UpdatedAt, AllowsCustomValue: false);
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.VideoDurations, customDurationOption.Id, disableCustomDuration, out _).Outcome);
        var editedLegacyCustomDuration = customDuration with { Book = customDuration.Book with { CustomVideoDuration = "50 秒" } };
        Assert.DoesNotContain(
            DraftValidator.Validate(new SaveDraftRequest(editedLegacyCustomDuration.Version, editedLegacyCustomDuration.Project, editedLegacyCustomDuration.Book), options, fileCategories, customDuration),
            error => error.Field == "book.customVideoDuration");
        Assert.Contains(
            DraftValidator.Validate(new SaveDraftRequest(customDuration.Version, customDuration.Project, customDuration.Book), options, fileCategories, baseline),
            error => error.Field == "book.customVideoDuration" && error.Code == "unknown_option");

        var dangerousCreativeUrl = baseline with
        {
            Creative = baseline.Creative with { StyleReferenceImageUrls = ["javascript:alert(1)"] }
        };
        Assert.Contains(
            CreativeValidator.Validate(new SaveCreativeRequest(dangerousCreativeUrl.Version, dangerousCreativeUrl.Creative), options, baseline),
            error => error.Field == "creative.styleReferenceImageUrls" && error.Code == "url");

        var visualStyle = options.ListAdmin(FormOptionGroups.VisualStyles).Single(value => value.Id == "cinematic");
        var disableVisualStyle = new UpsertFormOptionRequest(
            visualStyle.LabelZhCn, visualStyle.LabelEnUs, visualStyle.DescriptionZhCn, visualStyle.DescriptionEnUs,
            visualStyle.Tone, visualStyle.PreviewColor, false, visualStyle.SortOrder, visualStyle.UpdatedAt);
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.VisualStyles, visualStyle.Id, disableVisualStyle, out _).Outcome);
        Assert.DoesNotContain(options.ForLocale("zh-CN").VisualStyles, value => value.Id == "cinematic");
        var creativeLegacy = baseline with { Creative = baseline.Creative with { VisualStyleId = "cinematic" } };
        Assert.DoesNotContain(
            CreativeValidator.Validate(new SaveCreativeRequest(creativeLegacy.Version, creativeLegacy.Creative), options, creativeLegacy),
            error => error.Field == "creative.visualStyleId");
        Assert.Contains(
            CreativeValidator.Validate(new SaveCreativeRequest(creativeLegacy.Version, creativeLegacy.Creative), options, baseline),
            error => error.Field == "creative.visualStyleId" && error.Code == "unknown_option");

        var narrationTone = options.ListAdmin(FormOptionGroups.NarrationTones).Single(value => value.Id == "warm");
        var disableNarrationTone = new UpsertFormOptionRequest(
            narrationTone.LabelZhCn, narrationTone.LabelEnUs, narrationTone.DescriptionZhCn, narrationTone.DescriptionEnUs,
            narrationTone.Tone, narrationTone.PreviewColor, false, narrationTone.SortOrder, narrationTone.UpdatedAt);
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.NarrationTones, narrationTone.Id, disableNarrationTone, out _).Outcome);
        var voiceLegacy = baseline with
        {
            VoiceAndReferences = baseline.VoiceAndReferences with
            {
                Voiceover = baseline.VoiceAndReferences.Voiceover with { NarrationToneId = "warm" }
            }
        };
        Assert.DoesNotContain(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(voiceLegacy.Version, voiceLegacy.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, voiceLegacy),
            error => error.Field == "voiceAndReferences.voiceover.narrationToneId");
        Assert.Contains(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(voiceLegacy.Version, voiceLegacy.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, baseline),
            error => error.Field == "voiceAndReferences.voiceover.narrationToneId" && error.Code == "unknown_option");

        var disabledSelectedVoice = baseline with
        {
            VoiceAndReferences = baseline.VoiceAndReferences with
            {
                Voiceover = baseline.VoiceAndReferences.Voiceover with { SelectedVoiceIds = ["disabled-voice"] }
            }
        };
        Assert.DoesNotContain(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(disabledSelectedVoice.Version, disabledSelectedVoice.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, disabledSelectedVoice),
            error => error.Field == "voiceAndReferences.voiceover.selectedVoiceIds");
        Assert.Contains(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(disabledSelectedVoice.Version, disabledSelectedVoice.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, baseline),
            error => error.Field == "voiceAndReferences.voiceover.selectedVoiceIds" && error.Code == "unknown_option");


        var contentLanguage = options.ListAdmin(FormOptionGroups.ContentLanguages).Single(value => value.Id == "zh-CN");
        var disableContentLanguage = new UpsertFormOptionRequest(
            contentLanguage.LabelZhCn, contentLanguage.LabelEnUs, contentLanguage.DescriptionZhCn, contentLanguage.DescriptionEnUs,
            contentLanguage.Tone, contentLanguage.PreviewColor, false, contentLanguage.SortOrder, contentLanguage.UpdatedAt);
        Assert.Equal(FormOptionWriteOutcome.Saved, options.Upsert(FormOptionGroups.ContentLanguages, contentLanguage.Id, disableContentLanguage, out _).Outcome);
        var inheritedLanguageCurrent = baseline with { Book = baseline.Book with { ContentLanguageId = "zh-CN" } };
        var inheritedLanguageRequest = inheritedLanguageCurrent with
        {
            VoiceAndReferences = inheritedLanguageCurrent.VoiceAndReferences with
            {
                Voiceover = inheritedLanguageCurrent.VoiceAndReferences.Voiceover with { ContentLanguageId = "zh-CN" }
            }
        };
        Assert.DoesNotContain(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(inheritedLanguageRequest.Version, inheritedLanguageRequest.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, inheritedLanguageCurrent),
            error => error.Field == "voiceAndReferences.voiceover.contentLanguageId");
        Assert.Contains(
            VoiceAndReferencesValidator.Validate(new SaveVoiceAndReferencesRequest(inheritedLanguageRequest.Version, inheritedLanguageRequest.VoiceAndReferences, false), new HashSet<string>(), options, fileCategories, baseline),
            error => error.Field == "voiceAndReferences.voiceover.contentLanguageId" && error.Code == "unknown_option");
    }

    [Fact]
    public void PlatformLockPreventsConcurrentWriter()
    {
        var path = Path.Combine(root, "platform.lock");
        using (File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            Assert.Throws<IOException>(() => File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None));
        using var reopened = File.Open(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        Assert.True(reopened.CanWrite);
    }

    private bool HasColumn(string table, string column)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA table_info(" + table + ");";
        using var reader = command.ExecuteReader();
        while (reader.Read()) if (reader.GetString(1) == column) return true;
        return false;
    }

    private void Execute(string sql, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        command.ExecuteNonQuery();
    }

    private string? Scalar(string sql, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        return command.ExecuteScalar() as string;
    }

    private long ScalarLong(string sql, params (string Name, object Value)[] parameters)
    {
        using var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Name, parameter.Value);
        return Convert.ToInt64(command.ExecuteScalar());
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
    }
}
