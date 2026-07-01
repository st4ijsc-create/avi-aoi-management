import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, StatusBadge as PatternStatusBadge, type BadgeVariant } from "@/components/patterns";
import { RelatedViews } from "@/components/RelatedViews";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Boxes,
  GitMerge,
  Wrench,
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  Plus,
  Search,
  ClipboardList,
  CalendarClock,
  ExternalLink,
  ArrowRight,
} from "lucide-react";

// Domain status → solid shadcn <Badge> variant. Unified onto the shared
// <StatusBadge> (W4): this thin wrapper keeps the `value` API + em-dash empty
// state, delegating rendering to the pattern component (identical look).
function mesStatusVariant(v: string): BadgeVariant {
  if (v.includes("COMPLETED") || v === "RELEASE" || v === "APPROVED" || v === "SIGNED_OFF") return "default";
  if (v.includes("HOLD") || v.includes("WAIT") || v === "QUARANTINE" || v === "PAUSED") return "secondary";
  if (v.includes("SCRAP") || v.includes("REJECT") || v === "BREAKDOWN") return "destructive";
  return "outline";
}
function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <PatternStatusBadge status={value} variant={mesStatusVariant(value.toUpperCase())} />;
}

/**
 * Name lookup — turns the lightweight id→name payload from
 * mesControlTower.nameLookup into Maps so every tab can render REAL
 * line/station/machine names instead of raw numeric ids ("St #5").
 */
function useNames() {
  const lookup = trpc.mesControlTower.nameLookup.useQuery(undefined, { staleTime: 5 * 60_000 });
  return useMemo(() => {
    const lines = new Map<number, { name: string; code: string }>();
    const stations = new Map<number, { name: string; code: string }>();
    const machinesM = new Map<number, { name: string; code: string }>();
    for (const l of lookup.data?.lines ?? []) lines.set(l.id, { name: l.name, code: l.code });
    for (const s of lookup.data?.stations ?? []) stations.set(s.id, { name: s.name, code: s.code });
    for (const m of lookup.data?.machines ?? []) machinesM.set(m.id, { name: m.name, code: m.code });
    return {
      ready: !!lookup.data,
      line: (id?: number | null) => (id == null ? "—" : lines.get(id)?.name ?? `Line #${id}`),
      station: (id?: number | null) => (id == null ? "—" : stations.get(id)?.name ?? `Station #${id}`),
      machine: (id?: number | null) => (id == null ? "—" : machinesM.get(id)?.name ?? `Machine #${id}`),
    };
  }, [lookup.data]);
}

