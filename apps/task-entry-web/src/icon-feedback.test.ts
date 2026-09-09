// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {installIconFeedback} from "@lifewood/ui/icon-feedback";
let cleanup=()=>{};
afterEach(()=>{cleanup();document.body.replaceChildren();vi.unstubAllGlobals();});
function setup(){
 const media=new EventTarget() as EventTarget & {matches:boolean};media.matches=false;
 vi.stubGlobal("matchMedia",()=>media);
 document.body.innerHTML='<button data-icon-motion="press" aria-label="Close"><svg><path/></svg></button><button id="text">Save</button>';
 const button=document.querySelector('button')!,icon=button.querySelector('svg')!;
 const animations:{cancel:ReturnType<typeof vi.fn>;finished:Promise<void>}[]=[];
 const animate=vi.fn(()=>{const a={cancel:vi.fn(),finished:new Promise<void>(()=>{})};animations.push(a);return a;});
 Object.defineProperty(icon,'animate',{value:animate});cleanup=installIconFeedback();return {media,button,icon,animate,animations};
}
it('restarts only its own animation and never delays the business click handler',()=>{
 const {button,icon,animate,animations}=setup(),action=vi.fn();button.onclick=action;
 icon.querySelector('path')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.click();
 expect(action).toHaveBeenCalledTimes(2);expect(animate).toHaveBeenCalledTimes(2);expect(animations[0].cancel).toHaveBeenCalledOnce();
 cleanup();expect(animations[1].cancel).toHaveBeenCalledOnce();button.click();expect(animate).toHaveBeenCalledTimes(2);
});
it('skips disabled, aria-disabled, inert and unmarked controls',()=>{
 const {button,animate}=setup();
 button.disabled=true;button.dispatchEvent(new MouseEvent('click',{bubbles:true}));button.disabled=false;
 button.setAttribute('aria-disabled','true');button.click();button.removeAttribute('aria-disabled');
 button.setAttribute('inert','');button.click();button.removeAttribute('inert');
 document.querySelector<HTMLButtonElement>('#text')!.click();expect(animate).not.toHaveBeenCalled();
});
it('cancels in-flight motion when the system preference changes and resumes future clicks',()=>{
 const {media,button,animate,animations}=setup();button.click();media.matches=true;media.dispatchEvent(new Event('change'));
 expect(animations[0].cancel).toHaveBeenCalledOnce();button.click();expect(animate).toHaveBeenCalledOnce();
 media.matches=false;media.dispatchEvent(new Event('change'));button.click();expect(animate).toHaveBeenCalledTimes(2);
});
