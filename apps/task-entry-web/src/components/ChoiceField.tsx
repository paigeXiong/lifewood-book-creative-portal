import type { PropsWithChildren, ReactNode } from "react";

export function ChoiceField({ label, error, required, icon, id, children }: PropsWithChildren<{ label: string; error?: string; required?: boolean; icon?: ReactNode; id: string }>) {
  const errorId = `${id}-message`;
  return <fieldset className="field field-wide choice-field" aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} aria-required={required ? true : undefined}>
    <legend className={icon ? "field-label-with-icon" : undefined}>
      {icon && <span className="field-label-icon" aria-hidden="true">{icon}</span>}
      <span>{label}{required && <span className="required" aria-hidden="true">*</span>}</span>
    </legend>
    {children}
    {error && <div className="field-error" id={errorId} role="alert">{error}</div>}
  </fieldset>;
}
