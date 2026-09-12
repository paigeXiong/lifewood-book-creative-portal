import { DraftRecoveryDialog } from "../components/DraftRecoveryDialog";
import { sameUploadContent } from "../upload-reconciliation";
import type { ReactNode } from "react";
import { FileTransfers, type FileTransfer } from "../components/FileTransfers";
import { createId } from "../create-id";
import { safeLinkUrl } from "@lifewood/domain";
import { SaveFeedback } from "../components/SaveFeedback";
import { useDraftRecovery, focusSaveIssue } from "../useDraftRecovery";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import { useConfirm } from "../useConfirm";
import { useRevisionNext, useRevisionPrevious, RevisionLink } from "../revision-navigation";
import { toCreativeFormValues } from "../creative-form-values";
import { EnumField } from "../components/EnumField";
import { ChoiceRow } from "../components/ChoiceRow";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
} from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";
import { useWizardNavigate as useNavigate } from "../wizard-motion";
import {
  ApiError,
  localizedApiError,
  optionService,
  projectService,
} from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type {
  ConfigOption,
  CreativeInfo,
  ReferenceAsset,
  ReferenceCategory,
  TaskDraft,
} from "@lifewood/domain";
import { Field } from "../components/Field";
import { FieldIcon } from "../components/FieldIcon";
import { StylePreviewImage } from "../components/StylePreviewImage";
import { ColorToneChoice } from "../components/ColorToneChoice";
import { ChoiceField } from "../components/ChoiceField";
import { StepProgress } from "../components/StepProgress";
import { getHighestReachableStep } from "../workflow-progress";
import { ScreenError } from "../components/ScreenError";
import { FileDropCard } from "../components/FileDropCard";
import {
  createCreativeDraftSchema,
  createCharactersStepSchema,
  createStyleStepSchema,
  emptyCharacter,
  isCharactersComplete,
  type CreativeFormValues,
} from "./creativeFormSchema";
import { isVoicePreferencesComplete } from "./voiceFormSchema";
import {
  mergeLegacyOptions,
} from "../legacy-options";


function toCreativeInfo(values: CreativeFormValues): CreativeInfo {
  return {
    characters: values.characters.map((character) => ({
      ...character,
      roleTypeId: character.roleTypeId || undefined,
      ageRangeId: character.ageRangeId || undefined,
      genderId: character.genderId || undefined,
      clothing: character.clothing || undefined,
      emotion: character.emotion || undefined,
      voiceHint: character.voiceHint || undefined,
    })),
    visualStyleId: values.visualStyleId || undefined,
    moodTagIds: values.moodTagIds,
    imageStyleTagIds: values.imageStyleTagIds,
    paceTagIds: values.paceTagIds,
    styleReferenceImageUrls: values.styleReferenceImageUrls,
    styleReferenceImages: values.styleReferenceImages,
  };
}

function CharacterIdentity({
  character,
  roleTypes,
}: {
  character: CreativeFormValues["characters"][number] | undefined;
  roleTypes: ConfigOption[];
}) {
  const { t } = useTranslation();
  const roleLabel = roleTypes.find((item) => item.id === character?.roleTypeId)?.label ?? t("creative.rolePending");
  return (
    <div>
      <strong>{character?.name || t("creative.unnamedCharacter")}</strong>
      {roleLabel !== character?.name && <span>{roleLabel}</span>}
    </div>
  );
}

