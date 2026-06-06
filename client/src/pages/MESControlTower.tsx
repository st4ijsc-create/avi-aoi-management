import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Boxes,
  GitMerge,
  Wrench,
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
} from "lucide-react";

function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const v = value.toUpperCase();
  const variant =
    v.includes("COMPLETED") || v === "RELEASE" || v === "APPROVED"
      ? "default"
      : v.includes("HOLD") || v.includes("WAIT") || v === "QUARANTINE"
        ? "secondary"
        : v.includes("SCRAP") || v.includes("REJECT") || v === "BREAKDOWN"
          ? "destructive"
          : "outline";
  return <Badge variant={variant as any}>{value}</Badge>;
}

export default function MESControlTower() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("wip");

  const wipSummary = trpc.mesControlTower.wipSummary.useQuery(undefined, { refetchInterval: 30_000 });
  const wipList = trpc.mesControlTower.listWip.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const lineBalance = trpc.mesControlTower.lineBalance.useQuery({ limit: 50 });
  const stationDwell = trpc.mesControlTower.stationDwell.useQuery({ sinceHours: 24, limit: 100 });
  const dispositions = trpc.mesControlTower.listDispositions.useQuery({ limit: 100 });
  const workOrders = trpc.mesControlTower.listWorkOrders.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const woSummary = trpc.mesControlTower.workOrderSummary.useQuery(undefined, { refetchInterval: 30_000 });

  const wipTotal = (wipSummary.data ?? []).reduce((a, b) => a + (b.count || 0), 0);
  const openWo = (woSummary.data ?? [])
    .filter((s) => ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"].includes(s.status))
    .reduce((a, b) => a + (b.count || 0), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            {t("mesControlTower.title", "MES Control Tower")}
          </h1>
          <p className="text-muted-foreground">
            {t("mesControlTower.subtitle", "WIP, cân bằng chuyền, truy xuất nguồn gốc & bảo trì dự đoán")}
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Boxes className="h-4 w-4" /> {t("mesControlTower.wipTotal", "Tổng WIP")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{wipTotal}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Gauge className="h-4 w-4" /> {t("mesControlTower.lines", "Chuyền theo dõi")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{lineBalance.data?.length ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Wrench className="h-4 w-4" /> {t("mesControlTower.openWorkOrders", "Lệnh bảo trì mở")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{openWo}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <GitMerge className="h-4 w-4" /> {t("mesControlTower.dispositions", "Quyết định lô")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dispositions.data?.length ?? 0}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="wip">{t("mesControlTower.tabWip", "WIP")}</TabsTrigger>
            <TabsTrigger value="balance">{t("mesControlTower.tabBalance", "Cân bằng chuyền")}</TabsTrigger>
            <TabsTrigger value="trace">{t("mesControlTower.tabTrace", "Truy xuất")}</TabsTrigger>
            <TabsTrigger value="maintenance">{t("mesControlTower.tabMaintenance", "Bảo trì")}</TabsTrigger>
          </TabsList>

          {/* WIP */}
          <TabsContent value="wip" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("mesControlTower.wipByStatus", "WIP theo trạng thái")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                {(wipSummary.data ?? []).length === 0 && (
                  <span className="text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</span>
                )}
                {(wipSummary.data ?? []).map((s) => (
                  <div key={s.status} className="rounded-lg border px-4 py-2">
                    <div className="text-xs text-muted-foreground">{s.status}</div>
                    <div className="text-xl font-bold">{s.count}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("mesControlTower.wipUnits", "Đơn vị WIP")}</CardTitle>
                <CardDescription>{t("mesControlTower.wipUnitsDesc", "100 đơn vị gần nhất")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.serial", "Serial")}</TableHead>
                      <TableHead>{t("mesControlTower.lot", "Lô")}</TableHead>
                      <TableHead>{t("mesControlTower.product", "Sản phẩm")}</TableHead>
                      <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
                      <TableHead>{t("mesControlTower.enteredAt", "Vào lúc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(wipList.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(wipList.data ?? []).map((w: any) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.serialNumber ?? "—"}</TableCell>
                        <TableCell>{w.lotNumber ?? "—"}</TableCell>
                        <TableCell>{w.productCode ?? "—"}</TableCell>
                        <TableCell><StatusBadge value={w.status} /></TableCell>
                        <TableCell className="text-xs">{w.enteredAt ? new Date(w.enteredAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Line balance */}
          <TabsContent value="balance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("mesControlTower.lineBalanceMetrics", "Chỉ số cân bằng chuyền")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                      <TableHead>{t("mesControlTower.taktTime", "Takt (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.avgCycle", "Chu kỳ TB (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.bottleneck", "Nút thắt")}</TableHead>
                      <TableHead>{t("mesControlTower.utilization", "Hiệu suất %")}</TableHead>
                      <TableHead>{t("mesControlTower.balanceRate", "Cân bằng %")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(lineBalance.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(lineBalance.data ?? []).map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell>#{l.lineId}</TableCell>
                        <TableCell>{l.taktTimeMs ?? "—"}</TableCell>
                        <TableCell>{l.avgCycleTimeMs ?? "—"}</TableCell>
                        <TableCell>{l.bottleneckStationId ? `St #${l.bottleneckStationId}` : "—"}</TableCell>
                        <TableCell>{l.utilizationPct ?? "—"}</TableCell>
                        <TableCell>{l.balanceRatePct ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> {t("mesControlTower.stationDwell", "Dwell trạm (starved/blocked)")}
                </CardTitle>
                <CardDescription>{t("mesControlTower.stationDwellDesc", "24 giờ gần nhất")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.station", "Trạm")}</TableHead>
                      <TableHead>{t("mesControlTower.dwell", "Dwell (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.processing", "Xử lý (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.starved", "Starved (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.blocked", "Blocked (ms)")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(stationDwell.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(stationDwell.data ?? []).map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell>St #{d.stationId}</TableCell>
                        <TableCell>{d.dwellMs ?? "—"}</TableCell>
                        <TableCell>{d.processingMs ?? "—"}</TableCell>
                        <TableCell className="text-amber-600">{d.starvedMs ?? "—"}</TableCell>
                        <TableCell className="text-red-600">{d.blockedMs ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Traceability */}
          <TabsContent value="trace" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("mesControlTower.lotDispositions", "Quyết định lô (genealogy)")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.lot", "Lô")}</TableHead>
                      <TableHead>{t("mesControlTower.disposition", "Quyết định")}</TableHead>
                      <TableHead>{t("mesControlTower.quantity", "Số lượng")}</TableHead>
                      <TableHead>{t("mesControlTower.reason", "Lý do")}</TableHead>
                      <TableHead>{t("mesControlTower.decidedAt", "Thời điểm")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dispositions.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(dispositions.data ?? []).map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.lotNumber}</TableCell>
                        <TableCell><StatusBadge value={d.disposition} /></TableCell>
                        <TableCell>{d.quantity ?? "—"}</TableCell>
                        <TableCell className="max-w-60 truncate">{d.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs">{d.decidedAt ? new Date(d.decidedAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Maintenance */}
          <TabsContent value="maintenance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-4 w-4" /> {t("mesControlTower.workOrders", "Lệnh bảo trì")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 mb-4">
                {(woSummary.data ?? []).map((s) => (
                  <div key={s.status} className="rounded-lg border px-4 py-2">
                    <div className="text-xs text-muted-foreground">{s.status}</div>
                    <div className="text-xl font-bold">{s.count}</div>
                  </div>
                ))}
              </CardContent>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.woNumber", "Mã lệnh")}</TableHead>
                      <TableHead>{t("mesControlTower.machine", "Máy")}</TableHead>
                      <TableHead>{t("mesControlTower.type", "Loại")}</TableHead>
                      <TableHead>{t("mesControlTower.trigger", "Kích hoạt")}</TableHead>
                      <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
                      <TableHead>{t("mesControlTower.openedAt", "Mở lúc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(workOrders.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(workOrders.data ?? []).map((w: any) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.workOrderNumber}</TableCell>
                        <TableCell>{w.machineCode ?? `#${w.machineId}`}</TableCell>
                        <TableCell>{w.type}{w.trigger === "PREDICTED_FAILURE" && <AlertTriangle className="inline h-3 w-3 ml-1 text-amber-500" />}</TableCell>
                        <TableCell>{w.trigger}</TableCell>
                        <TableCell><StatusBadge value={w.status} /></TableCell>
                        <TableCell className="text-xs">{w.openedAt ? new Date(w.openedAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
