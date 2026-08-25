export function effectiveVoiceContentLanguage(voiceLanguageId?: string, bookLanguageId?: string) {
  return voiceLanguageId ?? bookLanguageId;
}
