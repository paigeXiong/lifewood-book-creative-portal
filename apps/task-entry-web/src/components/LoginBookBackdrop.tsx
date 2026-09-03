import type { CSSProperties } from "react";
import "./login-book-backdrop.css";

/** Decorative only; kept separate so the background experiment can be removed independently. */
export function LoginBookBackdrop() {
  return (
    <div className="login-book-backdrop" aria-hidden="true">
      <div className="login-book-grid">
      {Array.from({ length: 12 }, (_, row) => (
        <div className="login-book-row" key={row}>
        {Array.from({ length: 18 }, (_, column) => (
        <div className="login-floating-book" key={column} style={{ "--book-phase": `${-(row * 2.7 + (column % 2) * 4)}s` } as CSSProperties}>
          <svg viewBox="0 0 160 120" fill="none" focusable="false">
            {(row + column) % 2 === 0 ? (
              <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
                <path d="M17 30Q49 20 80 38Q111 20 143 30L149 92Q111 81 80 102Q49 81 11 92Z" fill="currentColor" fillOpacity=".12" />
                <path d="M80 38V102M17 30L11 84Q49 73 80 94Q111 73 149 84M28 43Q51 39 68 49M27 54Q50 50 68 60M26 65Q49 61 68 71M92 49Q111 39 132 43M92 60Q112 50 133 54M92 71Q113 61 134 65" />
              </g>
            ) : (
              <g stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
                <path d="M46 17H117V94H48Q37 94 37 83V28Q37 17 46 17Z" fill="currentColor" fillOpacity=".16" />
                <path d="M48 17V79M117 79H48Q37 79 37 88Q37 99 48 99H122M117 84V94M51 88H112M64 35H101M72 43H93" />
                <path d="M88 17V59L96 53L104 59V17" fill="currentColor" fillOpacity=".13" />
              </g>
            )}
          </svg>
        </div>
        ))}
        </div>
      ))}
      </div>
    </div>
  );
}
