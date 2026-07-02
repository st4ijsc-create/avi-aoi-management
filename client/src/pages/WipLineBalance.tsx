import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { RelatedViews } from "@/components/RelatedViews";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Boxes,
  Gauge,
  Clock,
  AlertTriangle,
  RefreshCw,
  ListOrdered,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { chartColor, chartTooltipStyle, chartGridProps, chartAxisTick } from "@/components/patterns";

// WIP status → themed colour. Semantically-loaded statuses map onto the shared
// status tokens (blocked→destructive, starved/on_hold→warning, completed→success);
// the rest fall back to the categorical chart palette so charts follow the theme.
const STATUS_COLORS: Record<string, string> = {
  queued: "var(--muted-foreground)",
  in_process: "var(--info)",
  completed: "var(--success)",
  blocked: "var(--destructive)",
  starved: "var(--warning)",
  scrapped: "var(--chart-5)",
  on_hold: "var(--warning)",
};

function reasonLabel(t: (k: string, d: string) => string, code: string): string {
  const map: Record<string, [string, string]> = {
    clear_blocked: ["wipDashboard.reasonClearBlocked", "Giải toả nghẽn"],
    feed_starved_bottleneck: ["wipDashboard.reasonFeedStarved", "Nạp nút thắt đói"],
    at_bottleneck: ["wipDashboard.reasonAtBottleneck", "Tại nút thắt"],
    high_priority: ["wipDashboard.reasonHighPriority", "Ưu tiên cao"],
    aging: ["wipDashboard.reasonAging", "Chờ lâu"],
    due_soon: ["wipDashboard.reasonDueSoon", "Sắp tới hạn"],
    overdue: ["wipDashboard.reasonOverdue", "Quá hạn"],
    fifo: ["wipDashboard.reasonFifo", "FIFO"],
  };
  const entry = map[code];
  return entry ? t(entry[0], entry[1]) : code;
}

