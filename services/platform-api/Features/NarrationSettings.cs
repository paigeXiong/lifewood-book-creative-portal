using Lifewood.PlatformApi.Contracts;

namespace Lifewood.PlatformApi.Features;

internal static class NarrationSettings
{
    public static bool? IsEnabled(VoiceoverInfoDto voice) => voice.NarrationEnabled ??
        (new[] { voice.NarrationToneId, voice.SpeechRateId, voice.PronunciationNotes,
            voice.VoiceGenderId, voice.VoiceAgeId, voice.AccentId, voice.EmotionStyleId,
            voice.PreferredVoiceId, voice.CustomVoiceDescription }.Any(value => !string.IsNullOrWhiteSpace(value))
            || voice.SelectedVoiceIds is { Length: > 0 } ? true : null);

    public static VoiceoverInfoDto Normalize(VoiceoverInfoDto voice) => IsEnabled(voice) is false
        ? new(null, null, null, null, null, null, null, null, [], null, null, false)
        : voice with { NarrationEnabled = IsEnabled(voice) };
}
