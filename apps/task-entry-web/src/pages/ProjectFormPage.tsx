import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError, localizedApiError, optionService, projectService } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import type { ReferenceAsset, ReferenceCategory, TaskDraft } from "@lifewood/domain";
import { Field } from "../components/Field";
import { ChoiceField } from "../components/ChoiceField";
import { EditableSelect, preserveEditableSelection } from "../components/EditableSelect";
import { StepProgress } from "../components/StepProgress";
import { createDraftSchema, createStepSchema, type ProjectFormValues } from "./projectFormSchema";
import { mergeLegacyOptions, type DisplayConfigOption } from "../legacy-options";
import { mergeLegacyCategories, type DisplayReferenceCategory } from "../legacy-categories";

function SelectOptions({ items }: { items?: DisplayConfigOption[] }) {
  return <>{items?.map((item) => <option key={item.id} value={item.id} disabled={item.unavailable}>{item.label}</option>)}</>;
}

type SourceTransfer = { id: string; categoryId: string; file: File; status: "uploading" | "error" | "cancelled"; error?: string };

function formatBytes(bytes: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte", unitDisplay: "short", maximumFractionDigits: 1 }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}

function SourceFilesSection({ categories, assets, locale, uploadCategory, transfers, uploadError, onUpload, onRemove, onCancel, onRetry }: {
  categories: DisplayReferenceCategory[]; assets: ReferenceAsset[]; locale: string; uploadCategory?: string; transfers: SourceTransfer[]; uploadError?: string;
  onUpload: (category: ReferenceCategory, files: FileList | null) => Promise<void>; onRemove: (id: string) => Promise<void>; onCancel: (id: string) => void; onRetry: (item: SourceTransfer) => Promise<void>;
}) {
  const { t } = useTranslation();
  return <section className="form-panel source-files-panel">
    <h2><span>1.3</span>{t("wizard.sections.sources")}</h2>
    <p className="section-hint">{t("sourceFiles.hint")}</p>
    <div className="upload-grid source-upload-grid">{categories.map((category) => { const files = assets.filter((asset) => asset.categoryId === category.id); return <div className="upload-card" key={category.id}>
      <div><strong>{category.label}{category.required && <em className="required-badge">{t("sourceFiles.required")}</em>}</strong><small>{category.description}</small><small>{t("voice.fileLimit", { size: formatBytes(category.maxBytes, locale), count: category.maxFiles })}</small></div>
      {category.id === "book-cover" && files[0] && <img className="source-cover-preview" src={files[0].url} alt={t("sourceFiles.coverAlt", { title: files[0].fileName })} width="320" height="128" />}
      <label className={`button button-secondary ${uploadCategory || category.unavailable || files.length >= category.maxFiles ? "disabled" : ""}`} aria-disabled={Boolean(uploadCategory) || category.unavailable || files.length >= category.maxFiles} htmlFor={`source-upload-${category.id}`} aria-label={t("sourceFiles.chooseFor", { category: category.label })}>{uploadCategory === category.id ? t("voice.uploading") : t("voice.chooseFiles")}</label>
      <input id={`source-upload-${category.id}`} name={`source-upload-${category.id}`} autoComplete="off" className="visually-hidden" type="file" multiple={category.maxFiles > 1} accept={category.accept.join(",")} disabled={Boolean(uploadCategory) || category.unavailable || files.length >= category.maxFiles} onChange={(event) => { void onUpload(category, event.target.files); event.target.value = ""; }} />
      {files.length > 0 && <ul className="uploaded-files">{files.map((asset) => <li key={asset.id}><span title={asset.fileName}>{asset.fileName}</span><small>{formatBytes(asset.sizeBytes, locale)}</small><button type="button" aria-label={t("sourceFiles.removeFile", { fileName: asset.fileName })} disabled={Boolean(uploadCategory)} onClick={() => void onRemove(asset.id)}>{t("voice.remove")}</button></li>)}</ul>}
    </div>; })}</div>
    {transfers.length > 0 && <ul className="transfer-list" aria-live="polite">{transfers.map((item) => <li key={item.id}><span>{item.file.name}</span><small>{item.status === "uploading" ? t("voice.uploading") : item.error}</small>{item.status === "uploading" ? <button type="button" onClick={() => onCancel(item.id)}>{t("voice.cancelUpload")}</button> : <button type="button" disabled={Boolean(uploadCategory)} onClick={() => void onRetry(item)}>{t("common.retry")}</button>}</li>)}</ul>}
    {uploadError && <div className="inline-error" role="alert">{uploadError}</div>}
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
  const [clientName, contactName, email, projectName, title, authorName, genreId, videoGoalId, audienceIds, contentLanguageId] = useWatch({
    control,
    name: ["clientName", "contactName", "email", "projectName", "title", "authorName", "genreId", "videoGoalId", "audienceIds", "contentLanguageId"],
  });
  const clientDone = Boolean(clientName && contactName && email);
  const bookDone = Boolean(title && authorName && genreId);
  const directionDone = Boolean(videoGoalId && audienceIds.length && contentLanguageId);
  const manuscriptDone = assets.some((asset) => asset.categoryId === "manuscript");
  const genreLabel = genres.find((genre) => genre.id === genreId)?.label ?? "—";
  const createdLabel = createdAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(createdAt)) : "—";
  return <aside className="context-rail">
    <div className="folio-card">
      <h3 className="summary-title">{t("wizard.summary.title")}</h3>
      {cover && <img className="summary-cover" src={cover.url} alt={t("sourceFiles.coverAlt", { title: title || cover.fileName })} width="240" height="180" />}
      <dl className="summary-meta">
        <div><dt>{t("wizard.fields.bookTitle")}</dt><dd>{title || projectName || t("wizard.summary.untitled")}</dd></div>
        <div><dt>{t("wizard.fields.authorName")}</dt><dd>{authorName || "—"}</dd></div>
        <div><dt>{t("wizard.fields.genre")}</dt><dd>{genreLabel}</dd></div>
        <div><dt>{t("wizard.summary.status")}</dt><dd><span className="status-badge">{statusLabel}</span></dd></div>
        <div><dt>{t("wizard.summary.created")}</dt><dd>{createdLabel}</dd></div>
      </dl>
    </div>
    <div className="check-card"><h3>{t("wizard.summary.checklist")}</h3><ul>
      <li className={clientDone ? "done" : ""}><span>{clientDone ? "✓" : "○"}</span>{t("wizard.summary.client")}</li>
      <li className={bookDone ? "done" : ""}><span>{bookDone ? "✓" : "○"}</span>{t("wizard.summary.book")}</li>
      <li className={cover ? "done" : ""}><span>{cover ? "✓" : "○"}</span>{t("wizard.summary.cover")}</li>
      <li className={manuscriptDone ? "done" : ""}><span>{manuscriptDone ? "✓" : "○"}</span>{t("wizard.summary.manuscript")}</li>
      <li className={directionDone ? "done" : ""}><span>{directionDone ? "✓" : "○"}</span>{t("wizard.summary.direction")}</li>
    </ul></div>
    <div className="next-card"><span className="next-mark" aria-hidden="true">→</span><div><h3>{t("wizard.summary.nextTitle")}</h3><p>{t("wizard.summary.nextBody")}</p></div></div>
  </aside>;
}

