import {createContext,useContext,type ReactNode} from "react";
import {createPortal} from "react-dom";

export const ProjectActionTarget=createContext<HTMLElement|null|undefined>(undefined);
export function ProjectAction({children,slot}:{children:ReactNode;slot:"operations"|"returns"|"delivery"}) {
  const target=useContext(ProjectActionTarget);
  const destination=target?.querySelector(`[data-project-action="${slot}"]`);
  return target===undefined?<>{children}</>:destination?createPortal(children,destination):null;
}
