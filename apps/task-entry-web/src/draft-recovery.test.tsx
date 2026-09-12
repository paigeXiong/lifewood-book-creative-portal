import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "@lifewood/i18n";
import { projectService } from "@lifewood/api-client";
import type { TaskDraft, FormOptions } from "@lifewood/domain";
import { recoveryFields, recoveryText, recoveryLabel } from "./draft-recovery";
import { useDraftRecovery } from "./useDraftRecovery";
import { DraftRecoveryDialog } from "./components/DraftRecoveryDialog";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("draft comparison", () => {
  it("matches reordered characters by identity and never restores file metadata", () => {
    const fields = recoveryFields({ characters: [{ id: "a", name: "Local", referenceImages: [{ id: "old" }], presetImageUrl: "bad" }, { id: "deleted", name: "Removed" }], assets: [{ id: "old" }], title: "same" },
      { characters: [{ id: "new", name: "New" }, { id: "a", name: "Server", referenceImages: [{ id: "new" }] }], assets: [{ id: "new" }], title: "same" });
    expect(fields.find(f => f.local === "Local")).toMatchObject({ path: ["characters", 1, "name"], recoverable: true });
    expect(fields.find(f => f.local === "Removed")?.recoverable).toBe(false);
    expect(fields.find(f => f.latest === "New")?.recoverable).toBe(false);
    expect(fields.every(f => f.field === "name")).toBe(true);
  });
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`renders readable choices and safe text (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      const options = { genres: [{ id: "uuid-genre", label: "Fiction" }] } as FormOptions;
      expect(recoveryText("uuid-genre", "genreId", i18n.t, options)).toBe("Fiction");
      expect(recoveryText("uuid-removed", "genreId", i18n.t, options)).toBe(i18n.t("saveRecovery.unavailableOption"));
      expect(recoveryText(["uuid-genre"], "genreId", i18n.t, options)).toBe("Fiction");
      const rows = recoveryFields({ title: "<img src=x onerror=alert(1)>" }, { title: "Server" });
      expect(recoveryLabel(rows[0], i18n.t)).toBe(i18n.t("wizard.fields.bookTitle"));
      const el=document.createElement("div"); document.body.append(el); const root=createRoot(el);
      const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
      const closed = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
      Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(){this.open=true;}});
      Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(){this.open=false;}});
      const accept=vi.fn(); const close=vi.fn();
      try {
        await act(async()=>root.render(<DraftRecoveryDialog recovery={{comparison:{latest:{status:"draft"} as TaskDraft,snapshot:"",fields:rows},accept,close,reload:vi.fn(),loading:false,error:undefined}} options={options}/>));
        expect(el.querySelector("img")).toBeNull(); expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
        expect(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].checked).toBe(true);
        await act(async()=>el.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
        await act(async()=>[...el.querySelectorAll("button")].find(b=>b.textContent===i18n.t("saveRecovery.apply"))!.click());
        expect(accept).toHaveBeenCalledWith(new Set([0]));
        await act(async()=>el.querySelector("dialog")!.dispatchEvent(new Event("cancel",{cancelable:true})));
        expect(close).toHaveBeenCalled();
      } finally {
        await act(async()=>root.unmount());el.remove();vi.restoreAllMocks();
        if(show)Object.defineProperty(HTMLDialogElement.prototype,"showModal",show);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
        if(closed)Object.defineProperty(HTMLDialogElement.prototype,"close",closed);else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
      }
    });
  }
});

describe("draft recovery races", () => {
  it("preserves typing during fetch, refreshes on a new server version, and applies only explicit selections", async () => {
    let input={title:"Local"}; const apply=vi.fn();
    let hook!: ReturnType<typeof useDraftRecovery>;
    function Harness(){hook=useDraftRecovery("task","en-US",()=>JSON.stringify(input),apply,draft=>({title:draft.book.title}));return null;}
    const el=document.createElement("div"); const root=createRoot(el);
    let resolve!: (draft:TaskDraft)=>void;
    const read=vi.spyOn(projectService,"getProject").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    const draft=(version:number,title:string)=>({id:"task",version,status:"draft",book:{title}} as TaskDraft);
    try {
      await act(async()=>root.render(<Harness/>));
      let request!:Promise<void>;
      await act(async()=>{request=hook.reload();}); input={title:"Typed while loading"};
      await act(async()=>{resolve(draft(2,"Server"));await request;});
      expect(hook.comparison!.fields[0].local).toBe("Typed while loading");expect(apply).not.toHaveBeenCalled();
      read.mockResolvedValue(draft(3,"New server"));
      await act(async()=>hook.accept(new Set([0])));
      expect(apply).not.toHaveBeenCalled();expect(hook.comparison!.latest.version).toBe(3);
      expect(hook.error).toBe(i18n.t("saveRecovery.changedAgain"));
      await act(async()=>hook.accept(new Set([0])));
      expect(apply).toHaveBeenCalledWith(expect.objectContaining({version:3}),[expect.objectContaining({field:"title",local:"Typed while loading"})]);
      expect(hook.comparison).toBeUndefined();
    } finally {await act(async()=>root.unmount());vi.restoreAllMocks();}
  });
  it("ignores a response after switching projects", async()=>{
    let hook!:ReturnType<typeof useDraftRecovery>; const apply=vi.fn();
    function Harness({id}:{id:string}){hook=useDraftRecovery(id,"en-US",()=>'{"title":"Local"}',apply,d=>({title:d.book.title}));return null;}
    const el=document.createElement("div");const root=createRoot(el);let resolve!:(d:TaskDraft)=>void;
    vi.spyOn(projectService,"getProject").mockImplementation(()=>new Promise(done=>{resolve=done;}));
    try {
      await act(async()=>root.render(<Harness id="a"/>));let request!:Promise<void>;
      await act(async()=>{request=hook.reload();});await act(async()=>root.render(<Harness id="b"/>));
      await act(async()=>{resolve({id:"a",version:2,book:{title:"Old project"}} as TaskDraft);await request;});
      expect(hook.comparison).toBeUndefined();expect(apply).not.toHaveBeenCalled();expect(hook.loading).toBe(false);
    } finally {await act(async()=>root.unmount());vi.restoreAllMocks();}
  });
});
