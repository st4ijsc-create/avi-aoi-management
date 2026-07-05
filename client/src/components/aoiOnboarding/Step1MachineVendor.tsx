// W2-D — Step 1: pick an existing AOI/AVI machine + the vendor adapter.
// Adapters are listed DYNAMICALLY from the vision registry (visionAdapter.listAdapters)
// — no vendor names are hardcoded. Optional description/confidence fields added by
// W2-B are rendered defensively when present.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, History, Loader2, Plus } from "lucide-react";
import { applySnapshot, type AoiDraftSnapshot, type StepProps } from "./types";

/** W2-B may enrich adapters with description/confidence — render when present. */
interface AdapterEntry {
  vendorKey: string;
  label: string;
  description?: string;
  confidence?: string;
}

export default function Step1MachineVendor({ state, update, onNext, goToStep }: StepProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const machinesQuery = trpc.aoiOnboarding.listAoiMachines.useQuery(undefined, {
    staleTime: 30_000,
  });
  const adaptersQuery = trpc.visionAdapter.listAdapters.useQuery(undefined, {
    staleTime: 60_000,
  });
  const draftQuery = trpc.aoiOnboarding.getDraft.useQuery(
    { machineId: state.machineId ?? 0 },
    { enabled: Boolean(state.machineId) },
  );

  const machines = machinesQuery.data ?? [];
  const adapters: AdapterEntry[] = (adaptersQuery.data?.adapters ?? []) as AdapterEntry[];

  const draft = draftQuery.data;
  const draftSnapshot = (draft?.configSnapshot ?? null) as AoiDraftSnapshot | null;
  const showResume = Boolean(draft && draftSnapshot && !resumeDismissed);

  const onSelectMachine = (idStr: string) => {
    const m = machines.find((x) => String(x.id) === idStr);
    if (!m) return;
    setResumeDismissed(false);
    update({
      machineId: m.id,
      machineCode: m.code,
      machineName: m.name,
      machineHasApiKey: m.hasApiKey,
    });
  };

  const onResume = () => {
    if (!draftSnapshot) return;
    update(applySnapshot(draftSnapshot));
    setResumeDismissed(true);
    goToStep(Math.min(Math.max(draftSnapshot.step ?? 0, 0), 4));
  };

  const selectedAdapter = adapters.find((a) => a.vendorKey === state.adapterKey);

  return (
    <div className="space-y-4">
      {/* Machine picker */}
      <div className="space-y-2">
        <Label>{t("aoiOnboarding.step1.machine")}</Label>
        {machinesQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{t("aoiOnboarding.loading")}
          </div>
        ) : (
          <Select value={state.machineId ? String(state.machineId) : undefined} onValueChange={onSelectMachine}>
            <SelectTrigger data-testid="aoi-wizard-machine-select">
              <SelectValue placeholder={t("aoiOnboarding.step1.selectMachine")} />
            </SelectTrigger>
            <SelectContent>
              {machines.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  <span className="inline-flex items-center gap-2">
                    {m.code} — {m.name}
                    <Badge variant="outline" className="text-[10px]">{m.machineType}</Badge>
                    {m.commissioningStatus === "commissioned" && (
                      <Badge className="text-[10px] bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                        {t("aoiOnboarding.status.commissioned")}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {machines.length === 0 && !machinesQuery.isLoading && (
          <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step1.noMachines")}</p>
        )}
        <Button variant="link" size="sm" className="px-0" onClick={() => navigate("/machine-onboarding")}>
          <Plus className="h-3 w-3 mr-1" />{t("aoiOnboarding.step1.createMachine")}
        </Button>
      </div>

      {/* Resume banner (draft exists for the selected machine) */}
      {showResume && (
        <Alert data-testid="aoi-wizard-resume-banner">
          <History className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-2 w-full">
            <span>{t("aoiOnboarding.step1.resumeHint")}</span>
            <span className="flex gap-2 shrink-0">
              <Button size="sm" onClick={onResume}>{t("aoiOnboarding.step1.resume")}</Button>
              <Button size="sm" variant="outline" onClick={() => setResumeDismissed(true)}>
                {t("aoiOnboarding.step1.startFresh")}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* Vendor adapter picker — DYNAMIC from the registry */}
      <div className="space-y-2">
        <Label>{t("aoiOnboarding.step1.vendor")}</Label>
        {adaptersQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{t("aoiOnboarding.loading")}
          </div>
        ) : adaptersQuery.isError ? (
          <p className="text-xs text-destructive">{t("aoiOnboarding.step1.adaptersUnavailable")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {adapters.map((a) => (
              <button
                key={a.vendorKey}
                type="button"
                data-testid={`aoi-wizard-adapter-${a.vendorKey}`}
                onClick={() => update({ adapterKey: a.vendorKey, adapterLabel: a.label })}
                className={
                  "rounded-lg border p-3 text-left transition-colors hover:bg-accent " +
                  (state.adapterKey === a.vendorKey ? "border-primary ring-1 ring-primary" : "")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{a.label}</span>
                  <span className="flex items-center gap-1">
                    {a.confidence && (
                      <Badge variant="secondary" className="text-[10px]">{a.confidence}</Badge>
                    )}
                    {state.adapterKey === a.vendorKey && <CheckCircle2 className="h-4 w-4 text-primary" />}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.description ?? a.vendorKey}
                </div>
              </button>
            ))}
          </div>
        )}
        {selectedAdapter && (
          <p className="text-xs text-muted-foreground">
            {t("aoiOnboarding.step1.selectedAdapter", { adapter: selectedAdapter.label })}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          data-testid="aoi-wizard-step1-next"
          onClick={onNext}
          disabled={!state.machineId || !state.adapterKey}
        >
          {t("aoiOnboarding.next")}
        </Button>
      </div>
    </div>
  );
}
