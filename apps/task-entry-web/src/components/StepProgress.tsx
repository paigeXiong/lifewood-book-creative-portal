import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { isSupportedLocale, localizedPath } from "@lifewood/i18n";

const stepKeys = ["project", "characters", "voice", "review"] as const;
const stepPaths = ["project", "characters", "voice", "review"] as const;

export function StepProgress({ current }: { current: number }) {
  const { t } = useTranslation();
  const { locale, taskId } = useParams();
  const validLocale = isSupportedLocale(locale) ? locale : "zh-CN";
  const confirmLeave = () => document.body.dataset.unsavedChanges !== "true" || window.confirm(t("wizard.unsavedChanges"));
  return (
    <nav className="step-progress" aria-label={t("wizard.stepProgress", { current, total: 4 })}>
      <span className="step-compact">{t("wizard.stepProgress", { current, total: 4 })}</span>
      <ol>
        {stepKeys.map((key, index) => {
          const number = index + 1;
          const state = number < current ? "complete" : number === current ? "current" : "pending";
          const content = <><span className="step-marker">{state === "complete" ? "✓" : number}</span><span className="step-label">{t(`wizard.steps.${key}`)}</span></>;
          return (
            <li className={`step-item step-${state}`} key={key} aria-current={state === "current" ? "step" : undefined}>
              {state === "complete" && taskId ? (
                <Link className="step-link" to={localizedPath(validLocale, `/tasks/${taskId}/edit/${stepPaths[index]}`)} onClick={(event) => { if (!confirmLeave()) event.preventDefault(); }}>
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
