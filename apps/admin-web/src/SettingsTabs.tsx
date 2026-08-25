import { NavLink } from "react-router-dom";
import type { SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";

export function SettingsTabs({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  return <nav className="settings-tabs" aria-label={t("admin.settings.sections")}>
    <NavLink to={`/${locale}/settings/options`}>{t("admin.settings.formOptions")}</NavLink>
    <NavLink to={`/${locale}/settings/files`}>{t("admin.settings.fileCategories")}</NavLink>
    <NavLink to={`/${locale}/settings/voices`}>{t("admin.settings.voices")}</NavLink>
  </nav>;
}
