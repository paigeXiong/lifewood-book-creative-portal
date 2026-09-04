import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";
import { workflowStepCount } from "../workflow-progress";

const stepKeys = ["project", "characters", "voice", "style", "references", "review"] as const;
const stepPaths = ["project", "characters", "voice", "style", "references", "review"] as const;

export function StepProgress({ current, highestReachable, onNext, onNavigate, canContinue = false, busy = false }: {
  current: number; highestReachable: number; onNext?: () => void; onNavigate?: (path: string) => void; canContinue?: boolean; busy?: boolean;
}) {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const confirmLeave = () => document.body.dataset.unsavedChanges !== "true" || window.confirm(t("wizard.unsavedChanges"));
  return (
    <nav className="step-progress" aria-label={t("wizard.stepProgress", { current, total: workflowStepCount })}>
      <span className="step-compact">{t("wizard.stepProgress", { current, total: workflowStepCount })}</span>
      <ol>
        {stepKeys.map((key, index) => {
          const number = index + 1;
          const state = number === current ? "current" : number < highestReachable ? "complete" : "pending";
          const isNextAction = number === current + 1 && Boolean(onNext);
          const reachable = isNextAction ? canContinue : number !== current && number <= highestReachable;
          const completedLine = number < highestReachable || (number === current && canContinue);
          const content = <><span className="step-marker">{state === "complete" ? "✓" : number}</span><span className="step-label">{t(`wizard.steps.${key}`)}</span></>;
          return (
            <li className={`step-item step-${state}${reachable ? " step-reachable" : ""}${completedLine ? " step-line-complete" : ""}`} key={key} aria-current={state === "current" ? "step" : undefined}>
              {isNextAction ? <button type="button" className="step-link step-button" disabled={!canContinue || busy} onClick={onNext}>{content}</button> : reachable && taskId ? (
                <Link viewTransition className="step-link" aria-disabled={busy || undefined} to={localizedPath(validLocale, `/tasks/${taskId}/edit/${stepPaths[index]}`)} onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (busy) { event.preventDefault(); return; }
                  if (onNavigate) { event.preventDefault(); onNavigate(event.currentTarget.pathname); }
                  else if (!confirmLeave()) event.preventDefault();
                }}>
                  {content}
                </Link>
              ) : <span className="step-content">{content}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
