import {
adminService,
localizedApiError
} from "@lifewood/api-client";
import type {
AdminOrganization,
AdminUser,
SupportedLocale
} from "@lifewood/domain";
import {
useMutation,
useQuery,
useQueryClient
} from "@tanstack/react-query";
import {
useEffect,
useState,
type FormEvent
} from "react";
import { useTranslation } from "react-i18next";
import {
useLocation,
useNavigate,
useSearchParams
} from "react-router-dom";
import { AccountClosureDialog } from "./AccountClosureDialog";
import { readBatchDraft } from "./BatchEditor";
import { ModalFrame } from "./ModalFrame";
import { loadAllOrganizations } from "./organization-loader";
import {
ResetUserPasswordDialog,
} from "./PasswordDialogs";
import { showAdminToast } from "./Toast";
import { useConfirm } from "./useConfirm";
import { ActivityTime,PresenceBadge,usePresenceDirectorySync,UserActivityDetails,UserActivityStats } from "./UserActivity";
import { useUnsavedClose } from "./useUnsavedClose";
import { workflowReturnPath,workflowRouteDraft } from "./WorkflowEditor";
export { customerPortalUrl } from "./portal-url";

function AccountRoleOptions({ includeOwner = false, staffOnly = false }: { includeOwner?: boolean; staffOnly?: boolean }) {
  const { i18n } = useTranslation();
  const locale = i18n.language === "en-US" ? "en-US" : "zh-CN";
  const roles = useQuery({ queryKey: ["admin-roles", locale], queryFn: () => adminService.listRoles(locale) });
  return <>{roles.data?.filter(role => (includeOwner || role.id !== "owner") && (!staffOnly || role.id !== "customer")).map(role => <option key={role.id} value={role.id}>{role.label}</option>)}</>;
}

