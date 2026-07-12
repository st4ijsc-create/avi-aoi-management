// WD-1 (doc 31 Đợt D · UX1) — Step 9: readiness summary + finish.
//
// Readiness is computed CLIENT-SIDE from existing queries (WD-2 owns the server
// product.getReadiness completeness score; this wizard stays out of that lane and
// shows a basic count summary inline per the doc-31 D.1 fallback).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import {
  PRODUCT_ONBOARDING_STEPS,
  type OnboardingReadiness,
  type OnboardingReadinessInput,
  type OnboardingStepState,
  type StepStatus,
  mergeStepStatus,
  requiredIncompleteSteps,
} from "./types";

interface Props {
  input: OnboardingReadinessInput;
  readiness: OnboardingReadiness;
  manual: OnboardingStepState;
  onGoToStep: (index: number) => void;
  onFinish: () => void;
  finishing: boolean;
}

const STATUS_ICON: Record<StepStatus, ReactNode> = {
  done: <CheckCircle2 className="h-4 w-4 text-success" />,
  skipped: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
  todo: <Circle className="h-4 w-4 text-muted-foreground/50" />,
};

export function ReviewStep({ input, readiness, manual, onGoToStep, onFinish, finishing }: Props) {
  const { t } = useTranslation();

  // H3 #1 — Finish guard: block until every REQUIRED step is done, and name the
  // ones still missing (was: Finish clickable at 25% with 4/6 required undone).
  const missingKeys = requiredIncompleteSteps(readiness.derived, manual);
  const canFinish = missingKeys.length === 0;

  const metric = (labelKey: string, fallback: string, value: string) => (
    <div className="rounded border p-3">
      <div className="text-xs text-muted-foreground">{t(labelKey, fallback)}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Progress headline */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {t("productOnboarding.review.progress", "Setup completeness")}
          </span>
          <span className="text-sm font-semibold">{readiness.percent}%</span>
        </div>
        <div className="h-2 w-full rounded bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${readiness.percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("productOnboarding.review.requiredSummary", {
            defaultValue: "{{done}} of {{total}} required steps complete",
            done: readiness.requiredComplete,
            total: readiness.requiredTotal,
          })}
        </p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metric("productOnboarding.review.points", "Measurement points", String(input.pointCount))}
        {metric(
          "productOnboarding.review.withLimits",
          "Points with limits",
          `${input.pointsWithLimits}/${input.pointCount} (${readiness.limitPct}%)`,
        )}
        {metric("productOnboarding.review.fiducials", "Fiducials", String(input.fiducialCount))}
        {metric("productOnboarding.review.mappings", "Machine mappings", String(input.mappingCount))}
        {metric("productOnboarding.review.golden", "Golden samples", String(input.goldenCount))}
        {metric("productOnboarding.review.panels", "Panel definitions", String(input.panelCount))}
        {metric("productOnboarding.review.releases", "Program releases", String(input.releaseCount))}
        {metric(
          "productOnboarding.review.imageDims",
          "Image dimensions",
          input.hasImageDims ? "OK" : "—",
        )}
      </div>

      {/* Per-step checklist */}
      <div className="space-y-1">
        {PRODUCT_ONBOARDING_STEPS.filter((s) => s.key !== "review").map((s, i) => {
          const status = mergeStepStatus(s.key, readiness.derived[s.key], manual[s.key]);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onGoToStep(i)}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent text-left"
            >
              {STATUS_ICON[status]}
              <span className="flex-1">
                {t(`productOnboarding.steps.${s.key}`, s.key)}
              </span>
              {s.optional && (
                <Badge variant="outline" className="text-[10px]">
                  {t("productOnboarding.optional", "optional")}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground capitalize">
                {t(`productOnboarding.status.${status}`, status)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Finish guard: list the required steps still blocking completion. */}
      {!canFinish && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("productOnboarding.review.guardTitle", {
              defaultValue: "Còn {{count}} bước bắt buộc chưa hoàn thành",
              count: missingKeys.length,
            })}
          </div>
          <ul className="space-y-1">
            {missingKeys.map((key) => {
              const idx = PRODUCT_ONBOARDING_STEPS.findIndex((s) => s.key === key);
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onGoToStep(idx)}
                    className="flex items-center gap-2 text-left hover:underline"
                  >
                    <Circle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span>{t(`productOnboarding.steps.${key}`, key)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onFinish} disabled={finishing || !canFinish} className="gap-1">
          <CheckCircle2 className="h-4 w-4" />
          {finishing
            ? t("productOnboarding.review.finishing", "Finishing…")
            : t("productOnboarding.review.finish", "Finish setup")}
        </Button>
      </div>
    </div>
  );
}

export default ReviewStep;
