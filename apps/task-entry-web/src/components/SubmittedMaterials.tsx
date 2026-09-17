import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

const MaterialsContext = createContext<{
  expanded: Set<string>;
  toggle: (id: string) => void;
  reveal: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
} | null>(null);

function useMaterials() {
  const value = useContext(MaterialsContext);
  if (!value) throw new Error("Submitted material controls require a provider");
  return value;
}

export function SubmittedMaterials({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => new Set(["project", "book"]));
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const { hash } = useLocation();
  const reveal = (id: string) => {
    pendingFocus.current = id;
    setExpanded(previous => {
      const next = new Set(previous).add(id);
      if (id.startsWith("character-")) next.add("creative");
      return next;
    });
  };
  // Deep links and browser history open their target before moving focus there.
  useLayoutEffect(() => {
    const id = hash.startsWith("#details-") ? hash.slice(9) : "";
    if (ids.includes(id)) reveal(id);
  }, [hash]);
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id || !expanded.has(id)) return;
    const target = document.getElementById(`details-${id}`);
    const section = target && container.current?.contains(target) ? target : null;
    section?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
    pendingFocus.current = null;
  }, [expanded]);
  return <MaterialsContext.Provider value={{ expanded, reveal,
    toggle: id => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    expandAll: () => setExpanded(new Set(ids)), collapseAll: () => setExpanded(new Set()),
  }}><div ref={container} className="detail-layout" id="submitted-materials">{children}</div></MaterialsContext.Provider>;
}

export function MaterialsControls() {
  const { expandAll, collapseAll } = useMaterials();
  const { t } = useTranslation();
  return <div className="detail-display-controls">
    <button type="button" className="button button-quiet" onClick={expandAll}>{t("taskDetail.expandAll")}</button>
    <button type="button" className="button button-quiet" onClick={collapseAll}>{t("taskDetail.collapseAll")}</button>
  </div>;
}

export function MaterialsLink({ id, children }: { id: string; children: ReactNode }) {
  const { reveal } = useMaterials();
  return <Link to={`#details-${id}`} onClick={event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) reveal(id);
  }}>{children}</Link>;
}

export function MaterialSection({ id, title, children, character = false }: { id: string; title: ReactNode; children: ReactNode; character?: boolean }) {
  const { expanded, toggle } = useMaterials();
  const open = expanded.has(id);
  const Heading = character ? "h3" : "h2";
  return <section className={character ? "material-character" : "form-panel detail-section"} id={`details-${id}`} aria-labelledby={`details-${id}-title`}>
    <Heading><button id={`details-${id}-title`} className="material-toggle" type="button" aria-expanded={open} aria-controls={`details-${id}-body`} onClick={() => toggle(id)}>
      <span className="material-title">{title}</span>
      <svg className="material-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button></Heading>
    <div className="material-section-body" id={`details-${id}-body`} hidden={!open}>{children}</div>
  </section>;
}
