import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { announcementService } from "@lifewood/api-client";
import type { AnnouncementFeed, AnnouncementItem, SupportedLocale } from "@lifewood/domain";
import { Announcements } from "./Announcements";
import "./announcements.css";

export function AnnouncementBanner({ userId, locale }: { userId: string; locale: SupportedLocale }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const heading = useId();
  const track = useRef<HTMLSpanElement>(null);
  const [duration, setDuration] = useState(24);
  const dialog = useRef<HTMLDialogElement>(null);
  const [paused, setPaused] = useState(false);
  const [detail, setDetail] = useState<AnnouncementItem | null>(null);
  const key = ["announcement-banner", userId, locale];
  const feed = useQuery({ queryKey: key, queryFn: () => announcementService.banner(locale), refetchInterval: 60_000, retry: 1 });
  const notice = feed.data?.items[0];
  const bannerText = notice ? t("announcements.bannerText", { title: notice.title, body: notice.body.replace(/\s+/g, " ").trim() }) : "";
  useEffect(() => {
    const copy = track.current?.firstElementChild;
    if (!copy || typeof ResizeObserver === "undefined") return;
    const measure = () => setDuration(Math.max(24, copy.getBoundingClientRect().width / 45));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [bannerText, notice?.id]);
  const dismiss = useMutation({
    mutationFn: (id: string) => announcementService.dismiss(id),
    onSuccess: async (_, id) => {
      client.setQueryData<AnnouncementFeed>(key, previous => previous && ({ ...previous, items: previous.items.filter(item => item.id !== id) }));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["announcement-banner", userId] }),
        client.invalidateQueries({ queryKey: ["announcements", userId] }),
      ]);
    },
  });
  useEffect(() => {
    if (detail && !dialog.current?.open) dialog.current?.showModal();
    if (!detail && dialog.current?.open) dialog.current.close();
  }, [detail]);
  return <>
    {notice && <aside className="portal-announcement-banner" aria-label={t("announcements.bannerLabel")}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 9 15-5v16L4 15V9Zm3 7 1 5h3l-1-4M2 10v4"/></svg>
      <button className={`portal-announcement-title${paused ? " is-paused" : ""}`} type="button" onClick={() => setDetail(notice)} aria-label={bannerText} title={t("announcements.bannerDetails")}>
        <span ref={track} key={notice.id} className="portal-announcement-track" style={{ animationDuration: `${duration}s` }} aria-hidden="true"><span>{bannerText}</span><span>{bannerText}</span></span>
      </button>
      <button className="portal-announcement-dismiss portal-announcement-pause" type="button" aria-label={t(paused ? "announcements.bannerResume" : "announcements.bannerPause")} title={t(paused ? "announcements.bannerResume" : "announcements.bannerPause")} onClick={() => setPaused(value => !value)}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">{paused ? <path d="m6 3 11 7-11 7Z"/> : <path d="M5 3h3v14H5zM12 3h3v14h-3z"/>}</svg>
      </button>
      <Announcements userId={userId} locale={locale} historyOnly entryLabel={t("announcements.bannerAll")}/>
      <button className="portal-announcement-dismiss" type="button" disabled={dismiss.isPending} aria-label={t("announcements.bannerDismiss")} title={t("announcements.bannerDismiss")} onClick={() => dismiss.mutate(notice.id)} data-icon-motion="press"><span aria-hidden="true" data-icon-glyph>×</span></button>
      {dismiss.isError && <span className="portal-announcement-error" role="alert">{t("announcements.bannerCloseFailed")}</span>}
    </aside>}
    <dialog ref={dialog} className="customer-announcements" aria-labelledby={heading} onCancel={() => setDetail(null)} onClose={() => setDetail(null)}>
      <header><h2 id={heading}>{detail?.title}</h2><button className="announcement-close" type="button" aria-label={t("announcements.close")} onClick={() => setDetail(null)}>×</button></header>
      {detail && <article><time dateTime={detail.publishedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(detail.publishedAt))}</time><p>{detail.body}</p></article>}
    </dialog>
  </>;
}
