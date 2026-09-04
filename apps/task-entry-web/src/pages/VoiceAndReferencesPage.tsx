import { EnumField } from "../components/EnumField";
import { ChoiceRow } from "../components/ChoiceRow";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { useWizardNavigate as useNavigate } from "../wizard-motion";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { ReferenceCategory, TaskDraft, VoiceReference } from "@lifewood/domain";
import { getNarrationEnabled, normalizeNarration } from "@lifewood/domain";
import { NarrationChoice } from "../components/NarrationChoice";
import { ChoiceField } from "../components/ChoiceField";
import { Field } from "../components/Field";
import { FieldIcon } from "../components/FieldIcon";
import { StepProgress } from "../components/StepProgress";
import { getHighestReachableStep } from "../workflow-progress";
import { ScreenError } from "../components/ScreenError";
import { FileDropCard } from "../components/FileDropCard";
import { createReferencesStepSchema, createVoiceDraftSchema, createVoicePreferencesStepSchema, isVoicePreferencesComplete, type VoiceFormValues } from "./voiceFormSchema";
import { reconcileVoiceSelection } from "../voice-selection";
import { isCharactersComplete, isStyleComplete } from "./creativeFormSchema";
import { mergeLegacyOptions } from "../legacy-options";
import { effectiveVoiceContentLanguage } from "../voice-content-language";
import { mergeLegacyCategories, type DisplayReferenceCategory } from "../legacy-categories";

type TransferItem = { id: string; categoryId: string; file: File; status: "uploading" | "error" | "cancelled"; error?: string };

