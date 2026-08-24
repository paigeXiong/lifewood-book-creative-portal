import type { PropsWithChildren } from "react";

export function ChoiceField({ label, error, required, id, children }: PropsWithChildren<{ label: string; error?: string; required?: boolean; id: string }>) {
  const errorId = `${id}-message`;
  return <fieldset className="field field-wide choice-field" aria-describedby={error ? errorId : undefined} aria-invalid={error ? true : undefined} aria-required={required ? true : undefined}>
    <legend>{label}{required && <span className="required" aria-hidden="true">*</span>}</legend>
    {children}
    {error && <div className="field-error" id={errorId} role="alert">{error}</div>}
  </fieldset>;
}
