import { ChoiceRow } from "./ChoiceRow";
import { useTranslation } from "react-i18next";
import type { DisplayConfigOption } from "../legacy-options";
import { ChoiceField } from "./ChoiceField";
import { FieldIcon } from "./FieldIcon";

export function ColorToneChoice({ options, value, onChange, error }: {
  options: DisplayConfigOption[];
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const legacy = value.length > 1 || options.some(item => item.unavailable && value.includes(item.id));
  return <ChoiceField label={t("creative.fields.imageTags")} icon={<FieldIcon name="image" />} id="image-tags" error={error}>
    {legacy ? <p role="status">{t("creative.colorTone.legacy", {
      values: value.map(id => options.find(item => item.id === id)?.label ?? id).join(" / "),
    })}</p> : null}
    <ChoiceRow>
      {options.filter(item => !item.unavailable).map(item => <label className="choice-chip" key={item.id}>
        <input type="radio" name="colorTone" value={item.id}
          checked={value.length === 1 && value[0] === item.id} onChange={() => onChange([item.id])} />
        <span>{item.label}</span>
      </label>)}
      <label className="choice-chip">
        <input type="radio" name="colorTone" value="" checked={value.length === 0} onChange={() => onChange([])} />
        <span>{t("creative.colorTone.noPreference")}</span>
      </label>
    </ChoiceRow>
  </ChoiceField>;
}
