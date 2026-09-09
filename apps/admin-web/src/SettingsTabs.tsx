import { useLayoutEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";

import "./settings-tabs.css";

export function SettingsTabs({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigation = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    // Scroll this strip only, without moving the settings page vertically.
    const revealCurrent = () => {
      const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current) return;
      const strip = nav.getBoundingClientRect(), item = current.getBoundingClientRect();
      if (item.left < strip.left + 4) nav.scrollLeft += item.left - strip.left - 4;
      else if (item.right > strip.right - 4) nav.scrollLeft += item.right - strip.right + 4;
    };
    revealCurrent();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", revealCurrent);
      return () => window.removeEventListener("resize", revealCurrent);
    }
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, locale]);
  return <nav ref={navigation} className="settings-tabs" aria-label={t("admin.settings.sections")}>
    <NavLink to={`/${locale}/settings/options`}>{t("admin.settings.formOptions")}</NavLink>
    <NavLink to={`/${locale}/settings/files`}>{t("admin.settings.fileCategories")}</NavLink>
    <NavLink to={`/${locale}/settings/characters`}>{t("admin.presets.title")}</NavLink>
    <NavLink to={`/${locale}/settings/voices`}>{t("admin.settings.voices")}</NavLink>
    <NavLink to={`/${locale}/settings/ai`}>{t("admin.settings.ai")}</NavLink>
    <NavLink to={`/${locale}/settings/announcements`}>{t("announcements.title")}</NavLink>
    <NavLink to={`/${locale}/settings/notifications`}>{t("notifications.title")}</NavLink>
    <NavLink to={`/${locale}/settings/runtime`}>{t("admin.settings.runtime")}</NavLink>
  </nav>;
}
