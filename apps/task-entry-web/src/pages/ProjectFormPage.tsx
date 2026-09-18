import { focusFormControl } from "../form-focus";
import { DraftRecoveryDialog } from "../components/DraftRecoveryDialog";
import { sameUploadContent } from "../upload-reconciliation";
import { FileTransfers, type FileTransfer } from "../components/FileTransfers";
import { SaveFeedback } from "../components/SaveFeedback";
import { useDraftRecovery, focusSaveIssue } from "../useDraftRecovery";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard";
import { useConfirm } from "../useConfirm";
import { useRevisionNext, RevisionLink } from "../revision-navigation";
import { createId } from "../create-id";
import { EnumField } from "../components/EnumField";
import { ChoiceRow } from "../components/ChoiceRow";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";
import { useWizardNavigate as useNavigate } from "../wizard-motion";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { ReferenceAsset, ReferenceCategory, TaskDraft } from "@lifewood/domain";
import { BookRecognition } from "../components/BookRecognition";
import { Field } from "../components/Field";
import { FieldIcon } from "../components/FieldIcon";
import { ProjectCoverImage } from "../components/ProjectCoverImage";
import { ChoiceField } from "../components/ChoiceField";
import { EditableSelect, preserveEditableSelection } from "../components/EditableSelect";
import { StepProgress } from "../components/StepProgress";
import { getHighestReachableStep } from "../workflow-progress";
import { ScreenError } from "../components/ScreenError";
import { FileDropCard } from "../components/FileDropCard";
import { createDraftSchema, createStepSchema, type ProjectFormValues } from "./projectFormSchema";
import { mergeLegacyOptions } from "../legacy-options";
import { mergeLegacyCategories, type DisplayReferenceCategory } from "../legacy-categories";


type SourceTransfer = FileTransfer;

function SourceFilesSection({ categories, assets, locale, uploadCategory, transfers, uploadError, onUpload, onRemove, onCancel, onRetry, children }: {
  children?: ReactNode;
  categories: DisplayReferenceCategory[]; assets: ReferenceAsset[]; locale: string; uploadCategory?: string; transfers: SourceTransfer[]; uploadError?: string;
  onUpload: (category: ReferenceCategory, files: FileList | readonly File[] | null) => Promise<void>; onRemove: (id: string) => Promise<void>; onCancel: (id: string) => void; onRetry: (item: SourceTransfer) => Promise<void>;
}) {
  const { t } = useTranslation();
  const primary = categories.filter(category=>category.required || category.id==="book-cover");
  const optional = categories.filter(category=>!category.required && category.id!=="book-cover");
  const renderCategory = (category: DisplayReferenceCategory) => { const files = assets.filter((asset) => asset.categoryId === category.id); return <FileDropCard
      key={category.id}
      inputId={`source-upload-${category.id}`}
      category={category}
      files={files}
      locale={locale}
      busyCategory={uploadCategory}
      selectionBlocked={transfers.length > 0}
      required={category.required}
      camera={category.id === "book-cover"}
      feedback={<FileTransfers items={transfers.filter(item => item.categoryId === category.id)} busy={Boolean(uploadCategory)} onCancel={onCancel} onRetry={onRetry} />}
      preview={category.id === "book-cover" && files[0] ? <img className="source-cover-preview" src={files[0].url} alt={t("sourceFiles.coverAlt", { title: files[0].fileName })} width="320" height="128" /> : undefined}
      onUpload={onUpload}
      onRemove={onRemove}
    />; };
  return <section className="form-panel source-files-panel">
    <h2><span>1.1</span>{t("wizard.sections.sources")}</h2>
    {uploadError && <div className="inline-error" role="alert">{uploadError}</div>}
    <div className="upload-grid source-upload-grid primary-uploads">{primary.map(renderCategory)}</div>
    {children}
    {optional.length>0 && <details className="optional-details" open={Boolean(uploadError || optional.some(category=>assets.some(asset=>asset.categoryId===category.id) || transfers.some(item=>item.categoryId===category.id)))}>
      <summary>{t("clientUx.optionalFiles")}</summary>
      <div className="upload-grid source-upload-grid">{optional.map(renderCategory)}</div>
    </details>}
  </section>;
}

