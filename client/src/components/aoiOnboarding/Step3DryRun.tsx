// W2-D — Step 3: dry-run validate a sample export. Upload a real export file
// (hot-folder mode → hotFolder.dryRun, extension-aware CSV/XML/JSON parse) or
// paste a payload (→ aoiOnboarding.dryRun). Renders the parsed canonical
// inspection; a passing dry-run is REQUIRED to sign off (admin may override
// with an audited reason).
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CheckCircle2, FileUp, Loader2, PlayCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import type { DryRunRenderModel, StepProps } from "./types";

function resultBadgeClass(result: string): string {
  if (result === "OK") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (result === "NG") return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
}

export default function Step3DryRun({ state, update, onNext, onBack, persistDraft }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [payloadText, setPayloadText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ error: string; hints: string[] } | null>(null);

  const onSuccessCommon = (summary: DryRunRenderModel) => {
    setFailure(null);
    update({ dryRunPassed: true, dryRunSummary: summary });
    toast.success(t("aoiOnboarding.step3.passed"));
    persistDraft();
  };

  const onFailureCommon = (error: string, hints: string[]) => {
    setFailure({ error, hints });
    update({ dryRunPassed: false, dryRunSummary: null });
  };

  // Path A — my router (pasted payload; JSON or raw text handed to the adapter).
  const pasteDryRun = trpc.aoiOnboarding.dryRun.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        onSuccessCommon(res.summary as DryRunRenderModel);
      } else {
        onFailureCommon(res.error, res.hints ?? []);
      }
    },
    onError: (err) => onFailureCommon(mapTrpcError(err), []),
  });

  // Path B — W2-A's hot-folder dry-run (uploaded FILE; extension-aware parse).
  const fileDryRun = trpc.hotFolder.dryRun.useMutation({
    onSuccess: (res: any) => {
      if (res?.ok) {
        const canonical = res.canonical ?? {};
        onSuccessCommon({
          serialNumber: res.summary?.serialNumber ?? canonical.serialNumber ?? "?",
          productModel: canonical.productModel ?? null,
          overallResult: res.summary?.overallResult ?? canonical.overallResult ?? "?",
          measurementCount: res.summary?.measurementCount ?? canonical.measurements?.length ?? 0,
          ngCount: res.summary?.ngCount ?? null,
          results: null,
          warnings: res.summary?.machineIdentityResolved === false ? ["NO_MACHINE_IDENTITY"] : [],
          sample: (canonical.measurements ?? []).slice(0, 5).map((m: any) => ({
            pointCode: m.pointCode ?? m.pointId ?? null,
            measuredValue: m.measuredValue ?? null,
            result: m.result,
            defectCatalogCode: m.defectCatalogCode ?? null,
          })),
          format: res.format ?? null,
        });
      } else {
        onFailureCommon(
          `${res?.stage ? `[${res.stage}] ` : ""}${res?.error ?? "dry-run failed"}`,
          ["SEE_FEED_SPEC:docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md"],
        );
      }
    },
    onError: (err) => onFailureCommon(mapTrpcError(err), []),
  });

  const busy = pasteDryRun.isPending || fileDryRun.isPending;

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPayloadText(String(reader.result ?? ""));
      setFileName(f.name);
    };
    reader.readAsText(f);
  };

  const runDryRun = () => {
    if (!state.adapterKey || !payloadText.trim()) return;
    // Uploaded file in hot-folder mode → W2-A's extension-aware parser; else my normalize path.
    if (fileName && state.ingestionMode === "hot-folder") {
      fileDryRun.mutate({
        adapterKey: state.adapterKey,
        fileName,
        content: payloadText,
        machineCode: state.machineCode,
      });
    } else {
      pasteDryRun.mutate({
        adapterKey: state.adapterKey,
        payload: payloadText,
        machineCode: state.machineCode,
      });
    }
  };

  const summary = state.dryRunSummary;
  const canProceed = state.dryRunPassed || (isAdmin && state.overrideReason.trim().length >= 5);

  /** Hint codes (server) → localized text; unknown codes fall back to the raw code. */
  const renderHint = (hint: string) => {
    const [code, detail] = hint.split(/:(.+)/, 2);
    const key = `aoiOnboarding.hints.${code}`;
    const text = t(key);
    return text === key ? hint : detail ? `${text}: ${detail}` : text;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t("aoiOnboarding.step3.sample")}</Label>
        <Textarea
          data-testid="aoi-wizard-payload"
          rows={7}
          className="font-mono text-xs"
          placeholder={t("aoiOnboarding.step3.samplePlaceholder")}
          value={payloadText}
          onChange={(e) => {
            setPayloadText(e.target.value);
            setFileName(null); // typed/edited → no longer the uploaded file
          }}
        />
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".json,.csv,.xml,.txt" className="hidden" onChange={onPickFile} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <FileUp className="h-4 w-4 mr-1" />{t("aoiOnboarding.step3.uploadFile")}
          </Button>
          {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
          <div className="flex-1" />
          <Button data-testid="aoi-wizard-run-dryrun" onClick={runDryRun} disabled={busy || !payloadText.trim() || !state.adapterKey}>
            {busy
              ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />{t("aoiOnboarding.step3.running")}</>
              : <><PlayCircle className="h-4 w-4 mr-1" />{t("aoiOnboarding.step3.run")}</>}
          </Button>
        </div>
      </div>

      {/* Failure — actionable hints */}
      {failure && (
        <Alert variant="destructive" data-testid="aoi-wizard-dryrun-error">
          <XCircle className="h-4 w-4" />
          <AlertTitle>{t("aoiOnboarding.step3.failed")}</AlertTitle>
          <AlertDescription>
            <p className="text-xs font-mono break-all">{failure.error}</p>
            {failure.hints.length > 0 && (
              <ul className="list-disc pl-4 mt-2 text-xs space-y-0.5">
                {failure.hints.map((h) => <li key={h}>{renderHint(h)}</li>)}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Success — parsed canonical inspection */}
      {state.dryRunPassed && summary && (
        <div className="rounded-lg border p-4 space-y-3" data-testid="aoi-wizard-dryrun-result">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3 mr-1" />{t("aoiOnboarding.step3.valid")}
            </Badge>
            {summary.format && <Badge variant="outline">{summary.format.toUpperCase()}</Badge>}
            <Badge className={resultBadgeClass(summary.overallResult)}>{summary.overallResult}</Badge>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t("aoiOnboarding.step3.serial")}</dt>
              <dd className="font-mono">{summary.serialNumber}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("aoiOnboarding.step3.product")}</dt>
              <dd>{summary.productModel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("aoiOnboarding.step3.points")}</dt>
              <dd>{summary.measurementCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("aoiOnboarding.step3.breakdown")}</dt>
              <dd className="text-xs">
                {summary.results
                  ? `OK ${summary.results.OK} · NG ${summary.results.NG} · NTF ${summary.results.NTF}`
                  : summary.ngCount != null
                    ? `NG ${summary.ngCount}/${summary.measurementCount}`
                    : "—"}
              </dd>
            </div>
          </dl>
          {summary.warnings.length > 0 && (
            <div className="text-xs text-amber-600 dark:text-amber-400 space-y-0.5">
              {summary.warnings.map((w) => <div key={w}>⚠ {renderHint(w)}</div>)}
            </div>
          )}
          {summary.sample && summary.sample.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t("aoiOnboarding.step3.point")}</TableHead>
                    <TableHead className="text-xs">{t("aoiOnboarding.step3.value")}</TableHead>
                    <TableHead className="text-xs">{t("aoiOnboarding.step3.result")}</TableHead>
                    <TableHead className="text-xs">{t("aoiOnboarding.step3.defect")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.sample.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{m.pointCode ?? "—"}</TableCell>
                      <TableCell className="text-xs">{m.measuredValue == null ? "—" : String(m.measuredValue)}</TableCell>
                      <TableCell><Badge className={`text-[10px] ${resultBadgeClass(m.result)}`}>{m.result}</Badge></TableCell>
                      <TableCell className="text-xs">{m.defectCatalogCode ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Admin override (audited) — only surfaced when no passing dry-run yet */}
      {!state.dryRunPassed && (
        isAdmin ? (
          <div className="rounded-lg border border-dashed p-3 space-y-1">
            <Label htmlFor="aoi-override" className="text-xs">{t("aoiOnboarding.step3.overrideLabel")}</Label>
            <Textarea
              id="aoi-override"
              data-testid="aoi-wizard-override-reason"
              rows={2}
              className="text-xs"
              placeholder={t("aoiOnboarding.step3.overridePlaceholder")}
              value={state.overrideReason}
              onChange={(e) => update({ overrideReason: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground">{t("aoiOnboarding.step3.overrideAudit")}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("aoiOnboarding.step3.mustPass")}</p>
        )
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>{t("aoiOnboarding.back")}</Button>
        <Button data-testid="aoi-wizard-step3-next" onClick={onNext} disabled={!canProceed}>
          {t("aoiOnboarding.next")}
        </Button>
      </div>
    </div>
  );
}
