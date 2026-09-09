// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it} from "vitest";
import {i18n} from "@lifewood/i18n";
import {ExpandableText} from "./ExpandableText";
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it.each(["zh-CN","en-US"])("keeps long copy collapsed and fully recoverable in %s",async locale=>{
 await i18n.changeLanguage(locale);const text="Meaningful project content. ".repeat(20), container=document.createElement("div"),root=createRoot(container);document.body.append(container);
 try {
  await act(async()=>root.render(<ExpandableText text={text}/>));const button=container.querySelector("button")!;
  expect(button.textContent).toBe(locale==="zh-CN"?"展开全文":"Read more");expect(button.getAttribute("aria-expanded")).toBe("false");expect(container.querySelector(".is-clamped")?.textContent).toBe(text);
  await act(async()=>button.click());expect(container.querySelector(".is-clamped")).toBeNull();expect(button.getAttribute("aria-expanded")).toBe("true");
  await act(async()=>button.click());expect(button.getAttribute("aria-expanded")).toBe("false");
 } finally {await act(async()=>root.unmount());container.remove();}
});
it("leaves short meaningful copy free of extra controls",async()=>{
 const container=document.createElement("div"),root=createRoot(container);
 try{await act(async()=>root.render(<ExpandableText text="Brief note"/>));expect(container.querySelector("button")).toBeNull();expect(container.textContent).toBe("Brief note");}finally{await act(async()=>root.unmount());}
});
