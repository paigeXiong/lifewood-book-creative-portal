// @vitest-environment jsdom
import {expect,it,vi} from "vitest";
import {i18n,setLocale} from "@lifewood/i18n";
import "./i18n";

it("keeps administrator translations and the selected language when the shared module reloads",async()=>{
 const navigation={"zh-CN":"组织管理","en-US":"Organizations"};
 const loading={"zh-CN":i18n.t("common.loading",{lng:"zh-CN"}),"en-US":i18n.t("common.loading",{lng:"en-US"})};
 for(const locale of ["en-US","zh-CN"] as const){
  await setLocale(locale);
  i18n.addResource(locale,"translation","common.loading","outdated translation");
  vi.resetModules();
  const reloaded=await import("@lifewood/i18n");
  expect(reloaded.i18n).toBe(i18n);
  expect.soft(i18n.language).toBe(locale);
  for(const language of ["zh-CN","en-US"] as const){
   expect.soft(i18n.t("admin.nav.organizations",{lng:language})).toBe(navigation[language]);
   expect(i18n.t("common.loading",{lng:language})).toBe(loading[language]);
  }
 }
});
