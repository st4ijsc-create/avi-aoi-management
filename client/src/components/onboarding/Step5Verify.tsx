// WS-2 — Wizard Step 5: verify heartbeat + deployment status (live poll)
// W7-D (doc 27 gap V19): honest delivery pipeline — packaged → downloaded →
// VERIFIED (device-reported sha256 matched packageHash) → active. A DEPLOYED
// reported without hash confirmation is shown as unverified, not silently green.
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, AlertTriangle, Loader2, ShieldCheck, ShieldAlert } from "lucide-react";
import type { StepProps } from "./types";
import { deriveDeploymentPipeline, type StageState } from "./step5Pipeline";

function statusBadge(status: string | undefined, t: (k: string) => string) {
  switch (status) {
    case "ACTIVE":
    case "DEPLOYED":
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />{status}</Badge>;
    case "FAILED":
    case "OUTDATED":
      return <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" />{status}</Badge>;
    default:
      return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />{status ?? t("onboarding.step5.unknown")}</Badge>;
  }
}

function StageIcon({ state }: { state: StageState }) {
  switch (state) {
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case "inProgress":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />;
    case "failed":
      return <AlertTriangle className="h-4 w-4 text-destructive" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function Step5Verify({ state, onBack }: StepProps & { onDone?: () => void }) {
  const { t } = useTranslation();

  const statusQuery = trpc.edgeDeployment.getDeploymentStatus.useQuery(
    { deploymentId: state.deploymentId ?? 0 },
    { enabled: !!state.deploymentId, refetchInterval: 5000 },
  );

  const d = statusQuery.data as any;
  const status: string | undefined = d?.status;

  // ── Honest pipeline derivation (V19) — pure helper, unit-tested ────────────
  const { stages: derivedStages, verifiedAt, unverifiedDeploy, isActive, isFailed } =
    deriveDeploymentPipeline(d);
  const verified = !!verifiedAt;

  const stageLabels: Record<string, string> = {
    packaged: t("onboarding.step5.stepPackaged"),
    downloaded: t("onboarding.step5.stepDownloaded"),
    verified: t("onboarding.step5.stepVerified"),
    active: t("onboarding.step5.stepActive"),
  };
  const stages = derivedStages.map((s) => ({ ...s, label: stageLabels[s.key] }));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("onboarding.step5.deploymentStatus")}</span>
          {statusQuery.isFetching && !d
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : statusBadge(status, t)}
        </div>

        {/* Delivery pipeline — packaged → downloaded → verified → active */}
        <div className="flex items-center gap-1 flex-wrap" data-testid="deploy-pipeline">
          {stages.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/50 px-1">→</span>}
              <span className="inline-flex items-center gap-1 text-xs rounded-md border px-2 py-1">
                <StageIcon state={s.state} />
                {s.label}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <div>{t("onboarding.step5.machine")}: {state.code}</div>
          <div>{t("onboarding.step5.deploymentId")}: {state.deploymentId}</div>
          <div>{t("onboarding.step5.packageVersion")}: {d?.packageVersion ?? "-"}</div>
          <div>{t("onboarding.step5.lastHeartbeat")}: {d?.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString() : "-"}</div>
        </div>

        {verified && (
          <p className="text-xs text-green-600 dark:text-green-400 inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t("onboarding.step5.verifiedAt")}: {new Date(verifiedAt as string).toLocaleString()}
          </p>
        )}
        {unverifiedDeploy && (
          <p className="text-xs text-amber-600 dark:text-amber-400 inline-flex items-start gap-1">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {t("onboarding.step5.unverifiedWarning")}
          </p>
        )}
        {isFailed && d?.errorMessage && (
          <p className="text-xs text-destructive break-words">
            {t("onboarding.step5.errorLabel")}: {d.errorMessage}
          </p>
        )}

        {isActive ? (
          <p className="text-sm text-green-600">{t("onboarding.step5.activeOk")}</p>
        ) : !isFailed ? (
          <p className="text-xs text-muted-foreground">{t("onboarding.step5.waitingHeartbeat")}</p>
        ) : null}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("onboarding.back")}</Button>
        <Button onClick={() => statusQuery.refetch()}>{t("onboarding.step5.refresh")}</Button>
      </div>
    </div>
  );
}
