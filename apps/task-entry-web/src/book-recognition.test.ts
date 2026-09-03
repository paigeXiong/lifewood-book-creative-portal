import { describe, it, expect } from "vitest";
import { recognitionUpdates } from "./book-recognition";
import { createStepSchema } from "./pages/projectFormSchema";
import { i18n } from "@lifewood/i18n";
const blank = { title:"", authorName:"", subtitle:"", genreId:"", sellingPoint:"", synopsis:"" };
describe("book intake", () => {
  it("fills blanks while preserving pre-existing and in-flight edits", () => {
    const result={...blank,title:"AI title",authorName:"AI author",subtitle:"AI subtitle",genreId:"fiction",synopsis:"AI synopsis"};
    const before={...blank,title:"My title",subtitle:"Remove this"};
    const current={...before,authorName:"Typed meanwhile",subtitle:""};
    expect(recognitionUpdates(result,before,current)).toEqual({genreId:"fiction",synopsis:"AI synopsis"});
  });
  it("allows book intake before project basics are entered in step five", () => {
    expect(createStepSchema(key=>key).safeParse({...blank,title:"Book",authorName:"Author",genreId:"fiction",clientName:"Client",contactName:"Creator",email:"test@example.test",phone:"",brandId:"",projectName:"",videoGoalId:"",deadline:"",audienceIds:[],contentLanguageId:"en-US",videoDurationId:"30s",customVideoDuration:"",publishingPlatformIds:[]}).success).toBe(true);
  });
  it("has matching Chinese and English feature translations", () => {
    const zh=i18n.getResourceBundle("zh-CN","translation").bookIntake;
    const en=i18n.getResourceBundle("en-US","translation").bookIntake;
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    for(const key of Object.keys(zh)) { expect(zh[key]).not.toEqual(en[key]); expect(zh[key]).toBeTruthy(); expect(en[key]).toBeTruthy(); }
  });
});
