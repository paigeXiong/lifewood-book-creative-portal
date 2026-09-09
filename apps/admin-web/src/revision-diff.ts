import {getNarrationEnabled} from "@lifewood/domain";
import type {SupportedLocale} from "@lifewood/domain";
import type {TFunction} from "i18next";
import {readRevisionSnapshot} from "./revision-snapshot";

type RecordValue = Record<string, unknown>;
export interface DiffValue {text: string; href?: string}
export interface RevisionChange {key:string; unit:string; label:string; kind:"added"|"removed"|"changed"; before:DiffValue[]; after:DiffValue[]}
// Explicit business fields keep internal IDs and bookkeeping out of the review.
export const revisionFields: [string,string,string,string?][] = [
 ["project.clientName","wizard.fields.clientName","references"], ["project.contactName","wizard.fields.contactName","references"],
 ["project.email","wizard.fields.email","references"], ["project.phone","wizard.fields.phone","references"],
 ["project.projectName","wizard.fields.projectName","references"], ["project.brandId","wizard.fields.brand","references","brands"],
 ["project.videoGoalId","wizard.fields.videoGoal","references","videoGoals"], ["project.deadline","wizard.fields.deadline","references"],
 ["project.audienceIds","wizard.fields.audiences","references","audiences"],
 ["book.title","wizard.fields.bookTitle","project"], ["book.subtitle","wizard.fields.subtitle","project"],
 ["book.authorName","wizard.fields.authorName","project"], ["book.genreId","wizard.fields.genre","project","genres"],
 ["book.sellingPoint","wizard.fields.sellingPoint","project"], ["book.synopsis","wizard.fields.synopsis","project"],
 ["book.contentLanguageId","wizard.fields.contentLanguage","project","contentLanguages"],
 ["book.videoDurationId","wizard.fields.duration","project","videoDurations"], ["book.customVideoDuration","revisionDiff.customDuration","project"],
 ["book.publishingPlatformIds","wizard.fields.platforms","project","publishingPlatforms"],
 ["creative.visualStyleId","creative.fields.visualStyle","style","visualStyles"],
 ["creative.moodTagIds","creative.fields.moodTags","style","moodTags"],
 ["creative.imageStyleTagIds","creative.fields.imageTags","style","imageStyleTags"], ["creative.paceTagIds","creative.fields.paceTags","style","paceTags"],
 ...[["contentLanguageId","contentLanguage","contentLanguages"],["narrationToneId","narrationTone","narrationTones"],
 ["speechRateId","speechRate","speechRates"],["voiceGenderId","voiceGender","voiceGenders"],["voiceAgeId","voiceAge","voiceAges"],
 ["accentId","accent","accents"],["emotionStyleId","emotionStyle","voiceEmotions"],
 ["pronunciationNotes","pronunciationNotes"],["customVoiceDescription","customVoice"]].map(([field,label,group]):[string,string,string,string?]=>["voiceAndReferences.voiceover."+field,"voice.fields."+label,"voice",group]),
 ["voiceAndReferences.voiceover.narrationEnabled","voice.narration.question","voice","boolean"],
 ["voiceAndReferences.voiceover.selectedVoiceIds","admin.projects.selectedVoices","voice","voices"],
 ["voiceAndReferences.voiceover.preferredVoiceId","admin.projects.preferredVoice","voice","voices"],
 ...["coreMessage","requiredScenes","authorPreferences","closingMessage","musicMood","avoidContent"].map((field):[string,string,string]=>["voiceAndReferences.creativeDirection."+field,"voice.fields."+field,"references"]),
];
export const characterFields: [string,string,string?][] = [
 ["name","creative.fields.characterName"],["roleTypeId","creative.fields.roleType","roleTypes"],
 ["storyRole","creative.fields.storyRole"],["personality","creative.fields.personality"],["appearance","creative.fields.appearance"],
 ["ageRangeId","creative.fields.ageRange","ageRanges"],["genderId","creative.fields.gender","genders"],
 ["clothing","creative.fields.clothing"],["emotion","creative.fields.emotion"],["voiceHint","creative.fields.voiceHint"],
];
const object = (value:unknown):RecordValue => value&&typeof value==="object"&&!Array.isArray(value)?value as RecordValue:{};
const array = (value:unknown):unknown[] => Array.isArray(value)?value:[];
const text = (value:unknown) => typeof value==="string"?value.replace(/\r\n/g,"\n"):"";
const get = (value:unknown,path:string):unknown => path.split(".").reduce<unknown>((part,key)=>object(part)[key],value);
const canonical = (value:unknown):string => Array.isArray(value)?JSON.stringify([...new Set(value.map(canonical))].sort()):JSON.stringify(typeof value==="string"?text(value):value??"");
const empty = (value:unknown) => value==null||value===""||Array.isArray(value)&&value.length===0;
function safeLink(value:string):string|undefined {try {const url=new URL(value);return ["http:","https:"].includes(url.protocol)?url.href:undefined;}catch{return undefined;}}