function ReferenceImageField({
  category,
  assets,
  busy,
  error,
  onUpload,
  onRemove,
  feedback,
  selectionBlocked,
}: {
  selectionBlocked?: boolean;
  feedback?: ReactNode;
  category?: ReferenceCategory;
  assets: ReferenceAsset[];
  busy: boolean;
  error?: string;
  onUpload: (files: FileList | readonly File[] | null) => Promise<void>;
  onRemove: (asset: ReferenceAsset) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  if (!category)
    return (
      <div className="reference-image-field unavailable">
        <p>{t("creative.referencesUnavailable")}</p>
      </div>
    );
  return (
    <div className="reference-image-upload">
      <FileDropCard
        inputId={`reference-upload-${category.id}`}
        category={category}
        files={assets}
        locale={i18n.language}
        busyCategory={busy ? category.id : undefined}
        className="character-reference-drop-card"
        showFileList={false}
        feedback={feedback}
        selectionBlocked={selectionBlocked}
        preview={<div className="reference-image-preview" aria-live="polite">
          {assets.length > 0 ? <>
            <ul className="reference-image-grid">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <a href={safeLinkUrl(asset.url, true)} target="_blank" rel="noreferrer">
                    <img src={asset.url} alt={asset.fileName} width="112" height="84" loading="lazy" />
                  </a>
                  <button type="button" disabled={busy || selectionBlocked} aria-label={t("creative.removeReferenceImage", { name: asset.fileName })} onClick={() => void onRemove(asset)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button>
                  <span title={asset.fileName}>{asset.fileName}</span>
                </li>
              ))}
            </ul>
            <p className="reference-image-status"><span aria-hidden="true">✓</span>{t("creative.referenceAdded", { count: assets.length })}</p>
          </> : <div className="reference-image-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5.5 19c.7-4 3-6 6.5-6s5.8 2 6.5 6" /></svg>
            <span>{t("creative.referenceEmpty")}</span>
          </div>}
        </div>}
        onUpload={async (_category, files) => onUpload(files)}
        onRemove={async (id) => {
          const asset = assets.find((item) => item.id === id);
          if (asset) await onRemove(asset);
        }}
      />
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function CreativeSummary({
  stage,
  control,
  visualStyles,
  roleTypes,
  styleTagMap,
  activeCharacter,
  onNext,
  nextDisabled,
}: {
  stage: "characters" | "style";
  control: Control<CreativeFormValues>;
  visualStyles: ConfigOption[];
  roleTypes: ConfigOption[];
  styleTagMap: Map<string, string>;
  activeCharacter?: CreativeFormValues["characters"][number];
  onNext: () => void;
  nextDisabled: boolean;
}) {
  const { t } = useTranslation();
  const next = useRevisionNext();
  const [visualStyleId, moodTagIds, imageStyleTagIds, paceTagIds] =
    useWatch({
      control,
      name: [
        "visualStyleId",
        "moodTagIds",
        "imageStyleTagIds",
        "paceTagIds",
      ],
    });
  const selectedStyle = visualStyles.find((item) => item.id === visualStyleId);
  const portrait = activeCharacter?.referenceImages[0]?.url ?? activeCharacter?.referenceImageUrls[0] ??
    (activeCharacter?.presetImageUrl ?? (activeCharacter?.presetId ? `/character-presets/${activeCharacter.presetId}.png` : undefined));
  return (
    <aside className="creative-summary">
      {stage === "characters" && activeCharacter && <figure className="focused-character-card">
        {portrait ? <img key={portrait} src={portrait} alt={t("creative.characterPortraitAlt", { name: activeCharacter.name || t("creative.unnamedCharacter") })} width={640} height={640} /> :
          <div className="focused-character-empty"><FieldIcon name="person" /><span>{t("creative.referenceEmpty")}</span></div>}
        <figcaption><CharacterIdentity character={activeCharacter} roleTypes={roleTypes} /></figcaption>
      </figure>}
      {stage === "style" && <div className="style-summary-card">
        <span className="folio-label">{t("creative.summary.direction")}</span>
        <StylePreviewImage option={selectedStyle} className="summary-swatch" />
        <strong>{selectedStyle?.label ?? t("creative.summary.noStyle")}</strong>
        <p>
          {[...moodTagIds, ...imageStyleTagIds, ...paceTagIds]
            .map((id) => styleTagMap.get(id))
            .filter(Boolean)
            .join(" · ") || t("creative.summary.noTags")}
        </p>
      </div>}
      <button className="next-card next-card-button" type="button" disabled={nextDisabled} onClick={onNext}>
        <span className="next-mark" aria-hidden="true">
          →
        </span>
        <div>
          <h3>{t(next ? "wizard.steps."+next : `creative.summary.${stage === "characters" ? "nextVoiceTitle" : "nextReferencesTitle"}`)}</h3>
        </div>
      </button>
    </aside>
  );
}

export function CreativeFormPage({ stage }: { stage: "characters" | "style" }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const revisionNext = useRevisionNext();
  const revisionPrevious = useRevisionPrevious();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const [saveState, setSaveState] = useState<
    "idle" | "invalid" | "error"
  >("idle");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>();
  const [uploadTarget, setUploadTarget] = useState<string>();
  const [transfers, setTransfers] = useState<FileTransfer[]>([]);
  const uploadBusyRef = useRef(false);
  const attemptedTransfers = useRef(new Set<string>());
  const uploadControllers = useRef(new Map<string, AbortController>());
  const cancelledTransfers = useRef(new Set<string>());
  const uploadEpoch = useRef(0);
  useEffect(() => {
    uploadEpoch.current += 1;
    setTransfers([]);
    setUploadError(undefined);
    setUploadTarget(undefined); uploadBusyRef.current = false;
    attemptedTransfers.current.clear(); cancelledTransfers.current.clear();
    return () => { uploadEpoch.current += 1; uploadControllers.current.forEach(controller => controller.abort()); };
  }, [taskId]);
  const [uploadError, setUploadError] = useState<string>();
  const [uploadErrorTarget, setUploadErrorTarget] = useState<string>();
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const savedSnapshotRef = useRef<string | undefined>(undefined);
  const [navigating, setNavigating] = useState(false);
  const conflictRef = useRef(false);
  const [recoveringInput, setRecoveringInput] = useState(false);
  useEffect(() => { setRecoveringInput(false); }, [taskId]);
  const failedSaveSnapshotRef = useRef<string | undefined>(undefined);
  const draftQuery = useQuery({
    queryKey: ["project", taskId],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
  });
  const previousToneIds = draftQuery.data?.creative.imageStyleTagIds;
  const draftSchema = useMemo(() => createCreativeDraftSchema(t, previousToneIds), [t, previousToneIds]);
  const stepSchema = useMemo(
    () => stage === "characters" ? createCharactersStepSchema(t, previousToneIds) : createStyleStepSchema(t, previousToneIds),
    [stage, t, previousToneIds],
  );
  const optionsQuery = useQuery({
    queryKey: ["form-options", validLocale],
    queryFn: () => optionService.getFormOptions(validLocale),
  });
  const form = useForm<CreativeFormValues>({
    resolver: zodResolver(draftSchema),
    defaultValues: {
      characters: [],
      visualStyleId: "",
      moodTagIds: [],
      imageStyleTagIds: [],
      paceTagIds: [],
      styleReferenceImageUrls: [],
      styleReferenceImages: [],
    },
  });
  const characters = useFieldArray({
    control: form.control,
    name: "characters",
    keyName: "formKey",
  });
  const watchedCharacters = useWatch({
    control: form.control,
    name: "characters",
  });
  const selectedMoodTagIds = useWatch({
    control: form.control,
    name: "moodTagIds",
  });
  const autosaveValues = useWatch({ control: form.control });
  const selectedImageStyleTagIds = useWatch({
    control: form.control,
    name: "imageStyleTagIds",
  });
  const selectedPaceTagIds = useWatch({
    control: form.control,
    name: "paceTagIds",
  });
  const selectedStyleReferenceImages = useWatch({
    control: form.control,
    name: "styleReferenceImages",
  });

  useEffect(() => {
    if (
      selectedCharacterId &&
      characters.fields.some(
        (character) => character.id === selectedCharacterId,
      )
    )
      return;
    setSelectedCharacterId(characters.fields[0]?.id);
  }, [characters.fields, selectedCharacterId]);

  const valuesFromDraft = (draft: TaskDraft) => toCreativeFormValues(draft.creative);
  const resetFromDraft = (draft: TaskDraft) => {
    form.reset(toCreativeFormValues(draft.creative));
  };
  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    resetFromDraft(draft);
  }, [draftQuery.data, form, form.formState.isDirty]);



  const saveCreative = useMutation({
    mutationFn: async ({
      values,
      continueAfter,
    }: {
      values: CreativeFormValues;
      continueAfter: boolean;
    }) => {

      const current =
        queryClient.getQueryData<TaskDraft>(["project", taskId]) ??
        draftQuery.data!;
      const next: TaskDraft = { ...current, creative: toCreativeInfo(values) };
      const saved = await projectService.saveCreative(
        current.id,
        next,
        validLocale,
      );
      return { saved, continueAfter, values };
    },
    onSuccess: async ({ saved, continueAfter, values }) => {
      const currentValues = draftSchema.safeParse(form.getValues());
      if (currentValues.success && JSON.stringify(currentValues.data) === JSON.stringify(values)) setRecoveringInput(false);
      queryClient.setQueryData(["project", taskId], saved);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      form.reset(values, { keepValues: true }); savedSnapshotRef.current = JSON.stringify(values);
      failedSaveSnapshotRef.current = undefined;
      setSaveState("idle");
      if (continueAfter)
        await navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/${stage === "characters" ? "voice" : "references"}`));
    },
    onError: (_error, variables) => {
      if (_error instanceof ApiError && _error.details.code === "project.version_conflict") conflictRef.current = true;
      failedSaveSnapshotRef.current = JSON.stringify(variables.values);
      setSaveState("error");
    },
    onSettled: () => {
      saveInFlightRef.current = false;
    },
  });

  const runSave = (
    values: CreativeFormValues,
    continueAfter: boolean,
    explicit: boolean,
  ) => {
    if (conflictRef.current) { setSaveState("error"); return Promise.resolve(false); }
    const snapshot = JSON.stringify(values);
    if (saveInFlightRef.current) return savePromiseRef.current ?? Promise.resolve(false);
    if (!explicit && failedSaveSnapshotRef.current === snapshot) return Promise.resolve(false);
    if (autosaveTimerRef.current !== undefined)
      window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    const pending = saveCreative.mutateAsync({ values, continueAfter }).then(() => true, () => false);
    savePromiseRef.current = pending;
    return pending;
  };

  const recovery = useDraftRecovery(taskId, validLocale, () => JSON.stringify(form.getValues()), (latest, fields) => {
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    setRecoveringInput(fields.length > 0);
    queryClient.setQueryData(["project", taskId], latest);
    resetFromDraft(latest);
    savedSnapshotRef.current = JSON.stringify(form.getValues());
    for (const field of fields) form.setValue(field.path.join(".") as never, field.local as never, { shouldDirty: true, shouldValidate: true });
    failedSaveSnapshotRef.current = undefined;
    conflictRef.current = false;
    saveCreative.reset(); setSaveState("idle");
  }, valuesFromDraft);
  const retrySave = async () => {
    if (saveInFlightRef.current) return;
    const checked = draftSchema.safeParse(form.getValues());
    if (!checked.success) {
      setSaveState("invalid");
      for (const issue of checked.error.issues) form.setError(issue.path.join(".") as never, { message: issue.message });
      const first = checked.error.issues[0]?.path;
      if (first?.[0] === "characters" && typeof first[1] === "number") setSelectedCharacterId(characters.fields[first[1]]?.id);
      if (first) focusSaveIssue(first.join("."));
      return;
    }
    await runSave(checked.data, false, true);
  };

  const unresolvedUploads = transfers.length > 0;
  useEffect(() => {
    if (!form.formState.isDirty || saveCreative.isPending || uploadTarget || unresolvedUploads || navigating) return;
    const checked = draftSchema.safeParse(autosaveValues);
    if (!checked.success) {
      setSaveState("invalid");
      return;
    }
    const snapshot = JSON.stringify(checked.data);
    if (failedSaveSnapshotRef.current === snapshot || savedSnapshotRef.current === snapshot) return;

    autosaveTimerRef.current = window.setTimeout(
      () => runSave(checked.data, false, false),
      0,
    );
    return () => {
      if (autosaveTimerRef.current !== undefined)
        window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = undefined;
    };
  }, [
    autosaveValues,
    form.formState.isDirty,
    saveCreative.isPending,
    uploadTarget,
    unresolvedUploads,
    navigating,
    draftSchema,
  ]);
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending)
    return (
      <div className="screen-status" role="status" aria-busy="true"><UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} />
        {t("common.loading")}
      </div>
    );
  if (
    draftQuery.isError ||
    optionsQuery.isError ||
    !draftQuery.data ||
    !optionsQuery.data
  )
    return <><UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} /><ScreenError error={draftQuery.error ?? optionsQuery.error} onRetry={() => Promise.all([draftQuery.refetch(), optionsQuery.refetch()])} /></>;
  if (draftQuery.data.status !== "draft")
    return (
      <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />
    );
  if (!recoveringInput && stage === "style" && !isCharactersComplete(draftQuery.data.creative))
    return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/characters`)} />;
  if (!recoveringInput && stage === "style" && !isVoicePreferencesComplete(draftQuery.data.voiceAndReferences))
    return <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}/edit/voice`)} />;

  const options = optionsQuery.data;
  const previous = draftQuery.data.creative;
  const unavailable = t("wizard.unavailableOption");
  const roleOptions = mergeLegacyOptions(
    options.roleTypes,
    previous.characters.map((item) => item.roleTypeId),
    unavailable,
  );
  const ageOptions = mergeLegacyOptions(
    options.ageRanges,
    previous.characters.map((item) => item.ageRangeId),
    unavailable,
  );
  const genderOptions = mergeLegacyOptions(
    options.genders,
    previous.characters.map((item) => item.genderId),
    unavailable,
  );
  const visualStyleOptions = mergeLegacyOptions(
    options.visualStyles,
    [previous.visualStyleId],
    unavailable,
  );
  const moodOptions = mergeLegacyOptions(
    options.moodTags,
    previous.moodTagIds,
    unavailable,
  );
  const imageStyleOptions = mergeLegacyOptions(
    options.imageStyleTags,
    previous.imageStyleTagIds,
    unavailable,
    options.legacyImageStyleTags,
  );
  const paceOptions = mergeLegacyOptions(
    options.paceTags,
    previous.paceTagIds,
    unavailable,
  );
  const characterReferenceCategory = options.referenceCategories.find(
    (category) => category.id === "character-reference",
  );
  const styleReferenceCategory = options.referenceCategories.find(
    (category) => category.id === "style-reference",
  );
  const styleTagMap = new Map(
    [...moodOptions, ...imageStyleOptions, ...paceOptions].map((item) => [
      item.id,
      item.label,
    ]),
  );
  const activeCharacterIndex = watchedCharacters.findIndex(
    (character) => character.id === selectedCharacterId,
  );
  const activeCharacter =
    activeCharacterIndex >= 0
      ? watchedCharacters[activeCharacterIndex]
      : undefined;
  const addCharacter = () => {
    const character = emptyCharacter();
    characters.append(character);
    setSelectedCharacterId(character.id);
  };
  const ensureCreativeSaved = async () => {
    if (conflictRef.current) throw new ApiError({ retryable: false, code: "project.version_conflict", messageKey: "wizard.versionConflict" });
    if (saveInFlightRef.current && !await savePromiseRef.current)
      throw new Error(t("wizard.saveFailed"));
    if (autosaveTimerRef.current !== undefined)
      window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    const checked = draftSchema.safeParse(form.getValues());
    if (!checked.success) throw new Error(t("common.saveNeedsAttention"));
    let current =
      queryClient.getQueryData<TaskDraft>(["project", taskId]) ??
      draftQuery.data!;
    if (!form.formState.isDirty) return current;
    if (!await runSave(checked.data, false, true)) {
      throw new ApiError({ retryable: false, code: conflictRef.current ? "project.version_conflict" : "project.save_failed", messageKey: conflictRef.current ? "wizard.versionConflict" : "wizard.saveFailed" });
    }
    return queryClient.getQueryData<TaskDraft>(["project", taskId])!;
  };
  const applyUploadedDraft = (current: TaskDraft) => {
    queryClient.setQueryData(["project", taskId], current);
    // Preserve text entered while the file was in flight; update only server-owned attachment lists.
    form.getValues("characters").forEach((character, index) => {
      const saved = current.creative.characters.find(item => item.id === character.id);
      if (saved) form.setValue(`characters.${index}.referenceImages`, saved.referenceImages ?? [], { shouldDirty: true });
    });
    form.setValue("styleReferenceImages", current.creative.styleReferenceImages ?? [], { shouldDirty: true });
    form.setValue("styleReferenceImageUrls", current.creative.styleReferenceImageUrls ?? [], { shouldDirty: true });
  };
  const uploadReference = async (item: FileTransfer) => {
    const epoch = uploadEpoch.current;
    const controller = new AbortController();
    uploadControllers.current.set(item.id, controller);
    setTransfers(items => items.map(entry => entry.id === item.id ? { ...entry, status: "uploading", progress: 0, error: undefined } : entry));
    try {
      if (attemptedTransfers.current.has(item.id) && saveInFlightRef.current) await savePromiseRef.current;
      if (epoch !== uploadEpoch.current) return;
      // A lost response may already have changed the version; replay before saving local edits.
      const current = attemptedTransfers.current.has(item.id)
        ? queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!
        : await ensureCreativeSaved();
      if (epoch !== uploadEpoch.current || controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      attemptedTransfers.current.add(item.id);
      const result = await projectService.uploadAsset(taskId, current.version, item.categoryId, item.file, validLocale, controller.signal, item.characterId, {
        uploadId: item.id,
        onProgress: progress => { if (epoch === uploadEpoch.current) setTransfers(items => items.map(entry => entry.id === item.id ? { ...entry, progress } : entry)); },
      });
      if (epoch !== uploadEpoch.current) return;
      if (!sameUploadContent(current, result.draft)) throw new ApiError({ code: "project.version_conflict", messageKey: "errors.project.versionConflict", retryable: false });
      applyUploadedDraft(result.draft);
      setTransfers(items => items.filter(entry => entry.id !== item.id));
      attemptedTransfers.current.delete(item.id);
      if (!conflictRef.current) setSaveState("idle");
      return true;
    } catch (error) {
      if (epoch !== uploadEpoch.current) return;
      const cancelled = controller.signal.aborted;
      setTransfers(items => items.map(entry => entry.id === item.id ? { ...entry, status: cancelled ? "cancelled" : "error", error: cancelled ? undefined : localizedApiError(error, t) } : entry));
      if (error instanceof ApiError && error.details.code === "project.version_conflict") { conflictRef.current = true; setSaveState("error"); }
    } finally { uploadControllers.current.delete(item.id); }
  };
  const runReferenceQueue = async (queue: FileTransfer[]) => {
    if (!queue.length || uploadBusyRef.current || uploadTarget) return;
    const epoch = uploadEpoch.current;
    uploadBusyRef.current = true;
    setUploadTarget(queue[0].characterId ? `character:${queue[0].characterId}` : "style");
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    setUploadError(undefined); setUploadErrorTarget(undefined);
    try {
      for (const item of queue) {
        if (epoch !== uploadEpoch.current) break;
        if (cancelledTransfers.current.delete(item.id)) continue;
        if (!await uploadReference(item)) break;
      }
    } finally { if (epoch === uploadEpoch.current) { uploadBusyRef.current = false; setUploadTarget(undefined); } }
  };
  const uploadReferences = async (category: ReferenceCategory | undefined, files: FileList | readonly File[] | null, characterId?: string) => {
    if (!category || !files?.length || uploadBusyRef.current || uploadTarget) return;
    const stored = characterId ? form.getValues("characters").find(item => item.id === characterId)?.referenceImages ?? [] : form.getValues("styleReferenceImages");
    const queue: FileTransfer[] = Array.from(files).slice(0, Math.max(0, category.maxFiles - stored.length))
      .map(file => ({ id: createId(), categoryId: category.id, characterId, file, status: "queued" }));
    setTransfers(items => [...items, ...queue]);
    await runReferenceQueue(queue);
  };
  const cancelReference = async (id: string) => {
    const controller = uploadControllers.current.get(id);
    if (controller) { controller.abort(); return; }
    const item = transfers.find(entry => entry.id === id);
    if (!item || item.status === "queued") {
      cancelledTransfers.current.add(id); setTransfers(items => items.filter(entry => entry.id !== id)); return;
    }
    if (uploadBusyRef.current) return;
    const epoch = uploadEpoch.current;
    uploadBusyRef.current = true; setUploadTarget("__reconciling__");
    try {
      const before = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const latest = await projectService.getProject(taskId!, validLocale);
      if (epoch !== uploadEpoch.current) return;
      if (!sameUploadContent(before, latest)) {
        conflictRef.current = true; setSaveState("error"); setUploadError(t("wizard.versionConflict")); return;
      }
      applyUploadedDraft(latest);
      setTransfers(items => items.filter(entry => entry.id !== id));
      setUploadError(undefined);
    } catch (error) { if (epoch === uploadEpoch.current) setUploadError(localizedApiError(error, t)); }
    finally { if (epoch === uploadEpoch.current) { uploadBusyRef.current = false; setUploadTarget(undefined); } }
  };
  const referenceFeedback = (characterId?: string) => <FileTransfers
    items={transfers.filter(item => item.characterId === characterId)} busy={Boolean(uploadTarget) || navigating}
    onCancel={cancelReference} onRetry={item => runReferenceQueue([item, ...transfers.filter(entry => entry.id !== item.id && entry.status === "queued")])} />;
  const removeReference = async (asset: ReferenceAsset) => {
    if (
      uploadTarget ||
      !await confirm(
        t("creative.removeReferenceConfirm", { name: asset.fileName }),
      )
    )
      return;
    const target = `remove:${asset.id}`;
    setUploadTarget(target);
    setUploadError(undefined);
    setUploadErrorTarget(undefined);
    try {
      const current = await ensureCreativeSaved();
      const saved = await projectService.deleteAsset(
        taskId,
        asset.id,
        current.version,
        validLocale,
      );
      queryClient.setQueryData(["project", taskId], saved);
      form.reset(toCreativeFormValues(saved.creative));
      setSaveState("idle");
    } catch (error) {
      if (error instanceof ApiError && error.details.code === "project.version_conflict") conflictRef.current = true;
      setUploadError(localizedApiError(error, t));
      setUploadErrorTarget(target);
      setSaveState("error");
    } finally {
      setUploadTarget(undefined);
    }
  };
  const deleteCharacter = async (index: number) => {
    const character = form.getValues(`characters.${index}`);
    if (
      !character ||
      uploadTarget ||
      !await confirm(t("creative.deleteConfirm"))
    )
      return;
    const target = `delete-character:${character.id}`;
    setUploadTarget(target);
    setUploadError(undefined);
    setUploadErrorTarget(undefined);
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      if (conflictRef.current) throw new ApiError({ retryable: false, code: "project.version_conflict", messageKey: "wizard.versionConflict" });
      if (autosaveTimerRef.current !== undefined)
        window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = undefined;
      const checked = draftSchema.safeParse(form.getValues());
      if (!checked.success) throw new Error(t("common.saveNeedsAttention"));
      const current =
        queryClient.getQueryData<TaskDraft>(["project", taskId]) ??
        draftQuery.data!;
      const currentValues = checked.data;
      const currentIndex = currentValues.characters.findIndex(
        (item) => item.id === character.id,
      );
      const next =
        currentValues.characters[currentIndex + 1] ??
        currentValues.characters[currentIndex - 1];
      const nextValues = {
        ...currentValues,
        characters: currentValues.characters.filter(
          (item) => item.id !== character.id,
        ),
      };
      saveInFlightRef.current = true;

      const saved = await projectService.saveCreative(
        current.id,
        { ...current, creative: toCreativeInfo(nextValues) },
        validLocale,
      );
      queryClient.setQueryData(["project", taskId], saved);
      form.reset(toCreativeFormValues(saved.creative));
      setSelectedCharacterId(next?.id);
      setSaveState("idle");
    } catch (error) {
      if (error instanceof ApiError && error.details.code === "project.version_conflict") conflictRef.current = true;
      setUploadError(localizedApiError(error, t));
      setUploadErrorTarget(target);
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      setUploadTarget(undefined);
    }
  };
  const conflict = conflictRef.current || conflictRef.current;
  const statusText = saveState === "invalid" ? t("common.saveNeedsAttention") : saveState === "error" ? (conflict ? t("wizard.versionConflict") : saveCreative.error instanceof ApiError ? localizedApiError(saveCreative.error, t) : t("wizard.saveFailed")) : "";
  const navigateWithSave = async (path: string) => {
    if (navigating || uploadTarget || transfers.length > 0) return;
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
  const continueStep = form.handleSubmit(async (values) => {
    if (navigating || uploadTarget || transfers.length > 0) return;
    const checked = stepSchema.safeParse(values);
    if (!checked.success) {
      checked.error.issues.forEach((issue) =>
        form.setError(issue.path.join(".") as never, { message: issue.message }),
      );
      const firstIssue = checked.error.issues[0];
      const first = firstIssue?.path.join(".");
      if (
        firstIssue?.path[0] === "characters" &&
        typeof firstIssue.path[1] === "number"
      ) {
        setSelectedCharacterId(
          form.getValues(`characters.${firstIssue.path[1]}`).id,
        );
        requestAnimationFrame(() => { if (first) focusSaveIssue(first); });
      } else if (first) focusSaveIssue(first);
      return;
    }
    setNavigating(true);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      await runSave(checked.data, true, true);
    } finally { setNavigating(false); }
  });

  return (
    <div className="wizard-page creative-page">
      <UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} />
      <div className="wizard-heading">
        <h1 className="sr-only">{t(`wizard.pageTitles.${stage}`)}</h1>
        <SaveFeedback message={statusText} conflict={conflict} invalid={saveState === "invalid"} busy={saveCreative.isPending || recovery.loading || navigating || Boolean(uploadTarget)} error={recovery.error} onRetry={() => void retrySave()} onReload={() => void recovery.reload()} />
        <DraftRecoveryDialog recovery={recovery} options={optionsQuery.data} />
      </div>
      <StepProgress onNavigate={(path) => void navigateWithSave(path)} current={stage === "characters" ? 2 : 4} highestReachable={getHighestReachableStep(draftQuery.data)} onNext={() => void continueStep()} canContinue={stepSchema.safeParse(form.getValues()).success} busy={navigating || Boolean(uploadTarget) || transfers.length > 0} />
      <form
        autoComplete="off"
        onSubmit={continueStep}
        inert={navigating || uploadTarget?.startsWith("remove:") || uploadTarget?.startsWith("delete-character:")}
        aria-busy={
          Boolean(uploadTarget) ||
          navigating
        }
      >
        <div className="creative-layout">
          <div className="form-stack">
            {stage === "characters" && <section
              className="form-panel character-section"
              id="characters-error-target"
              tabIndex={-1}
            >
              <div className="section-heading">
                <div>
                  <h2>
                    <span>2.1</span>
                    {t("creative.sections.characters")}
                  </h2>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={characters.fields.length >= 12 || Boolean(uploadTarget)}
                  onClick={addCharacter}
                >
                  <span aria-hidden="true">＋</span>
                  {t("creative.addCharacter")}
                </button>
              </div>
              {characters.fields.length === 0 && (
                <div className="character-empty">
                  <span aria-hidden="true">＋</span>
                  <div>
                    <strong>{t("creative.emptyTitle")}</strong>
                    <p>{t("creative.emptyBody")}</p>
                  </div>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={addCharacter}
                  >
                    {t("creative.addFirst")}
                  </button>
                </div>
              )}
              {typeof form.formState.errors.characters?.message ===
                "string" && (
                <div className="field-error" id="characters-error" role="alert">
                  {form.formState.errors.characters.message}
                </div>
              )}
              {activeCharacter && activeCharacterIndex >= 0 && (
                <div className="character-workspace">
                  <nav
                    className="character-roster"
                    aria-label={t("creative.characterListLabel")}
                  >
                    {characters.fields.map((character, index) => {
                      const value = watchedCharacters[index];
                      const thumbnail = value?.referenceImages?.[0] ?? ((value?.presetImageUrl ?? (value?.presetId ? `/character-presets/${value.presetId}.png` : "")) ? { url: value?.presetImageUrl ?? `/character-presets/${value?.presetId}.png` } : undefined);
                      return (
                        <button
                          type="button"
                          className={
                            character.id === selectedCharacterId ? "active" : ""
                          }
                          aria-pressed={character.id === selectedCharacterId}
                          key={character.formKey}
                          onClick={() => setSelectedCharacterId(character.id)}
                        >
                          {thumbnail ? (
                            <img
                              src={thumbnail.url}
                              alt=""
                              width="42"
                              height="42"
                              loading="lazy"
                            />
                          ) : (
                            <span
                              className="character-avatar-placeholder"
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" /><path d="M5.5 19c.7-4 3-6 6.5-6s5.8 2 6.5 6" /></svg>
                            </span>
                          )}
                          <CharacterIdentity
                            character={value}
                            roleTypes={roleOptions}
                          />
                        </button>
                      );
                    })}
                  </nav>
                  <article className="character-editor" key={`${activeCharacter.id}:${activeCharacterIndex}`}>
                    <div className="character-card-heading">
                      <CharacterIdentity
                        character={activeCharacter}
                        roleTypes={roleOptions}
                      />
                      <div className="character-actions">
                        <button
                          type="button"
                          aria-label={t("creative.moveUp")}
                          disabled={
                            activeCharacterIndex === 0 || Boolean(uploadTarget)
                          }
                          onClick={() =>
                            characters.swap(
                              activeCharacterIndex,
                              activeCharacterIndex - 1,
                            )
                          }
                         data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>↑</span></button>
                        <button
                          type="button"
                          aria-label={t("creative.moveDown")}
                          disabled={
                            activeCharacterIndex ===
                              characters.fields.length - 1 ||
                            Boolean(uploadTarget)
                          }
                          onClick={() =>
                            characters.swap(
                              activeCharacterIndex,
                              activeCharacterIndex + 1,
                            )
                          }
                         data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>↓</span></button>
                        <button
                          type="button"
                          className="danger-link"
                          disabled={
                            Boolean(uploadTarget) || navigating
                          }
                          onClick={() =>
                            void deleteCharacter(activeCharacterIndex)
                          }
                        >
                          {t("creative.delete")}
                        </button>
                      </div>
                    </div>
                    <div className="form-grid character-grid">
                      <EnumField
                        label={t("creative.fields.roleType")}
                        icon={<FieldIcon name="role" />}
                        htmlFor={`roleType-${activeCharacter.id}`}
                        required
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.roleTypeId?.message
                        }
                       items={roleOptions} registration={form.register(
                            `characters.${activeCharacterIndex}.roleTypeId`,
                          )} />
                      <Field
                        label={t("creative.fields.characterName")}
                        icon={<FieldIcon name="person" />}
                        htmlFor={`characterName-${activeCharacter.id}`}
                        required
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.name?.message
                        }
                      >
                        <input
                          id={`characterName-${activeCharacter.id}`}
                          {...form.register(
                            `characters.${activeCharacterIndex}.name`,
                          )}
                        />
                      </Field>
                      <Field
                        label={t("creative.fields.storyRole")}
                        icon={<FieldIcon name="story" />}
                        htmlFor={`storyRole-${activeCharacter.id}`}
                        required
                        className="field-wide"
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.storyRole?.message
                        }
                      >
                        <textarea
                          id={`storyRole-${activeCharacter.id}`}
                          rows={2}
                          maxLength={200}
                          {...form.register(
                            `characters.${activeCharacterIndex}.storyRole`,
                          )}
                        />
                      </Field>
                      <Field
                        label={t("creative.fields.personality")}
                        icon={<FieldIcon name="personality" />}
                        htmlFor={`personality-${activeCharacter.id}`}
                        required
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.personality?.message
                        }
                      >
                        <textarea
                          id={`personality-${activeCharacter.id}`}
                          rows={3}
                          maxLength={300}
                          {...form.register(
                            `characters.${activeCharacterIndex}.personality`,
                          )}
                        />
                      </Field>
                      <Field
                        label={t("creative.fields.appearance")}
                        icon={<FieldIcon name="appearance" />}
                        htmlFor={`appearance-${activeCharacter.id}`}
                        required
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.appearance?.message
                        }
                      >
                        <textarea
                          id={`appearance-${activeCharacter.id}`}
                          rows={3}
                          maxLength={300}
                          {...form.register(
                            `characters.${activeCharacterIndex}.appearance`,
                          )}
                        />
                      </Field>
                      <EnumField
                        label={t("creative.fields.ageRange")}
                        icon={<FieldIcon name="age" />}
                        htmlFor={`ageRange-${activeCharacter.id}`}
                       items={ageOptions} registration={form.register(
                            `characters.${activeCharacterIndex}.ageRangeId`,
                          )} />
                      <EnumField
                        label={t("creative.fields.gender")}
                        icon={<FieldIcon name="gender" />}
                        htmlFor={`gender-${activeCharacter.id}`}
                       items={genderOptions} registration={form.register(
                            `characters.${activeCharacterIndex}.genderId`,
                          )} />
                      <Field
                        label={t("creative.fields.clothing")}
                        icon={<FieldIcon name="clothing" />}
                        htmlFor={`clothing-${activeCharacter.id}`}
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.clothing?.message
                        }
                      >
                        <input
                          id={`clothing-${activeCharacter.id}`}
                          maxLength={200}
                          {...form.register(
                            `characters.${activeCharacterIndex}.clothing`,
                          )}
                        />
                      </Field>
                      <Field
                        label={t("creative.fields.emotion")}
                        icon={<FieldIcon name="emotion" />}
                        htmlFor={`emotion-${activeCharacter.id}`}
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.emotion?.message
                        }
                      >
                        <input
                          id={`emotion-${activeCharacter.id}`}
                          maxLength={150}
                          {...form.register(
                            `characters.${activeCharacterIndex}.emotion`,
                          )}
                        />
                      </Field>
                      <Field
                        label={t("creative.fields.voiceHint")}
                        icon={<FieldIcon name="voice" />}
                        htmlFor={`voiceHint-${activeCharacter.id}`}
                        className="field-wide"
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.voiceHint?.message
                        }
                      >
                        <input
                          id={`voiceHint-${activeCharacter.id}`}
                          className="input-long"
                          maxLength={100}
                          {...form.register(
                            `characters.${activeCharacterIndex}.voiceHint`,
                          )}
                        />
                      </Field>
                    </div>
                      <ReferenceImageField
                      key={`${taskId}:${activeCharacter.id}`}
                      category={characterReferenceCategory}
                      assets={activeCharacter.referenceImages}
                      busy={Boolean(uploadTarget) || navigating}
                      error={
                        uploadErrorTarget ===
                          `character:${activeCharacter.id}` ||
                        uploadErrorTarget ===
                          `delete-character:${activeCharacter.id}` ||
                        activeCharacter.referenceImages.some(
                          (asset) => uploadErrorTarget === `remove:${asset.id}`,
                        )
                          ? uploadError
                          : undefined
                      }
                      onUpload={(files) =>
                        uploadReferences(
                          characterReferenceCategory,
                          files,
                          activeCharacter.id,
                        )
                      }
                      selectionBlocked={transfers.length > 0}
                      feedback={referenceFeedback(activeCharacter.id)}
                      onRemove={removeReference}
                    />
                  </article>
                </div>
              )}
            </section>}

            {stage === "style" && <section className="form-panel style-section">
              <h2>
                    <span>4.1</span>
                {t("creative.sections.style")}
              </h2>
              <fieldset
                className="style-fieldset"
                aria-required="true"
                aria-invalid={
                  form.formState.errors.visualStyleId ? true : undefined
                }
                aria-describedby={
                  form.formState.errors.visualStyleId
                    ? "visual-style-error"
                    : undefined
                }
              >
                <legend className="field-label-with-icon">
                  <span className="field-label-icon" aria-hidden="true"><FieldIcon name="style" /></span>
                  <span>
                  {t("creative.fields.visualStyle")}
                  <span className="required" aria-hidden="true">
                    *
                  </span>
                  </span>
                </legend>
                <div className="style-grid">
                  {visualStyleOptions.map((item) => (
                    <label className="style-option" key={item.id}>
                      <input
                        type="radio"
                        value={item.id}
                        disabled={item.unavailable}
                        {...form.register("visualStyleId")}
                      />
                      <StylePreviewImage option={item} className="style-swatch" />
                      <strong>{item.label}</strong>
                    </label>
                  ))}
                </div>
                {form.formState.errors.visualStyleId?.message && (
                  <div
                    className="field-error"
                    id="visual-style-error"
                    role="alert"
                  >
                    {form.formState.errors.visualStyleId.message}
                  </div>
                )}
              </fieldset>
              <ChoiceField
                label={t("creative.fields.moodTags")}
                icon={<FieldIcon name="emotion" />}
                id="mood-tags"
                error={form.formState.errors.moodTagIds?.message}
              >
                <ChoiceRow>
                  {moodOptions.map((item) => (
                    <label className="choice-chip" key={item.id}>
                      <input
                        type="checkbox"
                        value={item.id}
                        disabled={
                          item.unavailable &&
                          !selectedMoodTagIds.includes(item.id)
                        }
                        {...form.register("moodTagIds")}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </ChoiceRow>
              </ChoiceField>
              <ColorToneChoice
                options={imageStyleOptions}
                value={selectedImageStyleTagIds}
                onChange={(value) => form.setValue("imageStyleTagIds", value, { shouldDirty: true, shouldValidate: true })}
                error={form.formState.errors.imageStyleTagIds?.message}
              />
              <ChoiceField
                label={t("creative.fields.paceTags")}
                icon={<FieldIcon name="pace" />}
                id="pace-tags"
                error={form.formState.errors.paceTagIds?.message}
              >
                <ChoiceRow>
                  {paceOptions.map((item) => (
                    <label className="choice-chip" key={item.id}>
                      <input
                        type="checkbox"
                        value={item.id}
                        disabled={
                          item.unavailable &&
                          !selectedPaceTagIds.includes(item.id)
                        }
                        {...form.register("paceTagIds")}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </ChoiceRow>
              </ChoiceField>
              <ReferenceImageField
                key={`${taskId}:style`}
                category={styleReferenceCategory}
                assets={selectedStyleReferenceImages}
                busy={Boolean(uploadTarget) || navigating}
                error={
                  uploadErrorTarget === "style" ||
                  selectedStyleReferenceImages.some(
                    (asset) => uploadErrorTarget === `remove:${asset.id}`,
                  )
                    ? uploadError
                    : undefined
                }
                onUpload={(files) =>
                  uploadReferences(styleReferenceCategory, files)
                }
                selectionBlocked={transfers.length > 0}
                feedback={referenceFeedback()}
                onRemove={removeReference}
              />
            </section>}
          </div>

          <CreativeSummary
            stage={stage}
            control={form.control}
            visualStyles={visualStyleOptions}
            roleTypes={roleOptions}
            styleTagMap={styleTagMap}
            activeCharacter={activeCharacter}
            onNext={() => void continueStep()}
            nextDisabled={navigating || Boolean(uploadTarget) || transfers.length > 0}
          />
        </div>
        <div className="sticky-actions">
          <RevisionLink hideWhenLocked
            className="button button-secondary"
            to={localizedPath(validLocale, `/tasks/${taskId}/edit/${revisionPrevious ?? (stage === "characters" ? "project" : "voice")}`)}
            onClick={guardLink}
          >
            {revisionPrevious ? t("clientUx.backTo",{unit:t("wizard.steps."+revisionPrevious)}) : t(stage === "characters" ? "wizard.actions.backUpload" : "wizard.actions.backVoice")}
          </RevisionLink>

          <div>
            <button
              className="button button-quiet"
              type="button"
              disabled={navigating || Boolean(uploadTarget) || transfers.length > 0}
              onClick={() => void navigateWithSave(localizedPath(validLocale, "/tasks"))}
            >
              {t("common.backHome")}
            </button>

            <button
              className="button button-primary"
              type="submit"
              disabled={navigating || Boolean(uploadTarget) || transfers.length > 0}
            >
              {t(revisionNext ? `wizard.steps.${revisionNext}` : (stage === "characters" ? "wizard.actions.toVoice" : "wizard.actions.toReferences"))}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