function ProjectSummaryRail({ control, cover, assets, genres, statusLabel, createdAt, locale }: {
  control: Control<ProjectFormValues>;
  cover?: ReferenceAsset;
  assets: ReferenceAsset[];
  genres: Array<{ id: string; label: string }>;
  statusLabel: string;
  createdAt?: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const revisionNext = useRevisionNext();
  const [projectName, title, authorName, genreId, contentLanguageId] = useWatch({
    control,
    name: ["projectName", "title", "authorName", "genreId", "contentLanguageId"],
  });
  const bookDone = Boolean(title && authorName && genreId);
  const directionDone = Boolean(contentLanguageId);
  const manuscriptDone = assets.some((asset) => asset.categoryId === "manuscript");
  const genreLabel = genres.find((genre) => genre.id === genreId)?.label ?? "—";
  const createdLabel = createdAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(createdAt)) : "—";
  return <aside className="context-rail">
    <div className="folio-card">
      <h3 className="summary-title">{t("wizard.summary.title")}</h3>
      <ProjectCoverImage
        coverUrl={cover?.url}
        coverAlt={t("sourceFiles.coverAlt", { title: title || cover?.fileName || projectName })}
        placeholderAlt={t("sourceFiles.coverPendingAlt")}
        className="summary-cover"
        width={240}
        height={180}
      />
      <dl className="summary-meta">
        <div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{title || projectName || t("wizard.summary.untitled")}</dd></div>
        <div><dt>{t("wizard.fields.authorName")}</dt><dd>{authorName || "—"}</dd></div>
        <div><dt>{t("wizard.fields.genre")}</dt><dd>{genreLabel}</dd></div>
        <div><dt>{t("wizard.summary.status")}</dt><dd><span className="status-badge">{statusLabel}</span></dd></div>
        <div><dt>{t("wizard.summary.created")}</dt><dd>{createdLabel}</dd></div>
      </dl>
    </div>
    <div className="check-card"><h3>{t("wizard.summary.checklist")}</h3><ul>
      <li className={bookDone ? "done" : ""}><span>{bookDone ? "✓" : "○"}</span>{t("wizard.summary.book")}</li>
      <li className={cover ? "done" : ""}><span>{cover ? "✓" : "○"}</span>{t("wizard.summary.cover")}</li>
      {manuscriptDone && <li className="done"><span>✓</span>{t("clientUx.manuscriptOptional")}</li>}
      <li className={directionDone ? "done" : ""}><span>{directionDone ? "✓" : "○"}</span>{t("wizard.fields.contentLanguage")}</li>
    </ul></div>
    <div className="next-card"><span className="next-mark" aria-hidden="true">→</span><div><h3>{t(revisionNext ? `wizard.steps.${revisionNext}` : ("wizard.summary.nextTitle"))}</h3></div></div>
  </aside>;
}

