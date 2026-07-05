import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Database } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

/**
 * W7-B (doc 27 gap V2, Đợt 7 item 7.2) — "Máy hay báo giả" agreement card.
 *
 * COMPLEMENTARY to W5-A's FalseCallEscapePanel directly above it in the
 * QualityCockpit: that panel reads inspection-row NTF flips only; this card
 * reads the HARVESTED corrections ledger (measurement_corrections) plus
 * verdict flips — per-machine false-call ranking, agreement rate and the
 * count of labels banked for training (the V2 learning loop).
 *
 * Chart discipline: ONE axis — only the daily false-call rate (%) is plotted
 * (correction counts are a different scale and live in the table). The rate
 * keeps the same orange as the panel above (same entity, same hue).
 */

export interface FalseCallTrendScope {
  machineId?: number;
  startDate: string;
  endDate: string;
}

const FALSE_CALL_LINE = "#f97316"; // same entity color as FalseCallEscapePanel

export function FalseCallTrendCard({ scope }: { scope: FalseCallTrendScope }) {
  const { t } = useTranslation();

  const { data: summary, isLoading: loadingSummary } =
    trpc.measurementCorrections.machineFalseCallSummary.useQuery({
      machineId: scope.machineId,
      startDate: scope.startDate,
      endDate: scope.endDate,
      limit: 6,
    });
  const { data: trend, isLoading: loadingTrend } =
    trpc.measurementCorrections.agreementTrend.useQuery({
      machineId: scope.machineId,
      startDate: scope.startDate,
      endDate: scope.endDate,
    });

  if (loadingSummary || loadingTrend) {
    return <Skeleton className="h-[240px] w-full" />;
  }

  const totalHarvested = (summary ?? []).reduce((acc, r) => acc + r.correctionsHarvested, 0);
  const hasData = (summary?.length ?? 0) > 0 || (trend?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database className="h-4 w-4" />
            {t("qualityCockpit.corrections.title")}
          </CardTitle>
          <Badge variant="secondary" className="gap-1">
            {t("qualityCockpit.corrections.harvestedCount", { count: totalHarvested })}
          </Badge>
        </div>
        <CardDescription>{t("qualityCockpit.corrections.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {t("qualityCockpit.corrections.noData")}
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Per-machine ranking — worst false-call rate first */}
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="p-2">{t("qualityCockpit.corrections.colMachine")}</TableHead>
                    <TableHead className="p-2 text-right">{t("qualityCockpit.corrections.colFalseCallRate")}</TableHead>
                    <TableHead className="p-2 text-right">{t("qualityCockpit.corrections.colNgCalls")}</TableHead>
                    <TableHead className="p-2 text-right">{t("qualityCockpit.corrections.colAgreement")}</TableHead>
                    <TableHead className="p-2 text-right">{t("qualityCockpit.corrections.colHarvested")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(summary ?? []).map((row) => (
                    <TableRow key={row.machineId}>
                      <TableCell className="p-2 font-medium">
                        {row.machineName ?? row.machineCode ?? `#${row.machineId}`}
                      </TableCell>
                      <TableCell className="p-2 text-right text-orange-500 font-semibold">
                        {row.falseCallRate != null ? `${row.falseCallRate.toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="p-2 text-right text-muted-foreground">{row.ngCalls}</TableCell>
                      <TableCell className="p-2 text-right text-muted-foreground">
                        {row.agreementRate != null ? `${row.agreementRate.toFixed(1)}%` : "—"}
                      </TableCell>
                      <TableCell className="p-2 text-right text-muted-foreground">{row.correctionsHarvested}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Daily false-call-rate trend (single series, single axis) */}
            <div className="h-[200px]">
              {(trend?.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      formatter={(value: any) => [
                        value != null ? `${Number(value).toFixed(2)}%` : "—",
                        t("qualityCockpit.corrections.trendSeries"),
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="falseCallRate"
                      name={t("qualityCockpit.corrections.trendSeries")}
                      stroke={FALSE_CALL_LINE}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  {t("qualityCockpit.corrections.noTrendData")}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default FalseCallTrendCard;
