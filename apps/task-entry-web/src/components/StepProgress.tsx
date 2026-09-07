import { useConfirmLink } from "../useConfirm";
import { useContext, useId, useState } from "react";
import { RevisionNavigation } from "../revision-navigation";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { workflowStepCount } from "../workflow-progress";

const stepKeys = ["project", "characters", "voice", "style", "references", "review"] as const;
const stepPaths = ["project", "characters", "voice", "style", "references", "review"] as const;

export function StepProgress({ current, highestReachable, onNext, onNavigate, canContinue = false, busy = false }: {
  current: number; highestReachable: number; onNext?: () => void; onNavigate?: (path: string) => void; canContinue?: boolean; busy?: boolean;
}) {
  const [expanded,setExpanded]=useState(false);
  const listId=useId();
  const allowed = useContext(RevisionNavigation);
  const { t } = useTranslation();
  const guardLink = useConfirmLink();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  return (
    <nav className={"step-progress"+(expanded?" steps-expanded":"")} aria-label={t("wizard.stepProgress", { current, total: workflowStepCount })}>
      <div className="step-compact"><strong>{current}/{workflowStepCount} · {t("wizard.steps."+stepKeys[current-1])}</strong><button type="button" aria-expanded={expanded} aria-controls={listId} onClick={()=>setExpanded(!expanded)}>{t(expanded?"clientUx.hideSteps":"clientUx.allSteps")}</button></div>
      <ol id={listId}>
        {stepKeys.map((key, index) => {
          const number = index + 1;
          const state = number === current ? "current" : number < highestReachable ? "complete" : "pending";
          const isNextAction = number === current + 1 && Boolean(onNext);
          const permitted = !allowed || allowed.includes(key);
          const reachable = permitted && (isNextAction ? canContinue : number !== current && number <= highestReachable);
          const completedLine = number < highestReachable || (number === current && canContinue);
          const content = <><span className="step-marker">{state === "complete" ? "✓" : number}</span><span className="step-label">{t(`wizard.steps.${key}`)}</span></>;
          return (
            <li className={`step-item step-${state}${reachable ? " step-reachable" : ""}${completedLine ? " step-line-complete" : ""}`} key={key} aria-current={state === "current" ? "step" : undefined}>
              {isNextAction && permitted ? <button type="button" className="step-link step-button" disabled={!canContinue || busy} onClick={()=>{setExpanded(false);onNext?.();}}>{content}</button> : reachable && taskId ? (
                <Link viewTransition className="step-link" aria-disabled={busy || undefined} to={localizedPath(validLocale, `/tasks/${taskId}/edit/${stepPaths[index]}`)} onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (busy) { event.preventDefault(); return; }
                  setExpanded(false);
                  if (onNavigate) { event.preventDefault(); onNavigate(event.currentTarget.pathname); }
                  else void guardLink(event);
                }}>
                  {content}
                </Link>
              ) : <span className="step-content" aria-disabled={!permitted || undefined}>{content}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
