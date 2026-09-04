import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConfigOption } from "@lifewood/domain";

export function TaskFilters({ search, status, statuses, total, onApply }: {
  search: string;
  status: string;
  statuses: ConfigOption[];
  total?: number;
  onApply: (values: { q: string; status: string; page: number }) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(search);
  const [selectedStatus, setSelectedStatus] = useState(status);
  const activeCount = Number(Boolean(search)) + Number(Boolean(status));

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const button = buttonRef.current;
      const panel = panelRef.current;
      if (!button || !panel) return;
      const rect = button.getBoundingClientRect();
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - panel.offsetHeight - 12));
      panel.style.top = `${top}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 12))}px`;
    };
    position();
    searchRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  const apply = (q: string, nextStatus: string) => {
    onApply({ q: q.trim(), status: nextStatus, page: 1 });
    panelRef.current?.hidePopover();
    buttonRef.current?.focus({ preventScroll: true });
  };

  return <>
    <button ref={buttonRef} className={`button button-secondary task-filter-button${activeCount ? " active" : ""}`} type="button" popoverTarget={id} aria-expanded={open} aria-controls={id} aria-haspopup="dialog">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" strokeLinejoin="round" /></svg>
      {t("tasks.filters.open")}{activeCount > 0 && <span className="task-filter-count">{activeCount}</span>}
    </button>
    <div ref={panelRef} id={id} popover="auto" className="task-filter-popover" role="dialog" aria-labelledby={`${id}-title`} onToggle={(event) => {
      const nextOpen = event.newState === "open";
      if (nextOpen) { setQuery(search); setSelectedStatus(status); }
      setOpen(nextOpen);
    }}>
      <div className="task-filter-title">
        <h2 id={`${id}-title`}>{t("tasks.filters.open")}</h2>
        <button className="button button-quiet" type="button" popoverTarget={id} popoverTargetAction="hide" aria-label={t("common.close")}>×</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); apply(query, selectedStatus); }}>
        <label htmlFor={`${id}-search`}>{t("tasks.filters.keyword")}</label>
        <input ref={searchRef} id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tasks.searchPlaceholder")} />
        <label htmlFor={`${id}-status`}>{t("tasks.filterLabel")}</label>
        <select id={`${id}-status`} value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
          <option value="">{t("common.all")}</option>
          {statuses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <div className="task-filter-footer">
          <span className="result-count" aria-live="polite">{total === undefined ? t("common.loading") : t("tasks.count", { count: total })}</span>
          <button className="button button-secondary" type="button" onClick={() => apply("", "")}>{t("tasks.filters.reset")}</button>
          <button className="button button-primary" type="submit">{t("tasks.filters.apply")}</button>
        </div>
      </form>
    </div>
  </>;
}