function VoiceSummary({ stage, control, voices }: { stage: "voice" | "references"; control: Control<VoiceFormValues>; voices: VoiceReference[] }) {
  const { t } = useTranslation();
  const [narrationEnabled, selectedVoiceIds, preferredVoiceId, assets, competitorUrls] = useWatch({ control, name: ["narrationEnabled", "selectedVoiceIds", "preferredVoiceId", "assets", "competitorUrls"] });
  return <aside className="voice-summary">
    {stage === "voice" && narrationEnabled && <div className="studio-card"><span className="folio-label">{t("voice.summary.selection")}</span><div className="studio-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div><strong>{voices.find((voice) => voice.id === preferredVoiceId)?.name ?? t("voice.summary.noPreferred")}</strong>{selectedVoiceIds.length > 0 && <p>{t("voice.summary.candidates", { count: selectedVoiceIds.length })}</p>}</div>}
    {stage === "references" && <div className="handoff-card"><span className="folio-label">{t("voice.summary.package")}</span><strong>{t("voice.summary.fileCount", { count: assets.length })}</strong><p>{t("voice.summary.linkCount", { count: competitorUrls.filter((url) => url.trim()).length })}</p></div>}
    <div className="next-card"><span className="next-mark" aria-hidden="true">→</span><div><h3>{t(stage === "voice" ? "voice.summary.nextStyleTitle" : "voice.summary.nextReviewTitle")}</h3></div></div>
  </aside>;
}

function VoiceSamplesSection({ form, voices, maxSelected, playingVoice, voiceTagMap, onSelect, onPrefer, onToggleAudio }: { form: UseFormReturn<VoiceFormValues>; voices: VoiceReference[]; maxSelected: number; playingVoice?: string; voiceTagMap: Map<string, string>; onSelect: (id: string, selected: boolean) => void; onPrefer: (id: string) => void; onToggleAudio: (voice: VoiceReference) => void }) {
  const { t } = useTranslation();
  const [selectedVoiceIds, preferredVoiceId] = useWatch({ control: form.control, name: ["selectedVoiceIds", "preferredVoiceId"] });
  return <section className="form-panel voice-samples"><div className="section-heading"><div><h2 id="voice-samples-heading"><span>3.2</span>{t("voice.sections.samples")}</h2><p>{t("voice.sampleDisclaimer")}</p></div><span className="selection-count" aria-live="polite">{t("voice.selectedCount", { count: selectedVoiceIds.length, max: maxSelected })}</span></div>
    {voices.length === 0 && <div className="compact-empty" role="status">{t("voice.noSamples")}</div>}
    <div className="voice-card-grid" role="group" aria-labelledby="voice-samples-heading" aria-describedby={form.formState.errors.selectedVoiceIds ? "voice-selection-error" : undefined}>{voices.map((voice) => { const selected = selectedVoiceIds.includes(voice.id); const preferred = preferredVoiceId === voice.id; return <article className={`voice-card ${selected ? "selected" : ""}`} key={voice.id}><label className="voice-select"><input name="selectedVoiceIds" type="checkbox" checked={selected} disabled={!selected && selectedVoiceIds.length >= maxSelected} onChange={(event) => onSelect(voice.id, event.target.checked)} /><span>{voice.name}</span>{voice.recommended && <small>{t("voice.recommended")}</small>}</label><p>{voice.description}</p><div className="voice-wave" aria-hidden="true">{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div><div className="voice-card-actions"><button type="button" className="audio-button" disabled={!voice.audioUrl} aria-label={voice.audioUrl ? t(playingVoice === voice.id ? "voice.pauseSample" : "voice.playSample", { name: voice.name }) : t("voice.sampleUnavailable")} onClick={() => onToggleAudio(voice)}>{playingVoice === voice.id ? "Ⅱ" : "▶"}<span>{voice.audioUrl ? t(playingVoice === voice.id ? "voice.pause" : "voice.play") : t("voice.sampleUnavailable")}</span></button><button type="button" className={`preference-button ${preferred ? "active" : ""}`} disabled={!selected} onClick={() => onPrefer(voice.id)}>{preferred ? t("voice.preferred") : t("voice.setPreferred")}</button></div><div className="voice-tags">{voice.tagIds.map((id) => <span key={id}>{voiceTagMap.get(id) ?? id}</span>)}</div></article>; })}</div>
    {form.formState.errors.selectedVoiceIds?.message && <div className="field-error" id="voice-selection-error" role="alert">{form.formState.errors.selectedVoiceIds.message}</div>}
    <Field className="field-wide" label={t("voice.fields.customVoice")} icon={<FieldIcon name="voice" />} htmlFor="custom-voice" error={form.formState.errors.customVoiceDescription?.message}><textarea id="custom-voice" rows={2} maxLength={300} autoComplete="off" {...form.register("customVoiceDescription")} /></Field>
  </section>;
}

function ReferencesSection({ form, categories, locale, uploadCategory, transfers, uploadError, onUpload, onRemoveAsset, onCancelUpload, onRetryUpload }: { form: UseFormReturn<VoiceFormValues>; categories: DisplayReferenceCategory[]; locale: string; uploadCategory?: string; transfers: TransferItem[]; uploadError?: string; onUpload: (category: ReferenceCategory, files: FileList | null) => Promise<void>; onRemoveAsset: (id: string) => Promise<void>; onCancelUpload: (id: string) => void; onRetryUpload: (item: TransferItem) => Promise<void> }) {
  const { t } = useTranslation();
  const [assets, competitorUrls] = useWatch({ control: form.control, name: ["assets", "competitorUrls"] });
  const linksEnabled = categories.some((category) => category.allowsUrl && !category.unavailable);
  return <section className="form-panel reference-section"><div className="section-heading"><div><h2><span>5.2</span>{t("voice.sections.references")}</h2></div></div>
    <div className="upload-grid">{categories.map((category) => { const files = assets.filter((asset) => asset.categoryId === category.id); return <FileDropCard key={category.id} inputId={`upload-${category.id}`} category={category} files={files} locale={locale} busyCategory={uploadCategory} onUpload={onUpload} onRemove={onRemoveAsset} />; })}</div>
    {transfers.length > 0 && <ul className="transfer-list" aria-live="polite">{transfers.map((item) => <li key={item.id}><span>{item.file.name}</span><small>{item.status === "uploading" ? t("voice.uploading") : item.error}</small>{item.status === "uploading" ? <button type="button" onClick={() => onCancelUpload(item.id)}>{t("voice.cancelUpload")}</button> : <button type="button" disabled={Boolean(uploadCategory)} onClick={() => void onRetryUpload(item)}>{t("common.retry")}</button>}</li>)}</ul>}
    {uploadError && <div className="inline-error" role="alert">{uploadError}</div>}
    <div className="competitor-links" hidden={!linksEnabled && competitorUrls.length === 0}><div className="section-heading compact"><div><h3>{t("voice.fields.competitorLinks")}</h3><p>{t("voice.competitorHint")}</p></div><button className="button button-secondary" type="button" disabled={!linksEnabled || competitorUrls.length >= 5} onClick={() => form.setValue("competitorUrls", [...competitorUrls, ""], { shouldDirty: true })}>{t("voice.addLink")}</button></div>{competitorUrls.map((_, index) => { const error = form.formState.errors.competitorUrls?.[index]?.message; const messageId = `competitor-url-${index}-message`; return <div className="field" key={index}><label htmlFor={`competitor-url-${index}`}>{t("voice.linkNumber", { index: index + 1 })}</label><div className="inline-input"><input id={`competitor-url-${index}`} type="url" inputMode="url" spellCheck={false} autoComplete="off" readOnly={!linksEnabled} placeholder="https://example.com/…" aria-invalid={error ? true : undefined} aria-describedby={error ? messageId : undefined} {...form.register(`competitorUrls.${index}`)} /><button type="button" aria-label={t("voice.removeLink", { index: index + 1 })} onClick={() => form.setValue("competitorUrls", competitorUrls.filter((_, itemIndex) => itemIndex !== index), { shouldDirty: true })}>{t("voice.remove")}</button></div>{error && <div className="field-error" id={messageId} role="alert">{error}</div>}</div>; })}</div>
  </section>;
}

export function VoiceAndReferencesPage({ stage }: { stage: "voice" | "references" }) {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const [saveState, setSaveState] = useState<"idle" | "invalid" | "error">("idle");
  const [uploadCategory, setUploadCategory] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [playingVoice, setPlayingVoice] = useState<string>();
  const [removedVoiceCount, setRemovedVoiceCount] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeUploadRef = useRef<{ id: string; controller: AbortController } | null>(null);
  const cancelledTransferIdsRef = useRef(new Set<string>());
  const uploadingRef = useRef(false);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const savedSnapshotRef = useRef<string | undefined>(undefined);
  const [navigating, setNavigating] = useState(false);
  const failedSaveSnapshotRef = useRef<string | undefined>(undefined);
  const draftSchema = useMemo(() => createVoiceDraftSchema(t), [t]);
  const stepSchema = useMemo(() => stage === "voice" ? createVoicePreferencesStepSchema(t) : createReferencesStepSchema(t), [stage, t]);
  const draftQuery = useQuery({ queryKey: ["project", taskId], queryFn: () => projectService.getProject(taskId!, validLocale), enabled: Boolean(taskId) });
  const optionsQuery = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });

  const voiceTagMap = useMemo(() => new Map((optionsQuery.data?.voiceTags ?? []).map((tag) => [tag.id, tag.label])), [optionsQuery.data?.voiceTags]);
  const form = useForm<VoiceFormValues>({ resolver: zodResolver(draftSchema), defaultValues: {
    brandId: "", projectName: "", videoGoalId: "", deadline: "", audienceIds: [],
    narrationEnabled: null,
    contentLanguageId: "", narrationToneId: "", speechRateId: "", pronunciationNotes: "", voiceGenderId: "", voiceAgeId: "", accentId: "", emotionStyleId: "",
    selectedVoiceIds: [], preferredVoiceId: "", customVoiceDescription: "", assets: [], competitorUrls: [], coreMessage: "", requiredScenes: "", authorPreferences: "", closingMessage: "", musicMood: "", avoidContent: "",
  }});
  const selectedAudienceIds = useWatch({ control: form.control, name: "audienceIds" }) ?? [];
  const autosaveValues = useWatch({ control: form.control });
  const narrationEnabled = useWatch({ control: form.control, name: "narrationEnabled" });
  const voicesQuery = useQuery({ queryKey: ["voices", validLocale], queryFn: () => optionService.getVoices(validLocale), enabled: stage === "voice" && narrationEnabled === true });

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    const voice = draft.voiceAndReferences.voiceover;
    const direction = draft.voiceAndReferences.creativeDirection;
    const { selectedVoiceIds, preferredVoiceId, removedCount } = stage === "voice" && getNarrationEnabled(voice) === true && voicesQuery.data
      ? reconcileVoiceSelection(voice.selectedVoiceIds, voice.preferredVoiceId, voicesQuery.data!.map((item) => item.id))
      : { selectedVoiceIds: voice.selectedVoiceIds, preferredVoiceId: voice.preferredVoiceId ?? "", removedCount: 0 };
    setRemovedVoiceCount(removedCount);
    form.reset({
      brandId: draft.project.brandId ?? "", projectName: draft.project.projectName.trim() || draft.book.title.trim(), videoGoalId: draft.project.videoGoalId ?? "",
      deadline: draft.project.deadline ?? "", audienceIds: draft.project.audienceIds,
      narrationEnabled: getNarrationEnabled(voice) ?? null,
      contentLanguageId: voice.contentLanguageId ?? draft.book.contentLanguageId ?? "", narrationToneId: voice.narrationToneId ?? "", speechRateId: voice.speechRateId ?? "",
      pronunciationNotes: voice.pronunciationNotes ?? "", voiceGenderId: voice.voiceGenderId ?? "", voiceAgeId: voice.voiceAgeId ?? "", accentId: voice.accentId ?? "", emotionStyleId: voice.emotionStyleId ?? "",
      selectedVoiceIds, preferredVoiceId, customVoiceDescription: voice.customVoiceDescription ?? "",
      assets: draft.voiceAndReferences.assets, competitorUrls: draft.voiceAndReferences.competitorUrls,
      coreMessage: direction.coreMessage, requiredScenes: direction.requiredScenes ?? "", authorPreferences: direction.authorPreferences ?? "", closingMessage: direction.closingMessage ?? "", musicMood: direction.musicMood ?? "", avoidContent: direction.avoidContent ?? "",
    });
  }, [draftQuery.data, voicesQuery.data, form, form.formState.isDirty, stage]);

  useEffect(() => {
    const dirty = form.formState.isDirty;
    document.body.dataset.unsavedChanges = String(dirty);
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const preventBackLoss = () => { if (dirty && !window.confirm(t("wizard.unsavedChanges"))) window.history.go(1); };
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("popstate", preventBackLoss);
    return () => { window.removeEventListener("beforeunload", preventLoss); window.removeEventListener("popstate", preventBackLoss); delete document.body.dataset.unsavedChanges; };
  }, [form.formState.isDirty, t]);

  useEffect(() => () => {
    audioRef.current?.pause();
    activeUploadRef.current?.controller.abort();
  }, []);

  const save = useMutation({
    mutationFn: async ({ values, continueAfter }: { values: VoiceFormValues; continueAfter: boolean }) => {

      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const next: TaskDraft = { ...current,
        project: stage === "references" ? { ...current.project, brandId: values.brandId || undefined,
          projectName: values.projectName?.trim() || current.book.title.trim(), videoGoalId: values.videoGoalId || undefined, deadline: values.deadline || undefined,
          audienceIds: values.audienceIds ?? [] } : current.project, voiceAndReferences: {
        voiceover: normalizeNarration({ narrationEnabled: values.narrationEnabled, contentLanguageId: values.contentLanguageId || undefined, narrationToneId: values.narrationToneId || undefined, speechRateId: values.speechRateId || undefined,
          pronunciationNotes: values.pronunciationNotes || undefined, voiceGenderId: values.voiceGenderId || undefined, voiceAgeId: values.voiceAgeId || undefined, accentId: values.accentId || undefined,
          emotionStyleId: values.emotionStyleId || undefined, selectedVoiceIds: values.selectedVoiceIds, preferredVoiceId: values.preferredVoiceId || undefined, customVoiceDescription: values.customVoiceDescription || undefined }),
        assets: values.assets, competitorUrls: values.competitorUrls.map((url) => url.trim()).filter(Boolean),
        creativeDirection: { coreMessage: values.coreMessage, requiredScenes: values.requiredScenes || undefined, authorPreferences: values.authorPreferences || undefined,
          closingMessage: values.closingMessage || undefined, musicMood: values.musicMood || undefined, avoidContent: values.avoidContent || undefined },
      }};
      return { saved: await projectService.saveVoiceAndReferences(current.id, next, validLocale, stage === "references" && continueAfter, stage === "references"), continueAfter, values };
    },
    onSuccess: async ({ saved, continueAfter, values }) => { queryClient.setQueryData(["project", taskId], saved); void queryClient.invalidateQueries({ queryKey: ["projects"] }); form.reset(values, { keepValues: true }); savedSnapshotRef.current = JSON.stringify(values); failedSaveSnapshotRef.current = undefined; setSaveState("idle"); if (continueAfter) await navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/${stage === "voice" ? "style" : "review"}`)); },
    onError: (_error, variables) => { failedSaveSnapshotRef.current = JSON.stringify(variables.values); setSaveState("error"); },
    onSettled: () => { saveInFlightRef.current = false; },
  });

  const runSave = (values: VoiceFormValues, continueAfter: boolean, explicit: boolean) => {
    const snapshot = JSON.stringify(values);
    if (saveInFlightRef.current) return savePromiseRef.current ?? Promise.resolve(false);
    if (!explicit && failedSaveSnapshotRef.current === snapshot) return Promise.resolve(false);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    const pending = save.mutateAsync({ values, continueAfter }).then(() => true, () => false);
    savePromiseRef.current = pending;
    return pending;
  };

  useEffect(() => {
    if (!form.formState.isDirty || save.isPending || uploadCategory || navigating) return;
    const checked = draftSchema.safeParse(autosaveValues);
    if (!checked.success) { setSaveState("invalid"); return; }
    const snapshot = JSON.stringify(checked.data);
    if (failedSaveSnapshotRef.current === snapshot || savedSnapshotRef.current === snapshot) return;

    autosaveTimerRef.current = window.setTimeout(() => runSave(checked.data, false, false), 0);
    return () => { if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = undefined; };
  }, [autosaveValues, form.formState.isDirty, save.isPending, uploadCategory, navigating, draftSchema]);
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending) return <div className="screen-status" aria-busy="true">{t("common.loading")}</div>;
  if (draftQuery.isError || optionsQuery.isError || !draftQuery.data || !optionsQuery.data) return <ScreenError error={draftQuery.error ?? optionsQuery.error} onRetry={() => Promise.all([draftQuery.refetch(), optionsQuery.refetch()])} />;
  if (draftQuery.data.status !== "draft") return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />;
  if (!isCharactersComplete(draftQuery.data.creative)) return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/characters`)} />;
  if (stage === "references" && !isVoicePreferencesComplete(draftQuery.data.voiceAndReferences)) return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/voice`)} />;
  if (stage === "references" && !isStyleComplete(draftQuery.data.creative)) return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/style`)} />;

  const options = optionsQuery.data;
  const basicUnavailable = t("wizard.unavailableOption");
  const brandOptions = mergeLegacyOptions(options.brands, [draftQuery.data.project.brandId], basicUnavailable);
  const videoGoalOptions = mergeLegacyOptions(options.videoGoals, [draftQuery.data.project.videoGoalId], basicUnavailable);
  const audienceOptions = mergeLegacyOptions(options.audiences, draftQuery.data.project.audienceIds, basicUnavailable);
  const previousVoice = draftQuery.data.voiceAndReferences.voiceover;
  const unavailable = t("wizard.unavailableOption");
  const contentLanguageOptions = mergeLegacyOptions(options.contentLanguages, [effectiveVoiceContentLanguage(previousVoice.contentLanguageId, draftQuery.data.book.contentLanguageId)], unavailable);
  const narrationToneOptions = mergeLegacyOptions(options.narrationTones, [previousVoice.narrationToneId], unavailable);
  const speechRateOptions = mergeLegacyOptions(options.speechRates, [previousVoice.speechRateId], unavailable);
  const voiceGenderOptions = mergeLegacyOptions(options.voiceGenders, [previousVoice.voiceGenderId], unavailable);
  const voiceAgeOptions = mergeLegacyOptions(options.voiceAges, [previousVoice.voiceAgeId], unavailable);
  const accentOptions = mergeLegacyOptions(options.accents, [previousVoice.accentId], unavailable);
  const emotionOptions = mergeLegacyOptions(options.voiceEmotions, [previousVoice.emotionStyleId], unavailable);
  const referenceCategories = mergeLegacyCategories(options.referenceCategories.filter((category) => !["character-reference", "style-reference"].includes(category.id)), draftQuery.data.voiceAndReferences.assets, unavailable);
  const voices = (voicesQuery.data ?? []).filter((voice) => voice.enabled);
  const conflict = save.error instanceof ApiError && save.error.details.code === "project.version_conflict";
  const statusText = saveState === "invalid" ? t("common.saveNeedsAttention") : saveState === "error" ? t(conflict ? "wizard.versionConflict" : "wizard.saveFailed") : "";
  const navigateWithSave = async (path: string) => {
    if (navigating || uploadCategory) return;
    setNavigating(true);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      const checked = draftSchema.safeParse(form.getValues());
      if (!checked.success) { setSaveState("invalid"); await form.trigger(); return; }
      const needsSave = savedSnapshotRef.current === undefined ? form.formState.isDirty : savedSnapshotRef.current !== JSON.stringify(checked.data);
      if (needsSave && !await runSave(checked.data, false, true)) return;
      await navigate(path);
    } finally { setNavigating(false); }
  };
  const guardLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigateWithSave(event.currentTarget.pathname);
  };
  const selectVoice = (id: string, selected: boolean) => {
    const selectedIds = form.getValues("selectedVoiceIds");
    if (selected && selectedIds.length >= options.maxSelectedVoices) { form.setError("selectedVoiceIds", { message: t("voice.validation.limit", { max: options.maxSelectedVoices }) }); return; }
    const next = selected ? [...selectedIds, id] : selectedIds.filter((voiceId) => voiceId !== id);
    form.setValue("selectedVoiceIds", next, { shouldDirty: true, shouldValidate: true });
    if (!selected && form.getValues("preferredVoiceId") === id) form.setValue("preferredVoiceId", "", { shouldDirty: true });
  };
  const preferVoice = (id: string) => { if (!form.getValues("selectedVoiceIds").includes(id)) selectVoice(id, true); form.setValue("preferredVoiceId", id, { shouldDirty: true, shouldValidate: true }); };
  const toggleAudio = (voice: VoiceReference) => {
    if (!voice.audioUrl) return;
    if (playingVoice === voice.id) { audioRef.current?.pause(); setPlayingVoice(undefined); return; }
    audioRef.current?.pause();
    const audio = new Audio(voice.audioUrl); audioRef.current = audio; audio.onended = () => setPlayingVoice(undefined); void audio.play(); setPlayingVoice(voice.id);
  };
  const uploadOne = async (item: TransferItem) => {
    const controller = new AbortController(); activeUploadRef.current = { id: item.id, controller };
    setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry));
    try {
      const currentDraft = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const result = await projectService.uploadAsset(taskId, currentDraft.version, item.categoryId, item.file, validLocale, controller.signal);
      queryClient.setQueryData(["project", taskId], result.draft);
      form.setValue("assets", result.draft.voiceAndReferences.assets, { shouldDirty: true, shouldValidate: true });
      setTransfers((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      const message = cancelled ? t("voice.uploadCancelled") : localizedApiError(error, t);
      setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: cancelled ? "cancelled" : "error", error: message } : entry));
      if (!cancelled) setUploadError(message);
      else {
        try {
          const latest = await projectService.getProject(taskId, validLocale);
          queryClient.setQueryData(["project", taskId], latest);
          form.setValue("assets", latest.voiceAndReferences.assets, { shouldDirty: true, shouldValidate: true });
        } catch { void queryClient.invalidateQueries({ queryKey: ["project", taskId] }); }
      }
    } finally { if (activeUploadRef.current?.id === item.id) activeUploadRef.current = null; }
  };
  const upload = async (category: ReferenceCategory, files: FileList | null) => {
    if (!files?.length || uploadingRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true; setUploadError(undefined); setUploadCategory(category.id);
    const available = Math.max(0, category.maxFiles - form.getValues("assets").filter((asset) => asset.categoryId === category.id).length);
    const queue = Array.from(files).slice(0, available).map((file) => ({ id: crypto.randomUUID(), categoryId: category.id, file, status: "uploading" as const }));
    try {
    if (saveInFlightRef.current && !await savePromiseRef.current) return;
    setTransfers((current) => [...current, ...queue]);
    for (const item of queue) {
      if (cancelledTransferIdsRef.current.delete(item.id)) continue;
      await uploadOne(item);
    }
    } finally { uploadingRef.current = false; setUploadCategory(undefined); }
  };
  const retryUpload = async (item: TransferItem) => {
    if (uploadingRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true; setUploadCategory(item.categoryId);
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      await uploadOne(item);
    } finally { uploadingRef.current = false; setUploadCategory(undefined); }
  };
  const cancelUpload = (id: string) => {
    cancelledTransferIdsRef.current.add(id);
    if (activeUploadRef.current?.id === id) activeUploadRef.current.controller.abort();
    else setTransfers((current) => current.filter((item) => item.id !== id));
  };
  const removeAsset = async (id: string) => {
    if (uploadingRef.current || !window.confirm(t("voice.removeConfirm"))) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadCategory("__removing__");
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const saved = await projectService.deleteAsset(taskId, id, current.version, validLocale);
      queryClient.setQueryData(["project", taskId], saved);
      form.setValue("assets", saved.voiceAndReferences.assets, { shouldDirty: true });
    } catch (error) {
      setUploadError(localizedApiError(error, t));
    } finally {
      uploadingRef.current = false;
      setUploadCategory(undefined);
    }
  };
  const continueStep = form.handleSubmit(async (values) => {
    if (navigating || uploadCategory) return;
    const checked = stepSchema.safeParse(values);
    if (!checked.success) { checked.error.issues.forEach((issue) => form.setError(issue.path as never, { message: issue.message })); const first = checked.error.issues[0]?.path.join("."); if (first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()); return; }
    setNavigating(true);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      await runSave(checked.data, true, true);
    } finally { setNavigating(false); }
  });

  return <div className={`wizard-page voice-page ${stage}-page`}>
    <div className="wizard-heading"><h1 className="sr-only">{t(`wizard.pageTitles.${stage}`)}</h1>{statusText && <span className={`save-state save-${saveState}`} role="alert">{statusText}</span>}</div>
    {stage === "voice" && narrationEnabled === true && removedVoiceCount > 0 && <div className="inline-notice" role="status">{t("voice.unavailableRemoved", { count: removedVoiceCount })}</div>}
    <StepProgress onNavigate={(path) => void navigateWithSave(path)} current={stage === "voice" ? 3 : 5} highestReachable={getHighestReachableStep(draftQuery.data)} onNext={() => void continueStep()} canContinue={stepSchema.safeParse(form.getValues()).success} busy={navigating || Boolean(uploadCategory)} />
    <form autoComplete="off" onSubmit={continueStep} inert={navigating} aria-busy={navigating}>
      <div className="voice-layout"><div className="form-stack">
        {stage === "voice" && <NarrationChoice value={narrationEnabled} error={form.formState.errors.narrationEnabled?.message} onChange={(value) => {
          if (!value) { audioRef.current?.pause(); setPlayingVoice(undefined); }
          form.clearErrors();
          form.setValue("narrationEnabled", value, { shouldDirty: true, shouldValidate: true });
        }}><section className="form-panel voice-settings"><div className="section-heading"><div><h2><span>3.1</span>{t("voice.sections.settings")}</h2><p>{t("voice.settingsHint")}</p></div></div>
          <div className="form-grid voice-grid">
            <EnumField label={t("voice.fields.contentLanguage")} icon={<FieldIcon name="language" />} htmlFor="voice-content-language" required error={form.formState.errors.contentLanguageId?.message} items={contentLanguageOptions} registration={form.register("contentLanguageId")} />
            <EnumField label={t("voice.fields.narrationTone")} icon={<FieldIcon name="tone" />} htmlFor="narration-tone" required error={form.formState.errors.narrationToneId?.message} items={narrationToneOptions} registration={form.register("narrationToneId")} />
            <EnumField label={t("voice.fields.speechRate")} icon={<FieldIcon name="pace" />} htmlFor="speech-rate" required error={form.formState.errors.speechRateId?.message} items={speechRateOptions} registration={form.register("speechRateId")} />
            <EnumField label={t("voice.fields.voiceGender")} icon={<FieldIcon name="gender" />} htmlFor="voice-gender" items={voiceGenderOptions} registration={form.register("voiceGenderId")} />
            <EnumField label={t("voice.fields.voiceAge")} icon={<FieldIcon name="age" />} htmlFor="voice-age" items={voiceAgeOptions} registration={form.register("voiceAgeId")} />
            <EnumField label={t("voice.fields.accent")} icon={<FieldIcon name="accent" />} htmlFor="voice-accent" items={accentOptions} registration={form.register("accentId")} />
            <EnumField label={t("voice.fields.emotionStyle")} icon={<FieldIcon name="emotion" />} htmlFor="voice-emotion" items={emotionOptions} registration={form.register("emotionStyleId")} />
            <Field className="field-wide" label={t("voice.fields.pronunciationNotes")} icon={<FieldIcon name="pronunciation" />} htmlFor="pronunciation-notes" error={form.formState.errors.pronunciationNotes?.message}><textarea id="pronunciation-notes" rows={2} maxLength={200} autoComplete="off" {...form.register("pronunciationNotes")} /></Field>
          </div>
        </section>

        {voicesQuery.isPending ? <div role="status">{t("common.loading")}</div> : voicesQuery.isError ? <ScreenError error={voicesQuery.error} onRetry={() => voicesQuery.refetch()} /> : <VoiceSamplesSection form={form} voices={voices} maxSelected={options.maxSelectedVoices} playingVoice={playingVoice} voiceTagMap={voiceTagMap} onSelect={selectVoice} onPrefer={preferVoice} onToggleAudio={toggleAudio} />}</NarrationChoice>}

        {stage === "references" && <>
<section className="form-panel">
              <h2><span>5.1</span>{t("wizard.sections.project")}</h2>

              <div className="form-grid">
                <Field label={t("wizard.fields.projectName")} icon={<FieldIcon name="project" />} htmlFor="projectName" error={form.formState.errors.projectName?.message}>
                  <input id="projectName" className="input-long" {...form.register("projectName")} />
                </Field>
                <Field label={t("wizard.fields.deadline")} icon={<FieldIcon name="calendar" />} htmlFor="deadline"><input id="deadline" type="date" className="input-short" {...form.register("deadline")} /></Field>
                <EnumField label={t("wizard.fields.brand")} icon={<FieldIcon name="brand" />} htmlFor="brandId" items={brandOptions} registration={form.register("brandId")} />
                <EnumField label={t("wizard.fields.videoGoal")} icon={<FieldIcon name="target" />} htmlFor="videoGoalId" required error={form.formState.errors.videoGoalId?.message} items={videoGoalOptions} registration={form.register("videoGoalId")} />
                <ChoiceField label={t("wizard.fields.audiences")} icon={<FieldIcon name="audience" />} id="audience-group" required error={form.formState.errors.audienceIds?.message}>
                  <ChoiceRow id="audience-group">{audienceOptions.map((item) => <label className="choice-chip" key={item.id} aria-disabled={item.unavailable}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedAudienceIds.includes(item.id)} {...form.register("audienceIds")} /><span>{item.label}</span></label>)}</ChoiceRow>
                </ChoiceField>
              </div>
            </section>
