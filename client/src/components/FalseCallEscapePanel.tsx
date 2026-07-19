import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, AlertTriangle, Info } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/**
 * Doc 27 gap A9 (W5-A) — paired false-call ↔ escape KPI panel.
 *
 * Shows the core AOI tuning trade-off side by side:
 *  - falseCallRate = NTF / machine NG calls (human-verify proxy — the honest
 *    rename of the old NTF/total "retestRate");
 *  - escapeRate    = escaped serials / defective serials from station_traces
 *    (product+window scope only — traces have no machine/line linkage).
 * Plus a daily trend of both rates (factory-local days), a tuning hint and
 * the NTF threshold level from yield_alert_thresholds (VISUAL only — no
 * push-alert path exists for this metric; see falseCallEscapeService.ts).
 */

export interface FalseCallEscapeScope {
  machineId?: number;
  productModelId?: number;
  startDate: string;
  endDate: string;
}

const HINT_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  overSensitive: "destructive",
  underSensitive: "destructive",
  processDrift: "destructive",
  improving: "secondary",
  stable: "secondary",
  insufficientData: "outline",
};

export function FalseCallEscapePanel({ scope }: { scope: FalseCallEscapeScope }) {
  const { t } = useTranslation();

  const { data, isLoading } = trpc.productionDashboard.getFalseCallEscape.useQuery({
    machineId: scope.machineId,
    productModelId: scope.productModelId,
    startDate: scope.startDate,
    endDate: scope.endDate,
  });

  // Merge both daily series on the factory-local day key for the chart.
  const chartData = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, { day: string; falseCallRate?: number | null; escapeRate?: number | null }>();
    for (const p of data.falseCall.trend) {
      byDay.set(p.day, { day: p.day, falseCallRate: p.falseCallRate });
    }
    for (const p of data.escape.trend) {
      const row = byDay.get(p.day) ?? { day: p.day };
      row.escapeRate = p.escapeRate;
      byDay.set(p.day, row);
    }
    const sorted = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
    // doc65 PRO-100: trục category — ngày TRỐNG phải được chèn (null) để khoảng cách tick
    // tỷ lệ với thời gian thật; thiếu nó, gap 14–18/07 bị nén thành 1 bước → dốc trend cuối
    // trông sai. connectNulls trên 2 Line đã có sẵn nên đường vẫn liền.
    if (sorted.length > 1) {
      const filled: typeof sorted = [];
      const first = new Date(sorted[0].day + "T00:00:00");
      const last = new Date(sorted[sorted.length - 1].day + "T00:00:00");
      for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        filled.push(byDay.get(key) ?? { day: key });
      }
      return filled;
    }
    return sorted;
  }, [data]);

  if (isLoading) {
    return <Skeleton className="h-[220px] w-full" />;
  }
  if (!data) return null;

  const fc = data.falseCall;
  const esc = data.escape;
  const thresholdLevel = data.threshold.level;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {t("qualityCockpit.fce.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            {thresholdLevel && thresholdLevel !== "ok" && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t(`qualityCockpit.fce.threshold.${thresholdLevel}`, {
                  warning: data.threshold.warning,
                  critical: data.threshold.critical,
                })}
              </Badge>
            )}
            <Badge variant={HINT_BADGE_VARIANT[data.tuningHint] ?? "outline"}>
              {t(`qualityCockpit.fce.hint.${data.tuningHint}`)}
            </Badge>
          </div>
        </div>
        <CardDescription>{t("qualityCockpit.fce.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Paired tiles */}
          <div className="space-y-3">
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{t("qualityCockpit.fce.falseCallRate")}</p>
                {thresholdLevel && (
                  <span
                    className={
                      thresholdLevel === "critical"
                        ? "h-2 w-2 rounded-full bg-destructive"
                        : thresholdLevel === "warning"
                          ? "h-2 w-2 rounded-full bg-warning"
                          : "h-2 w-2 rounded-full bg-success"
                    }
                  />
                )}
              </div>
              <p className="text-2xl font-bold text-orange-500">
                {fc.falseCallRate != null ? `${fc.falseCallRate.toFixed(2)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("qualityCockpit.fce.falseCallDetail", {
                  falseCalls: fc.falseCalls,
                  ngCalls: fc.machineNgCalls,
                })}
              </p>
            </div>
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground">{t("qualityCockpit.fce.escapeRate")}</p>
              {/* doc65 V1: đỏ CHỈ khi có giá trị thật — "—" (no-data) phải trung tính,
                  đỏ là màu báo động không phải placeholder. */}
              <p className={`text-2xl font-bold ${esc.available && esc.escapeRate != null ? "text-red-500" : "text-muted-foreground"}`}>
                {esc.available && esc.escapeRate != null ? `${esc.escapeRate.toFixed(2)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {esc.available
                  ? t("qualityCockpit.fce.escapeDetail", {
                      escaped: esc.escapedSerials,
                      defective: esc.defectSerials,
                    })
                  : t("qualityCockpit.fce.escapeUnavailable")}
              </p>
              {esc.available && scope.machineId && (
                <p className="text-[10px] text-muted-foreground italic mt-1 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  {t("qualityCockpit.fce.escapeScopeNote")}
                </p>
              )}
            </div>
          </div>

          {/* Paired trend */}
          <div className="lg:col-span-2 h-[220px]">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  {/* doc65 PRO-100: trục ngày dd/MM đồng bộ filter vi-VN */}
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d)); return m ? `${m[3]}/${m[2]}` : String(d); }} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip
                    formatter={(value: any, name: string) => [
                      value != null ? `${Number(value).toFixed(2)}%` : "—",
                      name,
                    ]}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="falseCallRate"
                    name={t("qualityCockpit.fce.falseCallRate")}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="escapeRate"
                    name={t("qualityCockpit.fce.escapeRate")}
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                {t("qualityCockpit.fce.noTrendData")}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default FalseCallEscapePanel;
