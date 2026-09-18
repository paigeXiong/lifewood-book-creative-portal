import { Link, useLocation, useOutletContext, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CurrentUser } from "@lifewood/domain";
import { HelpCenter } from "@lifewood/ui/help-center";

export function HelpPage() {
  const { locale = "zh-CN" } = useParams();
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useOutletContext<{ user?: CurrentUser }>();
  if (user) return <HelpCenter key={user.id} userId={user.id} locale={locale} canReadAdmin={user.permissions.includes("admin.access")} />;
  const otherLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
  return <div className="public-help">
    <header className="public-help-header"><strong>{t("help.title")}</strong><nav aria-label={t("help.title")}>
      <Link to={`/${otherLocale}/help${location.search}`} lang={otherLocale}>{locale === "zh-CN" ? "English" : "中文"}</Link>
      <Link to={`/${locale}/login`}>{t("auth.signIn")}</Link>
    </nav></header>
    <main><HelpCenter key="guest" userId="guest" locale={locale} canReadAdmin={false} /></main>
  </div>;
}
