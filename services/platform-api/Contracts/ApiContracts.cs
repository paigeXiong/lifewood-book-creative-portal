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
    int MaxSelectedVoices);

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
    DateTimeOffset UpdatedAt);

public sealed record ProjectSummaryDto(
    string Id,
    string? TaskNumber,
    string ProjectName,
    string ClientName,
    string BookTitle,
    string AuthorName,
    string? CoverUrl,
    string Status,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record PagedProjectsDto(
    ProjectSummaryDto[] Items,
    int Page,
    int PageSize,
    int Total);

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
