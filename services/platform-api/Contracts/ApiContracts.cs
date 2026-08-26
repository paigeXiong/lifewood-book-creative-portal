namespace Lifewood.PlatformApi.Contracts;

public sealed record HealthDto(string Status);

public sealed record OrganizationDto(string Id, string Name);

public sealed record CurrentUserDto(
    string Id,
    string? Username,
    string DisplayName,
    string? AvatarUrl,
    string? Email,
    OrganizationDto? Organization,
    string[] Roles,
    string[] Permissions,
    string? Locale,
    string? TimeZone);

public sealed record AuthStatusDto(bool RequiresBootstrap);
public sealed record CsrfTokenDto(string Token);
public sealed record BootstrapAccountRequest(string DisplayName, string Email, string Password);
public sealed record LoginRequest(string Email, string Password, bool RememberMe);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public sealed record ResetPasswordRequest(string NewPassword);

public sealed record AdminUserDto(string Id, string Email, string DisplayName, string Role, bool Active, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);
public sealed record PagedAdminUsersDto(AdminUserDto[] Items, int Page, int PageSize, int Total);
public sealed record CreateUserRequest(string DisplayName, string Email, string Password, string Role);
public sealed record UpdateUserRequest(string DisplayName, string Role, bool Active);

public sealed record ConfigOptionDto(
    string Id,
    string Label,
    string? Description = null,
    string? Tone = null,
    string? PreviewColor = null);

public sealed record ReferenceCategoryDto(
    string Id,
    string Label,
    string? Description,
    string[] Accept,
    long MaxBytes,
    int MaxFiles,
    bool AllowsUrl,
    bool Required);

public sealed record VoiceReferenceDto(
    string Id,
    string Name,
    string Description,
    string? AudioUrl,
    string[] TagIds,
    bool Recommended,
    bool Enabled);

public sealed record AdminVoiceReferenceDto(
    string Id,
    string NameZhCn,
    string NameEnUs,
    string DescriptionZhCn,
    string DescriptionEnUs,
    string? AudioUrl,
    string[] TagIds,
    bool Recommended,
    bool Enabled,
    int SortOrder,
    string UpdatedAt);

public sealed record UpsertVoiceReferenceRequest(
    string NameZhCn,
    string NameEnUs,
    string DescriptionZhCn,
    string DescriptionEnUs,
    string[] TagIds,
    bool Recommended,
    bool Enabled,
    int SortOrder,
    string? ExpectedUpdatedAt);

public sealed record AdminFormOptionDto(
    string GroupId,
    string Id,
    string LabelZhCn,
    string LabelEnUs,
    string? DescriptionZhCn,
    string? DescriptionEnUs,
    string? Tone,
    string? PreviewColor,
    bool Enabled,
    int SortOrder,
    DateTimeOffset UpdatedAt);

public sealed record AdminFileCategoryDto(
    string Scope,
    string Id,
    string LabelZhCn,
    string LabelEnUs,
    string? DescriptionZhCn,
    string? DescriptionEnUs,
    string[] Accept,
    long MaxBytes,
    int MaxFiles,
    bool AllowsUrl,
    bool Required,
    bool Enabled,
    int SortOrder,
    DateTimeOffset UpdatedAt);

public sealed record UpsertFileCategoryRequest(
    string LabelZhCn,
    string LabelEnUs,
    string? DescriptionZhCn,
    string? DescriptionEnUs,
    string[] Accept,
    long MaxBytes,
    int MaxFiles,
    bool AllowsUrl,
    bool Required,
    bool Enabled,
    int SortOrder,
    DateTimeOffset? ExpectedUpdatedAt = null);

public sealed record UpsertFormOptionRequest(
    string LabelZhCn,
    string LabelEnUs,
    string? DescriptionZhCn,
    string? DescriptionEnUs,
    string? Tone,
    string? PreviewColor,
    bool Enabled,
    int SortOrder,
    DateTimeOffset? ExpectedUpdatedAt = null);

public sealed record FormOptionsDto(
    ConfigOptionDto[] Brands,
    ConfigOptionDto[] VideoGoals,
    ConfigOptionDto[] Audiences,
    ConfigOptionDto[] Genres,
    ConfigOptionDto[] ContentLanguages,
    ConfigOptionDto[] VideoDurations,
    ConfigOptionDto[] PublishingPlatforms,
    ConfigOptionDto[] TaskStatuses,
    ConfigOptionDto[] RoleTypes,
    ConfigOptionDto[] AgeRanges,
    ConfigOptionDto[] Genders,
    ConfigOptionDto[] VisualStyles,
    ConfigOptionDto[] MoodTags,
    ConfigOptionDto[] ImageStyleTags,
    ConfigOptionDto[] PaceTags,
    ConfigOptionDto[] NarrationTones,
    ConfigOptionDto[] SpeechRates,
    ConfigOptionDto[] VoiceGenders,
    ConfigOptionDto[] VoiceAges,
    ConfigOptionDto[] Accents,
    ConfigOptionDto[] VoiceEmotions,
    ConfigOptionDto[] VoiceTags,
    ReferenceCategoryDto[] SourceCategories,
    ReferenceCategoryDto[] ReferenceCategories,
    int MaxSelectedVoices,
    ConfigOptionDto[] WorkflowStatuses,
    ConfigOptionDto[] ProjectPriorities);

