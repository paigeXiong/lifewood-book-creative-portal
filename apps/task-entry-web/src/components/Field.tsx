import { cloneElement, isValidElement, type PropsWithChildren, type ReactElement, type ReactNode } from "react";

export function Field({ label, htmlFor, error, hint, required, icon, className = "", children }: PropsWithChildren<{
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  icon?: ReactNode;
  className?: string;
}>) {
  const messageId = `${htmlFor}-message`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        ...(error || hint ? { "aria-describedby": messageId } : {}),
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { "aria-required": true } : {}),
      })
    : children;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor} className={icon ? "field-label-with-icon" : undefined}>
        {icon && <span className="field-label-icon" aria-hidden="true">{icon}</span>}
        <span>{label}{required && <span className="required" aria-hidden="true">*</span>}</span>
      </label>
      {control}
      {(error || hint) && <div className={error ? "field-error" : "field-hint"} id={messageId} role={error ? "alert" : undefined}>{error ?? hint}</div>}
    </div>
  );
}