export default function WipLineBalance() {
  const { t } = useTranslation();
  const [lineInput, setLineInput] = useState("");
  const lineId = lineInput.trim() ? Number(lineInput.trim()) : undefined;
  const validLine = lineId !== undefined && Number.isFinite(lineId) && lineId > 0;

  const summary = trpc.wip.summary.useQuery(
    validLine ? { lineId } : undefined,
    { refetchInterval: 30_000 },
  );
  const dwell = trpc.wip.dwellByStation.useQuery(
    validLine ? { lineId, hours: 24 } : { hours: 24 },
    { refetchInterval: 60_000 },
  );
  const lineBalance = trpc.wip.lineBalance.useQuery(
    { lineId: validLine ? lineId! : 0, limit: 24 },
    { enabled: validLine, refetchInterval: 60_000 },
  );
  const dispatch = trpc.wip.dispatch.useQuery(
    validLine ? { lineId, max: 50 } : { max: 50 },
    { refetchInterval: 20_000 },
  );

  const pieData = useMemo(
    () => (summary.data?.byStatus ?? []).map((s) => ({ name: s.status, value: s.count })),
    [summary.data],
  );
  const dwellData = useMemo(
    () => (dwell.data ?? []).slice(0, 12).map((d) => ({
      station: `St#${d.stationId}`,
      dwell: Math.round(d.avgDwellMs / 1000),
      starved: Math.round(d.avgStarvedMs / 1000),
      blocked: Math.round(d.avgBlockedMs / 1000),
    })),
    [dwell.data],
  );

  const refetchAll = () => {
    summary.refetch();
    dwell.refetch();
    if (validLine) lineBalance.refetch();
    dispatch.refetch();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-1">
        <PageHeader
          icon={<Boxes className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
          title={t("wipDashboard.title", "WIP & Cân bằng chuyền")}
          description={t("wipDashboard.subtitle", "Theo dõi WIP realtime, dwell/bottleneck và điều phối thời gian thực")}
          actions={
            <>
              <div>
                <Label htmlFor="lineId" className="text-xs">{t("wipDashboard.lineFilter", "Lọc theo chuyền (ID)")}</Label>
                <Input
                  id="lineId"
                  type="number"
                  min={1}
                  placeholder={t("wipDashboard.allLines", "Tất cả")}
                  value={lineInput}
                  onChange={(e) => setLineInput(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button variant="outline" size="icon" onClick={refetchAll} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </>
          }
        />

        {/* U7 cross-links — this is the deep WIP dispatch view; the MES Control
            Tower folds WIP into a broader hub, Command Center gives the panorama. */}
        <RelatedViews
          links={[
            { href: "/mes-control-tower", labelKey: "nav.mesControlTower", labelDefault: "MES Control Tower" },
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
          ]}
        />

        {/* KPI */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Boxes className="h-4 w-4" /> {t("wipDashboard.totalWip", "Tổng WIP")}
              </CardTitle>
            </CardHeader>
            <CardContent><div className="text-3xl font-bold">{summary.data?.total ?? 0}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" /> {t("wipDashboard.blocked", "Blocked")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">
                {(summary.data?.byStatus ?? []).find((s) => s.status === "blocked")?.count ?? 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-warning" /> {t("wipDashboard.starved", "Starved")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-warning">
                {(summary.data?.byStatus ?? []).find((s) => s.status === "starved")?.count ?? 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Gauge className="h-4 w-4" /> {t("wipDashboard.bottlenecks", "Nút thắt")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dispatch.data?.bottleneckStationIds.length ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("wipDashboard.wipByStatus", "WIP theo trạng thái")}</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {pieData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  {t("common.noData", "Chưa có dữ liệu")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {pieData.map((entry, i) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? chartColor(i)} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("wipDashboard.dwellByStation", "Dwell/Starved/Blocked theo trạm (giây, 24h)")}</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {dwellData.length === 0 ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  {t("common.noData", "Chưa có dữ liệu")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dwellData}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="station" tick={chartAxisTick} />
                    <YAxis tick={chartAxisTick} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend />
                    <Bar dataKey="dwell" name={t("wipDashboard.dwell", "Dwell")} fill="var(--info)" />
                    <Bar dataKey="starved" name={t("wipDashboard.starved", "Starved")} fill="var(--warning)" />
                    <Bar dataKey="blocked" name={t("wipDashboard.blocked", "Blocked")} fill="var(--destructive)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Dispatch recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" /> {t("wipDashboard.dispatch", "Điều phối realtime")}
            </CardTitle>
            <CardDescription>
              {t("wipDashboard.dispatchDesc", "Thứ tự xử lý đề xuất theo WIP & nút thắt (cập nhật 20s)")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t("wipDashboard.serial", "Serial")}</TableHead>
                  <TableHead>{t("wipDashboard.lot", "Lô")}</TableHead>
                  <TableHead>{t("wipDashboard.station", "Trạm")}</TableHead>
                  <TableHead>{t("wipDashboard.score", "Điểm")}</TableHead>
                  <TableHead>{t("wipDashboard.reasons", "Lý do")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(dispatch.data?.recommendations ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                )}
                {(dispatch.data?.recommendations ?? []).map((r) => (
                  <TableRow key={r.serialNumber}>
                    <TableCell className="font-bold">{r.rank}</TableCell>
                    <TableCell className="font-mono text-xs">{r.serialNumber}</TableCell>
                    <TableCell>{r.lotNumber ?? "—"}</TableCell>
                    <TableCell>{r.stationId != null ? `St#${r.stationId}` : "—"}</TableCell>
                    <TableCell>{r.score}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.reasons.map((c) => (
                          <Badge key={c} variant="outline" className="text-[10px]">{reasonLabel(t, c)}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Line balance (chỉ khi chọn chuyền) */}
        {validLine && (
          <Card>
            <CardHeader>
              <CardTitle>{t("wipDashboard.lineBalance", "Cân bằng chuyền")} #{lineId}</CardTitle>
              <CardDescription>{t("wipDashboard.lineBalanceDesc", "24 chu kỳ gần nhất")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("wipDashboard.periodStart", "Bắt đầu")}</TableHead>
                    <TableHead>{t("wipDashboard.takt", "Takt (ms)")}</TableHead>
                    <TableHead>{t("wipDashboard.avgCycle", "Chu kỳ TB (ms)")}</TableHead>
                    <TableHead>{t("wipDashboard.bottleneck", "Nút thắt")}</TableHead>
                    <TableHead>{t("wipDashboard.utilization", "Hiệu suất %")}</TableHead>
                    <TableHead>{t("wipDashboard.balanceRate", "Cân bằng %")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(lineBalance.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                  )}
                  {(lineBalance.data ?? []).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">{l.periodStart ? new Date(l.periodStart).toLocaleString() : "—"}</TableCell>
                      <TableCell>{l.taktTimeMs ?? "—"}</TableCell>
                      <TableCell>{l.avgCycleTimeMs ?? "—"}</TableCell>
                      <TableCell>{l.bottleneckStationId ? `St#${l.bottleneckStationId}` : "—"}</TableCell>
                      <TableCell>{l.utilizationPct ?? "—"}</TableCell>
                      <TableCell>{l.balanceRatePct ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
