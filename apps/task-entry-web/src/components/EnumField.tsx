import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { DisplayConfigOption } from "../legacy-options";
import { ChoiceField } from "./ChoiceField";
import { ChoiceRow } from "./ChoiceRow";

export function EnumField({ label, htmlFor, icon, required, error, items, registration }: {
  label: string;
  htmlFor: string;
  icon?: ReactNode;
  required?: boolean;
  error?: string;
  items: DisplayConfigOption[];
  registration: UseFormRegisterReturn;
}) {
  const { t } = useTranslation();
  const choices = required ? items : [{ id: "", label: t("common.noPreference") }, ...items];
  return <ChoiceField label={label} id={htmlFor} icon={icon} required={required} error={error}>
    <ChoiceRow id={htmlFor}>
      {choices.map((item) => <label className="choice-chip" key={item.id} aria-disabled={item.unavailable}>
        <input {...registration} type="radio" value={item.id} disabled={item.unavailable}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${htmlFor}-message` : undefined}
          onFocus={(event) => event.currentTarget.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" })} />
        <span>{item.label}</span>
      </label>)}
    </ChoiceRow>
  </ChoiceField>;
}
