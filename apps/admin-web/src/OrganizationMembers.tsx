import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { adminService, localizedApiError } from "@lifewood/api-client";
import type { AdminOrganization, SupportedLocale } from "@lifewood/domain";
import { CreateUserDialog } from "./UsersPage";
import { showAdminToast } from "./Toast";

function MemberIcon({ kind }: { kind: "add" | "create" | "manage" | "search" }) {
  const paths = { add: "M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6m-3-3h6", create: "M12 5v14M5 12h14", manage: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6", search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0" };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function MemberAvatar({ id, name }: { id: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="organization-member-avatar" aria-hidden="true">{failed ? name.trim().slice(0, 2).toLocaleUpperCase() : <img src={`/api/admin/users/${encodeURIComponent(id)}/avatar`} alt="" width="40" height="40" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

export function OrganizationMembers({ organization, locale, userId }: { organization: AdminOrganization; locale: SupportedLocale; userId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const location = useLocation();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const members = useQuery({
    queryKey: ["admin-users", "organization-members", userId, organization.id, search, page],
    queryFn: () => adminService.listUsers({ organization: organization.id, search: search || undefined, page, pageSize: 10 }),
  });
  const create = useMutation({
    mutationFn: adminService.createUser,
    onSuccess: async () => {
      setCreating(false);
      showAdminToast(t("admin.feedback.userCreated"));
      await Promise.all([client.invalidateQueries({ queryKey: ["admin-users"] }), client.invalidateQueries({ queryKey: ["admin-organizations"] })]);
    },
  });
  const pages = Math.max(1, Math.ceil((members.data?.total ?? 0) / 10));
  useEffect(() => { if (members.isSuccess && page > pages) setPage(pages); }, [members.isSuccess, page, pages]);
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(input.trim()); setPage(1); };
  return <section className="organization-members-panel" id={`organization-members-${organization.id}`} aria-label={t("organizationMembers.title", { name: organization.name })}>
    <header className="organization-members-toolbar">
      <span className="muted">{t("admin.users.count", { count: members.data?.total ?? 0 })}</span>
      <form role="search" aria-label={t("organizationMembers.search")} onSubmit={submitSearch} className="organization-members-search"><input type="search" aria-label={t("organizationMembers.search")} placeholder={t("organizationMembers.search")} value={input} onChange={event => setInput(event.target.value)} /><button type="submit" aria-label={t("common.search")} title={t("common.search")} data-icon-motion="press"><MemberIcon kind="search" /></button></form>
      <div className="organization-members-actions">
        {organization.active && <><Link className="organization-member-action" aria-label={t("organizationMembers.addExisting")} title={t("organizationMembers.addExisting")} to={`/${locale}/users?${new URLSearchParams({ joinOrganization: organization.id, organization: "unassigned" })}`} state={{ organizationReturnSearch: location.search }}><MemberIcon kind="add" /></Link><button type="button" className="organization-member-action" aria-label={t("organizationMembers.create")} title={t("organizationMembers.create")} data-icon-motion="press" onClick={() => { create.reset(); setCreating(true); }}><MemberIcon kind="create" /></button></>}
        <Link className="organization-member-action" aria-label={t("organizationMembers.manage")} title={t("organizationMembers.manage")} to={`/${locale}/users?${new URLSearchParams({ organization: organization.id })}`}><MemberIcon kind="manage" /></Link>
      </div>
    </header>
    {members.isError ? <div className="message error" role="alert">{localizedApiError(members.error, t)} <button onClick={() => void members.refetch()}>{t("common.retry")}</button></div> : members.isPending ? <p role="status">{t("common.loading")}</p> : <>
      <ul className="organization-member-list" aria-busy={members.isFetching}>{members.data.items.map(member => <li key={member.id}>
        <div className="organization-member-identity"><MemberAvatar id={member.id} name={member.displayName} /><div><strong>{member.displayName}</strong><span>{member.email}</span></div></div>
        <span>{t(`admin.roles.${member.role}`)}</span>
        <span className={`status ${member.active ? "active" : "inactive"}`}>{t(member.active ? "admin.users.active" : "admin.users.inactive")}</span>
      </li>)}</ul>
      {!members.data.items.length && <p className="empty">{t("admin.users.empty")}</p>}
      {pages > 1 && <nav className="pager" aria-label={t("organizationMembers.title", { name: organization.name })}><button disabled={page <= 1} onClick={() => setPage(current => current - 1)}>{t("common.previous")}</button><span>{t("common.pageOf", { page, pages })}</span><button disabled={page >= pages} onClick={() => setPage(current => current + 1)}>{t("common.next")}</button></nav>}
    </>}
    {creating && <CreateUserDialog initialOrganizationId={organization.id} organizations={[organization]} busy={create.isPending} error={create.error} onClose={() => setCreating(false)} onCreate={value => create.mutate(value)} />}
  </section>;
}
