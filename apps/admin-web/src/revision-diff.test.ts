import {describe,it,expect} from "vitest";
import {i18n} from "@lifewood/i18n";
import "./i18n";
import {compareRevisionSnapshots,revisionFields,characterFields} from "./revision-diff";
function snapshot(){return {
 project:{clientName:"Publisher",contactName:"Contact",email:"contact@example.test",projectName:"Book film",audienceIds:["adult","young"]},
 book:{title:"First title",synopsis:"First synopsis",sourceAssets:[{id:"file-old",fileName:"cover.png",categoryId:"cover",contentType:"image/png",sizeBytes:10,url:"/api/projects/p/files/file-old"}],genreId:"original",publishingPlatformIds:[]},
 creative:{characters:[{id:"character-a",name:"Alice",appearance:"Blue coat",referenceImages:[],referenceImageUrls:[]},{id:"character-b",name:"Bob",appearance:"Red coat",referenceImages:[],referenceImageUrls:[]}],moodTagIds:[],styleReferenceImages:[],styleReferenceImageUrls:[]},
 voiceAndReferences:{voiceover:{selectedVoiceIds:["voice-a"],narrationEnabled:true},creativeDirection:{coreMessage:"Message"},assets:[],competitorUrls:[] as string[]},
 configuration:{formOptions:[{id:"original",groupId:"genres",labelZhCn:"旧类别",labelEnUs:"Old genre"},{id:"updated",groupId:"genres",labelZhCn:"新类别",labelEnUs:"New genre"}],voices:[{id:"voice-a",nameZhCn:"音色甲",nameEnUs:"Voice A"},{id:"voice-b",nameZhCn:"音色乙",nameEnUs:"Voice B"}]}
};}
const compare=(before:unknown,after:unknown,locale:"zh-CN"|"en-US"="zh-CN")=>compareRevisionSnapshots(JSON.stringify(before),JSON.stringify(after),locale,i18n.getFixedT(locale),"project-1");
describe("revision comparisons",()=>{
 it.each(["zh-CN","en-US"] as const)("compares saved fields and labels in %s without exposing identifiers",locale=>{
  const before=snapshot(),after=structuredClone(before);after.book.title="Updated title";after.book.genreId="updated";after.voiceAndReferences.voiceover.selectedVoiceIds=["voice-b"];
  const changes=compare(before,after,locale)!;expect(changes).toHaveLength(3);
  expect(changes.find(c=>c.key==="book.genreId")?.before[0].text).toBe(locale==="zh-CN"?"旧类别":"Old genre");
  expect(changes.find(c=>c.key==="book.genreId")?.after[0].text).toBe(locale==="zh-CN"?"新类别":"New genre");
  expect(changes.flatMap(c=>[...c.before,...c.after]).map(v=>v.text).join()).not.toMatch(/voice-a|voice-b/);
  for(const [,label] of [...revisionFields,...characterFields])expect(i18n.exists(label,{lng:locale}),label).toBe(true);
 });
 it("ignores metadata, enum ordering and configuration renaming",()=>{
  const before=snapshot(),after=structuredClone(before);after.project.audienceIds.reverse();after.configuration.formOptions[0].labelZhCn="Renamed";after.book.sourceAssets[0].url="/changed-transport-url";
  expect(compare(before,{...after,version:999,updatedAt:"later"})).toEqual([]);
 });
 it("matches characters by identity, including insertion and explicit reordering",()=>{
  const before=snapshot(),after=structuredClone(before);after.creative.characters.unshift({...after.creative.characters[0],id:"character-new",name:"New character"});after.creative.characters[2].appearance="White coat";
  const changes=compare(before,after)!;expect(changes).toHaveLength(2);expect(changes.find(c=>c.kind==="added")?.after[0].text).toBe("New character");expect(changes.find(c=>c.kind==="changed")?.before[0].text).toBe("Red coat");
  const reordered=structuredClone(before);reordered.creative.characters.reverse();expect(compare(before,reordered)?.map(c=>c.key)).toEqual(["character-order"]);
 });
 it("shows a same-name replacement as separate removed and added attachments",()=>{
  const before=snapshot(),after=structuredClone(before);after.book.sourceAssets[0].id="file-new";
  const changes=compare(before,after)!;expect(changes.map(c=>c.kind)).toEqual(["removed","added"]);
  expect(changes[0].before).toEqual([{text:"cover.png",href:"/api/admin/projects/project-1/files/file-old"}]);expect(changes[1].after[0].text).toBe("cover.png");
 });
 it("keeps missing and empty optional values equivalent but distinguishes false from unset",()=>{
  const before=snapshot(),after=structuredClone(before);expect(compare(before,{...after,project:{...after.project,phone:""}})).toEqual([]);
  expect(compare({...before,voiceAndReferences:{...before.voiceAndReferences,voiceover:{selectedVoiceIds:[]}}},{...after,voiceAndReferences:{...after.voiceAndReferences,voiceover:{selectedVoiceIds:[],narrationEnabled:false}}})?.[0].kind).toBe("added");
 });
 it("does not replace missing historical labels with IDs or today's configuration",()=>{
  const before=snapshot(),after=structuredClone(before);after.book.genreId="retired-uuid";const changes=compare({...before,configuration:null},{...after,configuration:null})!;
  expect(changes).toHaveLength(1);expect(changes[0].before[0].text).toBe("选项信息不可用");expect(changes[0].after[0].text).toBe("选项信息不可用");
 });
 it("does not make unsafe URLs clickable, and rejects incomplete snapshots",()=>{
  const before=snapshot(),after=structuredClone(before);after.voiceAndReferences.competitorUrls=["javascript:alert(1)","https://example.test/watch?q=1"];
  const changes=compare(before,after)!;expect(changes[0].after[0].href).toBeUndefined();expect(changes[0].after[0].text).not.toContain("javascript:");expect(changes[1].after[0].href).toBe("https://example.test/watch?q=1");
  expect(compare({},after)).toBeNull();expect(compareRevisionSnapshots("bad",JSON.stringify(after),"en-US",i18n.getFixedT("en-US"),"p")).toBeNull();
 });
 it("resolves controlled preset images including legacy preset IDs",()=>{
  const before=snapshot(),after=structuredClone(before);
  const preset=(source:ReturnType<typeof snapshot>,id:string,image?:string)=>({...source,creative:{...source.creative,characters:[{...source.creative.characters[0],presetId:id,presetImageUrl:image}]}});
  const changes=compare(preset(before,"old"),preset(after,"new","/api/character-preset-images/new.png"))!;
  expect(changes.map(c=>c.kind)).toEqual(["removed","added"]);
  const deployed=compareRevisionSnapshots(JSON.stringify(preset(before,"old")),JSON.stringify(preset(after,"new","/api/character-preset-images/new.png")),"en-US",i18n.getFixedT("en-US"),"p","https://portal.example.test/en-US/tasks")!;
  expect(deployed[0].before[0].href).toBe("https://portal.example.test/character-presets/old.png");expect(deployed[1].after[0].href).toBe("/api/character-preset-images/new.png");
  expect(compare(preset(before,"old"),preset(after,"old",""))?.map(c=>c.kind)).toEqual(["removed"]);
  expect(changes[0].before[0].href).toBe("/character-presets/old.png");expect(changes[1].after[0].href).toBe("/api/character-preset-images/new.png");
  expect(compare(preset(before,"old"),preset(after,"new","/api/character-preset-images/../../private"))?.[1].after[0].href).toBeUndefined();
 });
 it("does not report legacy narration inference or newline normalization as an edit",()=>{
  const before=snapshot(),after=structuredClone(before);
  expect(compare({...before,voiceAndReferences:{...before.voiceAndReferences,voiceover:{selectedVoiceIds:["voice-a"]}}},after)).toEqual([]);
  expect(compare({...before,book:{...before.book,synopsis:"Line 1\r\nLine 2"}},{...after,book:{...after.book,synopsis:"Line 1\nLine 2"}})).toEqual([]);
 });

});
