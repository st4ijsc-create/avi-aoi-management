// W2-D — Step 5: commissioning sign-off. Shows the full config summary and a
// sign action that records who/when/what (aoi_commissioning_records + audit
// log) and flips the machine's ingest to "production".
//
// GATE IS SOFT: an un-commissioned machine STILL submits inspections — they are
// only tagged commissioning-mode by the ingest path. Signing removes the tag.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BadgeCheck, CheckCircle2, Info, Loader2, PenLine, XCircle } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import type { StepProps } from "./types";

export default function Step5SignOff({ state, update, onBack }: StepProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [note, setNote] = useState("");
  const [provisionMsg, setProvisionMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const utils = trpc.useUtils();
  const statusQuery = trpc.aoiOnboarding.status.useQuery(
    { machineId: state.machineId ?? 0 },
    { enabled: Boolean(state.machineId) },
  );

  const signOffMutation = trpc.aoiOnboarding.signOff.useMutation({
    onSuccess: (res) => {
      update({ signedOff: true });
      if (res.provisioning.attempted) {
        setProvisionMsg({ ok: res.provisioning.ok, message: res.provisioning.message });
      }
      toast.success(t("aoiOnboarding.step5.signed"));
      void utils.aoiOnboarding.status.invalidate();
      void utils.aoiOnboarding.listAoiMachines.invalidate();
    },
    onError: (err) => toast.error(t("aoiOnboarding.step5.signError"), { description: mapTrpcError(err) }),
  });

  const usingOverride = !state.dryRunPassed && state.overrideReason.trim().length >= 5;

  const rows: Array<[string, string]> = [
    [t("aoiOnboarding.step5.machine"), state.machineCode ? `${state.machineCode} — ${state.machineName ?? ""}` : "—"],
    [t("aoiOnboarding.step5.vendor"), state.adapterLabel ?? state.adapterKey ?? "—"],
    [
      t("aoiOnboarding.step5.source"),
      state.ingestionMode === "hot-folder"
        ? `${t("aoiOnboarding.step2.hotFolder")}: ${state.hotFolder.watchPath || "—"}`
        : t("aoiOnboarding.step2.httpPush"),
    ],
    [
      t("aoiOnboarding.step5.dryRun"),
      state.dryRunPassed
        ? t("aoiOnboarding.step5.dryRunPassed", {
            serial: state.dryRunSummary?.serialNumber ?? "?",
            n: state.dryRunSummary?.measurementCount ?? 0,
          })
        : usingOverride
          ? t("aoiOnboarding.step5.dryRunOverride")
          : t("aoiOnboarding.step5.dryRunMissing"),
    ],
    [
      t("aoiOnboarding.step5.credential"),
      state.keyIssued
        ? t("aoiOnboarding.step5.keyIssued", { prefix: state.keyPrefix ?? "" })
        : state.machineHasApiKey
          ? t("aoiOnboarding.step4.existingKey")
          : "—",
    ],
  ];

  const alreadyCommissioned = statusQuery.data?.commissioned === true;

  return (
    <div className="space-y-4">
      {/* Config summary */}
      <div className="rounded-lg border p-4 space-y-2" data-testid="aoi-wizard-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground shrink-0">{k}</span>
            <span className="text-right break-all">{v}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-muted-foreground">{t("aoiOnboarding.step5.currentMode")}</span>
          <span>
            {statusQuery.isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin inline" />
            ) : alreadyCommissioned || state.signedOff ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                <BadgeCheck className="h-3 w-3 mr-1" />{t("aoiOnboarding.status.production")}
              </Badge>
            ) : (
              <Badge variant="secondary">{t("aoiOnboarding.status.commissioningMode")}</Badge>
            )}
          </span>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">{t("aoiOnboarding.step5.softGateNote")}</AlertDescription>
      </Alert>

      {!state.signedOff ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="aoi-signoff-note">{t("aoiOnboarding.step5.note")}</Label>
            <Textarea
              id="aoi-signoff-note"
              data-testid="aoi-wizard-signoff-note"
              rows={2}
              placeholder={t("aoiOnboarding.step5.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {usingOverride && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>{t("aoiOnboarding.step5.overrideWarnTitle")}</AlertTitle>
              <AlertDescription className="text-xs">{state.overrideReason}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-between">
            <Button variant="outline" onClick={onBack}>{t("aoiOnboarding.back")}</Button>
            <Button
              data-testid="aoi-wizard-sign-off"
              onClick={() =>
                state.machineId &&
                signOffMutation.mutate({
                  machineId: state.machineId,
                  note: note.trim() || undefined,
                  overrideReason: usingOverride ? state.overrideReason.trim() : undefined,
                })
              }
              disabled={signOffMutation.isPending || !state.machineId}
            >
              {signOffMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{t("aoiOnboarding.step5.signing")}</>
                : <><PenLine className="h-4 w-4 mr-1" />{t("aoiOnboarding.step5.sign")}</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="aoi-wizard-signed">
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{t("aoiOnboarding.step5.doneTitle")}</AlertTitle>
            <AlertDescription className="text-xs">{t("aoiOnboarding.step5.doneDesc")}</AlertDescription>
          </Alert>
          {provisionMsg && (
            <Alert variant={provisionMsg.ok ? "default" : "destructive"}>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">{provisionMsg.message}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end">
            <Button onClick={() => navigate("/machine-registration")}>
              {t("aoiOnboarding.finish")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
