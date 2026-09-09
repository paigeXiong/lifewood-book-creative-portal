import {useState} from "react";
import {useTranslation} from "react-i18next";

export function ExpandableText({text}: {text:string}) {
  const {t}=useTranslation();
  const [expanded,setExpanded]=useState(false);
  const long=text.length>180 || text.split("\n").length>3;
  if(!long)return <span className="detail-copy">{text}</span>;
  return <div className="expandable-copy"><div className={expanded?"detail-copy":"detail-copy is-clamped"}>{text}</div><button type="button" className="text-disclosure" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{t(expanded?"uiDensity.collapse":"uiDensity.expand")}</button></div>;
}