function presetLink(value:string,imageBase?:string):string|undefined {
 if (!value.startsWith("/") || value.startsWith("//")) return safeLink(value);
 try {
  const url=new URL(value,"https://local.invalid");
  if(url.origin!=="https://local.invalid"||!["/api/character-preset-images/","/character-presets/"].some(prefix=>url.pathname.startsWith(prefix)))return undefined;
  const path=url.pathname+url.search;
  return url.pathname.startsWith("/character-presets/")&&imageBase?new URL(path,imageBase).href:path;
 }catch{return undefined;}
}
export function compareRevisionSnapshots(beforeJson:string,afterJson:string,locale:SupportedLocale,t:TFunction,projectId:string,imageBase?:string):RevisionChange[]|null {
 try {
  const before=readRevisionSnapshot(beforeJson,locale),after=readRevisionSnapshot(afterJson,locale);
  for(const snapshot of [before,after])for(const key of ["project","book","creative","voiceAndReferences"] as const){
   if(!snapshot.fields[key]||typeof snapshot.fields[key]!=="object"||Array.isArray(snapshot.fields[key]))return null;
  }
  const changes:RevisionChange[]=[];
  const format=(value:unknown,snapshot:typeof before,group?:string):DiffValue[]=>{
   if(empty(value))return [];
   if(group==="boolean")return [{text:t(value===true?"voice.narration.required":"voice.narration.notRequired")}];
   return (Array.isArray(value)?value:[value]).map(item=>({text:group?(group==="voices"?snapshot.voiceNames.get(text(item)):snapshot.optionMaps.get(group)?.get(text(item)))||t("uiDensity.unavailableOption"):text(item)}));
  };
  const add=(key:string,unit:string,label:string,a:unknown,b:unknown,valuesA:DiffValue[],valuesB:DiffValue[])=>{
   if(canonical(a)===canonical(b))return;
   changes.push({key,unit,label,kind:empty(a)?"added":empty(b)?"removed":"changed",before:valuesA,after:valuesB});
  };
  const fieldValue=(fields:typeof before.fields,path:string)=>{
   if(path!=="voiceAndReferences.voiceover.narrationEnabled")return get(fields,path);
   const voice=object(get(fields,"voiceAndReferences.voiceover"));
   return getNarrationEnabled({...voice,selectedVoiceIds:array(voice.selectedVoiceIds).map(text)});
  };
  for(const [path,label,unit,group] of revisionFields){const a=fieldValue(before.fields,path),b=fieldValue(after.fields,path);add(path,unit,t(label),a,b,format(a,before,group),format(b,after,group));}
  const assetChanges=(key:string,unit:string,label:string,a:unknown,b:unknown)=>{
   const left=new Map(array(a).map(item=>[text(object(item).id),object(item)])),right=new Map(array(b).map(item=>[text(object(item).id),object(item)]));
   for(const id of new Set([...left.keys(),...right.keys()])){
    const old=left.get(id),next=right.get(id);
    const value=(asset:RecordValue|undefined):DiffValue[]=>asset?[{text:text(asset.fileName)||t("revisionDiff.file"),href:id?`/api/admin/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(id)}`:undefined}]:[];
    const identity=(asset:RecordValue|undefined)=>asset?[id,asset.fileName,asset.categoryId,asset.sizeBytes,asset.contentType]:null;
    add(key+":"+id,unit,label,identity(old),identity(next),value(old),value(next));
   }
  };
  const linkChanges=(key:string,unit:string,label:string,a:unknown,b:unknown,preset=false)=>{
   const left=new Set(array(a).map(text)),right=new Set(array(b).map(text));
   for(const url of new Set([...left,...right])){
    if(left.has(url)&&right.has(url))continue;
    const href=preset?presetLink(url,imageBase):safeLink(url),name=href?(preset?t("revisionDiff.presetImage"):new URL(href).hostname):t("revisionDiff.unavailableLink");
    const value=[{text:t("uiDensity.referenceLink",{number:[...new Set([...left,...right])].indexOf(url)+1})+" · "+name,href}];
    add(key+":"+url,unit,label,left.has(url)?url:null,right.has(url)?url:null,left.has(url)?value:[],right.has(url)?value:[]);
   }
  };
  assetChanges("book.sourceAssets","project",t("taskDetail.sourceFiles"),before.fields.book.sourceAssets,after.fields.book.sourceAssets);
  assetChanges("creative.styleReferenceImages","style",t("admin.projects.styleReferences"),before.fields.creative.styleReferenceImages,after.fields.creative.styleReferenceImages);
  linkChanges("creative.styleReferenceImageUrls","style",t("admin.projects.styleReferences"),before.fields.creative.styleReferenceImageUrls,after.fields.creative.styleReferenceImageUrls);
  assetChanges("voiceAndReferences.assets","references",t("admin.projects.files"),before.fields.voiceAndReferences.assets,after.fields.voiceAndReferences.assets);
  linkChanges("voiceAndReferences.competitorUrls","references",t("voice.fields.competitorLinks"),before.fields.voiceAndReferences.competitorUrls,after.fields.voiceAndReferences.competitorUrls);
  const presetImages=(character:RecordValue|undefined):string[]=>{
   const url=character?.presetImageUrl??(character?.presetId?`/character-presets/${encodeURIComponent(text(character.presetId))}.png`:"");
   return text(url)?[text(url)]:[];
  };
  const left=new Map(array(before.fields.creative.characters).map(item=>[text(object(item).id),object(item)]));
  const right=new Map(array(after.fields.creative.characters).map(item=>[text(object(item).id),object(item)]));
  for(const id of new Set([...left.keys(),...right.keys()])){
   const old=left.get(id),next=right.get(id),name=text(next?.name)||text(old?.name)||t("revisionDiff.unnamedCharacter");
   if(!old||!next){add("character:"+id,"characters",t("revisionDiff.character"),old?id:null,next?id:null,old?[{text:text(old.name)||t("revisionDiff.unnamedCharacter")}]:[],next?[{text:text(next.name)||t("revisionDiff.unnamedCharacter")}]:[]);}
   else for(const [field,label,group] of characterFields)add("character:"+id+":"+field,"characters",name+" · "+t(label),old[field],next[field],format(old[field],before,group),format(next[field],after,group));
   assetChanges("character:"+id+":images","characters",name+" · "+t("admin.projects.referenceImages"),old?.referenceImages,next?.referenceImages);
   linkChanges("character:"+id+":urls","characters",name+" · "+t("admin.projects.referenceImages"),old?.referenceImageUrls,next?.referenceImageUrls);
   linkChanges("character:"+id+":preset","characters",name+" · "+t("revisionDiff.presetImage"),presetImages(old),presetImages(next),true);
  }
  // A changed character order is meaningful; inserting one must not mark every other character as modified.
  if(left.size===right.size&&[...left.keys()].every(id=>right.has(id))&&[...left.keys()].join()!==[...right.keys()].join()){
   changes.push({key:"character-order",unit:"characters",label:t("revisionDiff.characterOrder"),kind:"changed",before:[...left.values()].map(c=>({text:text(c.name)||t("revisionDiff.unnamedCharacter")})),after:[...right.values()].map(c=>({text:text(c.name)||t("revisionDiff.unnamedCharacter")}))});
  }
  return changes;
 }catch{return null;}
}
