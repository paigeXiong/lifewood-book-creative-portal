import { describe, expect, it } from "vitest";
import { runtimeAdminUrl } from "./SystemRuntimePage";

describe("runtimeAdminUrl", () => {
  it("uses the browser host for an all-interface listener", () => {
    expect(runtimeAdminUrl(
      { scheme: "https", listenAddress: "0.0.0.0", port: 8443 },
      "en-US",
      "portal.example.test",
    )).toBe("https://portal.example.test:8443/admin/en-US/settings/runtime");
  });

  it("wraps IPv6 listener addresses", () => {
    expect(runtimeAdminUrl(
      { scheme: "http", listenAddress: "::1", port: 5077 },
      "zh-CN",
    )).toBe("http://[::1]:5077/admin/zh-CN/settings/runtime");
  });

  it("does not double-wrap the browser IPv6 host for all-interface listeners", () => {
    expect(runtimeAdminUrl(
      { scheme: "http", listenAddress: "::", port: 5077 },
      "zh-CN",
      "[::1]",
    )).toBe("http://[::1]:5077/admin/zh-CN/settings/runtime");
  });
});

it("uses the separate admin listener after restarting", () => {
  expect(runtimeAdminUrl({scheme:"http",listenAddress:"127.0.0.1",port:5077,admin:{scheme:"https",listenAddress:"0.0.0.0",port:5444,shared:false}}, "en-US", "server.example")).toBe("https://server.example:5444/admin/en-US/settings/runtime");
});
