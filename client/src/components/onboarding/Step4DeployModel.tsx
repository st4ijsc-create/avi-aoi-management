// WS-2 — Wizard Step 4: pick product + AI model, trigger packaging & deploy
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Rocket, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { StepProps } from "./types";

export default function Step4DeployModel({ state, update, onNext, onBack }: StepProps) {
  const { t } = useTranslation();

  const productsQuery = trpc.productModel.list.useQuery();
  const products = (productsQuery.data ?? []) as Array<{ id: number; code: string; name: string }>;

  const modelsQuery = trpc.aiModel.list.useQuery({ status: "READY" });
  const models = (modelsQuery.data ?? []) as Array<{ id: number; code: string; name: string; currentVersion?: string | null }>;

  const selectedModel = models.find((m) => m.id === state.modelId);

  const deployMutation = trpc.edgeDeployment.deployModel.useMutation({
    onSuccess: (data: any) => {
      update({ deploymentId: data.deploymentId, deployStatus: data.package?.status });
      if (data.package?.status === "READY") {
        toast.success(t("onboarding.step4.deployed"));
      } else {
        toast.warning(t("onboarding.step4.deployPartial"), { description: data.package?.error });
      }
    },
    onError: (err) => toast.error(t("onboarding.step4.deployError"), { description: err.message }),
  });

  const handleDeploy = () => {
    if (!state.machineId || !state.modelId) return;
    const version = selectedModel?.currentVersion;
    if (!version) {
      toast.error(t("onboarding.step4.noVersion"));
      return;
    }
    update({ modelVersion: version });
    deployMutation.mutate({
      machineId: state.machineId,
      modelId: state.modelId,
      modelVersion: version,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>{t("onboarding.step4.product")}</Label>
          <Select
            value={state.productModelId ? String(state.productModelId) : undefined}
            onValueChange={(v) => update({ productModelId: parseInt(v, 10) })}
          >
            <SelectTrigger><SelectValue placeholder={t("onboarding.step4.selectProduct")} /></SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t("onboarding.step4.model")}</Label>
          <Select
            value={state.modelId ? String(state.modelId) : undefined}
            onValueChange={(v) => update({ modelId: parseInt(v, 10) })}
          >
            <SelectTrigger><SelectValue placeholder={t("onboarding.step4.selectModel")} /></SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.code} {m.currentVersion ? `(${m.currentVersion})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!state.deploymentId ? (
        <Button onClick={handleDeploy} disabled={deployMutation.isPending || !state.modelId}>
          {deployMutation.isPending
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("onboarding.step4.deploying")}</>
            : <><Rocket className="h-4 w-4 mr-2" />{t("onboarding.step4.deploy")}</>}
        </Button>
      ) : (
        <div className="rounded-lg border p-4">
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t("onboarding.step4.deploymentCreated", { id: state.deploymentId })}
          </Badge>
          <p className="text-xs text-muted-foreground mt-2">{t("onboarding.step4.notifyHint")}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("onboarding.back")}</Button>
        <Button onClick={onNext} disabled={!state.deploymentId}>{t("onboarding.next")}</Button>
      </div>
    </div>
  );
}