<ReferencesSection form={form} categories={referenceCategories} locale={validLocale} uploadCategory={uploadCategory} transfers={transfers} uploadError={uploadError} onUpload={upload} onRemoveAsset={removeAsset} onCancelUpload={cancelUpload} onRetryUpload={retryUpload} />

        <section className="form-panel direction-section"><div className="section-heading"><div><h2><span>5.3</span>{t("voice.sections.direction")}</h2></div></div><div className="form-grid">
          <Field className="field-wide" label={t("voice.fields.coreMessage")} icon={<FieldIcon name="message" />} htmlFor="core-message" required error={form.formState.errors.coreMessage?.message}><textarea id="core-message" rows={3} maxLength={300} autoComplete="off" {...form.register("coreMessage")} /></Field>
          <Field label={t("voice.fields.requiredScenes")} icon={<FieldIcon name="scene" />} htmlFor="required-scenes" error={form.formState.errors.requiredScenes?.message}><textarea id="required-scenes" rows={3} maxLength={300} autoComplete="off" {...form.register("requiredScenes")} /></Field>
          <Field label={t("voice.fields.authorPreferences")} icon={<FieldIcon name="preference" />} htmlFor="author-preferences" error={form.formState.errors.authorPreferences?.message}><textarea id="author-preferences" rows={3} maxLength={300} autoComplete="off" {...form.register("authorPreferences")} /></Field>
          <Field label={t("voice.fields.closingMessage")} icon={<FieldIcon name="message" />} htmlFor="closing-message" error={form.formState.errors.closingMessage?.message}><textarea id="closing-message" rows={3} maxLength={300} autoComplete="off" {...form.register("closingMessage")} /></Field>
          <Field label={t("voice.fields.musicMood")} icon={<FieldIcon name="music" />} htmlFor="music-mood" error={form.formState.errors.musicMood?.message}><textarea id="music-mood" rows={2} maxLength={200} autoComplete="off" {...form.register("musicMood")} /></Field>
          <Field className="field-wide" label={t("voice.fields.avoidContent")} icon={<FieldIcon name="avoid" />} htmlFor="avoid-content" error={form.formState.errors.avoidContent?.message}><textarea id="avoid-content" rows={2} maxLength={200} autoComplete="off" {...form.register("avoidContent")} /></Field>
        </div></section></>}
      </div><VoiceSummary stage={stage} control={form.control} voices={voices} /></div>
      <div className="sticky-actions"><Link className="button button-secondary" to={localizedPath(validLocale, `/tasks/${taskId}/edit/${stage === "voice" ? "characters" : "style"}`)} onClick={guardLink}>{t(stage === "voice" ? "wizard.actions.backCharacters" : "wizard.actions.backStyle")}</Link><div><button className="button button-quiet" type="button" disabled={navigating || Boolean(uploadCategory)} onClick={() => void navigateWithSave(localizedPath(validLocale, "/tasks"))}>{t("common.backHome")}</button>{conflict && <button className="button button-secondary" type="button" onClick={() => { failedSaveSnapshotRef.current = undefined; form.reset(); void draftQuery.refetch(); }}>{t("common.reload")}</button>}<button className="button button-primary" type="submit" disabled={navigating || Boolean(uploadCategory)}>{t(stage === "voice" ? "wizard.actions.toStyle" : "voice.continueToReview")}<span aria-hidden="true">→</span></button></div></div>
    </form>
  </div>;
}