public sealed record ProjectInfoDto(
    string ClientName,
    string ContactName,
    string Email,
    string? Phone,
    string? BrandId,
    string ProjectName,
    string? VideoGoalId,
    string? Deadline,
    string[] AudienceIds);

public sealed record BookInfoDto(
    string Title,
    string? Subtitle,
    string AuthorName,
    string? GenreId,
    string SellingPoint,
    string Synopsis,
    string? ContentLanguageId,
    string? VideoDurationId,
    string[] PublishingPlatformIds,
    ReferenceAssetDto[]? SourceAssets);

public sealed record CharacterInfoDto(
    string Id,
    string? RoleTypeId,
    string Name,
    string StoryRole,
    string Personality,
    string Appearance,
    string? AgeRangeId,
    string? GenderId,
    string? Clothing,
    string? Emotion,
    string? VoiceHint,
    string[] ReferenceImageUrls);

public sealed record CreativeInfoDto(
    CharacterInfoDto[] Characters,
    string? VisualStyleId,
    string[] MoodTagIds,
    string[] ImageStyleTagIds,
    string[] PaceTagIds,
    string[] StyleReferenceImageUrls);

public sealed record ReferenceAssetDto(
    string Id,
    string CategoryId,
    string FileName,
    string ContentType,
    long SizeBytes,
    string Url);

public sealed record VoiceoverInfoDto(
    string? ContentLanguageId,
    string? NarrationToneId,
    string? SpeechRateId,
    string? PronunciationNotes,
    string? VoiceGenderId,
    string? VoiceAgeId,
    string? AccentId,
    string? EmotionStyleId,
    string[] SelectedVoiceIds,
    string? PreferredVoiceId,
    string? CustomVoiceDescription);

public sealed record CreativeDirectionDto(
    string CoreMessage,
    string? RequiredScenes,
    string? AuthorPreferences,
    string? ClosingMessage,
    string? MusicMood,
    string? AvoidContent);

public sealed record VoiceAndReferencesInfoDto(
    VoiceoverInfoDto Voiceover,
    ReferenceAssetDto[] Assets,
    string[] CompetitorUrls,
    CreativeDirectionDto CreativeDirection);

public sealed record TaskDraftDto(
    string Id,
    string? TaskNumber,
    string Status,
    int Version,
    ProjectInfoDto Project,
    BookInfoDto Book,
    CreativeInfoDto Creative,
    VoiceAndReferencesInfoDto VoiceAndReferences,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? WorkflowStatus = null);

public sealed record ProjectSummaryDto(
    string Id,
    string? TaskNumber,
    int Version,
    string ProjectName,
    string ClientName,
    string BookTitle,
    string AuthorName,
    string? CoverUrl,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    string? WorkflowStatus = null);

public sealed record PagedProjectsDto(
    ProjectSummaryDto[] Items,
    int Page,
    int PageSize,
    int Total);

public sealed record AdminProjectSummaryDto(
    string Id, string? TaskNumber, string ProjectName, string ClientName, string BookTitle, string AuthorName, string? CoverUrl,
    string SubmissionStatus, string WorkflowStatus, string Priority, string OwnerId, string OwnerName, string OwnerEmail,
    string? AssigneeUserId, string? AssigneeName, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt);

public sealed record PagedAdminProjectsDto(AdminProjectSummaryDto[] Items, int Page, int PageSize, int Total);

public sealed record AdminCountDto(string Id, int Count);

public sealed record AdminOverviewDto(
    int TotalProjects,
    int UnassignedProjects,
    int TotalUsers,
    int ActiveUsers,
    AdminCountDto[] SubmissionStatuses,
    AdminCountDto[] WorkflowStatuses,
    AdminCountDto[] Priorities);

public sealed record AdminNoteDto(string Id, string ProjectId, string AuthorUserId, string AuthorName, string Body, DateTimeOffset CreatedAt);

public sealed record AdminProjectDetailDto(
    TaskDraftDto Project, string OwnerId, string OwnerName, string OwnerEmail, string WorkflowStatus, string Priority,
    string? AssigneeUserId, string? AssigneeName, AdminNoteDto[] Notes);

public sealed record UpdateProjectWorkflowRequest(string WorkflowStatus, string Priority, string? AssigneeUserId);

public sealed record AddAdminNoteRequest(string Body);

public sealed record SaveDraftRequest(
    int Version,
    ProjectInfoDto Project,
    BookInfoDto Book);

public sealed record SaveCreativeRequest(int Version, CreativeInfoDto Creative);

public sealed record SaveVoiceAndReferencesRequest(int Version, VoiceAndReferencesInfoDto VoiceAndReferences, bool RequireComplete = false);

public sealed record ValidateProjectRequest(int Version);

public sealed record ValidationResultDto(bool Valid, FieldErrorDto[] FieldErrors);

public sealed record SubmitProjectRequest(int Version, string IdempotencyKey);

public sealed record UploadReferenceResultDto(TaskDraftDto Draft, ReferenceAssetDto Asset);

public sealed record FieldErrorDto(string Field, string Code, string? MessageKey = null);

public sealed record ApiErrorDto(
    string Code,
    string? MessageKey,
    string? FallbackMessage,
    FieldErrorDto[]? FieldErrors,
    bool Retryable,
    string? RequestId,
    int? CurrentVersion = null);
