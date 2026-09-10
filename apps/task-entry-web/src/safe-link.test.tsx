// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {safeLinkUrl} from "@lifewood/domain";
import {ReferenceLinks} from "./components/ReferenceLinks";

describe("untrusted links", () => {
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "\tdata:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "blob:https://example.test/id", "//evil.test", "/\\evil.test", "https:\\evil.test", "https:evil.test", "<svg onload=alert(1)>"])("rejects %s", value => {
    expect(safeLinkUrl(value)).toBeUndefined();
    expect(safeLinkUrl(value, true)).toBeUndefined();
  });
  it("preserves HTTP(S), unicode and authorized local file paths", () => {
    expect(safeLinkUrl(" https://example.test/a?q=1&b=2 ")).toBe("https://example.test/a?q=1&b=2");
    expect(safeLinkUrl("HTTP://example.test/a")).toBe("http://example.test/a");
    expect(safeLinkUrl("https://example.test/书")).toBe("https://example.test/%E4%B9%A6");
    expect(safeLinkUrl("/api/projects/p/files/f?v=2", true)).toBe("/api/projects/p/files/f?v=2");
    expect(safeLinkUrl("/api/projects/p/files/f")).toBeUndefined();
  });
  it("renders injected file names as text and gives unsafe assets no clickable URL", () => {
    const payload='<img src=x onerror="window.__injected=1"><script>window.__injected=1</script>';
    const container=document.createElement("div");
    container.innerHTML=renderToStaticMarkup(<ReferenceLinks assets={[{id:"a",fileName:payload,url:"data:text/html,<script>alert(1)</script>",categoryId:"reference",contentType:"text/plain",sizeBytes:10}]} urls={["javascript:alert(1)","https://example.test/"]}/>);
    expect(container.textContent).toContain(payload);
    expect(container.querySelector("img, script, iframe, svg")).toBeNull();
    expect(container.querySelectorAll("a[href]")).toHaveLength(1);
    expect(container.querySelector("a[href]")?.getAttribute("href")).toBe("https://example.test/");
  });
});
