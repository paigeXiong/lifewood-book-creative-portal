using System.Text.Json;
using Lifewood.PlatformApi.Contracts;
using Lifewood.PlatformApi.Features;
using Lifewood.PlatformApi.Persistence;
using Lifewood.PlatformApi.Serialization;
using Xunit;

namespace Lifewood.PlatformApi.Tests;

public sealed class NarrationSettingsTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "lifewood-narration-tests-" + Guid.NewGuid().ToString("N"));
    private readonly ProjectRepository projects;
    private readonly FormOptionRepository options;
    private readonly FileCategoryRepository categories;
    private readonly AdminRepository admin;
    private readonly string ownerId;

    public NarrationSettingsTests()
    {
        Directory.CreateDirectory(root);
        var connection = "Data Source=" + Path.Combine(root, "platform.db") + ";Pooling=False";
        projects = new ProjectRepository(connection);
        projects.Initialize();
        var users = new UserRepository(connection, root);
        users.Initialize();
        admin = new AdminRepository(connection);
        admin.Initialize();
        ownerId = users.CreateOwner("Owner", "owner@example.test", "password-for-tests").User!.Id;
        options = new FormOptionRepository(connection);
        options.Initialize();
        categories = new FileCategoryRepository(connection);
        categories.Initialize();
    }

    [Fact]
    public void MissingChoiceCannotBeSubmittedButCanBeSavedAsDraft()
    {
        var draft = projects.Create(ownerId);
        var step = draft.VoiceAndReferences with { CreativeDirection = new("Direction", null, null, null, null, null) };
        Assert.Contains(Validate(step, true), error => error.Field.EndsWith(".narrationEnabled") && error.Code == "required");
        Assert.Empty(Validate(step, false));
        Assert.Null(NarrationSettings.IsEnabled(step.Voiceover with { ContentLanguageId = "en-US" }));
    }

    [Fact]
    public void OptInRequiresLanguageToneAndRateButOptOutDoesNot()
    {
        var step = projects.Create(ownerId).VoiceAndReferences;
        step = step with { CreativeDirection = new("Direction", null, null, null, null, null) };
        var enabled = step with { Voiceover = step.Voiceover with { NarrationEnabled = true } };
        var errors = Validate(enabled, true);
        foreach (var field in new[] { "contentLanguageId", "narrationToneId", "speechRateId" })
            Assert.Contains(errors, error => error.Field.EndsWith("." + field) && error.Code == "required");
        var disabled = step with { Voiceover = step.Voiceover with { NarrationEnabled = false } };
        Assert.Empty(Validate(disabled, true));
        Assert.Contains(Validate(disabled with { CreativeDirection = step.CreativeDirection with { CoreMessage = "" } }, true),
            error => error.Field.EndsWith(".coreMessage"));
        Assert.Contains(Validate(disabled with { CompetitorUrls = ["bad-link"] }, true),
            error => error.Field == "voiceAndReferences.competitorUrls");
    }

    [Fact]
    public void OptOutPersistsThroughReloadSubmissionAndAdminReadWithoutStaleVoiceSettings()
    {
        var draft = projects.Create(ownerId);
        draft = projects.Save(ownerId, draft.Id, new(draft.Version, draft.Project, draft.Book with { ContentLanguageId = "en-US" })).Draft!;
        var step = draft.VoiceAndReferences with
        {
            Voiceover = draft.VoiceAndReferences.Voiceover with
            {
                NarrationEnabled = false, ContentLanguageId = "en-US", NarrationToneId = "retired-tone",
                SelectedVoiceIds = ["retired-voice"], PreferredVoiceId = "retired-voice"
            },
            CompetitorUrls = ["https://example.test/reference"],
            CreativeDirection = new("Keep this direction", null, null, null, "Keep music", null)
        };
        Assert.Empty(Validate(step, true));
        var result = projects.SaveVoiceAndReferences(ownerId, draft.Id, new(draft.Version, step, true));
        Assert.Equal(SaveOutcome.Saved, result.Outcome);
        var saved = projects.Get(ownerId, draft.Id)!;
        Assert.False(saved.VoiceAndReferences.Voiceover.NarrationEnabled);
        Assert.Null(saved.VoiceAndReferences.Voiceover.NarrationToneId);
        Assert.Empty(saved.VoiceAndReferences.Voiceover.SelectedVoiceIds);
        Assert.Equal("en-US", saved.Book.ContentLanguageId);
        Assert.Equal("Keep music", saved.VoiceAndReferences.CreativeDirection.MusicMood);
        Assert.Single(saved.VoiceAndReferences.CompetitorUrls);
        Assert.DoesNotContain(SubmitValidator.Validate(saved, new HashSet<string>(), options, categories),
            error => error.Field.StartsWith("voiceAndReferences."));
        Assert.Equal(SaveOutcome.Saved, projects.Submit(ownerId, saved.Id, saved.Version, "narration-off", null).Outcome);
        Assert.False(projects.Get(ownerId, saved.Id)!.VoiceAndReferences.Voiceover.NarrationEnabled);
        Assert.False(admin.GetProject(saved.Id)!.Project.VoiceAndReferences.Voiceover.NarrationEnabled);
    }

    [Fact]
    public void LegacyJsonWithoutFlagPreservesNarrationAndFalseRoundTrips()
    {
        var legacy = JsonSerializer.Deserialize(
            """{"contentLanguageId":"en-US","narrationToneId":"warm","speechRateId":"medium","selectedVoiceIds":[]}""",
            AppJsonContext.Default.VoiceoverInfoDto)!;
        Assert.True(NarrationSettings.IsEnabled(legacy));
        var off = NarrationSettings.Normalize(legacy with { NarrationEnabled = false });
        var json = JsonSerializer.Serialize(off, AppJsonContext.Default.VoiceoverInfoDto);
        Assert.Contains("\"narrationEnabled\":false", json);
        Assert.False(JsonSerializer.Deserialize(json, AppJsonContext.Default.VoiceoverInfoDto)!.NarrationEnabled);
        var step = projects.Create(ownerId).VoiceAndReferences with
        {
            Voiceover = legacy,
            CreativeDirection = new("Direction", null, null, null, null, null)
        };
        Assert.Empty(Validate(step, true));
    }

    private FieldErrorDto[] Validate(VoiceAndReferencesInfoDto step, bool complete) =>
        VoiceAndReferencesValidator.Validate(new(1, step, complete), new HashSet<string>(), options, categories);

    public void Dispose() => Directory.Delete(root, true);
}