export function ProjectFormPage() {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "invalid" | "error">("idle");
  const [uploadCategory, setUploadCategory] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();
  const [transfers, setTransfers] = useState<SourceTransfer[]>([]);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const uploadingRef = useRef(false);
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const saveInFlightRef = useRef(false);
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

  const selectedAudienceIds = useWatch({ control: form.control, name: "audienceIds" }) ?? [];
  const autosaveValues = useWatch({ control: form.control });
  const selectedPlatformIds = useWatch({ control: form.control, name: "publishingPlatformIds" }) ?? [];
  const selectedVideoDurationId = useWatch({ control: form.control, name: "videoDurationId" }) ?? "";
  const customVideoDuration = useWatch({ control: form.control, name: "customVideoDuration" }) ?? "";
  useEffect(() => {
    const draft = draftQuery.data;
    if (!draft || form.formState.isDirty) return;
    form.reset({
      clientName: draft.project.clientName, contactName: draft.project.contactName, email: draft.project.email,
      phone: draft.project.phone ?? "", brandId: draft.project.brandId ?? "", projectName: draft.project.projectName,
      videoGoalId: draft.project.videoGoalId ?? "", deadline: draft.project.deadline ?? "", audienceIds: draft.project.audienceIds,
      title: draft.book.title, subtitle: draft.book.subtitle ?? "", authorName: draft.book.authorName, genreId: draft.book.genreId ?? "",
      sellingPoint: draft.book.sellingPoint, synopsis: draft.book.synopsis, contentLanguageId: draft.book.contentLanguageId ?? "",
      videoDurationId: draft.book.videoDurationId ?? "", customVideoDuration: draft.book.customVideoDuration ?? "", publishingPlatformIds: draft.book.publishingPlatformIds,
    });
  }, [draftQuery.data, form, form.formState.isDirty]);

  useEffect(() => {
    const dirty = form.formState.isDirty;
    const preventLoss = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    const preventBackLoss = () => { if (dirty && !window.confirm(t("wizard.unsavedChanges"))) window.history.go(1); };
    document.body.dataset.unsavedChanges = String(dirty);
    window.addEventListener("beforeunload", preventLoss);
    window.addEventListener("popstate", preventBackLoss);
    return () => {
      window.removeEventListener("beforeunload", preventLoss);
      window.removeEventListener("popstate", preventBackLoss);
      delete document.body.dataset.unsavedChanges;
    };
  }, [form.formState.isDirty, t]);

  const saveDraft = useMutation({
    mutationFn: async ({ values, continueAfter }: { values: ProjectFormValues; continueAfter: boolean }) => {
      setSaveState("saving");
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
    onSuccess: ({ saved, continueAfter, values }) => {
      queryClient.setQueryData(["project", taskId], saved);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      form.reset(values, { keepValues: true });
      failedSaveSnapshotRef.current = undefined;
      setSaveState("saved");
      if (continueAfter) navigate(localizedPath(validLocale, `/tasks/${saved.id}/edit/characters`));
    },
    onError: (_error, variables) => { failedSaveSnapshotRef.current = JSON.stringify(variables.values); setSaveState("error"); },
    onSettled: () => { saveInFlightRef.current = false; },
  });

  const runSave = (values: ProjectFormValues, continueAfter: boolean, explicit: boolean) => {
    const snapshot = JSON.stringify(values);
    if (saveInFlightRef.current || (!explicit && failedSaveSnapshotRef.current === snapshot)) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    if (explicit) failedSaveSnapshotRef.current = undefined;
    saveInFlightRef.current = true;
    saveDraft.mutate({ values, continueAfter });
  };

  useEffect(() => {
    if (!form.formState.isDirty || saveDraft.isPending || uploadCategory) return;
    const checked = schema.safeParse(autosaveValues);
    if (!checked.success) { setSaveState("invalid"); return; }
    const snapshot = JSON.stringify(checked.data);
    if (failedSaveSnapshotRef.current === snapshot) return;
    setSaveState("pending");
    autosaveTimerRef.current = window.setTimeout(() => runSave(checked.data, false, false), 2_000);
    return () => { if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = undefined; };
  }, [autosaveValues, form.formState.isDirty, saveDraft.isPending, uploadCategory, schema]);
  if (!taskId || !isSupportedLocale(locale)) return null;
  if (draftQuery.isPending || optionsQuery.isPending) return <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div>;
  if (draftQuery.isError || optionsQuery.isError || !draftQuery.data || !optionsQuery.data) {
    return <div className="screen-status" role="alert">{localizedApiError(draftQuery.error ?? optionsQuery.error, t)}</div>;
  }
  if (draftQuery.data.status !== "draft") {
    return <Navigate replace to={localizedPath(validLocale, `/tasks/${draftQuery.data.id}`)} />;
  }

  const options = optionsQuery.data;
  const unavailable = t("wizard.unavailableOption");
  const brandOptions = mergeLegacyOptions(options.brands, [draftQuery.data.project.brandId], unavailable);
  const videoGoalOptions = mergeLegacyOptions(options.videoGoals, [draftQuery.data.project.videoGoalId], unavailable);
  const audienceOptions = mergeLegacyOptions(options.audiences, draftQuery.data.project.audienceIds, unavailable);
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
  const conflict = saveDraft.error instanceof ApiError && saveDraft.error.details.code === "project.version_conflict";
  const statusText = saveState === "pending" ? t("common.savePending") : saveState === "saving" ? t("common.saving") : saveState === "saved" ? t("common.saved") : saveState === "invalid" ? t("common.saveNeedsAttention") : saveState === "error" ? t(conflict ? "wizard.versionConflict" : "wizard.saveFailed") : "";
  const continueStep = form.handleSubmit((values) => {
    if (options.sourceCategories.some((category) => category.required && !sourceAssets.some((asset) => asset.categoryId === category.id))) {
      setUploadError(t("sourceFiles.missingRequired"));
      requestAnimationFrame(() => document.querySelector<HTMLElement>(".source-files-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return;
    }
    const checked = stepSchema.safeParse(values);
    if (!checked.success) {
      checked.error.issues.forEach((issue) => form.setError(issue.path[0] as keyof ProjectFormValues, { message: issue.message }));
      const first = checked.error.issues[0]?.path.join(".");
      const focusName = first === "videoDurationId" || first === "customVideoDuration" ? "videoDurationInput" : first;
      if (focusName) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[name="${focusName}"]`)?.focus());
      return;
    }
    runSave(checked.data, true, true);
  });

  const uploadOne = async (item: SourceTransfer) => {
    const controller = new AbortController();
    uploadControllers.current.set(item.id, controller);
    setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", error: undefined } : entry));
    try {
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const result = await projectService.uploadAsset(taskId!, current.version, item.categoryId, item.file, validLocale, controller.signal);
      queryClient.setQueryData(["project", taskId], result.draft);
      setTransfers((currentTransfers) => currentTransfers.filter((entry) => entry.id !== item.id));
      setUploadError(undefined);
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? t("voice.uploadCancelled") : localizedApiError(error, t);
      setTransfers((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: cancelled ? "cancelled" : "error", error: message } : entry));
      if (error instanceof ApiError && error.details.code === "project.version_conflict") {
        try {
          const latest = await projectService.getProject(taskId!, validLocale);
          queryClient.setQueryData(["project", taskId], latest);
        } catch (refreshError) {
          setUploadError(localizedApiError(refreshError, t));
        }
      }
    } finally {
      uploadControllers.current.delete(item.id);
    }
  };
  const upload = async (category: ReferenceCategory, files: FileList | null) => {
    if (!files?.length || uploadingRef.current || saveInFlightRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadError(undefined);
    setUploadCategory(category.id);
    const available = Math.max(0, category.maxFiles - sourceAssets.filter((asset) => asset.categoryId === category.id).length);
    const queue = Array.from(files).slice(0, available).map((file) => ({ id: crypto.randomUUID(), categoryId: category.id, file, status: "uploading" as const }));
    setTransfers((current) => [...current, ...queue]);
    try {
      for (const item of queue) await uploadOne(item);
    } finally {
      uploadingRef.current = false;
      setUploadCategory(undefined);
    }
  };
  const retryUpload = async (item: SourceTransfer) => {
    if (uploadingRef.current || saveInFlightRef.current) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    uploadingRef.current = true;
    setUploadCategory(item.categoryId);
    try {
      await uploadOne(item);
    } finally {
      uploadingRef.current = false;
      setUploadCategory(undefined);
    }
  };
  const cancelUpload = (id: string) => uploadControllers.current.get(id)?.abort();
  const removeAsset = async (id: string) => {
    if (saveInFlightRef.current || !window.confirm(t("sourceFiles.removeConfirm"))) return;
    if (autosaveTimerRef.current !== undefined) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
    saveInFlightRef.current = true;
    setUploadCategory("__removing__");
    setUploadError(undefined);
    try {
      const current = queryClient.getQueryData<TaskDraft>(["project", taskId]) ?? draftQuery.data!;
      const saved = await projectService.deleteAsset(taskId!, id, current.version, validLocale);
      queryClient.setQueryData(["project", taskId], saved);
    } catch (error) {
      setUploadError(localizedApiError(error, t));
    } finally {
      saveInFlightRef.current = false;
      setUploadCategory(undefined);
    }
  };
  return (
    <div className="wizard-page">
      <div className="wizard-heading">
        <div><h1>{t("wizard.pageTitles.project")}</h1><p>{t("wizard.pageSubtitles.project")}</p></div>
        <span className={`save-state save-${saveState}`} role={saveState === "error" ? "alert" : "status"}>{statusText}</span>
      </div>
      <StepProgress current={1} />

      <form autoComplete="off" onSubmit={continueStep} inert={saveDraft.isPending && Boolean(saveDraft.variables?.continueAfter)} aria-busy={saveDraft.isPending && Boolean(saveDraft.variables?.continueAfter)}>
        <div className="wizard-layout">
          <div className="form-stack">
            <section className="form-panel">
              <h2><span>1.1</span>{t("wizard.sections.project")}</h2>
              <p className="section-hint reference-section-hint">{t("wizard.sectionHints.project")}</p>
              <div className="form-grid">
                <Field label={t("wizard.fields.clientName")} htmlFor="clientName" required error={form.formState.errors.clientName?.message}>
                  <input id="clientName" className="input-medium" autoComplete="organization" {...form.register("clientName")} />
                </Field>
                <Field label={t("wizard.fields.contactName")} htmlFor="contactName" required error={form.formState.errors.contactName?.message}>
                  <input id="contactName" className="input-medium" autoComplete="name" {...form.register("contactName")} />
                </Field>
                <Field label={t("wizard.fields.email")} htmlFor="email" required error={form.formState.errors.email?.message}>
                  <input id="email" type="email" inputMode="email" spellCheck={false} autoComplete="email" className="input-medium" {...form.register("email")} />
                </Field>
                <Field label={t("wizard.fields.phone")} htmlFor="phone"><input id="phone" type="tel" inputMode="tel" autoComplete="tel" className="input-short" {...form.register("phone")} /></Field>
                <Field label={t("wizard.fields.brand")} htmlFor="brandId">
                  <select id="brandId" className="input-medium" {...form.register("brandId")}><option value="" /><SelectOptions items={brandOptions} /></select>
                </Field>
                <Field label={t("wizard.fields.projectName")} htmlFor="projectName" required error={form.formState.errors.projectName?.message}>
                  <input id="projectName" className="input-long" {...form.register("projectName")} />
                </Field>
                <Field label={t("wizard.fields.videoGoal")} htmlFor="videoGoalId" required error={form.formState.errors.videoGoalId?.message}>
                  <select id="videoGoalId" className="input-medium" {...form.register("videoGoalId")}><option value="" /><SelectOptions items={videoGoalOptions} /></select>
                </Field>
                <Field label={t("wizard.fields.deadline")} htmlFor="deadline"><input id="deadline" type="date" className="input-short" {...form.register("deadline")} /></Field>
                <ChoiceField label={t("wizard.fields.audiences")} id="audience-group" required error={form.formState.errors.audienceIds?.message}>
                  <div className="choice-row" id="audience-group">{audienceOptions.map((item) => <label className="choice-chip" key={item.id} aria-disabled={item.unavailable}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedAudienceIds.includes(item.id)} {...form.register("audienceIds")} /><span>{item.label}</span></label>)}</div>
                </ChoiceField>
              </div>
            </section>

            <section className="form-panel">
              <h2><span>1.2</span>{t("wizard.sections.book")}</h2>
              <p className="section-hint reference-section-hint">{t("wizard.sectionHints.book")}</p>
              <div className="form-grid">
                <Field label={t("wizard.fields.bookTitle")} htmlFor="title" required error={form.formState.errors.title?.message}><input id="title" className="input-long" {...form.register("title")} /></Field>
                <Field label={t("wizard.fields.subtitle")} htmlFor="subtitle"><input id="subtitle" className="input-long" {...form.register("subtitle")} /></Field>
                <Field label={t("wizard.fields.authorName")} htmlFor="authorName" required error={form.formState.errors.authorName?.message}><input id="authorName" className="input-medium" {...form.register("authorName")} /></Field>
                <Field label={t("wizard.fields.genre")} htmlFor="genreId" required error={form.formState.errors.genreId?.message}><select id="genreId" className="input-medium" {...form.register("genreId")}><option value="" /><SelectOptions items={genreOptions} /></select></Field>
                <Field label={t("wizard.fields.sellingPoint")} htmlFor="sellingPoint" required className="field-wide" error={form.formState.errors.sellingPoint?.message}><textarea id="sellingPoint" rows={2} maxLength={150} {...form.register("sellingPoint")} /></Field>
                <Field label={t("wizard.fields.synopsis")} htmlFor="synopsis" required className="field-wide" error={form.formState.errors.synopsis?.message}><textarea id="synopsis" rows={4} maxLength={600} {...form.register("synopsis")} /></Field>
                <Field label={t("wizard.fields.contentLanguage")} htmlFor="contentLanguageId" required error={form.formState.errors.contentLanguageId?.message}><select id="contentLanguageId" className="input-medium" {...form.register("contentLanguageId")}><option value="" /><SelectOptions items={languageOptions} /></select></Field>
                <Field label={t("wizard.fields.duration")} htmlFor="videoDurationInput" required error={form.formState.errors.videoDurationId?.message ?? form.formState.errors.customVideoDuration?.message} hint={customDurationOptionIds.length ? t("wizard.durationEditableHint") : undefined}>
                  {customDurationOptionIds.length ? <EditableSelect id="videoDurationInput" name="videoDurationInput" className="input-short" autoComplete="off" maxLength={80} placeholder={t("wizard.durationPlaceholder")} options={editableDurationOptions} optionId={selectedVideoDurationId} customValue={customVideoDuration} onValueChange={(optionId, customValue) => {
                    form.setValue("videoDurationId", optionId, { shouldDirty: true, shouldValidate: true });
                    form.setValue("customVideoDuration", customValue, { shouldDirty: true, shouldValidate: true });
                  }} /> : <select id="videoDurationInput" className="input-short" {...form.register("videoDurationId", { onChange: () => form.setValue("customVideoDuration", "", { shouldDirty: true, shouldValidate: true }) })}><option value="" /><SelectOptions items={durationOptions} /></select>}
                </Field>
                <ChoiceField label={t("wizard.fields.platforms")} id="platform-group"><div className="choice-row" id="platform-group">{platformOptions.map((item) => <label className="choice-chip" key={item.id} aria-disabled={item.unavailable}><input type="checkbox" value={item.id} disabled={item.unavailable && !selectedPlatformIds.includes(item.id)} {...form.register("publishingPlatformIds")} /><span>{item.label}</span></label>)}</div></ChoiceField>
              </div>
            </section>
            <SourceFilesSection categories={sourceCategories} assets={sourceAssets} locale={validLocale} uploadCategory={uploadCategory ?? (saveDraft.isPending ? "__saving__" : undefined)} transfers={transfers} uploadError={uploadError} onUpload={upload} onRemove={removeAsset} onCancel={cancelUpload} onRetry={retryUpload} />
          </div>

          <ProjectSummaryRail control={form.control} cover={cover} assets={sourceAssets} genres={genreOptions} statusLabel={options.taskStatuses.find((item) => item.id === draftQuery.data.status)?.label ?? draftQuery.data.status} createdAt={draftQuery.data.createdAt} locale={validLocale} />
        </div>

        <div className="sticky-actions">
          <button className="button button-secondary" type="button" disabled={saveDraft.isPending || Boolean(uploadCategory)} onClick={form.handleSubmit((values) => runSave(values, false, true))}>{saveDraft.isPending ? t("common.saving") : t("common.saveDraft")}</button>
          <p className="sticky-note">{t("wizard.footerNotes.project")}</p>
          <div>
          {conflict && <button className="button button-secondary" type="button" onClick={() => { failedSaveSnapshotRef.current = undefined; form.reset(); void draftQuery.refetch(); }}>{t("common.reload")}</button>}
          <button className="button button-primary" type="submit" disabled={saveDraft.isPending || Boolean(uploadCategory)}>{saveDraft.isPending ? t("common.saving") : t("wizard.actions.toCharacters")}<span aria-hidden="true">→</span></button></div>
        </div>
      </form>
    </div>
  );
}