export function ProjectFormPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const revisionNext = useRevisionNext();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<"idle" | "invalid" | "error">("idle");
  const [returningHome, setReturningHome] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();
  const [transfers, setTransfers] = useState<SourceTransfer[]>([]);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const cancelledTransferIdsRef = useRef(new Set<string>());
  const uploadingRef = useRef(false);
  const uploadEpoch = useRef(0);
  useEffect(() => {
    uploadEpoch.current += 1;
    setTransfers([]);
    setUploadError(undefined);
    setUploadCategory(undefined); uploadingRef.current = false;
    cancelledTransferIdsRef.current.clear();
    return () => { uploadEpoch.current += 1; uploadControllers.current.forEach(controller => controller.abort()); };
  }, [taskId]);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const savedSnapshotRef = useRef<string | undefined>(undefined);
  const conflictRef = useRef(false);
  const failedSaveSnapshotRef = useRef<string | undefined>(undefined);
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";

  const schema = useMemo(() => createDraftSchema(t), [t]);

  const draftQuery = useQuery({
    queryKey: ["project", taskId],
    queryFn: () => projectService.getProject(taskId!, validLocale),
    enabled: Boolean(taskId),
  });
  const optionsQuery = useQuery({ queryKey: ["form-options", validLocale], queryFn: () => optionService.getFormOptions(validLocale) });
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      clientName: "", contactName: "", email: "", phone: "", brandId: "", projectName: "", videoGoalId: "", deadline: "",
      audienceIds: [], title: "", subtitle: "", authorName: "", genreId: "", sellingPoint: "", synopsis: "",
      contentLanguageId: "", videoDurationId: "", customVideoDuration: "", publishingPlatformIds: [],
    },
  });

  const autosaveValues = useWatch({ control: form.control });
  const selectedPlatformIds = useWatch({ control: form.control, name: "publishingPlatformIds" }) ?? [];
  const selectedVideoDurationId = useWatch({ control: form.control, name: "videoDurationId" }) ?? "";
  const customVideoDuration = useWatch({ control: form.control, name: "customVideoDuration" }) ?? "";
  const valuesFromDraft = (draft: TaskDraft) => {
    return {
      clientName: draft.project.clientName ?? "",
      contactName: draft.project.contactName ?? "",
      email: draft.project.email ?? "",
      phone: draft.project.phone ?? "", brandId: draft.project.brandId ?? "", projectName: draft.project.projectName,
      videoGoalId: draft.project.videoGoalId ?? "", deadline: draft.project.deadline ?? "", audienceIds: draft.project.audienceIds,
      title: draft.book.title, subtitle: draft.book.subtitle ?? "", authorName: draft.book.authorName, genreId: draft.book.genreId ?? "",
      sellingPoint: draft.book.sellingPoint, synopsis: draft.book.synopsis, contentLanguageId: draft.book.contentLanguageId ?? "",
      videoDurationId: draft.book.videoDurationId ?? "", customVideoDuration: draft.book.customVideoDuration ?? "", publishingPlatformIds: draft.book.publishingPlatformIds,
    };
  };
  const resetFromDraft = (draft: TaskDraft) => form.reset(valuesFromDraft(draft));
  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    resetFromDraft(draft);
  }, [draftQuery.data, form, form.formState.isDirty]);



  const saveDraft = useMutation({
    mutationFn: async ({ values, continueAfter }: { values: ProjectFormValues; continueAfter: boolean }) => {
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const next: TaskDraft = {
        ...current,
        project: {
          clientName: values.clientName, contactName: values.contactName, email: values.email, phone: values.phone || undefined,
          brandId: values.brandId || undefined, projectName: values.projectName, videoGoalId: values.videoGoalId || undefined,
          deadline: values.deadline || undefined, audienceIds: values.audienceIds,
        },
        book: {
          title: values.title, subtitle: values.subtitle || undefined, authorName: values.authorName, genreId: values.genreId || undefined,
          sellingPoint: values.sellingPoint, synopsis: values.synopsis, contentLanguageId: values.contentLanguageId || undefined,
          videoDurationId: values.videoDurationId || undefined, customVideoDuration: values.customVideoDuration.trim() || undefined, publishingPlatformIds: values.publishingPlatformIds,
          sourceAssets: current.book.sourceAssets,
        },
      };
      const saved = await projectService.saveDraft(current.id, next, validLocale);
      return { saved, continueAfter, values };
    },
    onSuccess: async ({ saved, continueAfter, values }) => {
      queryClient.setQueryData(["project", taskId], saved);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      form.reset(values, { keepValues: true });
      savedSnapshotRef.current = JSON.stringify(values);
      failedSaveSnapshotRef.current = undefined;
      setSaveState("idle");
      if (continueAfter) await navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/characters`));
    },
    onError: (_error, variables) => {
      if (_error instanceof ApiError && _error.details.code === "project.version_conflict") conflictRef.current = true; failedSaveSnapshotRef.current = JSON.stringify(variables.values); setSaveState("error"); },
    onSettled: () => { saveInFlightRef.current = false; },
  });

  const runSave = (values: ProjectFormValues, continueAfter: boolean, explicit: boolean) => {
    if (conflictRef.current) { setSaveState("error"); return Promise.resolve(false); }
    const snapshot = JSON.stringify(values);
    if (saveInFlightRef.current) return savePromiseRef.current ?? Promise.resolve(false);
    if (!explicit && failedSaveSnapshotRef.current === snapshot) return Promise.resolve(false);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    const pending = saveDraft.mutateAsync({ values, continueAfter }).then(() => true, () => false);
    savePromiseRef.current = pending;
    return pending;
  };

  const recovery = useDraftRecovery(taskId, validLocale, () => JSON.stringify(form.getValues()), (latest, fields) => {
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    queryClient.setQueryData(["project", taskId], latest);
    resetFromDraft(latest);
    savedSnapshotRef.current = JSON.stringify(form.getValues());
    for (const field of fields) form.setValue(field.path.join(".") as never, field.local as never, { shouldDirty: true, shouldValidate: true });
    failedSaveSnapshotRef.current = undefined;
    conflictRef.current = false;
    saveDraft.reset(); setSaveState("idle");
  }, valuesFromDraft);
  const retrySave = async () => {
    if (saveInFlightRef.current) return;
    const checked = schema.safeParse(form.getValues());
    if (!checked.success) {
      setSaveState("invalid");
      for (const issue of checked.error.issues) form.setError(issue.path.join(".") as never, { message: issue.message });
      const first = checked.error.issues[0]?.path;

      if (first) focusSaveIssue(first.join("."));
      return;
    }
    await runSave(checked.data, false, true);
  };

  useEffect(() => {
    if (!form.formState.isDirty || saveDraft.isPending || uploadCategory || transfers.length > 0 || returningHome || continuing) return;
    const checked = schema.safeParse(autosaveValues);
    if (!checked.success) { setSaveState("invalid"); return; }
    const snapshot = JSON.stringify(checked.data);
    if (savedSnapshotRef.current === snapshot) return;
    if (failedSaveSnapshotRef.current === snapshot) return;
    autosaveTimerRef.current = window.setTimeout(() => { void runSave(checked.data, false, false); }, 0);
    return () => { if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = undefined; };
  }, [autosaveValues, form.formState.isDirty, saveDraft.isPending, uploadCategory, transfers.length, returningHome, continuing, schema]);

  const returnHome = async (path = localizedPath(validLocale, "/tasks")) => {
    if (returningHome || uploadingRef.current || transfers.length > 0) return;
    setReturningHome(true);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      const checked = schema.safeParse(form.getValues());
      if (!checked.success) {
        setSaveState("invalid");
        await form.trigger();
        return;
      }
      const needsSave = savedSnapshotRef.current === undefined ? form.formState.isDirty : JSON.stringify(checked.data) !== savedSnapshotRef.current;
      if (needsSave) {
        if (!await runSave(checked.data, false, true)) return;
      }
      await navigate(path);
    } finally { setReturningHome(false); }
  };
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending) return <div className="screen-status" role="status" aria-busy="true"><UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} />{t("common.loading")}</div>;
  if (draftQuery.isError || optionsQuery.isError || !draftQuery.data || !optionsQuery.data) {
    return <><UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} /><ScreenError error={draftQuery.error ?? optionsQuery.error} onRetry={() => Promise.all([draftQuery.refetch(), optionsQuery.refetch()])} /></>;
  }
  if (draftQuery.data.status !== "draft" || draftQuery.data.canEdit === false) {
    return <Navigate replace to={localizedPath(validLocale, `/tasks/${draftQuery.data.id}`)} />;
  }

  const options = optionsQuery.data;
  const unavailable = t("wizard.unavailableOption");
  const genreOptions = mergeLegacyOptions(options.genres, [draftQuery.data.book.genreId], unavailable);
  const languageOptions = mergeLegacyOptions(options.contentLanguages, [draftQuery.data.book.contentLanguageId], unavailable);
  const durationOptions = mergeLegacyOptions(options.videoDurations, [draftQuery.data.book.videoDurationId], unavailable);
  const editableDurationOptions = preserveEditableSelection(durationOptions, selectedVideoDurationId, customVideoDuration);
  const customDurationOptionIds = editableDurationOptions.filter((option) => option.allowsCustomValue).map((option) => option.id);
  const stepSchema = createStepSchema(t, customDurationOptionIds);
  const platformOptions = mergeLegacyOptions(options.publishingPlatforms, draftQuery.data.book.publishingPlatformIds, unavailable);
  const sourceAssets = draftQuery.data.book.sourceAssets;
  const sourceCategories = mergeLegacyCategories(options.sourceCategories, sourceAssets, unavailable);
  const cover = sourceAssets.find((asset) => asset.categoryId === "book-cover");
  const conflict = conflictRef.current || saveDraft.error instanceof ApiError && saveDraft.error.details.code === "project.version_conflict";
  const statusText = saveState === "invalid" ? t("common.saveNeedsAttention") : saveState === "error" ? (conflict ? t("wizard.versionConflict") : saveDraft.error instanceof ApiError ? localizedApiError(saveDraft.error, t) : t("wizard.saveFailed")) : "";
  const continueStep = form.handleSubmit(async (values) => {
    if (continuing || returningHome || uploadingRef.current || transfers.length > 0) return;
    const missingCategory = options.sourceCategories.find(category => category.required && !sourceAssets.some(asset => asset.categoryId === category.id));
    if (missingCategory) {
      setUploadError(t("sourceFiles.missingRequired"));
      requestAnimationFrame(() => {
        const target = document.getElementById(`source-upload-${missingCategory.id}`)?.closest(".upload-drop-card")?.querySelector<HTMLElement>(".upload-drop-prompt");
        if (target) focusFormControl(target);
      });
      return;
    }
    const checked = stepSchema.safeParse(values);
    if (!checked.success) {
      checked.error.issues.forEach((issue) => form.setError(issue.path[0] as keyof ProjectFormValues, { message: issue.message }));
      const first = checked.error.issues[0]?.path.join(".");
      if (first) focusSaveIssue(first);
      return;
    }
    setContinuing(true);
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      await runSave(checked.data, true, true);
    } finally { setContinuing(false); }
  });

  const uploadOne = async (item: SourceTransfer) => {
    const epoch = uploadEpoch.current;
    const controller = new AbortController();
    uploadControllers.current.set(item.id, controller);
    setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", progress: 0, error: undefined } : entry));
    try {
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const result = await projectService.uploadAsset(taskId!, current.version, item.categoryId, item.file, validLocale, controller.signal, undefined, { uploadId: item.id, onProgress: progress => {
        if (epoch === uploadEpoch.current) setTransfers(current => current.map(entry => entry.id === item.id ? { ...entry, progress } : entry));
      } });
      if (epoch !== uploadEpoch.current) return;
      if (!sameUploadContent(current, result.draft)) throw new ApiError({ code: "project.version_conflict", messageKey: "errors.project.versionConflict", retryable: false });
      queryClient.setQueryData(["project", taskId], result.draft);
      setTransfers((currentTransfers) => currentTransfers.filter((entry) => entry.id !== item.id));
      setUploadError(undefined);
      return true;
    } catch (error) {
      if (epoch !== uploadEpoch.current) return;
      const cancelled = controller.signal.aborted;
      const message = cancelled ? t("voice.uploadCancelled") : localizedApiError(error, t);
      setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: cancelled ? "cancelled" : "error", error: message } : entry));
      if (error instanceof ApiError && error.details.code === "project.version_conflict") {
        try {
          const before = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
          const latest = await projectService.getProject(taskId!, validLocale);
          if (epoch !== uploadEpoch.current) return;
          if (sameUploadContent(before, latest)) queryClient.setQueryData(["project", taskId], latest);
          else { conflictRef.current = true; setSaveState("error"); }
        } catch (refreshError) {
          if (epoch === uploadEpoch.current) setUploadError(localizedApiError(refreshError, t));
        }
      }
    } finally {
      uploadControllers.current.delete(item.id);
    }
  };
  const upload = async (category: ReferenceCategory, files: FileList | readonly File[] | null) => {
    const epoch = uploadEpoch.current;
    if (!files?.length) return;
    if (uploadingRef.current) {
      setUploadError(t("bookIntake.photoUploadFailed"));
      if (category.id === "book-cover") throw new Error("Upload is already in progress");
      return;
    }
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadError(undefined);
    setUploadCategory(category.id);
    const available = Math.max(0, category.maxFiles - sourceAssets.filter((asset) => asset.categoryId === category.id).length);
    try {
      const queue = Array.from(files).slice(0, available).map((file) => ({ id: createId(), categoryId: category.id, file, status: "queued" as const }));
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      if (epoch !== uploadEpoch.current) return;
      setTransfers((current) => [...current, ...queue]);
      for (const item of queue) {
        if (epoch !== uploadEpoch.current) break;
        if (cancelledTransferIdsRef.current.delete(item.id)) continue;
        if (!await uploadOne(item)) break;
      }
    } catch (error) {
      if (epoch === uploadEpoch.current) setUploadError(localizedApiError(error, t));
    } finally {
      if (epoch === uploadEpoch.current) { uploadingRef.current = false; setUploadCategory(undefined); }
    }
  };
  const retryUpload = async (item: SourceTransfer) => {
    const epoch = uploadEpoch.current;
    if (uploadingRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadCategory(item.categoryId);
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      const queue = [item, ...transfers.filter(entry => entry.id !== item.id && entry.status === "queued")];
      for (const entry of queue) {
        if (epoch !== uploadEpoch.current) break;
        if (cancelledTransferIdsRef.current.delete(entry.id)) continue;
        if (!await uploadOne(entry)) break;
      }
    } finally {
      if (epoch === uploadEpoch.current) { uploadingRef.current = false; setUploadCategory(undefined); }
    }
  };
  const cancelUpload = async (id: string) => {
    const controller = uploadControllers.current.get(id);
    if (controller) { controller.abort(); return; }
    const item = transfers.find(entry => entry.id === id);
    if (!item || item.status === "queued") {
      cancelledTransferIdsRef.current.add(id); setTransfers(items => items.filter(entry => entry.id !== id)); return;
    }
    if (uploadingRef.current) return;
    const epoch = uploadEpoch.current;
    uploadingRef.current = true; setUploadCategory("__reconciling__");
    try {
      const before = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const latest = await projectService.getProject(taskId!, validLocale);
      if (epoch !== uploadEpoch.current) return;
      if (!sameUploadContent(before, latest)) {
        conflictRef.current = true; setSaveState("error"); setUploadError(t("wizard.versionConflict")); return;
      }
      queryClient.setQueryData(["project", taskId], latest);
      setTransfers(items => items.filter(entry => entry.id !== id));
      setUploadError(undefined);
    } catch (error) { if (epoch === uploadEpoch.current) setUploadError(localizedApiError(error, t)); }
    finally { if (epoch === uploadEpoch.current) { uploadingRef.current = false; setUploadCategory(undefined); } }
  };
  const removeAsset = async (id: string) => {
    if (uploadingRef.current || !await confirm(t("sourceFiles.removeConfirm"))) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadCategory("__removing__");
    setUploadError(undefined);
    try {
      if (saveInFlightRef.current && !await savePromiseRef.current) return;
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const saved = await projectService.deleteAsset(taskId!, id, current.version, validLocale);
      queryClient.setQueryData(["project", taskId], saved);
    } catch (error) {
      setUploadError(localizedApiError(error, t));
    } finally {
      uploadingRef.current = false;
      setUploadCategory(undefined);
    }
  };
  return (
    <div className="wizard-page">
      <UnsavedChangesGuard dirty={form.formState.isDirty || transfers.length > 0} />
      <div className="wizard-heading">
        <h1 className="sr-only">{t("wizard.pageTitles.project")}</h1>
        <SaveFeedback message={statusText} conflict={conflict} invalid={saveState === "invalid"} busy={saveDraft.isPending || recovery.loading || returningHome || continuing || Boolean(uploadCategory)} error={recovery.error} onRetry={() => void retrySave()} onReload={() => void recovery.reload()} />
        <DraftRecoveryDialog recovery={recovery} options={optionsQuery.data} />
      </div>
      <StepProgress onNavigate={(path) => void returnHome(path)} current={1} highestReachable={getHighestReachableStep(draftQuery.data)} onNext={() => void continueStep()} canContinue={stepSchema.safeParse(form.getValues()).success && options.sourceCategories.every(category => !category.required || sourceAssets.some(asset => asset.categoryId === category.id))} busy={returningHome || continuing || Boolean(uploadCategory) || transfers.length > 0} />

      <form autoComplete="off" onSubmit={continueStep} inert={returningHome || continuing} aria-busy={returningHome || continuing}>
        <div className="wizard-layout">
          <div className="form-stack">
            <SourceFilesSection key={taskId} categories={sourceCategories} assets={sourceAssets} locale={validLocale} uploadCategory={uploadCategory} transfers={transfers} uploadError={uploadError} onUpload={upload} onRemove={removeAsset} onCancel={cancelUpload} onRetry={retryUpload}><BookRecognition taskId={taskId!} locale={validLocale} enabled={Boolean(options.bookRecognitionEnabled)} assets={sourceAssets} form={form} busy={Boolean(uploadCategory)} /></SourceFilesSection>
            <section className="form-panel book-info-panel">
              <h2><span>1.2</span>{t("wizard.sections.book")}</h2>

              <div className="form-grid">
                <Field label={t("wizard.fields.bookTitle")} icon={<FieldIcon name="book" />} htmlFor="title" required error={form.formState.errors.title?.message}><input id="title" className="input-long" {...form.register("title")} /></Field>
                <Field label={t("wizard.fields.subtitle")} icon={<FieldIcon name="title" />} htmlFor="subtitle"><input id="subtitle" className="input-long" {...form.register("subtitle")} /></Field>
                <Field label={t("wizard.fields.authorName")} icon={<FieldIcon name="author" />} htmlFor="authorName" required error={form.formState.errors.authorName?.message}><input id="authorName" className="input-medium" {...form.register("authorName")} /></Field>
                {customDurationOptionIds.length > 0 && <Field label={t("wizard.fields.duration")} icon={<FieldIcon name="duration" />} htmlFor="videoDurationInput" required error={form.formState.errors.videoDurationId?.message ?? form.formState.errors.customVideoDuration?.message}>
                  <EditableSelect id="videoDurationInput" name="videoDurationInput" className="input-short" autoComplete="off" maxLength={80} placeholder={t("wizard.durationPlaceholder")} options={editableDurationOptions} optionId={selectedVideoDurationId} customValue={customVideoDuration} onValueChange={(optionId, customValue) => {
                    form.setValue("videoDurationId", optionId, { shouldDirty: true, shouldValidate: true });
                    form.setValue("customVideoDuration", customValue, { shouldDirty: true, shouldValidate: true });
                  }} />
                </Field>}
                <EnumField label={t("wizard.fields.genre")} icon={<FieldIcon name="genre" />} htmlFor="genreId" required error={form.formState.errors.genreId?.message} items={genreOptions} selectedId={form.watch("genreId")} registration={form.register("genreId")} />
                <EnumField label={t("wizard.fields.contentLanguage")} icon={<FieldIcon name="language" />} htmlFor="contentLanguageId" required error={form.formState.errors.contentLanguageId?.message} items={languageOptions} selectedId={form.watch("contentLanguageId")} registration={form.register("contentLanguageId")} />
                {customDurationOptionIds.length === 0 && <EnumField label={t("wizard.fields.duration")} icon={<FieldIcon name="duration" />} htmlFor="videoDurationInput" required error={form.formState.errors.videoDurationId?.message} items={durationOptions} registration={form.register("videoDurationId", { onChange: () => form.setValue("customVideoDuration", "", { shouldDirty: true, shouldValidate: true }) })} />}
                <ChoiceField label={t("wizard.fields.platforms")} icon={<FieldIcon name="platform" />} id="platform-group"><ChoiceRow id="platform-group">{platformOptions.map((item) => <label className="choice-chip" key={item.id} aria-disabled={item.unavailable}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedPlatformIds.includes(item.id)} {...form.register("publishingPlatformIds")} /><span>{item.label}</span></label>)}</ChoiceRow></ChoiceField>
              </div>
              <details className="optional-details" open={Boolean(form.formState.errors.sellingPoint || form.formState.errors.synopsis || form.watch("sellingPoint") || form.watch("synopsis"))}><summary>{t("clientUx.optionalBook")}</summary><div className="form-grid">
                <Field label={t("wizard.fields.sellingPoint")} icon={<FieldIcon name="highlight" />} htmlFor="sellingPoint" className="field-wide" error={form.formState.errors.sellingPoint?.message}><textarea id="sellingPoint" rows={2} maxLength={150} {...form.register("sellingPoint")} /></Field>
                <Field label={t("wizard.fields.synopsis")} icon={<FieldIcon name="summary" />} htmlFor="synopsis" className="field-wide" error={form.formState.errors.synopsis?.message}><textarea id="synopsis" rows={4} maxLength={600} {...form.register("synopsis")} /></Field>
              </div></details>
            </section>
          </div>

          <ProjectSummaryRail control={form.control} cover={cover} assets={sourceAssets} genres={genreOptions} statusLabel={draftQuery.data.workflowStatus === "awaiting_customer" ? t("clientUx.returnedStatus") : options.taskStatuses.find((item) => item.id === draftQuery.data.status)?.label ?? draftQuery.data.status} createdAt={draftQuery.data.createdAt} locale={validLocale} />
        </div>

        <div className="sticky-actions">
          <button className="button button-quiet" type="button" disabled={returningHome || Boolean(uploadCategory)} onClick={() => void returnHome()}>{t("common.backHome")}</button>

          <div>

          <button className="button button-primary" type="submit" disabled={continuing || returningHome || Boolean(uploadCategory)}>{t(revisionNext ? `wizard.steps.${revisionNext}` : ("wizard.actions.toCharacters"))}<span aria-hidden="true">→</span></button></div>
        </div>
      </form>
    </div>
  );
}
