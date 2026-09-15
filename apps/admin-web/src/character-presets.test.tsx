// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { adminService, ApiError, optionService } from "@lifewood/api-client";
import type { AdminCharacterPreset, FormOptions } from "@lifewood/domain";
import { i18n } from "@lifewood/i18n";
import "./i18n";
import { CharacterPresetsPage } from "./CharacterPresetsPage";
vi.mock("./useUnsavedClose",()=>({useUnsavedClose:(close:()=>void)=>({markDirty:()=>{},requestClose:close})}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
describe("character preset editor",()=>{
  it.each([["zh-CN",false],["en-US",false],["zh-CN",true],["en-US",true]] as const)("retains the acknowledged version and selected image after upload failure (%s, quota=%s)",async (locale,quota)=>{
    await i18n.changeLanguage(locale);
    const character={id:"hero",name:"Hero",storyRole:"Lead",personality:"Curious",appearance:"Short hair",referenceImages:[],referenceImageUrls:[]};
    const initial:AdminCharacterPreset={id:"hero",zhCn:{...character,name:"主角"},enUs:character,enabled:true,sortOrder:0,updatedAt:"v1"};
    let stored=initial;
    vi.spyOn(adminService,"listCharacterPresets").mockImplementation(async()=>[stored]);
    vi.spyOn(optionService,"getFormOptions").mockResolvedValue({roleTypes:[],ageRanges:[],genders:[]} as unknown as FormOptions);
    const save=vi.spyOn(adminService,"saveCharacterPreset").mockImplementation(async value=>(stored={...value,updatedAt:"v2"}));
    const upload=vi.spyOn(adminService,"uploadCharacterPresetImage").mockRejectedValueOnce(quota?new ApiError({code:"storage.quota",messageKey:"errors.storage.quota",retryable:true}):new Error("offline")).mockImplementation(async()=>stored);
    const createUrl=Object.getOwnPropertyDescriptor(URL,"createObjectURL"), revokeUrl=Object.getOwnPropertyDescriptor(URL,"revokeObjectURL");
    Object.defineProperty(URL,"createObjectURL",{configurable:true,value:()=>"blob:preview"});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:()=>{}});
    const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    const c=document.createElement("div");document.body.append(c);const root=createRoot(c);
    const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
    try{
      await act(async()=>{root.render(<QueryClientProvider client={client}><MemoryRouter><CharacterPresetsPage locale={locale} imageBase="http://localhost:5173/"/></MemoryRouter></QueryClientProvider>);await settle();});
      await act(async()=>{await settle();});
      const edit=[...c.querySelectorAll<HTMLButtonElement>("button")].find(x=>x.textContent===i18n.t("admin.voices.edit"))!;
      await act(async()=>edit.click());
      expect(c.textContent).not.toContain("creative.fields.");
      const file=new File(["picture"],"portrait.png",{type:"image/png"});
      const input=c.querySelector<HTMLInputElement>('input[type="file"]')!;
      await act(async()=>{Object.defineProperty(input,"files",{configurable:true,value:[file]});input.dispatchEvent(new Event("change",{bubbles:true}));});
      const submit=()=>c.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
      await act(async()=>{submit();await settle();});
      expect(c.querySelector('[role="alert"]')).not.toBeNull();
      if(quota)expect(c.querySelector('[role="alert"]')?.textContent).toContain(i18n.t("errors.storage.quota"));
      expect(c.querySelector<HTMLInputElement>('input[name="zhCn.name"]')!.value).toBe("主角");
      expect(c.textContent).toContain("portrait.png");
      await act(async()=>{submit();await settle();});
      expect(save.mock.calls[1][0].id).toBe("hero");expect(save.mock.calls[1][0].updatedAt).toBe("v2");
      expect(upload).toHaveBeenCalledTimes(2);expect(upload.mock.calls[1][1]).toBe(file);expect(c.querySelector('[role="dialog"]')).toBeNull();
    }finally{
      await act(async()=>root.unmount());c.remove();client.clear();vi.restoreAllMocks();
      if(createUrl)Object.defineProperty(URL,"createObjectURL",createUrl);else delete (URL as unknown as {createObjectURL?:unknown}).createObjectURL;
      if(revokeUrl)Object.defineProperty(URL,"revokeObjectURL",revokeUrl);else delete (URL as unknown as {revokeObjectURL?:unknown}).revokeObjectURL;
    }
  });
});
