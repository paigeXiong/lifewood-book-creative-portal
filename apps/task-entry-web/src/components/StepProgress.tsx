import { useTranslation } from "react-i18next";

const stepKeys = ["project", "characters", "voice", "review"] as const;

export function StepProgress({ current }: { current: number }) {
  const { t } = useTranslation();
  return (
    <nav className="step-progress" aria-label={t("wizard.stepProgress", { current, total: 4 })}>
      <span className="step-compact">{t("wizard.stepProgress", { current, total: 4 })}</span>
      <ol>
        {stepKeys.map((key, index) => {
          const number = index + 1;
          const state = number < current ? "complete" : number === current ? "current" : "pending";
          return (
            <li className={`step-item step-${state}`} key={key} aria-current={state === "current" ? "step" : undefined}>
              <span className="step-marker">{state === "complete" ? "✓" : number}</span>
              <span>{t(`wizard.steps.${key}`)}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

