import { createContext, useContext, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import type { SupportedLocale } from "@lifewood/domain";
import { useTranslation } from "react-i18next";

import "./settings-tabs.css";

const settingsIconPaths = {
  mail: "M3 5h18v14H3zM3 5l9 7 9-7",
  oidc: "M8 10V7a4 4 0 0 1 8 0v3M5 10h14v11H5zM12 14v3",
  options: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  files: "M3 7V5h6l2 2h10v13H3V7Zm0 3h18",
  characters: "M9 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M5 20v-2a7 7 0 0 1 14 0v2",
  voices: "M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4",
  ai: "M8 8h8v8H8zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3",
  announcements: "M4 9h4l12-5v16L8 15H4V9Zm4 6 2 6h4l-2-4M8 9v6",
  notifications: "M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 20h4",
  backups: "M4 8h16v12H4V8ZM3 4h18v4H3V4Zm7 8h4",
  runtime: "M4 3h16v6H4V3Zm0 12h16v6H4v-6Zm3-9h.01M7 18h.01M12 9v6",
};

function SettingsIcon({ name }: { name: keyof typeof settingsIconPaths }) {
  return <svg className="settings-tab-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={settingsIconPaths[name]} /></svg>;
}

const SettingsNavigation = createContext<NavigateFunction | null>(null);
// Keep the data-router navigation function above descendant <Routes>, whose
// history-only navigator does not forward viewTransition options.
export function SettingsNavigationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <SettingsNavigation.Provider value={navigate}>{children}</SettingsNavigation.Provider>;
}

function SettingsTab({ locale, name, children }: { locale: SupportedLocale; name: keyof typeof settingsIconPaths; children: ReactNode }) {
  const navigate = useContext(SettingsNavigation);
  const animated = typeof document !== "undefined" && typeof document.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return <NavLink to={`/${locale}/settings/${name}`} viewTransition={animated} onClick={event=>{
    if (!navigate || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void navigate(`/${locale}/settings/${name}`, {viewTransition: animated});
  }}>
    {({ isActive }) => <>
      {isActive && <span className="settings-tab-indicator" aria-hidden="true" />}
      <span className="settings-tab-label" style={{ viewTransitionName: `settings-label-${name}` }}><SettingsIcon name={name} />{children}</span>
    </>}
  </NavLink>;
}

const settingsGroups = [
  { id: "content", items: ["options", "files", "characters", "voices"] },
  { id: "access", items: ["oidc", "ai"] },
  { id: "messages", items: ["mail", "announcements", "notifications"] },
  { id: "operations", items: ["runtime", "backups"] },
] as const;
const settingsLabels: Record<keyof typeof settingsIconPaths, string> = {
  options: "admin.settings.formOptions", files: "admin.settings.fileCategories",
  characters: "admin.presets.title", voices: "admin.settings.voices",
  ai: "admin.settings.ai", oidc: "oidc.settings", mail: "mailQueue.title",
  announcements: "announcements.title", notifications: "notifications.title",
  backups: "backups.title", runtime: "admin.settings.runtime",
};

export function SettingsTabs({ locale }: { locale: SupportedLocale }) {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const current = pathname.split("/")[3];
  const group = settingsGroups.find(group => group.items.some(name => name === current)) ?? settingsGroups[0];
  return <nav className="settings-navigation" aria-label={t("admin.settings.sections")}>
    <div className="settings-groups">
      {settingsGroups.map(item => <NavLink key={item.id}
        to={item.id === group.id ? pathname + search + hash : `/${locale}/settings/${item.items[0]}`}
        aria-current={item.id === group.id ? "true" : undefined}
        className={item.id === group.id ? "selected" : undefined}>
        {t(`admin.settings.groups.${item.id}`)}
      </NavLink>)}
    </div>
    <div className="settings-tabs">
      {group.items.map(name => <SettingsTab key={name} locale={locale} name={name}>{t(settingsLabels[name])}</SettingsTab>)}
    </div>
  </nav>;
}
