// WS-2 — Wizard Step 2: test connectivity (HTTP/TCP/WS) + latency
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wifi, WifiOff, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import type { StepProps } from "./types";

export default function Step2TestConnection({ state, update, onNext, onBack }: StepProps) {
  const { t } = useTranslation();

  const testMutation = trpc.edgeDeployment.testConnection.useMutation({
    onSuccess: (res) => {
      update({ connectionTested: true, connectionOk: res.success, latencyMs: res.latencyMs });
      if (res.success) toast.success(t("onboarding.step2.ok"), { description: res.message });
      else toast.error(t("onboarding.step2.failed"), { description: res.message });
    },
    onError: (err) => {
      update({ connectionTested: true, connectionOk: false });
      toast.error(t("onboarding.step2.failed"), { description: mapTrpcError(err) });
    },
  });

  const runTest = () => {
    testMutation.mutate({
      ipAddress: state.ipAddress,
      port: state.port,
      protocol: state.protocol,
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-2">
        <div className="text-sm text-muted-foreground">
          {state.protocol.toUpperCase()} → {state.ipAddress}:{state.port}
        </div>
        <Button onClick={runTest} disabled={testMutation.isPending}>
          {testMutation.isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("onboarding.step2.testing")}</>
            : <><Wifi className="h-4 w-4 mr-2" />{t("onboarding.step2.runTest")}</>}
        </Button>

        {state.connectionTested && (
          <div className="flex items-center gap-2 pt-2">
            {state.connectionOk ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3 mr-1" />{t("onboarding.step2.reachable")}
                {state.latencyMs != null && <span className="ml-1">({state.latencyMs} ms)</span>}
              </Badge>
            ) : (
              <Badge variant="destructive"><WifiOff className="h-3 w-3 mr-1" />{t("onboarding.step2.unreachable")}</Badge>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("onboarding.step2.hint")}</p>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("onboarding.back")}</Button>
        {/* Allow continuing even on failure (offline-first); warn only. */}
        <Button onClick={onNext} disabled={!state.connectionTested}>{t("onboarding.next")}</Button>
      </div>
    </div>
  );
}
