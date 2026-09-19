// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {i18n} from "@lifewood/i18n";
import "./i18n";
import {AnnouncementPreview} from "./AnnouncementPreview";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
for(const locale of ["zh-CN","en-US"] as const) it(`previews banner text and popup safely without a form submission (${locale})`,async()=>{
 await i18n.changeLanguage(locale);const close=vi.fn(),submit=vi.fn();
 const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
 const content={title:"<img src=x onerror=alert(1)>",body:"Line one\nLine two",placement:"banner" as const,audience:"all" as const,languages:[],organizationIds:[],startsAt:null,endsAt:null,version:0};
 try{
  await act(async()=>root.render(<form onSubmit={submit}><AnnouncementPreview content={content} locale={locale} onClose={close}/></form>));
  expect(c.querySelector("img")).toBeNull();expect(c.querySelector(".notice-preview-track")?.textContent).toContain("Line one Line two");
  expect([...c.querySelectorAll("button")].every(button=>button.type==="button")).toBe(true);
  await act(async()=>c.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("noticePreview.pause")}"]`)!.click());
  expect(c.querySelector(".notice-preview-banner")?.classList.contains("is-paused")).toBe(true);
  await act(async()=>c.querySelector<HTMLButtonElement>(".notice-preview-scroll")!.click());
  expect(c.querySelector(".notice-preview-popup p")?.textContent).toBe(content.body);expect(submit).not.toHaveBeenCalled();
  await act(async()=>root.render(<form><AnnouncementPreview content={{...content,placement:"personal"}} locale={locale} onClose={close}/></form>));
  expect(c.querySelector(".notice-preview-banner")).toBeNull();expect(c.querySelector(".notice-preview-popup")).not.toBeNull();
 }finally{await act(async()=>root.unmount());c.remove();}
});
