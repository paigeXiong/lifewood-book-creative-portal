import {customerPortalUrl} from "./portal-url";
import {useMemo} from "react";
import {useTranslation} from "react-i18next";
import type {SupportedLocale} from "@lifewood/domain";
import {compareRevisionSnapshots,type DiffValue} from "./revision-diff";
import {ExpandableText} from "./ExpandableText";
import "./revision-diff.css";

function Values({values}:{values:DiffValue[]}) {
 const {t}=useTranslation();
 if(!values.length)return <span className="revision-diff-empty">{t("revisionDiff.empty")}</span>;
 return <ul>{values.map((value,index)=><li key={index}>{value.href?<a href={value.href} target="_blank" rel="noreferrer">{value.text}</a>:<ExpandableText text={value.text}/>}</li>)}</ul>;
}
export function RevisionDiff({before,after,locale,projectId,units}:{before?:string;after?:string;locale:SupportedLocale;projectId:string;units:{id:string;label:string}[]}) {
 const {t}=useTranslation();
 const changes=useMemo(()=>before&&after?compareRevisionSnapshots(before,after,locale,t,projectId,new URL(customerPortalUrl(locale),window.location.origin).href):null,[before,after,locale,t,projectId]);
 if(changes===null)return <p className="muted" role="status">{t("revisionDiff.unavailable")}</p>;
 if(!changes.length)return <p className="revision-diff-nochanges">{t("revisionDiff.noChanges")}</p>;
 return <section className="revision-diff" aria-label={t("revisionDiff.title")}>
  <p className="revision-diff-heading">{t("revisionDiff.count",{count:changes.length})}</p>
  {units.map(unit=>{const rows=changes.filter(change=>change.unit===unit.id);return rows.length>0&&<details className="revision-diff-group" key={unit.id}>
   <summary>{unit.label}<span>{rows.length}</span></summary>
   <table><thead><tr><th scope="col">{t("revisionDiff.field")}</th><th scope="col">{t("revisionDiff.before")}</th><th scope="col">{t("revisionDiff.after")}</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.key}>
     <th scope="row"><span>{row.label}</span><small className={`revision-diff-kind is-${row.kind}`}>{t("revisionDiff."+row.kind)}</small></th>
     <td className="revision-diff-before"><span className="revision-diff-mobile-label" aria-hidden="true">{t("revisionDiff.before")}</span><Values values={row.before}/></td>
     <td className="revision-diff-after"><span className="revision-diff-mobile-label" aria-hidden="true">{t("revisionDiff.after")}</span><Values values={row.after}/></td>
    </tr>)}</tbody>
   </table>
  </details>;})}
 </section>;
}