export default function MESControlTower() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("wip");
  const names = useNames();

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
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("mesControlTower.titleHub", "MES Operations Hub")}
          description={t("mesControlTower.subtitleHub", "WIP · cân bằng chuyền · truy xuất serial · lệnh sản xuất · phiên sản xuất")}
        />

        {/* U7 cross-links to the deep WIP dispatch view + the panorama. */}
        <RelatedViews
          links={[
            { href: "/wip-dashboard", labelKey: "nav.wipDashboard", labelDefault: "WIP & Line Balance (dispatch)" },
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
          ]}
        />

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
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="wip">{t("mesControlTower.tabWip", "WIP")}</TabsTrigger>
            <TabsTrigger value="balance">{t("mesControlTower.tabBalance", "Cân bằng chuyền")}</TabsTrigger>
            <TabsTrigger value="trace">{t("mesControlTower.tabTrace", "Truy xuất")}</TabsTrigger>
            <TabsTrigger value="orders">{t("mesControlTower.tabOrders", "Lệnh sản xuất")}</TabsTrigger>
            <TabsTrigger value="sessions">{t("mesControlTower.tabSessions", "Phiên sản xuất")}</TabsTrigger>
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
                      <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                      <TableHead>{t("mesControlTower.station", "Trạm")}</TableHead>
                      <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
                      <TableHead>{t("mesControlTower.enteredAt", "Vào lúc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(wipList.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(wipList.data ?? []).map((w: any) => (
                      <TableRow key={w.id}>
                        <TableCell className="font-mono text-xs">{w.serialNumber ?? "—"}</TableCell>
                        <TableCell>{w.lotNumber ?? "—"}</TableCell>
                        <TableCell>{w.productCode ?? "—"}</TableCell>
                        <TableCell>{names.line(w.lineId)}</TableCell>
                        <TableCell>{names.station(w.currentStationId)}</TableCell>
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
                        <TableCell className="font-medium">{names.line(l.lineId)}</TableCell>
                        <TableCell>{l.taktTimeMs ?? "—"}</TableCell>
                        <TableCell>{l.avgCycleTimeMs ?? "—"}</TableCell>
                        <TableCell>{l.bottleneckStationId ? names.station(l.bottleneckStationId) : "—"}</TableCell>
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
                      <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                      <TableHead>{t("mesControlTower.dwell", "Dwell (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.processing", "Xử lý (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.starved", "Starved (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.blocked", "Blocked (ms)")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(stationDwell.data ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                    )}
                    {(stationDwell.data ?? []).map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">{names.station(d.stationId)}</TableCell>
                        <TableCell>{names.line(d.lineId)}</TableCell>
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

          {/* Traceability — single-serial drill + material flow + dispositions */}
          <TabsContent value="trace" className="space-y-4">
            <SerialTracePanel names={names} />
            <MaterialFlowPanel />
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

          {/* Orders — embedded read view of production orders + link to full editor */}
          <TabsContent value="orders" className="space-y-4">
            <OrdersPanel names={names} />
          </TabsContent>

          {/* Sessions — production sessions (shift sessions), not login sessions */}
          <TabsContent value="sessions" className="space-y-4">
            <SessionsPanel names={names} />
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
                        <TableCell>{w.machineCode ?? names.machine(w.machineId)}</TableCell>
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

type Names = ReturnType<typeof useNames>;

/**
 * P3 — Single-serial Trace drill. Search one serial number → full genealogy
 * timeline: WIP route history (with real station/line names), parent/child
 * serials, lot dispositions, and dwell records. One serial = full story.
 */
function SerialTracePanel({ names }: { names: Names }) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [serial, setSerial] = useState<string | null>(null);
  const trace = trpc.mesControlTower.serialTrace.useQuery(
    { serialNumber: serial ?? "" },
    { enabled: !!serial },
  );

  const data = trace.data;
  const hasResult = !!serial && !!data;
  const empty = hasResult && (data!.wipUnits.length === 0 && data!.dwell.length === 0 && data!.dispositions.length === 0 && data!.children.length === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-4 w-4" /> {t("mesControlTower.serialTrace", "Truy xuất theo serial")}
        </CardTitle>
        <CardDescription>{t("mesControlTower.serialTraceDesc", "Nhập một serial để xem toàn bộ genealogy + lịch sử WIP + quyết định lô")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 max-w-sm">
            <Label>{t("mesControlTower.serial", "Serial")}</Label>
            <Input
              aria-label={t("mesControlTower.serial", "Serial")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) setSerial(input.trim()); }}
              placeholder="SN-..."
              className="font-mono"
            />
          </div>
          <Button disabled={!input.trim()} onClick={() => setSerial(input.trim())}>
            <Search className="mr-1 h-4 w-4" /> {t("common.search", "Tìm")}
          </Button>
        </div>

        {trace.isFetching && <div className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</div>}

        {hasResult && !trace.isFetching && empty && (
          <div className="text-sm text-muted-foreground">
            {t("mesControlTower.serialNoResult", "Không tìm thấy dữ liệu cho serial này")}
          </div>
        )}

        {hasResult && !empty && (
          <div className="space-y-4">
            {/* genealogy summary */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {data!.parentSerialNumber && (
                <button
                  className="inline-flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted"
                  onClick={() => { setInput(data!.parentSerialNumber!); setSerial(data!.parentSerialNumber!); }}
                >
                  {data!.parentSerialNumber} <ArrowRight className="h-3 w-3" />
                </button>
              )}
              <Badge variant="default" className="font-mono">{data!.serialNumber}</Badge>
              {data!.children.length > 0 && (
                <span className="text-muted-foreground">
                  → {data!.children.length} {t("mesControlTower.childUnits", "đơn vị con")}
                </span>
              )}
              {data!.lotNumbers.length > 0 && (
                <span className="text-muted-foreground">
                  · {t("mesControlTower.lot", "Lô")}: {data!.lotNumbers.join(", ")}
                </span>
              )}
            </div>

            {/* WIP route timeline */}
            <div>
              <div className="text-sm font-medium mb-2">{t("mesControlTower.wipHistory", "Lịch sử WIP (route)")}</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                    <TableHead>{t("mesControlTower.station", "Trạm")}</TableHead>
                    <TableHead>{t("mesControlTower.machine", "Máy")}</TableHead>
                    <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
                    <TableHead>{t("mesControlTower.enteredAt", "Vào lúc")}</TableHead>
                    <TableHead>{t("mesControlTower.exitedAt", "Ra lúc")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.wipUnits.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                  )}
                  {data!.wipUnits.map((w: any) => (
                    <TableRow key={w.id}>
                      <TableCell>{names.line(w.lineId)}</TableCell>
                      <TableCell>{names.station(w.currentStationId)}</TableCell>
                      <TableCell>{names.machine(w.currentMachineId)}</TableCell>
                      <TableCell><StatusBadge value={w.status} /></TableCell>
                      <TableCell className="text-xs">{w.enteredAt ? new Date(w.enteredAt).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-xs">{w.exitedAt ? new Date(w.exitedAt).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Dwell records */}
            {data!.dwell.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">{t("mesControlTower.stationDwell", "Dwell trạm (starved/blocked)")}</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mesControlTower.station", "Trạm")}</TableHead>
                      <TableHead>{t("mesControlTower.dwell", "Dwell (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.starved", "Starved (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.blocked", "Blocked (ms)")}</TableHead>
                      <TableHead>{t("mesControlTower.enteredAt", "Vào lúc")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data!.dwell.map((d: any) => (
                      <TableRow key={d.id}>
                        <TableCell>{names.station(d.stationId)}</TableCell>
                        <TableCell>{d.dwellMs ?? "—"}</TableCell>
                        <TableCell className="text-amber-600">{d.starvedMs ?? "—"}</TableCell>
                        <TableCell className="text-red-600">{d.blockedMs ?? "—"}</TableCell>
                        <TableCell className="text-xs">{d.enteredAt ? new Date(d.enteredAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Lot dispositions touching this serial */}
            {data!.dispositions.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">{t("mesControlTower.lotDispositions", "Quyết định lô (genealogy)")}</div>
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
                    {data!.dispositions.map((d: any) => (
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
              </div>
            )}

            {/* Child genealogy */}
            {data!.children.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">{t("mesControlTower.childUnits", "Đơn vị con")}</div>
                <div className="flex flex-wrap gap-2">
                  {data!.children.map((c: any) => (
                    <button
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-mono hover:bg-muted"
                      onClick={() => { setInput(c.serialNumber); setSerial(c.serialNumber); }}
                    >
                      {c.serialNumber} <ArrowRight className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Orders tab — embedded read view of production orders so the hub is a true
 * single pane. Full create/edit/Gantt lives on /production-orders (linked).
 */
function OrdersPanel({ names }: { names: Names }) {
  const { t } = useTranslation();
  const orders = trpc.productionOrder.list.useQuery(undefined, { refetchInterval: 30_000 });
  const products = trpc.productModel.list.useQuery();
  const productName = (id: number) => products.data?.find((p) => p.id === id)?.name ?? `#${id}`;

  const rows = orders.data ?? [];
  const inProgress = rows.filter((o) => o.status === "in_progress").length;
  const completed = rows.filter((o) => o.status === "completed").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> {t("mesControlTower.tabOrders", "Lệnh sản xuất")}
          </CardTitle>
          <CardDescription>
            {t("mesControlTower.ordersSummary", "{{total}} lệnh · {{inProgress}} đang chạy · {{completed}} hoàn tất", {
              total: rows.length, inProgress, completed,
            })}
          </CardDescription>
        </div>
        <Link href="/production-orders">
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-1 h-4 w-4" /> {t("mesControlTower.manageOrders", "Quản lý lệnh")}
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t("production.orderCode", "Mã lệnh")}</TableHead>
                <TableHead>{t("production.company", "Công ty")}</TableHead>
                <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                <TableHead>{t("mesControlTower.product", "Sản phẩm")}</TableHead>
                <TableHead>{t("production.progress", "Tiến độ")}</TableHead>
                <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
              )}
              {rows.map((o: any) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.orderCode}</TableCell>
                  <TableCell>{o.companyCode}</TableCell>
                  <TableCell>{names.line(o.lineId)}</TableCell>
                  <TableCell>{productName(o.productModelId)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${o.targetQuantity ? Math.round((o.completedQuantity / o.targetQuantity) * 100) : 0}%` }} />
                      </div>
                      <span className="text-sm">{o.completedQuantity}/{o.targetQuantity}</span>
                    </div>
                  </TableCell>
                  <TableCell><StatusBadge value={o.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Sessions tab — production (shift) sessions. Embedded read view; full
 * open/close/handover/sign-off lives on /production-session-signoff (linked).
 */
function SessionsPanel({ names }: { names: Names }) {
  const { t } = useTranslation();
  const sessions = trpc.productionSession.list.useQuery({ limit: 100 }, { refetchInterval: 30_000 });
  const rows = sessions.data ?? [];

  const byStatus = rows.reduce<Record<string, number>>((acc, s: any) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1; return acc;
  }, {});

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> {t("mesControlTower.tabSessions", "Phiên sản xuất")}
          </CardTitle>
          <CardDescription>{t("mesControlTower.sessionsDesc", "Phiên theo ca — mở/đóng/bàn giao và ký duyệt 21 CFR Part 11")}</CardDescription>
        </div>
        <Link href="/production-signoff">
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-1 h-4 w-4" /> {t("mesControlTower.signOff", "Ký duyệt phiên")}
          </Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          {Object.keys(byStatus).length === 0 && (
            <span className="text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</span>
          )}
          {Object.entries(byStatus).map(([status, count]) => (
            <div key={status} className="rounded-lg border px-4 py-2">
              <div className="text-xs text-muted-foreground">{status}</div>
              <div className="text-xl font-bold">{count}</div>
            </div>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead>{t("mesControlTower.sessionCode", "Mã phiên")}</TableHead>
                <TableHead>{t("mesControlTower.line", "Chuyền")}</TableHead>
                <TableHead>{t("mesControlTower.shiftDate", "Ngày ca")}</TableHead>
                <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
                <TableHead>{t("mesControlTower.signoff", "Ký duyệt")}</TableHead>
                <TableHead>{t("mesControlTower.actualStart", "Bắt đầu")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
              )}
              {rows.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.sessionCode}</TableCell>
                  <TableCell>{names.line(s.lineId)}</TableCell>
                  <TableCell className="text-xs">{s.shiftDate ? new Date(s.shiftDate).toLocaleDateString() : "—"}</TableCell>
                  <TableCell><StatusBadge value={s.status} /></TableCell>
                  <TableCell>{s.supervisorSignoff ? <Badge variant="default">{t("mesControlTower.signed", "Đã ký")}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs">{s.actualStart ? new Date(s.actualStart).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * P2 — Material-flow write UI. Surfaces the now-writable supplier-lot /
 * material-receipt shells and lets an operator record a lot disposition
 * (release/rework/scrap/return/hold/quarantine) so the genealogy chain gets real
 * decision rows. All procedures live on mesControlTowerRouter.
 */
function MaterialFlowPanel() {
  const { t } = useTranslation();
  const receipts = trpc.mesControlTower.listMaterialReceipts.useQuery({ limit: 50 });
  const supplierLots = trpc.mesControlTower.listSupplierLots.useQuery({ limit: 50 });
  const utils = trpc.useUtils();

  const [d, setD] = useState({ lotNumber: "", disposition: "rework", quantity: "1", reason: "" });
  const createDisp = trpc.mesControlTower.createLotDisposition.useMutation({
    onSuccess: () => {
      toast.success(t("mesControlTower.dispositionCreated", "Đã ghi quyết định lô"));
      setD({ lotNumber: "", disposition: "rework", quantity: "1", reason: "" });
      utils.mesControlTower.listDispositions.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4" /> {t("mesControlTower.recordDisposition", "Ghi quyết định lô")}
          </CardTitle>
          <CardDescription>{t("mesControlTower.recordDispositionDesc", "Tạo bản ghi xử lý lô cho truy xuất nguồn gốc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          <div>
            <Label>{t("mesControlTower.lot", "Lô")}</Label>
            <Input aria-label={t("mesControlTower.lot", "Lô")} value={d.lotNumber} onChange={(e) => setD({ ...d, lotNumber: e.target.value })} className="w-40" placeholder="LOT-..." />
          </div>
          <div>
            <Label>{t("mesControlTower.disposition", "Quyết định")}</Label>
            <Select value={d.disposition} onValueChange={(v) => setD({ ...d, disposition: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["release", "rework", "scrap", "return", "hold", "quarantine"].map((x) => (
                  <SelectItem key={x} value={x}>{x}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("mesControlTower.quantity", "Số lượng")}</Label>
            <Input aria-label={t("mesControlTower.quantity", "Số lượng")} value={d.quantity} onChange={(e) => setD({ ...d, quantity: e.target.value })} className="w-24" />
          </div>
          <div className="flex-1 min-w-40">
            <Label>{t("mesControlTower.reason", "Lý do")}</Label>
            <Input aria-label={t("mesControlTower.reason", "Lý do")} value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} placeholder="..." />
          </div>
          <Button
            disabled={!d.lotNumber || createDisp.isPending}
            onClick={() => createDisp.mutate({
              lotNumber: d.lotNumber,
              disposition: d.disposition as any,
              quantity: Number(d.quantity) || 1,
              reason: d.reason || undefined,
            })}
          ><Plus className="mr-1 h-4 w-4" /> {t("common.add", "Thêm")}</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("mesControlTower.supplierLots", "Lô nhà cung cấp")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("mesControlTower.lot", "Lô")}</TableHead>
                <TableHead>{t("mesControlTower.material", "Vật liệu")}</TableHead>
                <TableHead>{t("mesControlTower.quantity", "SL")}</TableHead>
                <TableHead>{t("mesControlTower.status", "Trạng thái")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(supplierLots.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                )}
                {(supplierLots.data ?? []).map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{l.supplierLotNumber}</TableCell>
                    <TableCell>{l.materialCode}</TableCell>
                    <TableCell>{l.quantity}</TableCell>
                    <TableCell><StatusBadge value={l.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("mesControlTower.materialReceipts", "Phiếu nhận vật liệu")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t("mesControlTower.receipt", "Phiếu")}</TableHead>
                <TableHead>{t("mesControlTower.material", "Vật liệu")}</TableHead>
                <TableHead>{t("mesControlTower.supplier", "NCC")}</TableHead>
                <TableHead>{t("mesControlTower.quantity", "SL")}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {(receipts.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("common.noData", "Chưa có dữ liệu")}</TableCell></TableRow>
                )}
                {(receipts.data ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.receiptNumber}</TableCell>
                    <TableCell>{r.materialCode}</TableCell>
                    <TableCell>{r.supplierCode ?? r.supplierName ?? "—"}</TableCell>
                    <TableCell>{r.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
