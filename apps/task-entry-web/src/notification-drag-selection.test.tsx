import {act,useRef,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
import {useNotificationDragSelection} from "../../../packages/ui/src/useNotificationDragSelection";

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root;
let host:HTMLDivElement;
function Fixture({ids,initial=[],disabled=false}:{ids:number[];initial?:number[];disabled?:boolean}) {
 const ref=useRef<HTMLElement>(null),[selected,setSelected]=useState(initial);
 const drag=useNotificationDragSelection({root:ref,ids,selected,disabled,onSelect:setSelected});
 return <section ref={ref}><ul className="notification-list">{ids.map(id=><li key={id}><input type="checkbox" checked={selected.includes(id)} onPointerDown={e=>drag.start(e,id)} onChange={()=>setSelected(current=>current.includes(id)?current.filter(i=>i!==id):[...current,id])}/></li>)}</ul></section>;
}
function setup(ids:number[],initial:number[]=[],disabled=false){
 vi.stubGlobal("requestAnimationFrame",vi.fn(()=>1));vi.stubGlobal("cancelAnimationFrame",vi.fn());
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
 act(()=>root.render(<Fixture ids={ids} initial={initial} disabled={disabled}/>));
 const box=(index:number)=>host.querySelectorAll<HTMLInputElement>('input')[index];
 const rect=(top:number,bottom:number)=>({left:0,right:300,top,bottom,width:300,height:bottom-top,x:0,y:top,toJSON:()=>({})});
 host.querySelector('ul')!.getBoundingClientRect=()=>rect(0,ids.length*50);
 host.querySelectorAll('li').forEach((row,i)=>{row.getBoundingClientRect=()=>rect(i*50,(i+1)*50);});
 host.querySelectorAll('input').forEach(input=>{input.setPointerCapture=vi.fn();input.hasPointerCapture=()=>false;input.releasePointerCapture=vi.fn();});
 return {box,checked:()=>Array.from(host.querySelectorAll('input')).flatMap((input,i)=>input.checked?[ids[i]]:[])};
}
function pointer(target:EventTarget,type:string,y:number,pointerType="mouse"){
 const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='pointerup'?0:1,clientX:20,clientY:y});
 Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:pointerType},isPrimary:{value:true}});
 act(()=>target.dispatchEvent(event));
}
function click(target:EventTarget){let accepted=true;act(()=>{accepted=target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));});return accepted;}
afterEach(()=>{if(root)act(()=>root.unmount());host?.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});

it('selects skipped rows and shrinks the range while preserving unrelated selections',()=>{
 const {box,checked}=setup([0,1,2,3,4,5],[5]);
 pointer(box(0),'pointerdown',20);pointer(window,'pointermove',170);expect(checked()).toEqual([0,1,2,3,5]);
 pointer(window,'pointermove',70);expect(checked()).toEqual([0,1,5]);
 pointer(window,'pointerup',70);expect(click(box(0))).toBe(false);expect(checked()).toEqual([0,1,5]);
});
it('deselects upward from a checked anchor and restores items when dragging back',()=>{
 const {box,checked}=setup([0,1,2,3,4,5],[0,1,2,3,4]);
 pointer(box(4),'pointerdown',220);pointer(window,'pointermove',70);expect(checked()).toEqual([0]);
 pointer(window,'pointermove',120);expect(checked()).toEqual([0,1]);
});
it('keeps the batch limit when dragging across more than 500 rows',()=>{
 const {box,checked}=setup(Array.from({length:505},(_,i)=>i));
 pointer(box(0),'pointerdown',20);pointer(window,'pointermove',504*50+20);expect(checked()).toHaveLength(500);
});
it('suppresses the release click after feed changes cancel a drag, then allows a new click',()=>{
 const {box}=setup([0,1,2]);
 pointer(box(0),'pointerdown',20);pointer(window,'pointermove',70);
 act(()=>root.render(<Fixture ids={[0,1]}/>));
 pointer(window,'pointerup',20);expect(click(box(0))).toBe(false);expect(box(0).checked).toBe(true);
 pointer(box(0),'pointerdown',20);pointer(window,'pointerup',20);expect(click(box(0))).toBe(true);expect(box(0).checked).toBe(false);
});
it.each([['touch',false],['mouse',true]] as const)('ignores %s drag when disabled is %s',(type,disabled)=>{
 const {box,checked}=setup([0,1,2],[],disabled);
 pointer(box(0),'pointerdown',20,type);pointer(window,'pointermove',120,type);expect(checked()).toEqual([]);
});
