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
        Assert.Equal(AdminWriteOutcome.NotFound, admin.UpdateWorkflow(draft.Id, new("contacting", "normal", null)).Outcome);
        Assert.Equal(AdminWriteOutcome.NotFound, admin.AddNote(draft.Id, owner.Id, new("Must not be added"), out _).Outcome);
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

        var submitted = projects.Submit(owner.Id, draft.Id, draft.Version, "submission-key");

        Assert.Equal(SaveOutcome.Saved, submitted.Outcome);
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

    [Theory]
    [InlineData("POST", "/api/admin/users", "user.create", "user", null)]
    [InlineData("PUT", "/api/admin/users/user-1", "user.update", "user", "user-1")]
    [InlineData("PUT", "/api/admin/users/user-1/password", "user.password_reset", "user", "user-1")]
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
        users.Initialize();
        Assert.True(HasColumn("users", "session_version"));

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
    public async Task FormOptionsPersistBilingualContentAndKeepDisabledIdsForExistingDrafts()
    {
        var options = new FormOptionRepository(ConnectionString);
        options.Initialize();
        var fileCategories = new FileCategoryRepository(ConnectionString);
        fileCategories.Initialize();
        Assert.Equal(6, fileCategories.ListAdmin(FileCategoryScopes.Source).Length);
        Assert.Equal(6, fileCategories.ListAdmin(FileCategoryScopes.Reference).Length);
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
