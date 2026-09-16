import {
adminService,
localizedApiError,
optionService
} from "@lifewood/api-client";
import type {
AdminProjectDetail,
AdminProjectSummary,
AdminVoiceReference,
ConfigOption,
CurrentUser,
FormOptions,
ProjectPriority,
ReferenceAsset,
SupportedLocale,
WorkflowStatus
} from "@lifewood/domain";
import { getNarrationEnabled } from "@lifewood/domain";
import { SavedViews } from "@lifewood/ui/saved-views";
import {
keepPreviousData,
useMutation,
useQuery,
useQueryClient,
} from "@tanstack/react-query";
import {
useEffect,
useId,
useMemo,
useState,
type FormEvent,
type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import {
useLocation,
useNavigate,
useSearchParams
} from "react-router-dom";
import { ExpandableText } from "./ExpandableText";
import { FinalDeliveryPanel } from "./FinalDeliveryPanel";
import { customerPortalUrl } from "./portal-url";
import { ProjectActionTarget } from "./ProjectAction";
import { ProjectOperations } from "./ProjectOperations";
import { ProjectReturns } from "./ProjectReturns";
import { readRevisionSnapshot } from "./revision-snapshot";
import { showAdminToast } from "./Toast";
import { WorkflowEditor,workflowRouteDraft } from "./WorkflowEditor";
export { customerPortalUrl } from "./portal-url";

import { adminAssetUrl,formatDate,resolveProjectSelection } from "./project-utils";
export function ProjectsPage({ locale, user }: { locale: SupportedLocale; user: CurrentUser }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const workflow = (searchParams.get("workflow") ?? "") as WorkflowStatus | "";
  const priority = (searchParams.get("priority") ?? "") as ProjectPriority | "";
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => setSearchInput(search), [search]);
  const requestedProjectId = searchParams.get("project") ?? undefined;
  const projects = useQuery({
    queryKey: ["admin-projects", workflow, priority, search, page],
    queryFn: () =>
      adminService.listProjects({
        workflowStatus: workflow || undefined,
        priority: priority || undefined,
        search: search || undefined,
        page,
        pageSize: 20,
      }),
  });
  const selectedId = resolveProjectSelection(
    requestedProjectId,
    projects.data?.items.map((item) => item.id) ?? [],
    Boolean(projects.data),
  );
  const detail = useQuery({
    queryKey: ["admin-project", selectedId],
    queryFn: () => adminService.getProject(selectedId!),
    enabled: Boolean(selectedId),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const options = useQuery({
    queryKey: ["form-options", locale],
    queryFn: () => optionService.getFormOptions(locale),
  });
  const voices = useQuery({
    queryKey: ["admin-project-voices", selectedId],
    queryFn: () => adminService.listProjectVoiceReferences(selectedId!),
    enabled: Boolean(selectedId),
  });
  const workflowOptions = options.data?.workflowStatuses ?? [];
  const priorityOptions = options.data?.projectPriorities ?? [];
  const workflowLabels = useMemo(
    () => new Map(workflowOptions.map((item) => [item.id, item.label])),
    [workflowOptions],
  );
  const updateUrl = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setSearchParams(next, { replace: true });
  };
  const pages = Math.max(1, Math.ceil((projects.data?.total ?? 0) / 20));
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    updateUrl({ q: value, page: undefined });
  };
  const updateWorkflow = useMutation({
    mutationFn: (value: {
      workflowStatus: WorkflowStatus;
      priority: ProjectPriority;
      assigneeUserId?: string;
      expectedUpdatedAt?: string;
    }) =>
      adminService.updateWorkflow(
        selectedId!,
        value.workflowStatus,
        value.priority,
        value.expectedUpdatedAt ?? detail.data!.workflowUpdatedAt,
        value.assigneeUserId,
      ),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.workflowSaved"));
      await queryClient.invalidateQueries({ queryKey: ["admin-project"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-projects"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-workbench"] });
    },
  });
  const addNote = useMutation({
    mutationFn: (body: string) => adminService.addNote(selectedId!, body),
    onSuccess: async () => {
      showAdminToast(t("admin.feedback.noteAdded"));
      await queryClient.invalidateQueries({ queryKey: ["admin-project"] });
    },
  });
  return (
    <main className="content projects-content">
      <section className="page-toolbar">
        <SavedViews key={user.id} userId={user.id} area="projects" filters={{q:search,workflow,priority}} onApply={values=>{setSearchInput(values.q??"");setSearchParams(new URLSearchParams(values));}}/>
        <form onSubmit={submitSearch} role="search">
          <input
            name="q"
            autoComplete="off"
            aria-label={t("admin.projects.search")}
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("admin.projects.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <select
          aria-label={t("admin.projects.statusFilter")}
          value={workflow}
          onChange={(event) => {
            updateUrl({ workflow: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.projects.allStatuses")}</option>
          {workflowOptions.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t("admin.projects.priorityFilter")}
          value={priority}
          onChange={(event) => {
            updateUrl({ priority: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.projects.allPriorities")}</option>
          {priorityOptions.map((item) => (
            <option value={item.id} key={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <span className="result-count">
          {t("admin.projects.count", { count: projects.data?.total ?? 0 })}
        </span>
      </section>
      <div className="master-detail">
        <section className="project-pane" aria-label={t("admin.projects.list")}>
          {projects.isError && (
            <div className="message error">
              {localizedApiError(projects.error, t)}
            </div>
          )}
          <div className="project-rows">
            {projects.data?.items.map((item) => (
              <ProjectRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                locale={locale}
                statusLabel={
                  workflowLabels.get(item.workflowStatus) ?? item.workflowStatus
                }
                onSelect={() => {
                  updateUrl({ project: item.id });
                }}
              />
            ))}
          </div>
          {!projects.isPending && !projects.data?.items.length && (
            <div className="empty">{t("admin.projects.empty")}</div>
          )}
          <nav className="pager">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                const next = page - 1;

                updateUrl({ page: next > 1 ? String(next) : undefined });
              }}
            >
              {t("common.previous")}
            </button>
            <span>{t("common.pageOf", { page, pages })}</span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => {
                const next = page + 1;

                updateUrl({ page: String(next) });
              }}
            >
              {t("common.next")}
            </button>
          </nav>
        </section>
        <ProjectDetail key={detail.data?.project.id ?? "empty"}
          permissions={user.permissions}
          detail={detail.data}
          switching={detail.isPlaceholderData && detail.isFetching}
          loading={
            (detail.isPending && Boolean(selectedId)) || options.isPending || (voices.isPending && Boolean(selectedId))
          }
          locale={locale}
          workflowOptions={workflowOptions}
          priorityOptions={priorityOptions}
          formOptions={options.data}
          voiceReferences={voices.data ?? []}
          busy={
            detail.isFetching ||
            updateWorkflow.isPending ||
            addNote.isPending ||
            options.isPending ||
            options.isError ||
            voices.isError ||
            !workflowOptions.length ||
            !priorityOptions.length
          }
          error={
            detail.error ??
            updateWorkflow.error ??
            addNote.error ??
            options.error ??
            voices.error
          }
          onWorkflow={async (value) => { await updateWorkflow.mutateAsync(value); }}
          onNote={async (body) => {
            await addNote.mutateAsync(body);
          }}
        />
      </div>
    </main>
  );
}

function ProjectRow({
  item,
  selected,
  locale,
  statusLabel,
  onSelect,
}: {
  item: AdminProjectSummary;
  selected: boolean;
  locale: SupportedLocale;
  statusLabel: string;
  onSelect: () => void;
}) {
  const {t}=useTranslation();
  return (
    <button
      type="button"
      className={selected ? "project-row selected" : "project-row"}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
    >
      {item.coverUrl ? (
        <img
          src={adminAssetUrl(item.id, item.coverUrl)}
          alt=""
          width="42"
          height="58"
          loading="lazy"
        />
      ) : (
        <span className="cover-placeholder" />
      )}
      <span className="row-main">
        <strong>{item.projectName || item.bookTitle || "—"}</strong>
        <small>
          {[item.ownerName || t("accountClosure.deleted"), item.bookTitle && item.bookTitle !== item.projectName ? item.bookTitle : undefined].filter(Boolean).join(" · ")}
        </small>
        <small>
          {formatDate(item.updatedAt, locale)}
        </small>
      </span>
      <span className={`status status-${item.workflowStatus}`}>
        {statusLabel}
      </span>
    </button>
  );
}

function ProjectDetail({
  permissions,
  detail,
  switching,
  loading,
  locale,
  workflowOptions,
  priorityOptions,
  formOptions,
  voiceReferences,
  busy,
  error,
  onWorkflow,
  onNote,
}: {
  permissions: string[];
  detail?: AdminProjectDetail;
  switching: boolean;
  loading: boolean;
  locale: SupportedLocale;
  workflowOptions: ConfigOption[];
  priorityOptions: ConfigOption[];
  formOptions?: FormOptions;
  voiceReferences: AdminVoiceReference[];
  busy: boolean;
  error: unknown;
  onWorkflow: (value: {
    workflowStatus: WorkflowStatus;
    priority: ProjectPriority;
    assigneeUserId?: string;
    expectedUpdatedAt?: string;
  }) => Promise<void>;
  onNote: (body: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [actionTarget,setActionTarget]=useState<HTMLDivElement|null>(null);
  const location=useLocation(),navigate=useNavigate();
  const routeDraft=workflowRouteDraft(location.state,detail?.project.id);
  const [editingWorkflow,setEditingWorkflow]=useState(Boolean(routeDraft));
  const closeWorkflow=()=>{setEditingWorkflow(false);if(routeDraft)navigate(location.pathname+location.search,{replace:true,state:null});};
  if (loading)
    return <aside className="detail-pane empty">{t("common.loading")}</aside>;
  if (!detail)
    return (
      <aside className="detail-pane empty">{t("admin.projects.select")}</aside>
    );
  const task = detail.project;
  const assets = [
    ...task.book.sourceAssets,
    ...(task.creative.styleReferenceImages ?? []),
    ...task.creative.characters.flatMap((character) => character.referenceImages ?? []),
    ...task.voiceAndReferences.assets,
  ];
  const assetCategoryLabel = (categoryId: string) =>
    [...(formOptions?.sourceCategories ?? []), ...(formOptions?.referenceCategories ?? [])]
      .find((category) => category.id === categoryId)?.label ?? t("uiDensity.unavailableOption");
  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (body) void onNote(body).then(() => form.reset());
  };
  return (
    <ProjectActionTarget.Provider value={actionTarget}><aside
      className={switching ? "detail-pane switching" : "detail-pane"}
      aria-busy={switching}
    >
      <div className="detail-title">
        <div>
          {task.taskNumber && <span className="eyebrow">{task.taskNumber}</span>}
          <h2>{task.project.projectName || task.book.title || "—"}</h2>
          <p>
            {[detail.ownerName || t("accountClosure.deleted"),detail.ownerEmail].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className={`status status-${detail.workflowStatus}`}>
          {workflowOptions.find((item) => item.id === detail.workflowStatus)
            ?.label ?? detail.workflowStatus}
        </span>
      </div>
      <div className="project-actions" role="group" aria-label={t("projectActions.title")} ref={setActionTarget}>
        {task.status === "submitted" && permissions.includes("admin.projects.workflow") && <button disabled={busy} onClick={()=>setEditingWorkflow(true)}>{t("projectActions.editWorkflow")}</button>}
        <div data-project-action="operations" />
        <div data-project-action="returns" />
        <div data-project-action="delivery" />
      </div>
      <div className="project-workflow-summary">
        <span>{t("admin.projects.assignee")} · <strong>{detail.assigneeName ?? t("admin.projects.unassigned")}</strong></span>
        <span>{t("admin.projects.priority")} · <strong>{priorityOptions.find(item=>item.id===detail.priority)?.label ?? t("uiDensity.unavailableOption")}</strong></span>
      </div>
      <ProjectOperations key={`operations-${task.id}`} id={task.id} locale={locale} permissions={permissions} workflow={detail.workflowStatus}/>
      <ProjectReturns canReturn={permissions.includes("admin.projects.return")} canReply={permissions.includes("admin.projects.reply")} key={`returns-${task.id}`} id={task.id} version={task.version} status={task.status} workflowUpdatedAt={detail.workflowUpdatedAt} locale={locale} renderSnapshot={snapshot=><RevisionSnapshotDetails snapshot={snapshot} task={task} locale={locale} />} />
      {editingWorkflow && task.status === "submitted" && permissions.includes("admin.projects.workflow") && <WorkflowEditor detail={detail} initialDraft={routeDraft} locale={locale} permissions={permissions} workflowOptions={workflowOptions} priorityOptions={priorityOptions} busy={busy} error={error} onSave={onWorkflow} onClose={closeWorkflow}/>}
      {Boolean(error) && (
        <div className="message error">{localizedApiError(error, t)}</div>
      )}
      <FinalDeliveryPanel key={`deliveries-${task.id}`}
        canDeliver={permissions.includes("admin.projects.deliver")}
        projectId={task.id}
        projectStatus={task.status}
        locale={locale}
      />
      <ProjectSubmissionDetails
        task={task}
        locale={locale}
        options={formOptions}
        voiceReferences={voiceReferences}
      />
      {assets.length > 0 && <details className="detail-section attachment-index" key={`attachments-${task.id}`}>
        <summary>{t("admin.projects.files", { count: assets.length })}</summary>
        {assets.length ? (
          <ul className="file-list">
            {assets.map((asset) => (
              <li key={asset.id}>
                <a
                  href={adminAssetUrl(task.id, asset.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {asset.fileName}
                </a>
                <small>{assetCategoryLabel(asset.categoryId)}</small>
              </li>
            ))}
          </ul>
        ) : (
          null
        )}
      </details>}
      <details className="detail-section notes" key={`notes-${task.id}`}>
        <summary>{t("admin.projects.notes")}{detail.notes.length > 0 && <span className="detail-count">{detail.notes.length}</span>}</summary>
        {task.status === "submitted" && permissions.includes("admin.projects.note") && <form onSubmit={saveNote}>
          <textarea
            name="body"
            rows={2}
            maxLength={4000}
            required
            placeholder={t("admin.projects.notePlaceholder")}
          />
          <button disabled={busy}>{t("admin.projects.addNote")}</button>
        </form>}
        {detail.notes.length ? (
          <ol>
            {detail.notes.map((note) => (
              <li key={note.id}>
                <ExpandableText text={note.body}/>
                <small>
                  {note.authorName || t("accountClosure.deleted")} · {formatDate(note.createdAt, locale)}
                </small>
              </li>
            ))}
          </ol>
        ) : null}
      </details>
    </aside></ProjectActionTarget.Provider>
  );
}

type SubmissionFact = { label: string; value?: ReactNode; wide?: boolean };

function FactGrid({ facts }: { facts: SubmissionFact[] }) {
  const {t}=useTranslation();
  const populated=facts.filter(fact=>fact.value !== undefined && fact.value !== null && fact.value !== "" && fact.value !== false);
  if(!populated.length)return <p className="muted">{t("uiDensity.noDetails")}</p>;
  return (
    <dl className="fact-grid">
      {populated.map((fact) => (
        <div className={fact.wide ? "wide" : undefined} key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{typeof fact.value === "string" ? <ExpandableText key={fact.value} text={fact.value}/> : fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReferenceLinks({ urls }: { urls: string[] }) {
  const {t}=useTranslation();
  const safeUrls = urls.filter((url) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  });
  return safeUrls.length ? (
    <ul className="reference-links">
      {safeUrls.map((url, index) => (
        <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer">{t("uiDensity.referenceLink", {number:index+1})} · {new URL(url).hostname}</a></li>
      ))}
    </ul>
  ) : <span>—</span>;
}

function ReferenceFiles({ projectId, assets, legacyUrls }: { projectId: string; assets: ReferenceAsset[]; legacyUrls: string[] }) {
  const {t}=useTranslation();
  const safeLegacyUrls = legacyUrls.filter((url) => {
    try { return ["http:", "https:"].includes(new URL(url).protocol); }
    catch { return false; }
  });
  if (!assets.length && !safeLegacyUrls.length) return <span>—</span>;
  return <ul className="reference-links">
    {assets.map((asset) => <li key={asset.id}><a href={adminAssetUrl(projectId, asset.url)} target="_blank" rel="noreferrer">{asset.fileName}</a></li>)}
    {safeLegacyUrls.map((url, index) => <li key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer">{t("uiDensity.referenceLink", {number:index+1})} · {new URL(url).hostname}</a></li>)}
  </ul>;
}

export function RevisionSnapshotDetails({ snapshot, task, locale }: {
  snapshot: string;
  task: AdminProjectDetail["project"];
  locale: SupportedLocale;
}) {
  const saved = useMemo(() => readRevisionSnapshot(snapshot, locale), [snapshot, locale]);
  return <ProjectSubmissionDetails task={{ ...task, ...saved.fields }} locale={locale} voiceReferences={[]} snapshotLabels={saved} />;
}

function ProjectSubmissionDetails({ task, locale, options, voiceReferences, snapshotLabels }: {
  task: AdminProjectDetail["project"];
  locale: SupportedLocale;
  options?: FormOptions;
  voiceReferences: AdminVoiceReference[];
  snapshotLabels?: ReturnType<typeof readRevisionSnapshot>;
}) {
  const { t } = useTranslation();
  const optionMaps = useMemo(() => {
    const groups: Record<string, ConfigOption[] | undefined> = {
      brands: options?.brands,
      videoGoals: options?.videoGoals,
      audiences: options?.audiences,
      genres: options?.genres,
      contentLanguages: options?.contentLanguages,
      videoDurations: options?.videoDurations,
      publishingPlatforms: options?.publishingPlatforms,
      roleTypes: options?.roleTypes,
      ageRanges: options?.ageRanges,
      genders: options?.genders,
      visualStyles: options?.visualStyles,
      moodTags: options?.moodTags,
      imageStyleTags: [...(options?.imageStyleTags ?? []), ...(options?.legacyImageStyleTags ?? [])],
      paceTags: options?.paceTags,
      narrationTones: options?.narrationTones,
      speechRates: options?.speechRates,
      voiceGenders: options?.voiceGenders,
      voiceAges: options?.voiceAges,
      accents: options?.accents,
      voiceEmotions: options?.voiceEmotions,
    };
    return new Map(Object.entries(groups).map(([group, items]) => [group, new Map((items ?? []).map((item) => [item.id, item.label]))]));
  }, [options]);
  const voiceNames = useMemo(
    () => new Map(voiceReferences.map((voice) => [voice.id, locale === "en-US" ? voice.nameEnUs : voice.nameZhCn])),
    [locale, voiceReferences],
  );
  const listFormat = useMemo(() => new Intl.ListFormat(locale, { style: "short", type: "conjunction" }), [locale]);
  const label = (group: string, id?: string) => id ? (snapshotLabels?.optionMaps ?? optionMaps).get(group)?.get(id) ?? t("uiDensity.unavailableOption") : undefined;
  const labels = (group: string, ids: string[]) => ids.length ? listFormat.format(ids.map((id) => label(group, id) ?? id)) : undefined;
  const project = task.project;
  const book = task.book;
  const creative = task.creative;
  const voice = task.voiceAndReferences.voiceover;
  const narrationEnabled = getNarrationEnabled(voice);
  const direction = task.voiceAndReferences.creativeDirection;
  const selectedVoices = voice.selectedVoiceIds.map((id) => (snapshotLabels?.voiceNames ?? voiceNames).get(id) ?? t("uiDensity.unavailableOption"));
  const characterPanelId = useId();
  const [characterSelection, setCharacterSelection] = useState<{
    projectId: string;
    characterId: string;
  }>();
  const requestedCharacterId =
    characterSelection?.projectId === task.id
      ? characterSelection.characterId
      : undefined;
  const selectedCharacter =
    creative.characters.find(
      (character) => character.id === requestedCharacterId,
    ) ?? creative.characters[0];
  const selectedCharacterIndex = selectedCharacter
    ? creative.characters.findIndex(
        (character) => character.id === selectedCharacter.id,
      )
    : -1;

  return (
    <div className="submission-sections">
      <details className="detail-section submission-section" open>
        <summary>{t("admin.projects.projectInfo")}</summary>
        <FactGrid facts={[
          { label: t("wizard.fields.clientName"), value: project.clientName },
          { label: t("wizard.fields.contactName"), value: project.contactName },
          { label: t("wizard.fields.email"), value: project.email },
          { label: t("wizard.fields.phone"), value: project.phone },
          { label: t("wizard.fields.brand"), value: label("brands", project.brandId) },
          { label: t("wizard.fields.projectName"), value: project.projectName },
          { label: t("wizard.fields.videoGoal"), value: label("videoGoals", project.videoGoalId) },
          { label: t("wizard.fields.deadline"), value: project.deadline },
          { label: t("wizard.fields.audiences"), value: labels("audiences", project.audienceIds), wide: true },
        ]} />
      </details>
      <details className="detail-section submission-section" open>
        <summary>{t("admin.projects.bookInfo")}</summary>
        <FactGrid facts={[
          { label: t("wizard.fields.bookTitle"), value: book.title },
          { label: t("wizard.fields.subtitle"), value: book.subtitle },
          { label: t("wizard.fields.authorName"), value: book.authorName },
          { label: t("wizard.fields.genre"), value: label("genres", book.genreId) },
          { label: t("wizard.fields.contentLanguage"), value: label("contentLanguages", book.contentLanguageId) },
          { label: t("wizard.fields.duration"), value: book.customVideoDuration || label("videoDurations", book.videoDurationId) },
          { label: t("wizard.fields.platforms"), value: labels("publishingPlatforms", book.publishingPlatformIds), wide: true },
          { label: t("wizard.fields.sellingPoint"), value: book.sellingPoint, wide: true },
          { label: t("wizard.fields.synopsis"), value: book.synopsis, wide: true },
        ]} />
      </details>
      <details className="detail-section submission-section">
        <summary>{t("admin.projects.characters", { count: creative.characters.length })}</summary>
        {selectedCharacter ? (
          <>
            <div
              className="character-tabs"
              role="tablist"
              aria-label={t("admin.projects.characters", {
                count: creative.characters.length,
              })}
            >
              {creative.characters.map((character, index) => {
                const selected = character.id === selectedCharacter.id;
                return (
                  <button
                    id={`${characterPanelId}-tab-${index}`}
                    key={character.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={characterPanelId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() =>
                      setCharacterSelection({
                        projectId: task.id,
                        characterId: character.id,
                      })
                    }
                    onKeyDown={(event) => {
                      let nextIndex: number | undefined;
                      if (event.key === "ArrowRight") {
                        nextIndex = (index + 1) % creative.characters.length;
                      } else if (event.key === "ArrowLeft") {
                        nextIndex =
                          (index - 1 + creative.characters.length) %
                          creative.characters.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = creative.characters.length - 1;
                      }

                      if (nextIndex === undefined) return;
                      event.preventDefault();
                      const nextCharacter = creative.characters[nextIndex];
                      setCharacterSelection({
                        projectId: task.id,
                        characterId: nextCharacter.id,
                      });
                      requestAnimationFrame(() => {
                        document
                          .getElementById(
                            `${characterPanelId}-tab-${nextIndex}`,
                          )
                          ?.focus();
                      });
                    }}
                  >
                    {character.name ||
                      t("admin.projects.characterNumber", {
                        number: index + 1,
                      })}
                  </button>
                );
              })}
            </div>
            <div className="character-submissions">
              <article
                id={characterPanelId}
                role="tabpanel"
                aria-labelledby={`${characterPanelId}-tab-${selectedCharacterIndex}`}
              >
                <h4>
                  {selectedCharacter.name ||
                    t("admin.projects.characterNumber", {
                      number: selectedCharacterIndex + 1,
                    })}
                </h4>
                {(selectedCharacter.presetImageUrl ?? selectedCharacter.presetId) && <figure><img src={selectedCharacter.presetImageUrl?.startsWith("/api/") ? selectedCharacter.presetImageUrl : new URL(selectedCharacter.presetImageUrl ?? `/character-presets/${selectedCharacter.presetId}.png`, new URL(customerPortalUrl(locale), window.location.origin)).href} alt={t("bookIntake.presetImage", { name: selectedCharacter.name })} width="120" height="120" loading="lazy" /></figure>}
                <FactGrid facts={[
                  { label: t("creative.fields.roleType"), value: label("roleTypes", selectedCharacter.roleTypeId) },
                  { label: t("creative.fields.storyRole"), value: selectedCharacter.storyRole },
                  { label: t("creative.fields.ageRange"), value: label("ageRanges", selectedCharacter.ageRangeId) },
                  { label: t("creative.fields.gender"), value: label("genders", selectedCharacter.genderId) },
                  { label: t("creative.fields.personality"), value: selectedCharacter.personality, wide: true },
                  { label: t("creative.fields.appearance"), value: selectedCharacter.appearance, wide: true },
                  { label: t("creative.fields.clothing"), value: selectedCharacter.clothing },
                  { label: t("creative.fields.emotion"), value: selectedCharacter.emotion },
                  { label: t("creative.fields.voiceHint"), value: selectedCharacter.voiceHint, wide: true },
                  { label: t("admin.projects.referenceImages"), value: ((selectedCharacter.referenceImages?.length ?? 0) + selectedCharacter.referenceImageUrls.length) > 0 ? <ReferenceFiles projectId={task.id} assets={selectedCharacter.referenceImages ?? []} legacyUrls={selectedCharacter.referenceImageUrls} /> : undefined, wide: true },
                ]} />
              </article>
            </div>
          </>
        ) : (
          <p className="muted">{t("admin.projects.noCharacters")}</p>
        )}
      </details>
      <details className="detail-section submission-section">
        <summary>{t("admin.projects.visualInfo")}</summary>
        <FactGrid facts={[
          { label: t("creative.fields.visualStyle"), value: label("visualStyles", creative.visualStyleId) },
          { label: t("creative.fields.moodTags"), value: labels("moodTags", creative.moodTagIds) },
          { label: t("creative.fields.imageTags"), value: labels("imageStyleTags", creative.imageStyleTagIds) },
          { label: t("creative.fields.paceTags"), value: labels("paceTags", creative.paceTagIds) },
          { label: t("admin.projects.styleReferences"), value: ((creative.styleReferenceImages?.length ?? 0) + creative.styleReferenceImageUrls.length) > 0 ? <ReferenceFiles projectId={task.id} assets={creative.styleReferenceImages ?? []} legacyUrls={creative.styleReferenceImageUrls} /> : undefined, wide: true },
        ]} />
      </details>
      <details className="detail-section submission-section">
        <summary>{t("admin.projects.voiceInfo")}</summary>
        <FactGrid facts={[
          { label: t("voice.narration.question"), value: t(narrationEnabled === true ? "voice.narration.required" : narrationEnabled === false ? "voice.narration.notRequired" : "voice.narration.unselected"), wide: true },
          ...(narrationEnabled === true ? [
          { label: t("voice.fields.contentLanguage"), value: label("contentLanguages", voice.contentLanguageId) },
          { label: t("voice.fields.narrationTone"), value: label("narrationTones", voice.narrationToneId) },
          { label: t("voice.fields.speechRate"), value: label("speechRates", voice.speechRateId) },
          { label: t("voice.fields.voiceGender"), value: label("voiceGenders", voice.voiceGenderId) },
          { label: t("voice.fields.voiceAge"), value: label("voiceAges", voice.voiceAgeId) },
          { label: t("voice.fields.accent"), value: label("accents", voice.accentId) },
          { label: t("voice.fields.emotionStyle"), value: label("voiceEmotions", voice.emotionStyleId) },
          { label: t("admin.projects.preferredVoice"), value: voice.preferredVoiceId ? (snapshotLabels?.voiceNames ?? voiceNames).get(voice.preferredVoiceId) ?? t("uiDensity.unavailableOption") : undefined },
          { label: t("admin.projects.selectedVoices"), value: selectedVoices.length ? listFormat.format(selectedVoices) : undefined, wide: true },
          { label: t("voice.fields.customVoice"), value: voice.customVoiceDescription, wide: true },
          { label: t("voice.fields.pronunciationNotes"), value: voice.pronunciationNotes, wide: true },
          ] : []),
        ]} />
      </details>
      <details className="detail-section submission-section">
        <summary>{t("admin.projects.creativeDirection")}</summary>
        <FactGrid facts={[
          { label: t("voice.fields.coreMessage"), value: direction.coreMessage, wide: true },
          { label: t("voice.fields.requiredScenes"), value: direction.requiredScenes, wide: true },
          { label: t("voice.fields.authorPreferences"), value: direction.authorPreferences, wide: true },
          { label: t("voice.fields.closingMessage"), value: direction.closingMessage, wide: true },
          { label: t("voice.fields.musicMood"), value: direction.musicMood },
          { label: t("voice.fields.avoidContent"), value: direction.avoidContent },
          { label: t("voice.fields.competitorLinks"), value: task.voiceAndReferences.competitorUrls.length ? <ReferenceLinks urls={task.voiceAndReferences.competitorUrls} /> : undefined, wide: true },
        ]} />
      </details>
    </div>
  );
}

