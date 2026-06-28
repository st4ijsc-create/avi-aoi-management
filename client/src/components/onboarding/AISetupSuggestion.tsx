// LUỒNG ① — AI Setup Advisor card for the onboarding wizard.
//
// Shows AFTER the machine type (+ optional product) is chosen. Calls
// aiSetupAdvisor.suggestSetup and renders a DECISION-READY summary of the
// proposed config from the most similar template machine. "✅ Dùng & tiếp tục"
// writes the bundle into the wizard state (pre-filling station + recommended
// model + the review lists); "Bỏ qua, nhập tay" keeps everything manual.
//
// Advisory only: nothing is created here. The technician still approves each
// step via the wizard's EXISTING RBAC'd create mutations.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sparkles, Loader2, ChevronDown, CheckCircle2, Info, Database, Copy as CopyIcon,
} from "lucide-react";
import type { StepProps, AISetupBundle } from "./types";

function sourceBadge(t: (k: string) => string, source: "data" | "copied" | "default") {
  if (source === "data") {
    return (
      <Badge variant="outline" className="text-green-700 border-green-300 dark:text-green-400">
        <Database className="h-3 w-3 mr-1" />{t("onboarding.aiSetup.srcData")}
      </Badge>
    );
  }
  if (source === "copied") {
    return (
      <Badge variant="outline" className="text-blue-700 border-blue-300 dark:text-blue-400">
        <CopyIcon className="h-3 w-3 mr-1" />{t("onboarding.aiSetup.srcCopied")}
      </Badge>
    );
  }
  return <Badge variant="outline">{t("onboarding.aiSetup.srcDefault")}</Badge>;
}

export default function AISetupSuggestion({ state, update }: StepProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const enabled = state.machineType != null && !skipped && !applied;

  const query = trpc.aiSetupAdvisor.suggestSetup.useQuery(
    {
      machineType: state.machineType,
      productModelId: state.productModelId,
      targetMachineId: state.machineId,
    },
    { enabled, staleTime: 60_000, retry: false },
  );

  const bundle = query.data?.bundle as AISetupBundle | undefined;

  const apply = () => {
    if (!bundle) return;
    update({
      aiBundle: bundle,
      recommendedModelCode: bundle.model.code,
      // Pre-fill the station suggestion so Step 3 starts on the right station.
      ...(bundle.stationSuggestion.stationId != null
        ? { stationId: bundle.stationSuggestion.stationId }
        : {}),
    });
    setApplied(true);
  };

  // Already applied → compact confirmation.
  if (applied && bundle) {
    return (
      <Card className="border-green-300 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
        <CardContent className="py-3 flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span>
            {t("onboarding.aiSetup.appliedSummary", {
              points: bundle.summary.points,
              ng: bundle.summary.ngThresholds,
            })}
          </span>
        </CardContent>
      </Card>
    );
  }

  if (skipped) return null;

  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t("onboarding.aiSetup.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("onboarding.aiSetup.loading")}
          </div>
        )}

        {/* Flag off / degraded / no template → friendly note, manual still works */}
        {!query.isLoading && bundle && (bundle.disabled || bundle.degraded || !bundle.templateMachine) && (
          <div className="rounded-md bg-muted/60 p-3 text-sm flex gap-2">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-muted-foreground">
                {bundle.disabled
                  ? t("onboarding.aiSetup.unavailable")
                  : t("onboarding.aiSetup.noTemplate")}
              </p>
              {bundle.notes?.[0] && (
                <p className="text-xs text-muted-foreground">{bundle.notes[0]}</p>
              )}
            </div>
          </div>
        )}

        {/* Healthy bundle → decision-ready summary */}
        {!query.isLoading && bundle && bundle.templateMachine && !bundle.disabled && !bundle.degraded && (
          <>
            <p className="text-sm">
              {t("onboarding.aiSetup.basedOn")}{" "}
              <span className="font-medium">
                {bundle.templateMachine.code ?? `#${bundle.templateMachine.id}`}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">{bundle.similarityReason}</p>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">
                {t("onboarding.aiSetup.countPoints", { n: bundle.summary.points })}
              </Badge>
              <Badge variant="secondary">
                {t("onboarding.aiSetup.countThresholds", {
                  total: bundle.summary.points,
                  data: bundle.summary.thresholdsFromData,
                  copied: bundle.summary.thresholdsCopied,
                })}
              </Badge>
              <Badge variant="secondary">
                {t("onboarding.aiSetup.countNg", { n: bundle.summary.ngThresholds })}
              </Badge>
              <Badge variant="secondary">
                {t("onboarding.aiSetup.modelLabel", { model: bundle.model.code })}
              </Badge>
            </div>

            {/* Per-item expand */}
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  <ChevronDown
                    className={`h-3 w-3 mr-1 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                  {t("onboarding.aiSetup.viewDetails")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                <div className="rounded-md border divide-y text-xs">
                  {bundle.points.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium">{p.code ?? p.name ?? `#${i + 1}`}</span>
                        <span className="text-muted-foreground ml-2">
                          {p.lsl ?? "—"} / {p.target ?? "—"} / {p.usl ?? "—"}
                          {p.unit ? ` ${p.unit}` : ""}
                        </span>
                      </div>
                      {sourceBadge(t, p.source)}
                    </div>
                  ))}
                  {bundle.points.length === 0 && (
                    <div className="px-3 py-2 text-muted-foreground">
                      {t("onboarding.aiSetup.noPoints")}
                    </div>
                  )}
                </div>
                {bundle.notes.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                    {bundle.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
              </CollapsibleContent>
            </Collapsible>
          </>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {bundle && bundle.templateMachine && !bundle.disabled && !bundle.degraded && (
            <Button size="sm" onClick={apply}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {t("onboarding.aiSetup.useAndContinue")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSkipped(true)}>
            {t("onboarding.aiSetup.skip")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
