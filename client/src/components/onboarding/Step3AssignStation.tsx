// WS-2 — Wizard Step 3: assign to a station, create machine + grant apiKey (approve)
// Doc 27 Đợt 5 / W5-E — gap F3: re-check the code server-side right before the
// create call (time may have passed since Step 1) so duplicates surface as a
// clear field-level message, not only as the raw server-error toast.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Copy, KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import type { StepProps } from "./types";

export default function Step3AssignStation({ state, update, onNext, onBack }: StepProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const stationsQuery = trpc.station.list.useQuery();
  const stations = (stationsQuery.data ?? []) as Array<{ id: number; code: string; name: string }>;
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [prechecking, setPrechecking] = useState(false);

  // Creating an approved machine grants the apiKey in one step.
  const createMutation = trpc.machine.create.useMutation({
    onSuccess: (data: any) => {
      update({ machineId: data.id, apiKey: data.apiKey, approved: true });
      toast.success(t("onboarding.step3.granted"));
    },
    onError: (err) => toast.error(t("onboarding.step3.createError"), { description: mapTrpcError(err) }),
  });

  const handleCreate = async () => {
    if (!state.stationId) {
      toast.error(t("onboarding.step3.selectStation"));
      return;
    }
    // F3 pre-check — advisory only; the server still enforces CONFLICT on races.
    setPrecheckError(null);
    setPrechecking(true);
    try {
      const check = await utils.machine.checkCode.fetch({ code: state.code.trim() });
      if (!check.available) {
        const msg = t("onboarding.validation.codeTaken", {
          name: check.holder?.name ?? check.holder?.code ?? "",
        });
        setPrecheckError(msg);
        toast.error(msg);
        return;
      }
    } catch {
      // Pre-check failing (network etc.) must not block creation — the server
      // create path is the source of truth.
    } finally {
      setPrechecking(false);
    }
    createMutation.mutate({
      stationId: state.stationId,
      code: state.code,
      name: state.name,
      machineType: state.machineType,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("onboarding.step3.station")}</Label>
        <Select
          value={state.stationId ? String(state.stationId) : undefined}
          onValueChange={(v) => update({ stationId: parseInt(v, 10) })}
          disabled={state.approved}
        >
          <SelectTrigger><SelectValue placeholder={t("onboarding.step3.selectStation")} /></SelectTrigger>
          <SelectContent>
            {stations.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.code} — {s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!state.approved ? (
        <div className="space-y-2">
          <Button onClick={handleCreate} disabled={createMutation.isPending || prechecking || !state.stationId}>
            {createMutation.isPending || prechecking
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("onboarding.step3.creating")}</>
              : <><KeyRound className="h-4 w-4 mr-2" />{t("onboarding.step3.createAndApprove")}</>}
          </Button>
          {precheckError && <p className="text-xs text-destructive">{precheckError}</p>}
        </div>
      ) : (
        <div className="rounded-lg border p-4 space-y-2">
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />{t("onboarding.step3.approved")}
          </Badge>
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted px-2 py-1 rounded break-all flex-1">{state.apiKey}</code>
            <Button size="sm" variant="outline" onClick={() => {
              navigator.clipboard.writeText(state.apiKey ?? "");
              toast.success(t("onboarding.step3.copied"));
            }}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("onboarding.step3.apiKeyHint")}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("onboarding.back")}</Button>
        <Button onClick={onNext} disabled={!state.approved}>{t("onboarding.next")}</Button>
      </div>
    </div>
  );
}
