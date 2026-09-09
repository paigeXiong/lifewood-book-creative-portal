import {useEffect,useRef,type PointerEvent as ReactPointerEvent} from "react";

export function useNotificationLongPress(onLongPress:(id:number)=>void, disabled:boolean) {
 const callback=useRef(onLongPress);callback.current=onLongPress;
 const pending=useRef<{timer:ReturnType<typeof setTimeout>;id:number;x:number;y:number;pointer:number}|null>(null);
 const activated=useRef<number|null>(null);
 const cancel=()=>{if(pending.current)clearTimeout(pending.current.timer);pending.current=null;};
 useEffect(()=>{const stop=()=>cancel();window.addEventListener("blur",stop);document.addEventListener("scroll",stop,true);document.addEventListener("visibilitychange",stop);return()=>{cancel();window.removeEventListener("blur",stop);document.removeEventListener("scroll",stop,true);document.removeEventListener("visibilitychange",stop);};},[]);
 useEffect(()=>{if(disabled)cancel();},[disabled]);
 return {
  start:(event:ReactPointerEvent,id:number)=>{
   cancel();activated.current=null;
   if(disabled||event.button!==0||event.isPrimary===false||(event.target as Element).closest("button,input,a,select,textarea"))return;
   const target=event.currentTarget, pointer=event.pointerId;
   pending.current={id,x:event.clientX,y:event.clientY,pointer:event.pointerId,timer:setTimeout(()=>{pending.current=null;if(!target.isConnected)return;try{target.setPointerCapture(pointer);}catch{}activated.current=id;callback.current(id);},500)};
  },
  move:(event:ReactPointerEvent)=>{const p=pending.current;if(p&&(p.pointer!==event.pointerId||Math.hypot(event.clientX-p.x,event.clientY-p.y)>8))cancel();},
  cancel,
  consumeClick:(id:number)=>{if(activated.current!==id)return false;activated.current=null;return true;},
  wasActivated:(id:number)=>activated.current===id||pending.current?.id===id,
 };
}
