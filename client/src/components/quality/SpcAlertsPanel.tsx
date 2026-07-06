import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertOctagon, BellRing, CheckCircle2, Target } from "lucide-react";

interface SpcScope {
  productModelId?: number;
  startDate: string;
  endDate: string;
}

function fmtTs(d: any): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString();
}

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    critical: "border-transparent bg-destructive/15 text-destructive",
    warn: "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
    info: "border-transparent bg-muted text-muted-foreground",
  };
  return <Badge className={map[sev] ?? "border-transparent bg-muted text-muted-foreground"}>{sev}</Badge>;
}

// SPC out-of-control alerts (mp_spc_alerts) + top defect measurement points
// (mpDefectStats) — surfaces two orphaned routers into the cockpit.
export function SpcAlertsPanel({ scope }: { scope: SpcScope }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [unackedOnly, setUnackedOnly] = useState(true);

  const alertsQuery = trpc.spcAlerts.list.useQuery(
    { unackedOnly, limit: 100 },
    { refetchInterval: 30000 },
  );

  const ackMutation = trpc.spcAlerts.ack.useMutation({
    onSuccess: () => {
      toast.success(t("spcAlerts.acked"));
      void utils.spcAlerts.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const defectStatsQuery = trpc.mpDefectStats.byProductModel.useQuery(
    { productModelId: scope.productModelId ?? 0, lastNDays: 30 },
    { enabled: !!scope.productModelId },
  );

  const topDefects = (defectStatsQuery.data ?? [])
    .slice()
    .sort((a: any, b: any) => (b.ngCount ?? 0) - (a.ngCount ?? 0))
    .slice(0, 10);

  const alerts = alertsQuery.data ?? [];
  const unackedCount = (alerts as any[]).filter((a) => !a.ackAt).length;

  return (
    <div className="space-y-4">
      {/* SPC OOC alerts */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <BellRing className="h-4 w-4" />
                {t("spcAlerts.title")}
                {unackedCount > 0 && (
                  <Badge variant="destructive">{unackedCount}</Badge>
                )}
              </CardTitle>
              <CardDescription>{t("spcAlerts.subtitle")}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnackedOnly((v) => !v)}
            >
              {unackedOnly ? t("spcAlerts.showAll") : t("spcAlerts.showUnacked")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {alertsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : alertsQuery.isError ? (
            <p className="text-sm text-destructive">{alertsQuery.error.message}</p>
          ) : alerts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {t("spcAlerts.none")}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("spcAlerts.rule")}</TableHead>
                  <TableHead>{t("spcAlerts.severity")}</TableHead>
                  <TableHead>{t("spcAlerts.point")}</TableHead>
                  <TableHead>{t("spcAlerts.window")}</TableHead>
                  <TableHead>{t("spcAlerts.detectedAt")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(alerts as any[]).map((a) => (
                  <TableRow key={a.id} className={a.ackAt ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        <AlertOctagon className="h-3.5 w-3.5 text-destructive" />
                        {a.ruleName}
                        <span className="text-xs text-muted-foreground">({a.ruleCode})</span>
                      </span>
                    </TableCell>
                    <TableCell>{severityBadge(a.severity)}</TableCell>
                    <TableCell className="tabular-nums">#{a.pointDefId}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtTs(a.windowFrom)} → {fmtTs(a.windowTo)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtTs(a.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      {a.ackAt ? (
                        <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          {t("spcAlerts.ackedShort")}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={ackMutation.isPending}
                          onClick={() => ackMutation.mutate({ id: a.id })}
                        >
                          {t("spcAlerts.ack")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Top defect measurement points */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4" />
            {t("mpDefectStats.title")}
          </CardTitle>
          <CardDescription>{t("mpDefectStats.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {!scope.productModelId ? (
            <p className="text-sm text-muted-foreground">{t("mpDefectStats.selectProduct")}</p>
          ) : defectStatsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : defectStatsQuery.isError ? (
            <p className="text-sm text-destructive">{defectStatsQuery.error.message}</p>
          ) : topDefects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("mpDefectStats.none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("mpDefectStats.point")}</TableHead>
                  <TableHead className="text-right">{t("mpDefectStats.ngCount")}</TableHead>
                  <TableHead className="text-right">{t("mpDefectStats.total")}</TableHead>
                  <TableHead className="text-right">{t("mpDefectStats.defectRate")}</TableHead>
                  <TableHead>{t("mpDefectStats.topDefects")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topDefects.map((d: any) => (
                  <TableRow key={d.pointDefId}>
                    <TableCell className="font-medium">{d.code ?? `#${d.pointDefId}`}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.ngCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{d.totalCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.defectRate != null ? `${(Number(d.defectRate) * 100).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(d.topDefects ?? []).slice(0, 3).map((td: any) => td.name ?? td.code).filter(Boolean).join(", ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default SpcAlertsPanel;
