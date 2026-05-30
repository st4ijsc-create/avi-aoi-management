// WS-2 — Wizard Step 5: verify heartbeat + deployment status (live poll)
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, AlertTriangle, Loader2 } from "lucide-react";
import type { StepProps } from "./types";

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

export default function Step5Verify({ state, onBack }: StepProps & { onDone?: () => void }) {
  const { t } = useTranslation();

  const statusQuery = trpc.edgeDeployment.getDeploymentStatus.useQuery(
    { deploymentId: state.deploymentId ?? 0 },
    { enabled: !!state.deploymentId, refetchInterval: 5000 },
  );

  const d = statusQuery.data as any;
  const isActive = d?.status === "ACTIVE";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t("onboarding.step5.deploymentStatus")}</span>
          {statusQuery.isFetching && !d
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : statusBadge(d?.status, t)}
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
          <div>{t("onboarding.step5.machine")}: {state.code}</div>
          <div>{t("onboarding.step5.deploymentId")}: {state.deploymentId}</div>
          <div>{t("onboarding.step5.packageVersion")}: {d?.packageVersion ?? "-"}</div>
          <div>{t("onboarding.step5.lastHeartbeat")}: {d?.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleString() : "-"}</div>
        </div>
        {isActive ? (
          <p className="text-sm text-green-600">{t("onboarding.step5.activeOk")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("onboarding.step5.waitingHeartbeat")}</p>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("onboarding.back")}</Button>
        <Button onClick={() => statusQuery.refetch()}>{t("onboarding.step5.refresh")}</Button>
      </div>
    </div>
  );
}
