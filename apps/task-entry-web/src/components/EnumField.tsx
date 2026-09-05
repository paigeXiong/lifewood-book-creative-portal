import { useState, type ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { DisplayConfigOption } from "../legacy-options";
import { ChoiceField } from "./ChoiceField";
import { ChoiceRow } from "./ChoiceRow";

export function EnumField({ label, htmlFor, icon, required, error, items, registration, selectedId }: {
  label: string;
  htmlFor: string;
  icon?: ReactNode;
  required?: boolean;
  error?: string;
  selectedId?: string;
  items: DisplayConfigOption[];
  registration: UseFormRegisterReturn;
}) {
  const { t } = useTranslation();
  const [search,setSearch]=useState("");
  const searchable=items.length>8 && selectedId!==undefined;
  const query=search.trim().toLocaleLowerCase();
  const matches=(item:DisplayConfigOption)=>item.label.toLocaleLowerCase().includes(query);
  const choices = required ? items : [{ id: "", label: t("common.noPreference") }, ...items];
  return <ChoiceField label={label} id={htmlFor} icon={icon} required={required} error={error}>
    {searchable && <div className="enum-search"><input type="search" aria-label={t("clientUx.searchOptions",{label})} placeholder={t("clientUx.searchOptions",{label})} value={search} onChange={event=>setSearch(event.target.value)}/>{selectedId&&<span>{t("clientUx.selected")}：{items.find(item=>item.id===selectedId)?.label}</span>}</div>}
    {searchable&&query&&!choices.some(matches)&&<p role="status">{t("clientUx.noOptions")}</p>}
    <ChoiceRow id={htmlFor} className={searchable?"searchable-choices":""}>
      {choices.map((item) => <label hidden={searchable && !!query && !matches(item) && item.id!==selectedId} className="choice-chip" key={item.id} aria-disabled={item.unavailable}>
        <input {...registration} type="radio" value={item.id} disabled={item.unavailable}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${htmlFor}-message` : undefined}
          onFocus={(event) => event.currentTarget.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" })} />
        <span>{item.label}</span>
      </label>)}
    </ChoiceRow>
  </ChoiceField>;
}
