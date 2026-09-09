import type {SupportedLocale} from "@lifewood/domain";

export function customerPortalUrl(
  locale: SupportedLocale,
  configuredBase = import.meta.env.VITE_CUSTOMER_APP_URL,
): string {
  const base =
    configuredBase?.trim() ||
    (import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:5173`
      : "");
  return `${base.replace(/\/$/, "")}/${locale}/tasks`;
}
