type EmptyKind = "new" | "noAction" | "noResults";

export function TaskEmptyIllustration({ kind }: { kind: EmptyKind }) {
  return <svg className="task-empty-illustration" width="112" height="96" viewBox="0 0 112 96" fill="none" aria-hidden="true" focusable="false">
    <circle cx="53" cy="47" r="38" fill="#f0f5f2" />
    <rect x="24" y="16" width="43" height="56" rx="7" transform="rotate(-10 24 16)" fill="#e0ece5" />
    <rect x="32" y="15" width="45" height="58" rx="7" fill="white" stroke="#a9c5b5" strokeWidth="1.5" />
    <path d="M43 30h23" stroke="#79a18b" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M43 40h23M43 49h17" stroke="#d2e1d8" strokeWidth="2.5" strokeLinecap="round" />
    {kind === "noResults" ? <g stroke="#316d50" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="76" cy="63" r="12" fill="#f5f9f6" />
      <path d="m85 72 10 10" strokeWidth="4" />
    </g> : <>
      <circle cx="78" cy="67" r="17" fill="#2d7050" stroke="white" strokeWidth="4" />
      <g stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        {kind === "noAction" ? <path d="m71 67 4.5 4.5L85 62" /> : <path d="M78 60v14m-7-7h14" />}
      </g>
    </>}
  </svg>;
}