function AccountRoleSelect({ initialRole }: { initialRole: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en-US" ? "en-US" : "zh-CN";
  const roles = useQuery({ queryKey: ["admin-roles", locale], queryFn: () => adminService.listRoles(locale) });
  const [role, setRole] = useState(initialRole);
  return <><select name="role" required value={roles.data ? role : ""} onChange={event => setRole(event.target.value)}>
    {!roles.data && <option value="" disabled>{t(roles.isError ? "common.retry" : "common.loading")}</option>}
    {roles.data?.filter(item => item.id !== "owner").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
  </select>{roles.isError && <button type="button" onClick={() => void roles.refetch()}>{t("common.retry")}</button>}
  {role === "operator" && <small>{t("admin.users.operatorHint")}</small>}</>;
}

function adminUserAvatarUrl(userId: string) {
  return `/api/admin/users/${encodeURIComponent(userId)}/avatar`;
}

export function UsersPage({ locale, currentUserId }: { locale: SupportedLocale; currentUserId: string }) {
  usePresenceDirectorySync();
  const { t } = useTranslation();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const location=useLocation(),navigate=useNavigate();
  const workflowDraft=workflowRouteDraft(location.state);
  const batchDraft=readBatchDraft(location.state);
  const batchPicking=searchParams.get("pick")==="batch-assignee"&&!!batchDraft;
  const picking=searchParams.get("pick")==="assignee"&&!!workflowDraft||batchPicking;
  const finishPicking=(user?:AdminUser)=>{if(batchPicking&&batchDraft){if(user&&(!user.active||user.role==="customer"))return;navigate(`/${locale}/workbench${batchDraft.returnSearch}`,{replace:true,state:{batchEditor:user?{...batchDraft,assigneeId:user.id,assigneeName:user.displayName}:batchDraft}});return;}if(!workflowDraft||user&&(!user.active||user.role==="customer"))return;navigate(workflowReturnPath(locale,workflowDraft),{replace:true,state:{workflowEditor:user?{...workflowDraft,assigneeUserId:user.id,assigneeName:user.displayName}:workflowDraft}});};
  const initialSearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [role, setRole] = useState(searchParams.get("role") ?? "");
  const [page, setPage] = useState(() =>
    Math.max(1, Number(searchParams.get("page")) || 1),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [detailUserId,setDetailUserId] = useState<string>();
  const presenceStatus=searchParams.get("status")??"";
  const organizationFilter=searchParams.get("organization")??"";
  const enabledFilter=searchParams.get("enabled")??"";
  const today=new Date();today.setHours(0,0,0,0);
  const todayStart=today.toISOString();
  const [closingUser,setClosingUser]=useState<AdminUser>();
  const [editUser, setEditUser] = useState<AdminUser>();
  const [resetUser, setResetUser] = useState<AdminUser>();
  const users = useQuery({
    queryKey: ["admin-users", search, role, page, presenceStatus, organizationFilter, enabledFilter, todayStart, picking],
    refetchInterval: 15000,
    queryFn: () =>
      adminService.listUsers({
        assignableOnly:picking,
        search: search || undefined,
        role: role || undefined,
        status:presenceStatus||undefined,organization:organizationFilter||undefined,enabled:enabledFilter||undefined,todayStart,
        page,
        pageSize: 20,
      }),
  });
  const organizations = useQuery({
    queryKey: ["admin-organizations", "user-selector"],
    queryFn: () => loadAllOrganizations(),
  });
  const pages = Math.max(1, Math.ceil((users.data?.total ?? 0) / 20));
  const create = useMutation({
    mutationFn: adminService.createUser,
    onSuccess: async () => {
      setShowCreate(false);
      showAdminToast(t("admin.feedback.userCreated"));
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      displayName,
      phone,
      role,
      active,
      organizationId,
    }: {
      id: string;
      displayName: string;
      phone?: string;
      role: "owner" | "customer" | "admin" | "operator";
      active: boolean;
      organizationId?: string;
    }) => adminService.updateUser(id, { displayName, phone, role, active, organizationId }),
    onSuccess: async () => {
      setEditUser(undefined);
      showAdminToast(t("admin.feedback.userUpdated"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-me"] }),
      ]);
    },
  });
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setPage(1);
    setSearch(value);
    const next = new URLSearchParams(searchParams);
    value ? next.set("q", value) : next.delete("q");
    next.delete("page");
    setSearchParams(next, { replace: true, state:location.state });
  };
  const setListState = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(changes).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key),
    );
    setSearchParams(next, { replace: true, state:location.state });
  };
  useEffect(()=>{if(users.isSuccess&&page>pages){setPage(pages);setListState({page:pages>1?String(pages):undefined});}},[users.isSuccess,pages,page]);
  return (
    <main className="content users-content">
      {picking?<section className="page-toolbar assignee-picker-toolbar"><strong>{t("workflowPicker.title")}</strong><button type="button" onClick={()=>finishPicking()}>{t("common.cancel")}</button></section>:<UserActivityStats statistics={users.data?.statistics}/>}
      <section className="page-toolbar">
        <form onSubmit={submitSearch} role="search">
          <input
            name="q"
            autoComplete="off"
            aria-label={t("admin.users.search")}
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("admin.users.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <select
          aria-label={t("admin.users.roleFilter")}
          value={role}
          onChange={(event) => {
            setPage(1);
            setRole(event.target.value);
            setListState({ role: event.target.value, page: undefined });
          }}
        >
          <option value="">{t("admin.users.allRoles")}</option>
          <AccountRoleOptions includeOwner staffOnly={picking} />
        </select>
        <select aria-label={t("userActivity.statusFilter")} value={presenceStatus} onChange={e=>{setPage(1);setListState({status:e.target.value||undefined,page:undefined});}}>
          <option value="">{t("userActivity.allPresence")}</option>
          {(["online","away","offline"] as const).map(value=><option key={value} value={value}>{t(`userActivity.${value}`)}</option>)}
        </select>
        <select aria-label={t("userActivity.organizationFilter")} value={organizationFilter} onChange={e=>{setPage(1);setListState({organization:e.target.value||undefined,page:undefined});}}>
          <option value="">{t("userActivity.allOrganizations")}</option><option value="unassigned">{t("admin.users.noOrganization")}</option>
          {organizations.data?.map(org=><option value={org.id} key={org.id}>{org.name}</option>)}
        </select>
        {!picking&&<select aria-label={t("userActivity.enabledFilter")} value={enabledFilter} onChange={e=>{setPage(1);setListState({enabled:e.target.value||undefined,page:undefined});}}>
          <option value="">{t("userActivity.allEnabled")}</option><option value="enabled">{t("admin.users.active")}</option><option value="disabled">{t("admin.users.inactive")}</option>
        </select>}
        <span className="result-count">
          {t("admin.users.count", { count: users.data?.total ?? 0 })}
        </span>
        {!picking&&<button
          type="button"
          className="primary push-right"
          onClick={() => setShowCreate(true)}
        >
          {t("admin.users.create")}
        </button>}
      </section>
      {Boolean(users.error || organizations.error) && (
        <div className="message error" role="alert">
          {localizedApiError(users.error ?? organizations.error, t)}
        </div>
      )}
      <section className="table-card">
        <div className="management-table-scroll" aria-busy={users.isFetching}>
        <table>
          <thead>
            <tr>
              <th>{t("admin.users.account")}</th>
              <th>{t("admin.users.role")}</th>
              <th>{t("admin.users.organization")}</th>
              <th>{t("admin.users.status")}</th>
              <th>{t("userActivity.lastActive")}</th>
              <th>{t("admin.users.action")}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((user) => (
              <tr key={user.id}>
                <td data-label={t("admin.users.account")}>
                  <div className="user-cell">
                    <img
                      src={adminUserAvatarUrl(user.id)}
                      alt=""
                      width="32"
                      height="32"
                      loading="lazy"
                    />
                    <div>
                      <div className="user-name-line"><button type="button" className="user-detail-link" onClick={()=>picking?finishPicking(user):setDetailUserId(user.id)}>{user.displayName}</button><PresenceBadge presence={user.presence}/></div>
                      <small>{user.email}{user.phone ? ` · ${user.phone}` : ""}</small>
                    </div>
                  </div>
                </td>
                <td data-label={t("admin.users.role")}>{t(`admin.roles.${user.role}`)}</td>
                <td data-label={t("admin.users.organization")}>{user.organization?.name ?? t("admin.users.noOrganization")}</td>
                <td data-label={t("admin.users.status")}>
                  <span
                    className={
                      user.active ? "status active" : "status inactive"
                    }
                  >
                    {t(
                      user.active
                        ? "admin.users.active"
                        : "admin.users.inactive",
                    )}
                  </span>
                </td>
                <td data-label={t("userActivity.lastActive")}><ActivityTime value={user.presence?.lastActiveAt} locale={locale}/></td>
                <td data-label={t("admin.users.action")}>
                  {picking?<button type="button" disabled={!user.active||user.role==="customer"} onClick={()=>finishPicking(user)}>{t(user.id===(batchPicking?batchDraft?.assigneeId:workflowDraft?.assigneeUserId)?"workflowPicker.current":"workflowPicker.select")}</button>:<div className="row-actions">
                    <button type="button" onClick={() => setEditUser(user)}>{t("admin.users.edit")}</button>
                    {user.role === "owner" ? (
                      <span className="muted">{t("admin.users.protected")}</span>
                    ) : (
                      <>
                      <button type="button" onClick={() => setResetUser(user)}>
                        {t("admin.users.resetPassword")}
                      </button>
                      <button
                        type="button"
                        disabled={update.isPending}
                        onClick={async () => {
                          if (
                            user.active &&
                            !await confirm(
                              t("admin.users.deactivateConfirm", {
                                name: user.displayName,
                              }),
                            )
                          )
                            return;
                          update.mutate({
                            id: user.id,
                            displayName: user.displayName,
                            phone: user.phone,
                            role: user.role,
                            active: !user.active,
                            organizationId: user.organization?.id,
                          });
                        }}
                      >
                        {t(
                          user.active
                            ? "admin.users.deactivate"
                            : "admin.users.activate",
                        )}
                      </button>
                      {user.id!==currentUserId&&<button type="button" className="account-close-button" aria-label={t("accountClosure.closeNamed",{name:user.displayName})} title={t("accountClosure.title")} onClick={()=>setClosingUser(user)} data-icon-motion="press"><svg data-icon-glyph viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button>}
                      </>
                    )}
                  </div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.isPending && !users.data?.items.length && (
          <div className="empty">{t("admin.users.empty")}</div>
        )}
        </div>
        <nav className="pager">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              setListState({ page: next > 1 ? String(next) : undefined });
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
              setPage(next);
              setListState({ page: String(next) });
            }}
          >
            {t("common.next")}
          </button>
        </nav>
      </section>
      {detailUserId&&<UserActivityDetails id={detailUserId} locale={locale} onClose={()=>setDetailUserId(undefined)}/>}
      {closingUser&&<AccountClosureDialog user={closingUser} onClose={()=>setClosingUser(undefined)}/>}
      {showCreate && (
        <CreateUserDialog
          busy={create.isPending}
          error={create.error}
          organizations={organizations.data ?? []}
          onClose={() => setShowCreate(false)}
          onCreate={(value) => create.mutate(value)}
        />
      )}
      {editUser && (
        <EditUserDialog
          user={editUser}
          organizations={organizations.data ?? []}
          busy={update.isPending}
          error={update.error}
          onClose={() => setEditUser(undefined)}
          onSave={(value) => update.mutate(value)}
        />
      )}
      {resetUser && (
        <ResetUserPasswordDialog
          user={resetUser}
          onClose={() => setResetUser(undefined)}
        />
      )}
    </main>
  );
}

