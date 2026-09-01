import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch, type Control, type UseFormReturn } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { ReferenceCategory, TaskDraft, VoiceReference } from "@lifewood/domain";
import { Field } from "../components/Field";
import { FieldIcon } from "../components/FieldIcon";
import { StepProgress } from "../components/StepProgress";
import { ScreenError } from "../components/ScreenError";
import { createVoiceDraftSchema, createVoiceStepSchema, type VoiceFormValues } from "./voiceFormSchema";
import { reconcileVoiceSelection } from "../voice-selection";
import { isCreativeComplete } from "./creativeFormSchema";
import { mergeLegacyOptions, type DisplayConfigOption } from "../legacy-options";
import { effectiveVoiceContentLanguage } from "../voice-content-language";
import { mergeLegacyCategories, type DisplayReferenceCategory } from "../legacy-categories";

function Options({ items }: { items: DisplayConfigOption[] }) { return <>{items.map((item) => <option key={item.id} value={item.id} disabled={item.unavailable}>{item.label}</option>)}</>; }
function formatBytes(value: number, locale: string) { return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000_000)}\u00a0MB`; }
type TransferItem = { id: string; categoryId: string; file: File; status: "uploading" | "error" | "cancelled"; error?: string };

function VoiceSummary({ control, voices }: { control: Control<VoiceFormValues>; voices: VoiceReference[] }) {
  const { t } = useTranslation();
  const [selectedVoiceIds, preferredVoiceId, assets, competitorUrls] = useWatch({ control, name: ["selectedVoiceIds", "preferredVoiceId", "assets", "competitorUrls"] });
  return <aside className="voice-summary"><div className="studio-card"><span className="folio-label">{t("voice.summary.selection")}</span><div className="studio-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</div><strong>{voices.find((voice) => voice.id === preferredVoiceId)?.name ?? t("voice.summary.noPreferred")}</strong><p>{selectedVoiceIds.length ? t("voice.summary.candidates", { count: selectedVoiceIds.length }) : t("voice.summary.noCandidates")}</p></div><div className="handoff-card"><span className="folio-label">{t("voice.summary.package")}</span><strong>{t("voice.summary.fileCount", { count: assets.length })}</strong><p>{t("voice.summary.linkCount", { count: competitorUrls.filter((url) => url.trim()).length })}</p></div><div className="next-card"><span className="next-mark" aria-hidden="true">→</span><div><h3>{t("voice.summary.nextTitle")}</h3><p>{t("voice.summary.nextBody")}</p></div></div></aside>;
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
  return <section className="form-panel reference-section"><div className="section-heading"><div><h2><span>3.3</span>{t("voice.sections.references")}</h2><p>{t("voice.referenceHint")}</p></div></div>
    <div className="upload-grid">{categories.map((category) => { const files = assets.filter((asset) => asset.categoryId === category.id); return <div className="upload-card" key={category.id}><div><strong>{category.label}</strong><small>{category.description}</small><small>{t("voice.fileLimit", { size: formatBytes(category.maxBytes, locale), count: category.maxFiles })}</small></div><label className={`button button-secondary ${uploadCategory || category.unavailable || files.length >= category.maxFiles ? "disabled" : ""}`} aria-disabled={Boolean(uploadCategory) || category.unavailable || files.length >= category.maxFiles} htmlFor={`upload-${category.id}`} aria-label={t("voice.chooseFor", { category: category.label })}>{uploadCategory === category.id ? t("voice.uploading") : t("voice.chooseFiles")}</label><input id={`upload-${category.id}`} name={`upload-${category.id}`} autoComplete="off" className="visually-hidden" type="file" multiple={category.maxFiles > 1} accept={category.accept.join(",")} disabled={Boolean(uploadCategory) || category.unavailable || files.length >= category.maxFiles} onChange={(event) => { void onUpload(category, event.target.files); event.target.value = ""; }} />{files.length > 0 && <ul className="uploaded-files">{files.map((asset) => <li key={asset.id}><span title={asset.fileName}>{asset.fileName}</span><small>{formatBytes(asset.sizeBytes, locale)}</small><button type="button" aria-label={t("voice.removeFile", { fileName: asset.fileName })} disabled={Boolean(uploadCategory)} onClick={() => void onRemoveAsset(asset.id)}>{t("voice.remove")}</button></li>)}</ul>}</div>; })}</div>
    {transfers.length > 0 && <ul className="transfer-list" aria-live="polite">{transfers.map((item) => <li key={item.id}><span>{item.file.name}</span><small>{item.status === "uploading" ? t("voice.uploading") : item.error}</small>{item.status === "uploading" ? <button type="button" onClick={() => onCancelUpload(item.id)}>{t("voice.cancelUpload")}</button> : <button type="button" disabled={Boolean(uploadCategory)} onClick={() => void onRetryUpload(item)}>{t("common.retry")}</button>}</li>)}</ul>}
    {uploadError && <div className="inline-error" role="alert">{uploadError}</div>}
    <div className="competitor-links" hidden={!linksEnabled && competitorUrls.length === 0}><div className="section-heading compact"><div><h3>{t("voice.fields.competitorLinks")}</h3><p>{t("voice.competitorHint")}</p></div><button className="button button-secondary" type="button" disabled={!linksEnabled || competitorUrls.length >= 5} onClick={() => form.setValue("competitorUrls", [...competitorUrls, ""], { shouldDirty: true })}>{t("voice.addLink")}</button></div>{competitorUrls.map((_, index) => { const error = form.formState.errors.competitorUrls?.[index]?.message; const messageId = `competitor-url-${index}-message`; return <div className="field" key={index}><label htmlFor={`competitor-url-${index}`}>{t("voice.linkNumber", { index: index + 1 })}</label><div className="inline-input"><input id={`competitor-url-${index}`} type="url" inputMode="url" spellCheck={false} autoComplete="off" readOnly={!linksEnabled} placeholder="https://example.com/…" aria-invalid={error ? true : undefined} aria-describedby={error ? messageId : undefined} {...form.register(`competitorUrls.${index}`)} /><button type="button" aria-label={t("voice.removeLink", { index: index + 1 })} onClick={() => form.setValue("competitorUrls", competitorUrls.filter((_, itemIndex) => itemIndex !== index), { shouldDirty: true })}>{t("voice.remove")}</button></div>{error && <div className="field-error" id={messageId} role="alert">{error}</div>}</div>; })}</div>
  </section>;
}

export function VoiceAndReferencesPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "invalid" | "error">("idle");
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
  const failedSaveSnapshotRef = useRef<string | undefined>(undefined);
  const draftSchema = useMemo(() => createVoiceDraftSchema(t), [t]);
  const stepSchema = useMemo(() => createVoiceStepSchema(t), [t]);
  const draftQuery = useQuery({ queryKey: ["project", taskId], queryFn: () => projectService.getProject(taskId!, validLocale), enabled: Boolean(taskId) });
  const optionsQuery = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const voicesQuery = useQuery({ queryKey: ["voices", validLocale], queryFn: () => optionService.getVoices(validLocale) });
  const voiceTagMap = useMemo(() => new Map((optionsQuery.data?.voiceTags ?? []).map((tag) => [tag.id, tag.label])), [optionsQuery.data?.voiceTags]);
  const form = useForm<VoiceFormValues>({ resolver: zodResolver(draftSchema), defaultValues: {
    contentLanguageId: "", narrationToneId: "", speechRateId: "", pronunciationNotes: "", voiceGenderId: "", voiceAgeId: "", accentId: "", emotionStyleId: "",
    selectedVoiceIds: [], preferredVoiceId: "", customVoiceDescription: "", assets: [], competitorUrls: [], coreMessage: "", requiredScenes: "", authorPreferences: "", closingMessage: "", musicMood: "", avoidContent: "",
  }});
  const autosaveValues = useWatch({ control: form.control });

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || !voicesQuery.data || form.formState.isDirty) return;
    const voice = draft.voiceAndReferences.voiceover;
    const direction = draft.voiceAndReferences.creativeDirection;
    const { selectedVoiceIds, preferredVoiceId, removedCount } = reconcileVoiceSelection(
      voice.selectedVoiceIds, voice.preferredVoiceId, voicesQuery.data.map((item) => item.id),
    );
    setRemovedVoiceCount(removedCount);
    form.reset({
      contentLanguageId: voice.contentLanguageId ?? draft.book.contentLanguageId ?? "", narrationToneId: voice.narrationToneId ?? "", speechRateId: voice.speechRateId ?? "",
      pronunciationNotes: voice.pronunciationNotes ?? "", voiceGenderId: voice.voiceGenderId ?? "", voiceAgeId: voice.voiceAgeId ?? "", accentId: voice.accentId ?? "", emotionStyleId: voice.emotionStyleId ?? "",
      selectedVoiceIds, preferredVoiceId, customVoiceDescription: voice.customVoiceDescription ?? "",
      assets: draft.voiceAndReferences.assets, competitorUrls: draft.voiceAndReferences.competitorUrls,
      coreMessage: direction.coreMessage, requiredScenes: direction.requiredScenes ?? "", authorPreferences: direction.authorPreferences ?? "", closingMessage: direction.closingMessage ?? "", musicMood: direction.musicMood ?? "", avoidContent: direction.avoidContent ?? "",
    });
  }, [draftQuery.data, voicesQuery.data, form, form.formState.isDirty]);

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
      setSaveState("saving");
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const next: TaskDraft = { ...current, voiceAndReferences: {
        voiceover: { contentLanguageId: values.contentLanguageId || undefined, narrationToneId: values.narrationToneId || undefined, speechRateId: values.speechRateId || undefined,
          pronunciationNotes: values.pronunciationNotes || undefined, voiceGenderId: values.voiceGenderId || undefined, voiceAgeId: values.voiceAgeId || undefined, accentId: values.accentId || undefined,
          emotionStyleId: values.emotionStyleId || undefined, selectedVoiceIds: values.selectedVoiceIds, preferredVoiceId: values.preferredVoiceId || undefined, customVoiceDescription: values.customVoiceDescription || undefined },
        assets: values.assets, competitorUrls: values.competitorUrls.map((url) => url.trim()).filter(Boolean),
        creativeDirection: { coreMessage: values.coreMessage, requiredScenes: values.requiredScenes || undefined, authorPreferences: values.authorPreferences || undefined,
          closingMessage: values.closingMessage || undefined, musicMood: values.musicMood || undefined, avoidContent: values.avoidContent || undefined },
      }};
      return { saved: await projectService.saveVoiceAndReferences(current.id, next, validLocale, continueAfter), continueAfter, values };
    },
    onSuccess: ({ saved, continueAfter, values }) => { queryClient.setQueryData(["project", taskId], saved); void queryClient.invalidateQueries({ queryKey: ["projects"] }); form.reset(values, { keepValues: true }); failedSaveSnapshotRef.current = undefined; setSaveState("saved"); if (continueAfter) navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/review`)); },
    onError: (_error, variables) => { failedSaveSnapshotRef.current = JSON.stringify(variables.values); setSaveState("error"); },
    onSettled: () => { saveInFlightRef.current = false; },
  });

  const runSave = (values: VoiceFormValues, continueAfter: boolean, explicit: boolean) => {
    const snapshot = JSON.stringify(values);
    if (saveInFlightRef.current || (!explicit && failedSaveSnapshotRef.current === snapshot)) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    save.mutate({ values, continueAfter });
  };

  useEffect(() => {
    if (!form.formState.isDirty || save.isPending || uploadCategory) return;
    const checked = draftSchema.safeParse(autosaveValues);
    if (!checked.success) { setSaveState("invalid"); return; }
    const snapshot = JSON.stringify(checked.data);
    if (failedSaveSnapshotRef.current === snapshot) return;
    setSaveState("pending");
    autosaveTimerRef.current = window.setTimeout(() => runSave(checked.data, false, false), 2_000);
    return () => { if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = undefined; };
  }, [autosaveValues, form.formState.isDirty, save.isPending, uploadCategory, draftSchema]);
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending || voicesQuery.isPending) return <div className="screen-status" aria-busy="true">{t("common.loading")}</div>;
  if (draftQuery.isError || optionsQuery.isError || voicesQuery.isError || !draftQuery.data || !optionsQuery.data || !voicesQuery.data) return <ScreenError error={draftQuery.error ?? optionsQuery.error ?? voicesQuery.error} onRetry={() => Promise.all([draftQuery.refetch(), optionsQuery.refetch(), voicesQuery.refetch()])} />;
  if (draftQuery.data.status !== "draft") return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />;
  if (!isCreativeComplete(draftQuery.data.creative)) return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/characters`)} />;

  const options = optionsQuery.data;
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
  const voices = voicesQuery.data.filter((voice) => voice.enabled);
  const conflict = save.error instanceof ApiError && save.error.details.code === "project.version_conflict";
  const statusText = saveState === "pending" ? t("common.savePending") : saveState === "saving" ? t("common.saving") : saveState === "saved" ? t("common.saved") : saveState === "invalid" ? t("common.saveNeedsAttention") : saveState === "error" ? t(conflict ? "wizard.versionConflict" : "wizard.saveFailed") : "";
  const guardLink = (event: MouseEvent<HTMLAnchorElement>) => { if (form.formState.isDirty && !window.confirm(t("wizard.unsavedChanges"))) event.preventDefault(); };
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
    if (!files?.length || uploadingRef.current || saveInFlightRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true; setUploadError(undefined); setUploadCategory(category.id);
    const available = Math.max(0, category.maxFiles - form.getValues("assets").filter((asset) => asset.categoryId === category.id).length);
    const queue = Array.from(files).slice(0, available).map((file) => ({ id: crypto.randomUUID(), categoryId: category.id, file, status: "uploading" as const }));
    setTransfers((current) => [...current, ...queue]);
    for (const item of queue) {
      if (cancelledTransferIdsRef.current.delete(item.id)) continue;
      await uploadOne(item);
    }
    uploadingRef.current = false; setUploadCategory(undefined);
  };
  const retryUpload = async (item: TransferItem) => { if (uploadingRef.current || saveInFlightRef.current) return; if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = undefined; uploadingRef.current = true; setUploadCategory(item.categoryId); await uploadOne(item); uploadingRef.current = false; setUploadCategory(undefined); };
  const cancelUpload = (id: string) => {
    cancelledTransferIdsRef.current.add(id);
    if (activeUploadRef.current?.id === id) activeUploadRef.current.controller.abort();
    else setTransfers((current) => current.filter((item) => item.id !== id));
  };
  const removeAsset = async (id: string) => {
    if (saveInFlightRef.current || !window.confirm(t("voice.removeConfirm"))) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    saveInFlightRef.current = true;
    setUploadCategory("__removing__");
    try {
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const saved = await projectService.deleteAsset(taskId, id, current.version, validLocale);
      queryClient.setQueryData(["project", taskId], saved);
      form.setValue("assets", saved.voiceAndReferences.assets, { shouldDirty: true });
    } catch (error) {
      setUploadError(localizedApiError(error, t));
    } finally {
      saveInFlightRef.current = false;
      setUploadCategory(undefined);
    }
  };
  const continueStep = form.handleSubmit((values) => {
    const checked = stepSchema.safeParse(values);
    if (!checked.success) { checked.error.issues.forEach((issue) => form.setError(issue.path as never, { message: issue.message })); const first = checked.error.issues[0]?.path.join("."); if (first) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()); return; }
    runSave(checked.data, true, true);
  });

  return <div className="wizard-page voice-page">
    <div className="wizard-heading"><div><h1>{t("wizard.pageTitles.voice")}</h1><p>{t("wizard.pageSubtitles.voice")}</p></div><span className={`save-state save-${saveState}`} aria-live="polite">{statusText}</span></div>
    {removedVoiceCount > 0 && <div className="inline-notice" role="status">{t("voice.unavailableRemoved", { count: removedVoiceCount })}</div>}
    <StepProgress current={3} />
    <form autoComplete="off" onSubmit={continueStep} inert={save.isPending && Boolean(save.variables?.continueAfter)} aria-busy={save.isPending && Boolean(save.variables?.continueAfter)}>
      <div className="voice-layout"><div className="form-stack">
        <section className="form-panel voice-settings"><div className="section-heading"><div><h2><span>3.1</span>{t("voice.sections.settings")}</h2><p>{t("voice.settingsHint")}</p></div></div>
          <div className="form-grid voice-grid">
            <Field label={t("voice.fields.contentLanguage")} icon={<FieldIcon name="language" />} htmlFor="voice-content-language" required error={form.formState.errors.contentLanguageId?.message}><select id="voice-content-language" autoComplete="off" {...form.register("contentLanguageId")}><option value="" /><Options items={contentLanguageOptions} /></select></Field>
            <Field label={t("voice.fields.narrationTone")} icon={<FieldIcon name="tone" />} htmlFor="narration-tone" required error={form.formState.errors.narrationToneId?.message}><select id="narration-tone" autoComplete="off" {...form.register("narrationToneId")}><option value="" /><Options items={narrationToneOptions} /></select></Field>
            <Field label={t("voice.fields.speechRate")} icon={<FieldIcon name="pace" />} htmlFor="speech-rate" required error={form.formState.errors.speechRateId?.message}><select id="speech-rate" autoComplete="off" {...form.register("speechRateId")}><option value="" /><Options items={speechRateOptions} /></select></Field>
            <Field label={t("voice.fields.voiceGender")} icon={<FieldIcon name="gender" />} htmlFor="voice-gender"><select id="voice-gender" autoComplete="off" {...form.register("voiceGenderId")}><option value="" /><Options items={voiceGenderOptions} /></select></Field>
            <Field label={t("voice.fields.voiceAge")} icon={<FieldIcon name="age" />} htmlFor="voice-age"><select id="voice-age" autoComplete="off" {...form.register("voiceAgeId")}><option value="" /><Options items={voiceAgeOptions} /></select></Field>
            <Field label={t("voice.fields.accent")} icon={<FieldIcon name="accent" />} htmlFor="voice-accent"><select id="voice-accent" autoComplete="off" {...form.register("accentId")}><option value="" /><Options items={accentOptions} /></select></Field>
            <Field label={t("voice.fields.emotionStyle")} icon={<FieldIcon name="emotion" />} htmlFor="voice-emotion"><select id="voice-emotion" autoComplete="off" {...form.register("emotionStyleId")}><option value="" /><Options items={emotionOptions} /></select></Field>
            <Field className="field-wide" label={t("voice.fields.pronunciationNotes")} icon={<FieldIcon name="pronunciation" />} htmlFor="pronunciation-notes" error={form.formState.errors.pronunciationNotes?.message}><textarea id="pronunciation-notes" rows={2} maxLength={200} autoComplete="off" {...form.register("pronunciationNotes")} /></Field>
          </div>
        </section>

        <VoiceSamplesSection form={form} voices={voices} maxSelected={options.maxSelectedVoices} playingVoice={playingVoice} voiceTagMap={voiceTagMap} onSelect={selectVoice} onPrefer={preferVoice} onToggleAudio={toggleAudio} />

        <ReferencesSection form={form} categories={referenceCategories} locale={validLocale} uploadCategory={uploadCategory ?? (save.isPending ? "__saving__" : undefined)} transfers={transfers} uploadError={uploadError} onUpload={upload} onRemoveAsset={removeAsset} onCancelUpload={cancelUpload} onRetryUpload={retryUpload} />

        <section className="form-panel direction-section"><div className="section-heading"><div><h2><span>3.4</span>{t("voice.sections.direction")}</h2><p>{t("voice.directionHint")}</p></div></div><div className="form-grid">
          <Field className="field-wide" label={t("voice.fields.coreMessage")} icon={<FieldIcon name="message" />} htmlFor="core-message" required error={form.formState.errors.coreMessage?.message}><textarea id="core-message" rows={3} maxLength={300} autoComplete="off" {...form.register("coreMessage")} /></Field>
          <Field label={t("voice.fields.requiredScenes")} icon={<FieldIcon name="scene" />} htmlFor="required-scenes" error={form.formState.errors.requiredScenes?.message}><textarea id="required-scenes" rows={3} maxLength={300} autoComplete="off" {...form.register("requiredScenes")} /></Field>
          <Field label={t("voice.fields.authorPreferences")} icon={<FieldIcon name="preference" />} htmlFor="author-preferences" error={form.formState.errors.authorPreferences?.message}><textarea id="author-preferences" rows={3} maxLength={300} autoComplete="off" {...form.register("authorPreferences")} /></Field>
          <Field label={t("voice.fields.closingMessage")} icon={<FieldIcon name="message" />} htmlFor="closing-message" error={form.formState.errors.closingMessage?.message}><textarea id="closing-message" rows={3} maxLength={300} autoComplete="off" {...form.register("closingMessage")} /></Field>
          <Field label={t("voice.fields.musicMood")} icon={<FieldIcon name="music" />} htmlFor="music-mood" error={form.formState.errors.musicMood?.message}><textarea id="music-mood" rows={2} maxLength={200} autoComplete="off" {...form.register("musicMood")} /></Field>
          <Field className="field-wide" label={t("voice.fields.avoidContent")} icon={<FieldIcon name="avoid" />} htmlFor="avoid-content" error={form.formState.errors.avoidContent?.message}><textarea id="avoid-content" rows={2} maxLength={200} autoComplete="off" {...form.register("avoidContent")} /></Field>
        </div></section>
      </div><VoiceSummary control={form.control} voices={voices} /></div>
      <div className="sticky-actions"><Link className="button button-secondary" to={localizedPath(validLocale, `/tasks/${taskId}/edit/characters`)} onClick={guardLink}>{t("wizard.actions.backCharacters")}</Link><p className="sticky-note">{t("wizard.footerNotes.voice")}</p><div><button className="button button-quiet" type="button" disabled={save.isPending || Boolean(uploadCategory)} onClick={form.handleSubmit((values) => runSave(values, false, true))}>{save.isPending ? t("common.saving") : t("common.saveNow")}</button>{conflict && <button className="button button-secondary" type="button" onClick={() => { failedSaveSnapshotRef.current = undefined; form.reset(); void draftQuery.refetch(); }}>{t("common.reload")}</button>}<button className="button button-primary" type="submit" disabled={save.isPending || Boolean(uploadCategory)}>{save.isPending ? t("common.saving") : t("voice.continueToReview")}<span aria-hidden="true">→</span></button></div></div>
    </form>
  </div>;
}
