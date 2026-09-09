import {useEffect,useRef,type PointerEvent as ReactPointerEvent,type RefObject} from "react";

type Options = {
 root: RefObject<HTMLElement | null>;
 ids: number[];
 selected: number[];
 disabled: boolean;
 onSelect: (ids: number[]) => void;
};
type Gesture = {
 pointer: number; target: HTMLInputElement; anchor: number; initial: number[];
 selecting: boolean; startX: number; startY: number; x: number; y: number;
 dragging: boolean; lastEnd: number; frame: number; lastTime: number;
};

/** Mouse range selection; touch keeps native vertical scrolling and long press. */
export function useNotificationDragSelection(options: Options) {
 const latest=useRef(options);latest.current=options;
 const gesture=useRef<Gesture|null>(null);
 const suppressClick=useRef(false);
 const clickTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const cancel=()=>{
  const current=gesture.current;gesture.current=null;
  if(!current)return;
  if(current.dragging)suppressClick.current=true;
  cancelAnimationFrame(current.frame);
  if(current.target.hasPointerCapture(current.pointer))current.target.releasePointerCapture(current.pointer);
 };
 useEffect(()=>{
  const updateRange=(current:Gesture)=>{
   const {root,ids,onSelect,disabled}=latest.current;
   if(disabled||!current.target.isConnected){cancel();return;}
   const list=root.current?.querySelector<HTMLElement>(".notification-list");
   if(!list)return;
   const bounds=list.getBoundingClientRect();
   if(current.x<bounds.left||current.x>bounds.right)return;
   const rows=Array.from(list.children) as HTMLElement[];
   const end=rows.findIndex(row=>current.y<row.getBoundingClientRect().bottom);
   const index=end<0?rows.length-1:end;
   if(index<0||index===current.lastEnd)return;
   current.lastEnd=index;
   const range=ids.slice(Math.min(current.anchor,index),Math.max(current.anchor,index)+1);
   const rangeSet=new Set(range);
   onSelect(current.selecting
    ? Array.from(new Set([...current.initial,...range])).slice(0,500)
    : current.initial.filter(id=>!rangeSet.has(id)));
  };
  const tick=(time:number)=>{
   const current=gesture.current;if(!current||!current.dragging)return;
   const root=latest.current.root.current;
   const list=root?.querySelector<HTMLElement>(".notification-list");
   if(!list||latest.current.disabled||!current.target.isConnected){cancel();return;}
   let scroll:HTMLElement|null=list.parentElement;
   while(scroll&&!(scroll.scrollHeight>scroll.clientHeight&&/(auto|scroll)/.test(getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;
   const scroller=scroll??document.scrollingElement as HTMLElement;
   const viewport=scroll?scroll.getBoundingClientRect():{top:0,bottom:window.innerHeight};
   const top=Math.max(0,viewport.top),bottom=Math.min(window.innerHeight,viewport.bottom);
   const bounds=list.getBoundingClientRect();
   const elapsed=current.lastTime?Math.min(32,time-current.lastTime):16;
   current.lastTime=time;
   if(current.x>=bounds.left&&current.x<=bounds.right){
    const edge=40;
    const speed=current.y<top+edge?-Math.min(1,(top+edge-current.y)/edge):current.y>bottom-edge?Math.min(1,(current.y-bottom+edge)/edge):0;
    if(speed)scroller.scrollTop+=speed*elapsed*.65;
    updateRange(current);
   }
   if(gesture.current===current)current.frame=requestAnimationFrame(tick);
  };
  const move=(event:PointerEvent)=>{
   const current=gesture.current;if(!current||event.pointerId!==current.pointer)return;
   if(!(event.buttons&1)){cancel();return;}
   current.x=event.clientX;current.y=event.clientY;
   if(!current.dragging&&Math.hypot(current.x-current.startX,current.y-current.startY)<5)return;
   event.preventDefault();
   if(!current.dragging){current.dragging=true;current.frame=requestAnimationFrame(tick);}
   updateRange(current);
  };
  const finish=(event:PointerEvent)=>{
   const current=gesture.current;
   if(current&&event.pointerId!==current.pointer)return;
   cancel();
   if(suppressClick.current&&event.type==="pointerup"){
    clearTimeout(clickTimer.current);
    clickTimer.current=setTimeout(()=>{suppressClick.current=false;},0);
   }
  };
  const newPress=()=>{suppressClick.current=false;clearTimeout(clickTimer.current);};
  const click=(event:MouseEvent)=>{
   if(!suppressClick.current||event.detail===0)return;
   suppressClick.current=false;event.preventDefault();event.stopImmediatePropagation();
  };
  const stop=()=>cancel();
  window.addEventListener("pointerdown",newPress,true);
  window.addEventListener("pointermove",move,{passive:false});
  window.addEventListener("pointerup",finish);
  window.addEventListener("pointercancel",finish);
  window.addEventListener("blur",stop);
  document.addEventListener("visibilitychange",stop);
  document.addEventListener("click",click,true);
  return()=>{
   cancel();clearTimeout(clickTimer.current);
   window.removeEventListener("pointerdown",newPress,true);
   window.removeEventListener("pointermove",move);
   window.removeEventListener("pointerup",finish);
   window.removeEventListener("pointercancel",finish);
   window.removeEventListener("blur",stop);
   document.removeEventListener("visibilitychange",stop);
   document.removeEventListener("click",click,true);
  };
 },[]);
 const idsKey=options.ids.join(",");
 useEffect(()=>cancel(),[options.disabled,idsKey]);
 return {cancel,start:(event:ReactPointerEvent<HTMLInputElement>,id:number)=>{
  cancel();suppressClick.current=false;
  if(options.disabled||event.currentTarget.disabled||event.pointerType!=="mouse"||event.button!==0||event.isPrimary===false)return;
  const anchor=options.ids.indexOf(id);if(anchor<0)return;
  event.currentTarget.focus({preventScroll:true});
  event.currentTarget.setPointerCapture(event.pointerId);
  gesture.current={pointer:event.pointerId,target:event.currentTarget,anchor,initial:[...options.selected],selecting:!options.selected.includes(id),startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,dragging:false,lastEnd:-1,frame:0,lastTime:0};
 }};
}