function CreateUserDialog({
  busy,
  error,
  organizations,
  onClose,
  onCreate,
}: {
  busy: boolean;
  error: unknown;
  organizations: AdminOrganization[];
  onClose: () => void;
  onCreate: (value: {
    displayName: string;
    email: string;
    phone?: string;
    password: string;
    role: "customer" | "admin" | "operator";
    organizationId?: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onCreate({
      displayName: String(data.get("displayName")),
      email: String(data.get("email")),
      phone: String(data.get("phone") ?? "").trim() || undefined,
      password: String(data.get("password")),
      role: String(data.get("role")) as "customer" | "admin" | "operator",
      organizationId: String(data.get("organizationId") ?? "") || undefined,
    });
  };
  return (
    <ModalFrame labelledBy="create-user-title" busy={busy} onClose={requestClose}>
      <div className="modal-title">
        <h2 id="create-user-title">{t("admin.users.create")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button>
      </div>
      <form onSubmit={submit} onChange={markDirty}>
        <label>
          <span>{t("admin.users.name")}</span>
          <input
            name="displayName"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label>
          <span>{t("admin.users.email")}</span>
          <input
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            maxLength={254}
            required
          />
        </label>
        <label>
          <span>{t("admin.users.phone")}</span>
          <input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} />
        </label>
        <label>
          <span>{t("admin.users.password")}</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
          />
          <small>{t("admin.users.passwordHint")}</small>
        </label>
        <label>
          <span>{t("admin.users.role")}</span>
          <AccountRoleSelect initialRole="customer" />
        </label>
        <label>
          <span>{t("admin.users.organization")}</span>
          <select name="organizationId" defaultValue="">
            <option value="">{t("admin.users.noOrganization")}</option>
            {organizations.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <small>{t("admin.users.organizationHint")}</small>
        </label>
        {Boolean(error) && (
          <div className="message error" role="alert">
            {localizedApiError(error, t)}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={requestClose}>
            {t("common.cancel")}
          </button>
          <button className="primary" disabled={busy}>
            {t(busy ? "common.loading" : "admin.users.createAction")}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}

function EditUserDialog({ user, organizations, busy, error, onClose, onSave }: {
  user: AdminUser;
  organizations: AdminOrganization[];
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (value: { id: string; displayName: string; phone?: string; role: "owner" | "customer" | "admin" | "operator"; active: boolean; organizationId?: string }) => void;
}) {
  const { t } = useTranslation();
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({
      id: user.id,
      displayName: String(data.get("displayName") ?? ""),
      phone: String(data.get("phone") ?? "").trim() || undefined,
      role: user.role === "owner" ? "owner" : String(data.get("role")) as "customer" | "admin" | "operator",
      active: user.role === "owner" || data.get("active") === "on",
      organizationId: String(data.get("organizationId") ?? "") || undefined,
    });
  };
  const selectableOrganizations = organizations.filter((item) => item.active || item.id === user.organization?.id);
  return (
    <ModalFrame labelledBy="edit-user-title" busy={busy} onClose={requestClose}>
      <div className="modal-title">
        <h2 id="edit-user-title">{t("admin.users.edit")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button>
      </div>
      <form onSubmit={submit} onChange={markDirty}>
        <label><span>{t("admin.users.name")}</span><input name="displayName" defaultValue={user.displayName} minLength={2} maxLength={100} required /></label>
        <label><span>{t("admin.users.email")}</span><input value={user.email} readOnly aria-readonly="true" /></label>
        <label><span>{t("admin.users.phone")}</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} defaultValue={user.phone ?? ""} /></label>
        <label>
          <span>{t("admin.users.role")}</span>
          {user.role === "owner" ? <input value={t("admin.roles.owner")} readOnly aria-readonly="true" /> : (
            <AccountRoleSelect initialRole={user.role} />
          )}
        </label>
        <label>
          <span>{t("admin.users.organization")}</span>
          <select name="organizationId" defaultValue={user.organization?.id ?? ""}>
            <option value="">{t("admin.users.noOrganization")}</option>
            {selectableOrganizations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? "" : ` · ${t("admin.organizations.inactive")}`}</option>)}
          </select>
          <small>{t("admin.users.organizationHint")}</small>
        </label>
        {user.role !== "owner" && <label className="check-row"><input name="active" type="checkbox" defaultChecked={user.active} /><span>{t("admin.users.accountEnabled")}</span></label>}
        {Boolean(error) && <div className="message error" role="alert">{localizedApiError(error, t)}</div>}
        <div className="modal-actions"><button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button><button className="primary" disabled={busy}>{t(busy ? "common.loading" : "common.save")}</button></div>
      </form>
    </ModalFrame>
  );
}

