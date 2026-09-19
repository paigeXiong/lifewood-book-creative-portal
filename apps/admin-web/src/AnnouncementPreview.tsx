import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnnouncementInput, SupportedLocale } from "@lifewood/domain";
import { HelpPopover } from "./HelpPopover";
import "./announcement-preview.css";

export function AnnouncementPreview({content,locale,onClose}:{content:AnnouncementInput;locale:SupportedLocale;onClose:()=>void}) {
 const {t}=useTranslation();const [paused,setPaused]=useState(false),[details,setDetails]=useState(false);
 const title=(content.title??(locale==="en-US"?content.titleEn:content.titleZh))||t("noticePreview.emptyTitle");
 const body=(content.body??(locale==="en-US"?content.bodyEn:content.bodyZh))||t("noticePreview.emptyBody");
 const banner=content.placement==="banner",text=`${title} · ${body}`.replace(/\s+/g," ");
 return <section className="notice-display-preview" aria-label={t("noticePreview.label")}>
  <div className="notice-preview-heading"><strong>{t("noticePreview.label")}</strong><HelpPopover label={t("noticePreview.label")}>{t("noticePreview.hint")}</HelpPopover></div>
  {banner&&<div className={`notice-preview-banner${paused?" is-paused":""}`}>
   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m4 9 15-5v16L4 15V9Zm3 7 1 5h3l-1-4M2 10v4"/></svg><button type="button" className="notice-preview-scroll" aria-label={t("noticePreview.details")} onClick={()=>setDetails(!details)}><span className="notice-preview-track" aria-hidden="true" style={{animationDuration:`${Math.max(24,text.length*.25)}s`}}><span>{text}</span><span>{text}</span></span></button>
   <button type="button" aria-label={t(paused?"noticePreview.resume":"noticePreview.pause")} onClick={()=>setPaused(!paused)}>{paused?"▶":"Ⅱ"}</button>
   <button type="button" onClick={()=>setDetails(true)}>{t("noticePreview.all")}</button><button type="button" aria-label={t("noticePreview.close")} onClick={onClose}>×</button>
  </div>}
  {(!banner||details)&&<div className="notice-preview-backdrop"><article className="notice-preview-popup"><header><strong>{t("noticePreview.popup")}</strong><button type="button" aria-label={t("noticePreview.close")} onClick={()=>banner?setDetails(false):onClose()}>×</button></header><h3>{title}</h3><p>{body}</p></article></div>}
 </section>;
}
