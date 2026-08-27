import {
  useEffect,
  useId,
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
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
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
import { ChoiceField } from "../components/ChoiceField";
import { StepProgress } from "../components/StepProgress";
import {
  createCreativeDraftSchema,
  createCreativeStepSchema,
  emptyCharacter,
  type CreativeFormValues,
} from "./creativeFormSchema";
import {
  mergeLegacyOptions,
  type DisplayConfigOption,
} from "../legacy-options";

function Options({ items }: { items: DisplayConfigOption[] }) {
  return (
    <>
      {items.map((item) => (
        <option key={item.id} value={item.id} disabled={item.unavailable}>
          {item.label}
        </option>
      ))}
    </>
  );
}

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

function toCreativeFormValues(creative: CreativeInfo): CreativeFormValues {
  return {
    characters: creative.characters.map((character) => ({
      id: character.id,
      roleTypeId: character.roleTypeId ?? "",
      name: character.name,
      storyRole: character.storyRole,
      personality: character.personality,
      appearance: character.appearance,
      ageRangeId: character.ageRangeId ?? "",
      genderId: character.genderId ?? "",
      clothing: character.clothing ?? "",
      emotion: character.emotion ?? "",
      voiceHint: character.voiceHint ?? "",
      referenceImageUrls: character.referenceImageUrls,
      referenceImages: character.referenceImages ?? [],
    })),
    visualStyleId: creative.visualStyleId ?? "",
    moodTagIds: creative.moodTagIds,
    imageStyleTagIds: creative.imageStyleTagIds,
    paceTagIds: creative.paceTagIds,
    styleReferenceImageUrls: creative.styleReferenceImageUrls,
    styleReferenceImages: creative.styleReferenceImages ?? [],
  };
}

function CharacterIdentity({
  control,
  index,
  roleTypes,
}: {
  control: Control<CreativeFormValues>;
  index: number;
  roleTypes: ConfigOption[];
}) {
  const { t } = useTranslation();
  const character = useWatch({ control, name: `characters.${index}` });
  return (
    <div>
      <strong>{character?.name || t("creative.unnamedCharacter")}</strong>
      <span>
        {roleTypes.find((item) => item.id === character?.roleTypeId)?.label ??
          t("creative.rolePending")}
      </span>
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
}: {
  category?: ReferenceCategory;
  assets: ReferenceAsset[];
  busy: boolean;
  error?: string;
  onUpload: (files: FileList | null) => Promise<void>;
  onRemove: (asset: ReferenceAsset) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  if (!category)
    return (
      <div className="reference-image-field unavailable">
        <p>{t("creative.referencesUnavailable")}</p>
      </div>
    );
  const limitReached = assets.length >= category.maxFiles;
  return (
    <div className="reference-image-field">
      <div className="reference-image-heading">
        <div>
          <strong>{category.label}</strong>
          <small>{category.description}</small>
        </div>
        <label
          className={`button button-secondary ${busy || limitReached ? "disabled" : ""}`}
          aria-disabled={busy || limitReached}
          htmlFor={inputId}
        >
          {busy ? t("voice.uploading") : t("creative.addReferenceImages")}
        </label>
        <input
          id={inputId}
          name={inputId}
          className="visually-hidden"
          type="file"
          accept={category.accept.join(",")}
          multiple
          disabled={busy || limitReached}
          onChange={(event) => {
            void onUpload(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>
      <small className="reference-image-limit">
        {t("creative.referenceLimit", {
          count: category.maxFiles,
          size: new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: 1,
          }).format(category.maxBytes / 1_000_000),
        })}
      </small>
      {assets.length > 0 && (
        <ul className="reference-image-grid">
          {assets.map((asset) => (
            <li key={asset.id}>
              <a href={asset.url} target="_blank" rel="noreferrer">
                <img
                  src={asset.url}
                  alt={asset.fileName}
                  width="112"
                  height="84"
                  loading="lazy"
                />
              </a>
              <button
                type="button"
                disabled={busy}
                aria-label={t("creative.removeReferenceImage", {
                  name: asset.fileName,
                })}
                onClick={() => void onRemove(asset)}
              >
                ×
              </button>
              <span title={asset.fileName}>{asset.fileName}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function CreativeSummary({
  control,
  visualStyles,
  roleTypes,
  styleTagMap,
}: {
  control: Control<CreativeFormValues>;
  visualStyles: ConfigOption[];
  roleTypes: ConfigOption[];
  styleTagMap: Map<string, string>;
}) {
  const { t } = useTranslation();
  const [characters, visualStyleId, moodTagIds, imageStyleTagIds, paceTagIds] =
    useWatch({
      control,
      name: [
        "characters",
        "visualStyleId",
        "moodTagIds",
        "imageStyleTagIds",
        "paceTagIds",
      ],
    });
  const selectedStyle = visualStyles.find((item) => item.id === visualStyleId);
  return (
    <aside className="creative-summary">
      <div className="casting-card">
        <span className="folio-label">{t("creative.summary.casting")}</span>
        <strong>
          {t("creative.summary.characterCount", { count: characters.length })}
        </strong>
        <div className="casting-stack">
          {characters.slice(0, 5).map((character, index) => (
            <div key={character.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>
                  {character.name || t("creative.unnamedCharacter")}
                </strong>
                <small>
                  {roleTypes.find((item) => item.id === character.roleTypeId)
                    ?.label ?? "—"}
                </small>
              </div>
            </div>
          ))}
        </div>
        {characters.length > 5 && (
          <small>
            {t("creative.summary.more", { count: characters.length - 5 })}
          </small>
        )}
      </div>
      <div className="style-summary-card">
        <span className="folio-label">{t("creative.summary.direction")}</span>
        <div
          className="summary-swatch"
          style={{ backgroundColor: selectedStyle?.previewColor ?? "#e7e7e1" }}
        >
          <i />
        </div>
        <strong>{selectedStyle?.label ?? t("creative.summary.noStyle")}</strong>
        <p>
          {[...moodTagIds, ...imageStyleTagIds, ...paceTagIds]
            .map((id) => styleTagMap.get(id))
            .filter(Boolean)
            .join(" · ") || t("creative.summary.noTags")}
        </p>
      </div>
      <div className="next-card">
        <span className="next-mark" aria-hidden="true">
          →
        </span>
        <div>
          <h3>{t("creative.summary.nextTitle")}</h3>
          <p>{t("creative.summary.nextBody")}</p>
        </div>
      </div>
    </aside>
  );
}

export function CreativeFormPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const [saveState, setSaveState] = useState<
    "idle" | "pending" | "saving" | "saved" | "invalid" | "error"
  >("idle");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>();
  const [uploadTarget, setUploadTarget] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();
  const [uploadErrorTarget, setUploadErrorTarget] = useState<string>();
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const failedSaveSnapshotRef = useRef<string | undefined>(undefined);
  const draftSchema = useMemo(() => createCreativeDraftSchema(t), [t]);
  const stepSchema = useMemo(() => createCreativeStepSchema(t), [t]);
  const draftQuery = useQuery({
    queryKey: ["project", taskId],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
  });
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

  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    form.reset(toCreativeFormValues(draft.creative));
  }, [draftQuery.data, form, form.formState.isDirty]);

  useEffect(() => {
    const dirty = form.formState.isDirty;
    document.body.dataset.unsavedChanges = String(dirty);
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    const preventBackLoss = () => {
      if (dirty && !window.confirm(t("wizard.unsavedChanges")))
        window.history.go(1);
    };
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("popstate", preventBackLoss);
    return () => {
      window.removeEventListener("beforeunload", preventLoss);
      window.removeEventListener("popstate", preventBackLoss);
      delete document.body.dataset.unsavedChanges;
    };
  }, [form.formState.isDirty, t]);

  const saveCreative = useMutation({
    mutationFn: async ({
      values,
      continueAfter,
    }: {
      values: CreativeFormValues;
      continueAfter: boolean;
    }) => {
      setSaveState("saving");
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
    onSuccess: ({ saved, continueAfter, values }) => {
      queryClient.setQueryData(["project", taskId], saved);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      form.reset(values, { keepValues: true });
      failedSaveSnapshotRef.current = undefined;
      setSaveState("saved");
      if (continueAfter)
        navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/voice`));
    },
    onError: (_error, variables) => {
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
    const snapshot = JSON.stringify(values);
    if (
      saveInFlightRef.current ||
      (!explicit && failedSaveSnapshotRef.current === snapshot)
    )
      return;
    if (autosaveTimerRef.current !== undefined)
      window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    saveCreative.mutate({ values, continueAfter });
  };

  useEffect(() => {
    if (!form.formState.isDirty || saveCreative.isPending) return;
    const checked = draftSchema.safeParse(autosaveValues);
    if (!checked.success) {
      setSaveState("invalid");
      return;
    }
    const snapshot = JSON.stringify(checked.data);
    if (failedSaveSnapshotRef.current === snapshot) return;
    setSaveState("pending");
    autosaveTimerRef.current = window.setTimeout(
      () => runSave(checked.data, false, false),
      2_000,
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
    draftSchema,
  ]);
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending)
    return (
      <div className="screen-status" role="status" aria-busy="true">
        {t("common.loading")}
      </div>
    );
  if (
    draftQuery.isError ||
    optionsQuery.isError ||
    !draftQuery.data ||
    !optionsQuery.data
  )
    return (
      <div className="screen-status" role="alert">
        {localizedApiError(draftQuery.error ?? optionsQuery.error, t)}
      </div>
    );
  if (draftQuery.data.status !== "draft")
    return (
      <Navigate replace to={localizedPath(validLocale, `/tasks/${taskId}`)} />
    );

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
    if (saveCreative.isPending || saveInFlightRef.current)
      throw new Error(t("common.saving"));
    if (autosaveTimerRef.current !== undefined)
      window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    const checked = draftSchema.safeParse(form.getValues());
    if (!checked.success) throw new Error(t("common.saveNeedsAttention"));
    let current =
      queryClient.getQueryData<TaskDraft>(["project", taskId]) ??
      draftQuery.data!;
    if (!form.formState.isDirty) return current;
    saveInFlightRef.current = true;
    setSaveState("saving");
    try {
      current = await projectService.saveCreative(
        current.id,
        { ...current, creative: toCreativeInfo(checked.data) },
        validLocale,
      );
      queryClient.setQueryData(["project", taskId], current);
      form.reset(toCreativeFormValues(current.creative));
      setSaveState("saved");
      return current;
    } finally {
      saveInFlightRef.current = false;
    }
  };
  const uploadReferences = async (
    category: ReferenceCategory | undefined,
    files: FileList | null,
    characterId?: string,
  ) => {
    if (!category || !files?.length || uploadTarget) return;
    const target = characterId ? `character:${characterId}` : "style";
    setUploadTarget(target);
    setUploadError(undefined);
    setUploadErrorTarget(undefined);
    try {
      let current = await ensureCreativeSaved();
      const stored = characterId
        ? (current.creative.characters.find(
            (character) => character.id === characterId,
          )?.referenceImages ?? [])
        : (current.creative.styleReferenceImages ?? []);
      const queue = Array.from(files).slice(
        0,
        Math.max(0, category.maxFiles - stored.length),
      );
      for (const file of queue) {
        const result = await projectService.uploadAsset(
          taskId,
          current.version,
          category.id,
          file,
          validLocale,
          undefined,
          characterId,
        );
        current = result.draft;
        queryClient.setQueryData(["project", taskId], current);
        form.reset(toCreativeFormValues(current.creative));
      }
      setSaveState("saved");
    } catch (error) {
      setUploadError(localizedApiError(error, t));
      setUploadErrorTarget(target);
      setSaveState("error");
    } finally {
      setUploadTarget(undefined);
    }
  };
  const removeReference = async (asset: ReferenceAsset) => {
    if (
      uploadTarget ||
      !window.confirm(
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
      setSaveState("saved");
    } catch (error) {
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
      saveCreative.isPending ||
      saveInFlightRef.current ||
      !window.confirm(t("creative.deleteConfirm"))
    )
      return;
    const target = `delete-character:${character.id}`;
    setUploadTarget(target);
    setUploadError(undefined);
    setUploadErrorTarget(undefined);
    try {
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
      setSaveState("saving");
      const saved = await projectService.saveCreative(
        current.id,
        { ...current, creative: toCreativeInfo(nextValues) },
        validLocale,
      );
      queryClient.setQueryData(["project", taskId], saved);
      form.reset(toCreativeFormValues(saved.creative));
      setSelectedCharacterId(next?.id);
      setSaveState("saved");
    } catch (error) {
      setUploadError(localizedApiError(error, t));
      setUploadErrorTarget(target);
      setSaveState("error");
    } finally {
      saveInFlightRef.current = false;
      setUploadTarget(undefined);
    }
  };
  const conflict =
    saveCreative.error instanceof ApiError &&
    saveCreative.error.details.code === "project.version_conflict";
  const statusText =
    saveState === "pending"
      ? t("common.savePending")
      : saveState === "saving"
        ? t("common.saving")
        : saveState === "saved"
          ? t("common.saved")
          : saveState === "invalid"
            ? t("common.saveNeedsAttention")
            : saveState === "error"
              ? t(conflict ? "wizard.versionConflict" : "wizard.saveFailed")
              : "";
  const guardLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (form.formState.isDirty && !window.confirm(t("wizard.unsavedChanges")))
      event.preventDefault();
  };
  const continueStep = form.handleSubmit((values) => {
    const checked = stepSchema.safeParse(values);
    if (!checked.success) {
      checked.error.issues.forEach((issue) =>
        form.setError(issue.path as never, { message: issue.message }),
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
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(),
          ),
        );
      } else if (first)
        requestAnimationFrame(() =>
          (first === "characters"
            ? document.getElementById("characters-error-target")
            : document.querySelector<HTMLElement>(`[name="${first}"]`)
          )?.focus(),
        );
      return;
    }
    runSave(checked.data, true, true);
  });

  return (
    <div className="wizard-page creative-page">
      <div className="wizard-heading">
        <div>
          <h1>{t("wizard.pageTitles.characters")}</h1>
          <p>{t("wizard.pageSubtitles.characters")}</p>
        </div>
        <span
          className={`save-state save-${saveState}`}
          role={saveState === "error" ? "alert" : "status"}
        >
          {statusText}
        </span>
      </div>
      <StepProgress current={2} />
      <form
        autoComplete="off"
        onSubmit={continueStep}
        inert={
          Boolean(uploadTarget) ||
          (saveCreative.isPending &&
            Boolean(saveCreative.variables?.continueAfter))
        }
        aria-busy={
          Boolean(uploadTarget) ||
          (saveCreative.isPending &&
            Boolean(saveCreative.variables?.continueAfter))
        }
      >
        <div className="creative-layout">
          <div className="form-stack">
            <section
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
                  <p>{t("creative.characterHint")}</p>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={characters.fields.length >= 12}
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
                      const thumbnail = value?.referenceImages?.[0];
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
                              className="character-number"
                              aria-hidden="true"
                            >
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          )}
                          <CharacterIdentity
                            control={form.control}
                            index={index}
                            roleTypes={roleOptions}
                          />
                        </button>
                      );
                    })}
                  </nav>
                  <article className="character-editor">
                    <div className="character-card-heading">
                      <CharacterIdentity
                        control={form.control}
                        index={activeCharacterIndex}
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
                        >
                          ↑
                        </button>
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
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="danger-link"
                          disabled={
                            Boolean(uploadTarget) || saveCreative.isPending
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
                      <Field
                        label={t("creative.fields.roleType")}
                        htmlFor={`roleType-${activeCharacter.id}`}
                        required
                        error={
                          form.formState.errors.characters?.[
                            activeCharacterIndex
                          ]?.roleTypeId?.message
                        }
                      >
                        <select
                          id={`roleType-${activeCharacter.id}`}
                          {...form.register(
                            `characters.${activeCharacterIndex}.roleTypeId`,
                          )}
                        >
                          <option value="" />
                          <Options items={roleOptions} />
                        </select>
                      </Field>
                      <Field
                        label={t("creative.fields.characterName")}
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
                      <Field
                        label={t("creative.fields.ageRange")}
                        htmlFor={`ageRange-${activeCharacter.id}`}
                      >
                        <select
                          id={`ageRange-${activeCharacter.id}`}
                          {...form.register(
                            `characters.${activeCharacterIndex}.ageRangeId`,
                          )}
                        >
                          <option value="" />
                          <Options items={ageOptions} />
                        </select>
                      </Field>
                      <Field
                        label={t("creative.fields.gender")}
                        htmlFor={`gender-${activeCharacter.id}`}
                      >
                        <select
                          id={`gender-${activeCharacter.id}`}
                          {...form.register(
                            `characters.${activeCharacterIndex}.genderId`,
                          )}
                        >
                          <option value="" />
                          <Options items={genderOptions} />
                        </select>
                      </Field>
                      <Field
                        label={t("creative.fields.clothing")}
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
                      category={characterReferenceCategory}
                      assets={activeCharacter.referenceImages}
                      busy={Boolean(uploadTarget) || saveCreative.isPending}
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
                      onRemove={removeReference}
                    />
                  </article>
                </div>
              )}
            </section>

            <section className="form-panel style-section">
              <h2>
                <span>2.2</span>
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
                <legend>
                  {t("creative.fields.visualStyle")}
                  <span className="required" aria-hidden="true">
                    *
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
                      <span
                        className="style-swatch"
                        style={{
                          backgroundColor: item.previewColor ?? "#d8d4c7",
                        }}
                        aria-hidden="true"
                      >
                        <i />
                      </span>
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
                id="mood-tags"
                error={form.formState.errors.moodTagIds?.message}
              >
                <div className="choice-row">
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
                </div>
              </ChoiceField>
              <ChoiceField
                label={t("creative.fields.imageTags")}
                id="image-tags"
                error={form.formState.errors.imageStyleTagIds?.message}
              >
                <div className="choice-row">
                  {imageStyleOptions.map((item) => (
                    <label className="choice-chip" key={item.id}>
                      <input
                        type="checkbox"
                        value={item.id}
                        disabled={
                          item.unavailable &&
                          !selectedImageStyleTagIds.includes(item.id)
                        }
                        {...form.register("imageStyleTagIds")}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </ChoiceField>
              <ChoiceField
                label={t("creative.fields.paceTags")}
                id="pace-tags"
                error={form.formState.errors.paceTagIds?.message}
              >
                <div className="choice-row">
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
                </div>
              </ChoiceField>
              <ReferenceImageField
                category={styleReferenceCategory}
                assets={selectedStyleReferenceImages}
                busy={Boolean(uploadTarget) || saveCreative.isPending}
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
                onRemove={removeReference}
              />
            </section>
          </div>

          <CreativeSummary
            control={form.control}
            visualStyles={visualStyleOptions}
            roleTypes={roleOptions}
            styleTagMap={styleTagMap}
          />
        </div>
        <div className="sticky-actions">
          <Link
            className="button button-secondary"
            to={localizedPath(validLocale, `/tasks/${taskId}/edit/project`)}
            onClick={guardLink}
          >
            {t("wizard.actions.backUpload")}
          </Link>
          <p className="sticky-note">{t("wizard.footerNotes.characters")}</p>
          <div>
            <button
              className="button button-secondary"
              type="button"
              disabled={saveCreative.isPending || Boolean(uploadTarget)}
              onClick={form.handleSubmit((values) =>
                runSave(values, false, true),
              )}
            >
              {saveCreative.isPending ? t("common.saving") : t("common.save")}
            </button>
            {conflict && (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  failedSaveSnapshotRef.current = undefined;
                  form.reset();
                  void draftQuery.refetch();
                }}
              >
                {t("common.reload")}
              </button>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={saveCreative.isPending || Boolean(uploadTarget)}
            >
              {saveCreative.isPending
                ? t("common.saving")
                : t("wizard.actions.toVoice")}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
