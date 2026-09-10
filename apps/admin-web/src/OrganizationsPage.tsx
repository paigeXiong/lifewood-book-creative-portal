import type { NoticeEditor } from "./AnnouncementsPage";
import { useConfirm } from "./useConfirm";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AdminOrganization, SupportedLocale } from "@lifewood/domain";
import { ModalFrame } from "./ModalFrame";
import { showAdminToast } from "./Toast";
import { useUnsavedClose } from "./useUnsavedClose";

function formatDate(value: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function OrganizationIdentity({ organization }: { organization: AdminOrganization }) {
  const [failed, setFailed] = useState(false);
  if (!organization.avatarUrl || failed) return <span>{organization.name}</span>;
  return <img className="organization-wordmark" src={organization.avatarUrl} alt={organization.name} title={organization.name} width="216" height="36" loading="lazy" decoding="async" onError={()=>setFailed(true)} />;
}

export function OrganizationsPage({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const location=useLocation(); const navigate=useNavigate();
  const noticeEditor=(location.state as {announcementEditor?:NoticeEditor}|null)?.announcementEditor;
  const picking=!!noticeEditor && new URLSearchParams(location.search).get("pick")==="announcement";
  const [selected,setSelected]=useState<string[]>(noticeEditor?.content.organizationIds??[]);
  const [names,setNames]=useState<Record<string,string>>(noticeEditor?.organizations??{});

  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(() => Math.max(1, Number(searchParams.get("page")) || 1));
  const [editing, setEditing] = useState<AdminOrganization | null | undefined>();
  const organizations = useQuery({
    queryKey: ["admin-organizations", search, page],
    queryFn: () => adminService.listOrganizations({ search: search || undefined, page, pageSize: 20 }),
  });
  const pages = Math.max(1, Math.ceil((organizations.data?.total ?? 0) / 20));
  const save = useMutation({
    mutationFn: (value: { id?: string; name: string; active: boolean }) =>
      value.id
        ? adminService.updateOrganization(value.id, { name: value.name, active: value.active })
        : adminService.createOrganization(value.name),
    onSuccess: async (_, value) => {
      setEditing(undefined);
      showAdminToast(t(value.id ? "admin.feedback.organizationUpdated" : "admin.feedback.organizationCreated"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-organizations"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-me"] }),
      ]);
    },
  });
  const setListState = (nextPage: number, nextSearch = search) => {
    const next = new URLSearchParams(searchParams);
    nextSearch ? next.set("q", nextSearch) : next.delete("q");
    nextPage > 1 ? next.set("page", String(nextPage)) : next.delete("page");
    setSearchParams(next, { replace: true, state: location.state });
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchInput.trim();
    setPage(1);
    setSearch(value);
    setListState(1, value);
  };

  return (
    <main className="content organizations-content">
      {picking&&<section className="page-toolbar"><span>{t("announcements.selected")} · {selected.length}</span><button onClick={()=>navigate(`/${locale}/settings/announcements`,{state:{announcementEditor:noticeEditor}})}>{t("announcements.cancel")}</button><button className="primary" onClick={()=>navigate(`/${locale}/settings/announcements`,{state:{announcementEditor:{...noticeEditor,organizations:names,content:{...noticeEditor!.content,organizationIds:selected}}}})}>{t("announcements.done")}</button></section>}
      <section className="page-toolbar">
        <form onSubmit={submitSearch} role="search">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label={t("admin.organizations.search")}
            placeholder={t("admin.organizations.search")}
          />
          <button>{t("common.search")}</button>
        </form>
        <span className="result-count">{t("admin.organizations.count", { count: organizations.data?.total ?? 0 })}</span>
        <button type="button" className="primary push-right" onClick={() => setEditing(null)}>{t("admin.organizations.create")}</button>
      </section>
      {Boolean(organizations.error) && <div className="message error" role="alert">{localizedApiError(organizations.error, t)}</div>}
      <section className="table-card">
        <div className="management-table-scroll" aria-busy={organizations.isFetching}>
        <table>
          <thead><tr>
            <th>{t("admin.organizations.name")}</th>
            <th>{t("admin.organizations.members")}</th>
            <th>{t("admin.organizations.status")}</th>
            <th>{t("admin.organizations.updated")}</th>
            <th>{t("admin.organizations.action")}</th>
          </tr></thead>
          <tbody>{organizations.data?.items.map((organization) => (
            <tr key={organization.id}>
              <td data-label={t("admin.organizations.name")}><strong>{picking ? <OrganizationIdentity key={organization.avatarUrl} organization={organization} /> : <Link className="organization-members-link organization-identity-link" to={`/${locale}/users?${new URLSearchParams({organization:organization.id})}`} title={t("admin.organizations.viewMembers",{name:organization.name,count:organization.memberCount})}><OrganizationIdentity key={organization.avatarUrl} organization={organization} /></Link>}</strong></td>
              <td data-label={t("admin.organizations.members")}>{picking ? organization.memberCount : <Link className="organization-members-link organization-member-count" to={`/${locale}/users?${new URLSearchParams({organization:organization.id})}`} aria-label={t("admin.organizations.viewMembers",{name:organization.name,count:organization.memberCount})} title={t("admin.organizations.viewMembers",{name:organization.name,count:organization.memberCount})}>{organization.memberCount}</Link>}</td>
              <td data-label={t("admin.organizations.status")}><span className={organization.active ? "status active" : "status inactive"}>{t(organization.active ? "admin.organizations.active" : "admin.organizations.inactive")}</span></td>
              <td data-label={t("admin.organizations.updated")}>{formatDate(organization.updatedAt, locale)}</td>
              <td data-label={t("admin.organizations.action")}>{picking?<label><input type="checkbox" disabled={!organization.active || !selected.includes(organization.id)&&selected.length>=200} checked={selected.includes(organization.id)} onChange={e=>{setSelected(prev=>e.target.checked?[...prev,organization.id]:prev.filter(x=>x!==organization.id));setNames(prev=>({...prev,[organization.id]:organization.name}));}}/>{t("announcements.select")}</label>:<button type="button" onClick={() => setEditing(organization)}>{t("admin.organizations.edit")}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!organizations.isPending && !organizations.data?.items.length && <div className="empty">{t("admin.organizations.empty")}</div>}
        </div>
        <nav className="pager">
          <button type="button" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); setListState(next); }}>{t("common.previous")}</button>
          <span>{t("common.pageOf", { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => { const next = page + 1; setPage(next); setListState(next); }}>{t("common.next")}</button>
        </nav>
      </section>
      {editing !== undefined && (
        <OrganizationDialog
          organization={editing}
          busy={save.isPending}
          error={save.error}
          onClose={() => setEditing(undefined)}
          onSave={(value) => save.mutate(value)}
        />
      )}
    </main>
  );
}

function OrganizationDialog({ organization, busy, error, onClose, onSave }: {
  organization: AdminOrganization | null;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (value: { id?: string; name: string; active: boolean }) => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { markDirty, requestClose } = useUnsavedClose(onClose, t("common.unsavedConfirm"), busy);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const active = organization ? data.get("active") === "on" : true;
    if (organization?.active && !active && organization.memberCount > 0 && !await confirm(t("admin.organizations.deactivateConfirm", { count: organization.memberCount }))) return;
    onSave({ id: organization?.id, name: String(data.get("name") ?? ""), active });
  };
  return (
    <ModalFrame labelledBy="organization-dialog-title" busy={busy} onClose={requestClose}>
      <div className="modal-title">
        <h2 id="organization-dialog-title">{t(organization ? "admin.organizations.edit" : "admin.organizations.create")}</h2>
        <button type="button" aria-label={t("common.close")} disabled={busy} onClick={requestClose} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button>
      </div>
      <form onSubmit={submit} onChange={markDirty}>
        <label><span>{t("admin.organizations.name")}</span><input name="name" defaultValue={organization?.name} minLength={2} maxLength={120} required /></label>
        {organization && <label className="check-row"><input name="active" type="checkbox" defaultChecked={organization.active} /><span>{t("admin.organizations.enabled")}</span></label>}
        {Boolean(error) && <div className="message error" role="alert">{localizedApiError(error, t)}</div>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={requestClose}>{t("common.cancel")}</button>
          <button className="primary" disabled={busy}>{t(busy ? "common.loading" : "common.save")}</button>
        </div>
      </form>
    </ModalFrame>
  );
}
