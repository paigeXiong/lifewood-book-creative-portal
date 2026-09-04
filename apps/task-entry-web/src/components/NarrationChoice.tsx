import { ChoiceRow } from "./ChoiceRow";
import type { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { ChoiceField } from "./ChoiceField";
import { FieldIcon } from "./FieldIcon";

export function NarrationChoice({ value, onChange, error, children }: PropsWithChildren<{
  value: boolean | null; onChange: (value: boolean) => void; error?: string;
}>) {
  const { t } = useTranslation();
  return <>
    <section className="form-panel narration-choice">
      <ChoiceField id="narration-choice" label={t("voice.narration.question")} required error={error} icon={<FieldIcon name="voice" />}>

        <ChoiceRow>
          <label className="choice-chip">
            <input type="radio" name="narrationEnabled" value="true" checked={value === true}
              aria-controls="narration-configuration" onChange={() => onChange(true)} />
            <span>{t("voice.narration.yes")}</span>
          </label>
          <label className="choice-chip">
            <input type="radio" name="narrationEnabled" value="false" checked={value === false}
              aria-controls="narration-configuration" onChange={() => onChange(false)} />
            <span>{t("voice.narration.no")}</span>
          </label>
        </ChoiceRow>
      </ChoiceField>

    </section>
    <div id="narration-configuration" className="form-stack" hidden={value !== true}>
      {value === true ? children : null}
    </div>
  </>;
}
