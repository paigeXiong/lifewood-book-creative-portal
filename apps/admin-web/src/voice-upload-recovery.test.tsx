// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as api from "@lifewood/api-client";
import type { AdminVoiceReference, FormOptions, SupportedLocale } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { VoiceConfigPage } from "./VoiceConfigPage";
vi.mock("./useConfirm",()=>({useConfirm:()=>vi.fn().mockResolvedValue(true)}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>vi.restoreAllMocks());
const voice:AdminVoiceReference={id:"voice-1",nameZhCn:"温暖旁白",nameEnUs:"Warm narration",descriptionZhCn:"",descriptionEnUs:"",tagIds:[],enabled:true,recommended:false,sortOrder:1,audioUrl:null,updatedAt:"v1"};
const quota=()=>new api.ApiError({code:"storage.quota",messageKey:"errors.storage.quota",retryable:true});
async function fixture(locale:SupportedLocale="zh-CN") {
  await i18n.changeLanguage(locale);
  vi.spyOn(api.adminService,"listVoiceReferences").mockResolvedValue([voice]);
  vi.spyOn(api.optionService,"getFormOptions").mockResolvedValue({voiceTags:[]} as unknown as FormOptions);
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  client.setQueryData(["admin-voices"],[voice]);client.setQueryData(["form-options",locale],{voiceTags:[]});
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
  await act(async()=>{root.render(<QueryClientProvider client={client}><MemoryRouter><VoiceConfigPage locale={locale}/></MemoryRouter></QueryClientProvider>);await settle();});
  const button=(key:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===i18n.t(key));
  return {container,button,settle,
    choose:async(file:File)=>{await act(async()=>{const input=container.querySelector<HTMLInputElement>('input[type="file"]')!;Object.defineProperty(input,"files",{configurable:true,value:[file]});input.dispatchEvent(new Event("change",{bubbles:true}));await settle();});},
    close:async()=>{await act(async()=>root.unmount());container.remove();client.clear();},
  };
}
it.each(["zh-CN","en-US"] as const)("retains a quota-rejected sample and retries the same target and file in %s",async locale=>{
  const upload=vi.spyOn(api.adminService,"uploadVoiceSample").mockRejectedValueOnce(quota()).mockResolvedValue(voice);
  const f=await fixture(locale),file=new File(["audio"],"sample.mp3",{type:"audio/mpeg"});
  try {
    await f.choose(file);
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.storage.quota"));
    expect(f.container.textContent).toContain(file.name);expect(upload).toHaveBeenCalledOnce();
    await act(async()=>{f.button("admin.voices.retryUpload")!.click();await f.settle();});
    expect(upload).toHaveBeenCalledTimes(2);expect(upload.mock.calls[1]).toEqual([voice.id,file]);
    expect(f.button("admin.voices.retryUpload")).toBeUndefined();expect(f.container.querySelector('[role="alert"]')).toBeNull();
  } finally {await f.close();}
});
it("blocks duplicate retry clicks and permits discarding a failed selection",async()=>{
  let finish!:(value:AdminVoiceReference)=>void;
  const upload=vi.spyOn(api.adminService,"uploadVoiceSample").mockRejectedValueOnce(quota()).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const f=await fixture();
  try {
    await f.choose(new File(["audio"],"sample.mp3"));
    await act(async()=>{const retry=f.button("admin.voices.retryUpload")!;retry.click();retry.click();await f.settle();});
    expect(upload).toHaveBeenCalledTimes(2);
    await act(async()=>{finish(voice);await f.settle();});
    upload.mockRejectedValue(quota());await f.choose(new File(["audio"],"discard.mp3"));
    await act(async()=>{f.button("common.cancel")!.click();await f.settle();});
    expect(f.container.textContent).not.toContain("discard.mp3");expect(f.button("admin.voices.retryUpload")).toBeUndefined();
  } finally {await f.close();}
});
it("does not offer retry for a permission error or submit a retained file under another account",async()=>{
  const guard=vi.fn();vi.spyOn(api,"captureAccountGuard").mockReturnValue(guard);
  const upload=vi.spyOn(api.adminService,"uploadVoiceSample").mockRejectedValueOnce(new api.ApiError({code:"auth.forbidden",messageKey:"errors.auth.forbidden",retryable:false})).mockRejectedValue(quota());
  const f=await fixture();
  try {
    await f.choose(new File(["audio"],"denied.mp3"));expect(f.button("admin.voices.retryUpload")).toBeUndefined();
    await f.choose(new File(["audio"],"quota.mp3"));
    guard.mockImplementation(()=>{throw new api.ApiError({code:"auth.account_changed",messageKey:"accountSwitch.changed",retryable:false});});
    await act(async()=>{f.button("admin.voices.retryUpload")!.click();await f.settle();});
    expect(upload).toHaveBeenCalledTimes(2);expect(f.button("admin.voices.retryUpload")).toBeUndefined();
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("accountSwitch.changed"));
  } finally {await f.close();}
});
it("preserves the failed file when a replacement is invalid and clears validation on retry",async()=>{
  const upload=vi.spyOn(api.adminService,"uploadVoiceSample").mockRejectedValueOnce(quota()).mockResolvedValue(voice);
  const f=await fixture(),original=new File(["audio"],"original.mp3");
  try {
    await f.choose(original);await f.choose(new File([],"empty.mp3"));
    expect(f.container.textContent).toContain("original.mp3");
    expect(f.container.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("admin.voices.audioInvalid"));
    expect(upload).toHaveBeenCalledOnce();
    await act(async()=>{f.button("admin.voices.retryUpload")!.click();await f.settle();});
    expect(upload.mock.calls[1]).toEqual([voice.id,original]);expect(f.container.querySelector('[role="alert"]')).toBeNull();
  } finally {await f.close();}
});
