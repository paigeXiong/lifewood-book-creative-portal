import { Children, createContext, useContext, type ReactNode } from "react";
import { Link, useLocation, type LinkProps } from "react-router-dom";
export const revisionSteps=["project","characters","voice","style","references","review"];
export const RevisionNavigation=createContext<string[]|null>(null);
export function useRevisionNext() {
 const allowed=useContext(RevisionNavigation);
 const current=useLocation().pathname.split("/").at(-1)!;
 return allowed ? revisionSteps.find((step,index)=>index>revisionSteps.indexOf(current)&&allowed.includes(step)) : undefined;
}
export function RevisionLink({hideWhenLocked=false,...props}:LinkProps & {hideWhenLocked?:boolean}) {
 const allowed=useContext(RevisionNavigation);
 const path=typeof props.to==="string"?props.to:props.to.pathname;
 const step=path?.match(/\/edit\/([^/?#]+)/)?.[1];
 return allowed&&step&&!allowed.includes(step)?(hideWhenLocked?null:<span className={props.className} aria-disabled="true">{props.children}</span>):<Link {...props}/>;
}


export function useRevisionPrevious() {
 const allowed=useContext(RevisionNavigation);
 const current=useLocation().pathname.split("/").at(-1)!;
 return allowed ? revisionSteps.slice(0,revisionSteps.indexOf(current)).reverse().find(step=>allowed.includes(step)) : undefined;
}

export function ReviewSection({units,children,className=""}:{units:string[];children:ReactNode;className?:string}) {
 const allowed=useContext(RevisionNavigation);
 const parts=Children.toArray(children);
 if(!allowed)return <section className={"form-panel review-section "+className}>{children}</section>;
 return <details className={"form-panel review-section revision-review-section "+className} open={units.some(unit=>allowed.includes(unit))}>
   <summary>{parts[0]}</summary>{parts.slice(1)}
 </details>;
}
