import {useEffect} from "react";
import {presenceService} from "@lifewood/api-client";

export function installUserPresence(userId:string) {
 let tabId=crypto.randomUUID();
 let accountChanged=false,stopped=false,sequence=0,acknowledged=0,lastInteraction=0,lastSent=0,inFlight:AbortController|undefined;
 let refresh:ReturnType<typeof setTimeout>|undefined;
 const visible=()=>document.visibilityState==="visible";
 const send=()=>{
  if(stopped||inFlight)return;
  const controller=new AbortController();inFlight=controller;
  const current=sequence,isVisible=visible();lastSent=Date.now();
  void presenceService.heartbeat(userId,{tabId,visible:isVisible,interacted:isVisible&&current>acknowledged&&Date.now()-lastInteraction<300000},controller.signal)
   .then(()=>{if(stopped)return;if(isVisible)acknowledged=current;window.dispatchEvent(new CustomEvent("lw-presence-updated",{detail:{userId}}));}).catch(()=>{})
   .finally(()=>{if(inFlight===controller)inFlight=undefined;});
 };
 const activity=(event:Event)=>{
  if(!event.isTrusted||!visible())return;
  sequence++;lastInteraction=Date.now();
  if(acknowledged===0||Date.now()-lastSent>=15000)send();
 };
 const visibility=()=>{
  clearTimeout(refresh);
  refresh=setTimeout(send,150);
 };
 const stop=()=>{stopped=true;clearInterval(timer);clearTimeout(refresh);inFlight?.abort();};
 const leave=()=>{stop();void presenceService.leave(userId,tabId).catch(()=>{});};
 const accountStop=()=>{accountChanged=true;stop();};
 const resume=()=>{if(stopped&&!accountChanged){tabId=crypto.randomUUID();stopped=false;inFlight=undefined;timer=setInterval(send,30000);send();}};
 let timer=setInterval(send,30000);
 for(const event of ["pointerdown","pointermove","keydown","wheel","touchstart"])window.addEventListener(event,activity,{passive:true,capture:true});
 document.addEventListener("visibilitychange",visibility);window.addEventListener("focus",visibility);window.addEventListener("blur",visibility);
 window.addEventListener("pagehide",leave);window.addEventListener("pageshow",resume);window.addEventListener("lw-account-changed",accountStop);
 send();
 return()=>{
  leave();
  for(const event of ["pointerdown","pointermove","keydown","wheel","touchstart"])window.removeEventListener(event,activity,true);
  document.removeEventListener("visibilitychange",visibility);window.removeEventListener("focus",visibility);window.removeEventListener("blur",visibility);
  window.removeEventListener("pagehide",leave);window.removeEventListener("pageshow",resume);window.removeEventListener("lw-account-changed",accountStop);
 };
}
export function UserPresence({userId}:{userId:string}) {useEffect(()=>installUserPresence(userId),[userId]);return null;}
