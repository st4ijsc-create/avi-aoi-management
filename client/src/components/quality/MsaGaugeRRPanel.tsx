import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FlaskConical, Play } from "lucide-react";

const SAMPLE = `A,1,1,10.02
A,1,2,10.03
A,2,1,10.55
A,2,2,10.54
A,3,1,9.80
A,3,2,9.82
B,1,1,10.01
B,1,2,10.04
B,2,1,10.53
B,2,2,10.55
B,3,1,9.79
B,3,2,9.83`;

function verdictBadge(v: string) {
  const map: Record<string, string> = {
    good: "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    acceptable: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    poor: "border-transparent bg-destructive/15 text-destructive",
    insufficient_data: "border-transparent bg-muted text-muted-foreground",
  };
  return <Badge className={map[v] ?? "border-transparent bg-muted text-muted-foreground"}>{v}</Badge>;
}

// Advanced MSA (Gauge R&R via ANOVA) — surfaces the orphaned `msaAdvanced`
// router. The engine is stateless: it takes operator/part/trial/value
// observations (CSV) and returns AIAG variance components.
export function MsaGaugeRRPanel() {
  const { t } = useTranslation();
  const [csv, setCsv] = useState(SAMPLE);
  const [tolerance, setTolerance] = useState("");
  const [result, setResult] = useState<any | null>(null);

  const anovaMutation = trpc.msaAdvanced.anovaGrr.useMutation({
    onSuccess: (d) => {
      setResult(d);
      if ((d as any)?.verdict === "insufficient_data") {
        toast.warning(t("msaAdvanced.insufficient"));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const run = () => {
    const observations: Array<{ operator: string; part: string; trial: number; value: number }> = [];
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(/[,\t]/).map((s) => s.trim());
      if (parts.length < 4) continue;
      const [operator, part, trialStr, valStr] = parts;
      const trial = Number(trialStr);
      const value = Number(valStr);
      if (!operator || !part || !Number.isFinite(trial) || !Number.isFinite(value)) continue;
      observations.push({ operator, part, trial, value });
    }
    if (observations.length < 4) {
      toast.error(t("msaAdvanced.needRows"));
      return;
    }
    const tol = Number(tolerance);
    anovaMutation.mutate({
      observations,
      tolerance: tolerance.trim() && Number.isFinite(tol) && tol > 0 ? tol : undefined,
    });
  };

  const pct = (v: any) => (v == null ? "—" : `${Number(v).toFixed(2)}%`);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            {t("msaAdvanced.title")}
          </CardTitle>
          <CardDescription>{t("msaAdvanced.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("msaAdvanced.observations")}</Label>
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={10}
              className="font-mono text-xs"
              placeholder="operator,part,trial,value"
            />
            <p className="text-xs text-muted-foreground">{t("msaAdvanced.formatHint")}</p>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label>{t("msaAdvanced.tolerance")}</Label>
              <Input
                type="number"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                placeholder={t("common.optional")}
                className="w-40"
              />
            </div>
            <Button onClick={run} disabled={anovaMutation.isPending} className="gap-2">
              <Play className="h-4 w-4" />
              {anovaMutation.isPending ? t("common.loading") : t("msaAdvanced.run")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t("msaAdvanced.results")}</CardTitle>
              {verdictBadge(result.verdict)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <Metric label={t("msaAdvanced.grrPct")} value={pct(result.grrPct)} highlight />
              <Metric label={t("msaAdvanced.evPct")} value={pct(result.evPct)} />
              <Metric label={t("msaAdvanced.avPct")} value={pct(result.avPct)} />
              <Metric label={t("msaAdvanced.pvPct")} value={pct(result.pvPct)} />
              <Metric label="NDC" value={result.ndc ?? "—"} />
              {result.ptRatio != null && (
                <Metric label={t("msaAdvanced.ptRatio")} value={pct(result.ptRatio)} />
              )}
            </div>
            {Array.isArray(result.notes) && result.notes.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                {result.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {t("msaAdvanced.gradeHint")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "bg-muted/40" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default MsaGaugeRRPanel;
