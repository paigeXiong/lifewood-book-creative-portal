import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authService } from "@lifewood/api-client";
import { isSupportedLocale } from "@lifewood/i18n";
import type { CurrentUser, SupportedLocale } from "@lifewood/domain";
import { ScreenError } from "../components/ScreenError";
import { MemberAvatar } from "./MyOrganizationPage";
import { OrganizationMemberDashboard } from "../components/OrganizationMemberDashboard";
import "./my-organization.css";

export function OrganizationMemberPage() {
  const { locale, memberId } = useParams();
  const location = useLocation();
  const { user } = useOutletContext<{ user: CurrentUser }>();
  const language = isSupportedLocale(locale) ? locale : "zh-CN";
  return <MemberContent key={`${user.id}:${user.organization?.id ?? ""}:${memberId}:${language}`} user={user} language={language} memberId={memberId!} returnSearch={location.search} />;
}

function MemberContent({ user, language, memberId, returnSearch }: { user: CurrentUser; language: SupportedLocale; memberId: string; returnSearch: string }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState({ search: "", page: 1 });
  const query = useQuery({
    queryKey: ["organization-member", user.id, user.organization?.id, memberId, language],
    queryFn: ({ signal }) => authService.getOrganizationMember({ id: memberId!, locale: language, signal }),
    enabled: !!memberId,
    staleTime: 0,
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["organization-member-activity", user.id, user.organization?.id, memberId, language, selection],
    queryFn: ({ signal }) => authService.getOrganizationMemberActivity({ id: memberId, locale: language, ...selection, signal }),
    enabled: !!memberId,
    staleTime: 0, retry: false,
    refetchInterval: query => query.state.error ? false : 30_000,
    refetchOnWindowFocus: true,
  });
  const member = query.data;
  return <div className="page organization-member-page">
    <Link className="organization-member-back" to={`/${language}/organization${returnSearch}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>{t("organizationMember.back")}
    </Link>
    {query.isError || activity.isError ? <ScreenError error={query.error ?? activity.error} onRetry={() => Promise.all([query.refetch(), activity.refetch()])} /> : !member ? <div className="screen-status" role="status" aria-busy="true">{t("common.loading")}</div> : <><section className="organization-member-profile" aria-label={t("organizationMember.view", { name: member.displayName })}>
      <header className="organization-member-identity"><MemberAvatar key={`${member.id}:${member.avatarUrl}`} name={member.displayName} url={member.avatarUrl} /><div><h1>{member.displayName}</h1><span>{member.organizationName}</span></div></header>
      <dl className="organization-member-fields">
        <div><dt>{member.labels.name}</dt><dd>{member.displayName}</dd></div>
        <div><dt>{member.labels.organization}</dt><dd>{member.organizationName}</dd></div>
        <div><dt>{member.labels.role}</dt><dd>{member.roleLabel}</dd></div>
      </dl>
    </section><OrganizationMemberDashboard data={activity.data} locale={language} selection={selection} onSelect={setSelection} busy={activity.isFetching} onRefresh={() => { void query.refetch(); void activity.refetch(); }} /></>}
  </div>;
}
