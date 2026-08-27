import { useId, type InputHTMLAttributes } from "react";
import type { ConfigOption } from "@lifewood/domain";

type EditableOption = ConfigOption & { unavailable?: boolean };

export function preserveEditableSelection(options: EditableOption[], optionId: string, customValue: string) {
  return options.map((option) => option.id === optionId && customValue
    ? { ...option, allowsCustomValue: true, unavailable: false }
    : option);
}

export function resolveEditableOption(input: string, options: EditableOption[]) {
  const available = options.filter((option) => !option.unavailable);
  const match = available.find((option) => option.label.localeCompare(input, undefined, { sensitivity: "accent" }) === 0);
  if (match) return { optionId: match.id, customValue: "" };
  const customOption = available.find((option) => option.allowsCustomValue);
  return { optionId: input ? customOption?.id ?? "" : "", customValue: input && customOption ? input : "" };
}

export function EditableSelect({ options, optionId, customValue, onValueChange, ...inputProps }: {
  options: EditableOption[];
  optionId: string;
  customValue: string;
  onValueChange: (optionId: string, customValue: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "list" | "value" | "onChange">) {
  const generatedId = useId();
  const listId = `${inputProps.id ?? generatedId}-options`;
  const selected = options.find((option) => option.id === optionId);
  const value = customValue || selected?.label || "";
  const selectableOptions = options.filter((option) => !option.allowsCustomValue);

  return <>
    <input {...inputProps} role="combobox" aria-autocomplete="list" list={listId} value={value} onChange={(event) => {
      const next = resolveEditableOption(event.currentTarget.value, options);
      onValueChange(next.optionId, next.customValue);
    }} />
    <datalist id={listId}>{selectableOptions.map((option) => <option key={option.id} value={option.label} disabled={option.unavailable} />)}</datalist>
  </>;
}
