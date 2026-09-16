import { HelpPopover } from "@lifewood/ui/help-popover";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { emailService, localizedApiError } from "@lifewood/api-client";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import "@lifewood/ui/email";

export function EmailActionPage() {
  const location = useLocation();
  const [entry, setEntry] = useState(() => ({ key: location.key, hash: location.hash, pathname: location.pathname, search: location.search, generation: 0 }));
  // Only our own fragment-removal navigation may retain the in-memory link.
  // A new history entry, including another email link, starts a fresh form.
  const sourceKey = `${entry.key}:${entry.generation}`;
  const cleaned = !location.hash && location.state?.emailActionSource === sourceKey && location.pathname === entry.pathname && location.search === entry.search;
  if (!cleaned && (location.key !== entry.key || location.hash !== entry.hash || location.pathname !== entry.pathname || location.search !== entry.search)) {
    setEntry({ key: location.key, hash: location.hash, pathname: location.pathname, search: location.search, generation: entry.generation + 1 });
    return null;
  }
  return <EmailActionForm key={entry.generation} fragment={entry.hash} sourceKey={sourceKey} />;
}

function EmailActionForm({ fragment, sourceKey }: { fragment: string; sourceKey: string }) {
  const { t } = useTranslation(), { locale } = useParams(), location = useLocation(), navigate = useNavigate();
  const [link] = useState(() => new URLSearchParams(fragment.slice(1)));
  const purpose = link.get("purpose"), token = link.get("token") ?? "";
  const valid = (purpose === "verify" || purpose === "reset") && /^[a-fA-F0-9]{64}$/.test(token);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState<unknown>(), [mismatch, setMismatch] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { emailActionSource: sourceKey } });
  }, [location.hash, location.pathname, location.search, navigate, sourceKey]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!valid || lock.current || done) return;
    setMismatch(false); setError(undefined);
    if (purpose === "reset" && password !== confirmation) { setMismatch(true); return; }
    lock.current = true; setBusy(true);
    try { await emailService.consume(purpose as "verify" | "reset", token, purpose === "reset" ? password : undefined); setPassword(""); setConfirmation(""); setDone(true); }
    catch (reason) { setError(reason); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!isSupportedLocale(locale)) return null;
  return <main className="email-action"><section className="email-action-card">
    <div className="field-help-heading"><h1>{t(purpose === "reset" ? "email.resetTitle" : "email.verification")}</h1>{valid && !done && <HelpPopover label={t(purpose === "reset" ? "email.resetTitle" : "email.verification")}>{t(purpose === "reset" ? "email.resetHint" : "email.verifyHint")}</HelpPopover>}</div>
    {!valid ? <p role="alert">{t("email.errors.invalidLink")}</p> : done ? <p role="status">{t(purpose === "reset" ? "email.resetDone" : "email.verifyDone")}</p> : <form onSubmit={submit} aria-busy={busy}>

      {purpose === "reset" && <><label>{t("auth.password")}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label><label>{t("auth.confirmPassword")}<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label></>}
      {mismatch && <p role="alert">{t("auth.passwordMismatch")}</p>}
      {error != null && <p role="alert">{localizedApiError(error, t)}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{t(busy ? "common.loading" : purpose === "reset" ? "email.resetTitle" : "email.confirmVerify")}</button>
    </form>}
    <a href={localizedPath(locale, "/login")}>{t("auth.signIn")}</a>
  </section></main>;
}
