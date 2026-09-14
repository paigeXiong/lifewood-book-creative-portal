import { Navigate, useLocation } from "react-router-dom";
import { isSupportedLocale } from "@lifewood/i18n";

// A sibling of the page, so changing language does not unmount unsaved forms.
export function AccountLocaleRedirect({ locale }: { locale?: string | null }) {
  const location = useLocation();
  if (!locale || !isSupportedLocale(locale)) return null;
  const pathname = location.pathname.replace(/^\/(zh-CN|en-US)(?=\/|$)/, `/${locale}`);
  if (pathname === location.pathname) return null;
  return <Navigate replace to={{ pathname, search: location.search, hash: location.hash }} state={location.state} />;
}
