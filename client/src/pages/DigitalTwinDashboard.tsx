import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Boxes,
  Activity,
  Flame,
  FlaskConical,
  Cpu,
  Heart,
  AlertTriangle,
  Workflow,
  Gauge,
  TrendingUp,
} from "lucide-react";
import { useTwinStream } from "@/hooks/useTwinStream";

/** Màu nền semantic theo màu twin trả về từ server (status+health). */
function twinDot(color?: string | null) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-full ring-1 ring-black/10"
      style={{ backgroundColor: color || "#94a3b8" }}
    />
  );
}

function healthBadge(score?: number | null) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const variant = score >= 80 ? "default" : score >= 50 ? "secondary" : "destructive";
  return <Badge variant={variant as any}>{score}</Badge>;
}

export default function DigitalTwinDashboard() {
  const { t } = useTranslation();

  // --- Twin state (trạng thái máy + health + màu) ---
  const twin = trpc.digitalTwin.twinState.useQuery({ limit: 500 });

  // --- Defect heatmap ---
  const [heatHours, setHeatHours] = useState(24);
  const heatmap = trpc.digitalTwin.defectHeatmap.useQuery({ hours: heatHours });

  // --- What-if (mô phỏng năng suất chuyền) ---
  const [horizonHours, setHorizonHours] = useState(8);
  const [cycleMult, setCycleMult] = useState(1);
  const [whatIfInput, setWhatIfInput] = useState<{
    stations: { stationId: number; name?: string; cycleTimeSec: number; availability?: number; yield?: number }[];
    horizonHours: number;
    cycleTimeMultiplier?: number;
  } | null>(null);

  const whatIf = trpc.digitalTwin.whatIf.useQuery(whatIfInput!, {
    enabled: !!whatIfInput,
  });

  // --- G2.7: WIP flow + station load + prediction (read-only) ---
  const [lineId, setLineId] = useState<number>(1);
  const twinStream = useTwinStream({ lineId });
  const stationLoad = trpc.digitalTwin.stationLoadHeatmap.useQuery(
    { lineId, hours: 24 },
    { enabled: lineId > 0 },
  );
  const prediction = trpc.digitalTwin.predictionOverlay.useQuery(
    { lineId, horizonHours: 1 },
    { enabled: lineId > 0 },
  );

  const twinRows = twin.data ?? [];
  const heatRows = heatmap.data ?? [];

  const kpis = useMemo(() => {
    const total = twinRows.length;
    const running = twinRows.filter((m) => (m.operationStatus || "").toLowerCase() === "running").length;
    const atRisk = twinRows.filter((m) => (m.predictedFailureRisk ?? 0) >= 0.5).length;
    const lowHealth = twinRows.filter((m) => (m.healthScore ?? 100) < 50).length;
    return { total, running, atRisk, lowHealth };
  }, [twinRows]);

  const maxNg = useMemo(
    () => heatRows.reduce((mx, r) => Math.max(mx, r.ngCount), 0),
    [heatRows],
  );

  // Tạo what-if từ chính các trạm hiện hữu (giả lập cycle time mặc định)
  const runWhatIf = () => {
    const byStation = new Map<number, { stationId: number; name?: string; cycleTimeSec: number }>();
    for (const m of twinRows) {
      if (m.stationId == null) continue;
      if (!byStation.has(m.stationId)) {
        byStation.set(m.stationId, {
          stationId: m.stationId,
          name: m.name ?? undefined,
          cycleTimeSec: 30,
        });
      }
    }
    const stations = Array.from(byStation.values());
    if (stations.length === 0) {
      setWhatIfInput({
        stations: [{ stationId: 1, name: "Station 1", cycleTimeSec: 30 }],
        horizonHours,
        cycleTimeMultiplier: cycleMult,
      });
      return;
    }
    setWhatIfInput({ stations, horizonHours, cycleTimeMultiplier: cycleMult });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Boxes className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("nav.digitalTwin", "Digital Twin")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("digitalTwin.subtitle", "Trạng thái máy realtime · heatmap lỗi · mô phỏng what-if")}
            </p>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("digitalTwin.totalMachines", "Tổng máy")}</CardTitle>
              <Cpu className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("digitalTwin.running", "Đang chạy")}</CardTitle>
              <Activity className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{kpis.running}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("digitalTwin.atRisk", "Nguy cơ hỏng")}</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{kpis.atRisk}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("digitalTwin.lowHealth", "Health thấp")}</CardTitle>
              <Heart className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-600">{kpis.lowHealth}</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="twin" className="w-full">
          <TabsList>
            <TabsTrigger value="twin">
              <Activity className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabTwin", "Trạng thái máy")}
            </TabsTrigger>
            <TabsTrigger value="heatmap">
              <Flame className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabHeatmap", "Heatmap lỗi")}
            </TabsTrigger>
            <TabsTrigger value="whatif">
              <FlaskConical className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabWhatIf", "Mô phỏng what-if")}
            </TabsTrigger>
            <TabsTrigger value="wipflow">
              <Workflow className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabWipFlow", "Dòng WIP")}
            </TabsTrigger>
            <TabsTrigger value="stationload">
              <Gauge className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabStationLoad", "Tải trạm")}
            </TabsTrigger>
            <TabsTrigger value="prediction">
              <TrendingUp className="mr-2 h-4 w-4" />
              {t("digitalTwin.tabPrediction", "Dự báo tắc nghẽn")}
            </TabsTrigger>
          </TabsList>

          {/* TAB: Twin state */}
          <TabsContent value="twin" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("digitalTwin.machineStates", "Trạng thái twin theo máy")}</CardTitle>
                <CardDescription>
                  {t("digitalTwin.machineStatesDesc", "Màu hiển thị tổng hợp trạng thái vận hành và health score")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {twin.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                ) : twinRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData", "Không có dữ liệu")}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>{t("digitalTwin.code", "Mã máy")}</TableHead>
                        <TableHead>{t("digitalTwin.name", "Tên máy")}</TableHead>
                        <TableHead>{t("digitalTwin.station", "Trạm")}</TableHead>
                        <TableHead>{t("digitalTwin.status", "Trạng thái")}</TableHead>
                        <TableHead className="text-right">{t("digitalTwin.health", "Health")}</TableHead>
                        <TableHead className="text-right">{t("digitalTwin.risk", "Nguy cơ")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {twinRows.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{twinDot(m.color)}</TableCell>
                          <TableCell className="font-mono text-xs">{m.code}</TableCell>
                          <TableCell>{m.name}</TableCell>
                          <TableCell>{m.stationId ?? "—"}</TableCell>
                          <TableCell>{m.operationStatus ?? "—"}</TableCell>
                          <TableCell className="text-right">{healthBadge(m.healthScore)}</TableCell>
                          <TableCell className="text-right">
                            {m.predictedFailureRisk == null
                              ? "—"
                              : `${Math.round(m.predictedFailureRisk * 100)}%`}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Heatmap */}
          <TabsContent value="heatmap" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("digitalTwin.defectHeatmap", "Heatmap lỗi theo máy")}</CardTitle>
                <CardDescription>
                  {t("digitalTwin.defectHeatmapDesc", "Số lượng NG và tỷ lệ NG trong cửa sổ thời gian")}
                </CardDescription>
                <div className="flex items-end gap-2 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("digitalTwin.windowHours", "Cửa sổ (giờ)")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      value={heatHours}
                      onChange={(e) => setHeatHours(Math.max(1, Math.min(720, Number(e.target.value) || 24)))}
                      className="w-28"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {heatmap.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                ) : heatRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData", "Không có dữ liệu")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {heatRows.map((r) => {
                      const intensity = maxNg > 0 ? r.ngCount / maxNg : 0;
                      const bg = `rgba(239, 68, 68, ${0.12 + intensity * 0.78})`;
                      return (
                        <div
                          key={r.machineId}
                          className="rounded-lg border p-3 text-sm"
                          style={{ backgroundColor: bg }}
                        >
                          <div className="font-mono text-xs opacity-80">#{r.machineId}</div>
                          <div className="text-lg font-bold">{r.ngCount} NG</div>
                          <div className="text-xs opacity-80">
                            {r.ngRate}% · {r.totalCount} {t("digitalTwin.units", "đơn vị")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: What-if */}
          <TabsContent value="whatif" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("digitalTwin.whatIf", "Mô phỏng năng suất chuyền (what-if)")}</CardTitle>
                <CardDescription>
                  {t("digitalTwin.whatIfDesc", "Ước lượng throughput dựa trên cycle time, availability và yield (pure compute)")}
                </CardDescription>
                <div className="flex flex-wrap items-end gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("digitalTwin.horizonHours", "Khoảng thời gian (giờ)")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={720}
                      value={horizonHours}
                      onChange={(e) => setHorizonHours(Math.max(1, Math.min(720, Number(e.target.value) || 8)))}
                      className="w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("digitalTwin.cycleMult", "Hệ số cycle time")}</Label>
                    <Input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={cycleMult}
                      onChange={(e) => setCycleMult(Math.max(0.1, Math.min(10, Number(e.target.value) || 1)))}
                      className="w-32"
                    />
                  </div>
                  <Button onClick={runWhatIf}>
                    <FlaskConical className="mr-2 h-4 w-4" />
                    {t("digitalTwin.simulate", "Chạy mô phỏng")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!whatIfInput ? (
                  <p className="text-sm text-muted-foreground">
                    {t("digitalTwin.whatIfHint", "Nhấn \"Chạy mô phỏng\" để ước lượng năng suất theo các trạm hiện có.")}
                  </p>
                ) : whatIf.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                ) : !whatIf.data ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData", "Không có dữ liệu")}</p>
                ) : (
                  <WhatIfResult data={whatIf.data} t={t as any} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* G2.7 — line selector shared by WIP/load/prediction tabs */}

          {/* TAB: WIP flow */}
          <TabsContent value="wipflow" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {t("digitalTwin.wipFlow.title", "Dòng WIP theo trạm")}
                  <Badge variant={twinStream.isStreaming ? "default" : "secondary"}>
                    {twinStream.isStreaming
                      ? t("digitalTwin.wipFlow.streaming", "Đang stream")
                      : t("digitalTwin.wipFlow.polling", "Đang poll")}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {t("digitalTwin.wipFlow.desc", "Số bán thành phẩm đang trong chuyền tại mỗi trạm")}
                </CardDescription>
                <div className="flex items-end gap-2 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("digitalTwin.station", "Trạm")} / Line ID</Label>
                    <Input
                      type="number"
                      min={1}
                      value={lineId}
                      onChange={(e) => setLineId(Math.max(1, Number(e.target.value) || 1))}
                      className="w-28"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {twinStream.stations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t("digitalTwin.wipFlow.noData", "Không có WIP trong chuyền")}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {twinStream.stations.map((s) => (
                      <div
                        key={s.stationId}
                        className="rounded-lg border p-3 text-sm transition-all duration-300"
                        style={s.color ? { borderColor: s.color } : undefined}
                      >
                        <div className="flex items-center gap-2">
                          {twinDot(s.color)}
                          <span className="font-mono text-xs opacity-80">#{s.stationId}</span>
                        </div>
                        <div className="text-2xl font-bold">{s.wipCount}</div>
                        <div className="text-xs opacity-70">{t("digitalTwin.wipFlow.wipCount", "Số WIP")}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Station load heatmap */}
          <TabsContent value="stationload" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("digitalTwin.stationLoad.title", "Heatmap tải trạm")}</CardTitle>
                <CardDescription>
                  {t("digitalTwin.stationLoad.desc", "Mức tải và trạng thái chủ đạo của từng trạm")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stationLoad.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                ) : !stationLoad.data || stationLoad.data.cells.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("common.noData", "Không có dữ liệu")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                    {stationLoad.data.cells.map((c) => (
                      <div
                        key={c.stationId}
                        className="rounded-lg border-2 p-3 text-sm"
                        style={{ borderColor: c.color, backgroundColor: `${c.color}22` }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs opacity-80">#{c.stationId}</span>
                          {stationLoad.data.bottleneckStationId === c.stationId && (
                            <Badge variant="destructive" className="text-[9px]">
                              {t("digitalTwin.stationLoad.bottleneck", "Nút thắt")}
                            </Badge>
                          )}
                        </div>
                        <div className="text-lg font-bold">{c.loadPct}%</div>
                        <div className="text-xs opacity-80">
                          {t(`digitalTwin.stationLoad.${c.dominantState}`, c.dominantState)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB: Prediction overlay */}
          <TabsContent value="prediction" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>{t("digitalTwin.prediction.title", "Dự báo tắc nghẽn")}</CardTitle>
                <CardDescription>
                  {t("digitalTwin.prediction.desc", "Ước lượng WIP giờ tới và mức rủi ro (chỉ cảnh báo)")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {prediction.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                ) : !prediction.data || !prediction.data.available ? (
                  <p className="text-sm text-muted-foreground">
                    {t("digitalTwin.prediction.unavailable", "Chưa đủ dữ liệu để dự báo")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {prediction.data.cells.map((c) => (
                      <div
                        key={c.stationId}
                        className="flex items-center justify-between rounded-lg border-2 p-3"
                        style={{ borderColor: c.color }}
                      >
                        <div className="flex items-center gap-3">
                          {twinDot(c.color)}
                          <div>
                            <div className="text-sm font-semibold">
                              {t(c.messageKey, c.congestionRisk)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t("digitalTwin.prediction.predictedWip", "WIP dự báo (1h)")}: {c.predictedWipNext1h}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={c.congestionRisk === "high" ? "destructive" : c.congestionRisk === "medium" ? "secondary" : "default"}
                        >
                          {c.congestionRisk.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

interface WhatIfData {
  bottleneckStationId: number | null;
  bottleneckCycleSec: number;
  theoreticalUnits: number;
  effectiveUnits: number;
  lineBalanceRatePct: number;
  perStation: Array<{ stationId: number; effectiveCycleSec: number; utilizationPct: number }>;
}

function WhatIfResult({ data, t }: { data: WhatIfData; t: (k: string, d?: string) => string }) {
  const stations = data.perStation ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("digitalTwin.effectiveUnits", "Sản lượng thực tế")}</div>
          <div className="text-2xl font-bold">{data.effectiveUnits}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("digitalTwin.theoreticalUnits", "Sản lượng lý thuyết")}</div>
          <div className="text-2xl font-bold">{data.theoreticalUnits}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("digitalTwin.bottleneck", "Nút thắt")}</div>
          <div className="text-lg font-semibold">
            {data.bottleneckStationId != null ? `#${data.bottleneckStationId}` : "—"}
            <span className="ml-2 text-xs text-muted-foreground">
              {data.bottleneckCycleSec ? `${data.bottleneckCycleSec}s` : ""}
            </span>
          </div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground">{t("digitalTwin.lineBalanceRate", "Tỷ lệ cân bằng chuyền")}</div>
          <div className="text-2xl font-bold">{data.lineBalanceRatePct}%</div>
        </div>
      </div>

      {stations.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("digitalTwin.station", "Trạm")}</TableHead>
              <TableHead className="text-right">{t("digitalTwin.effCycle", "Cycle hiệu dụng (s)")}</TableHead>
              <TableHead className="text-right">{t("digitalTwin.utilization", "Hiệu suất")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stations.map((s, i) => (
              <TableRow key={s.stationId ?? i}>
                <TableCell>#{s.stationId}</TableCell>
                <TableCell className="text-right">{Math.round(s.effectiveCycleSec * 100) / 100}</TableCell>
                <TableCell className="text-right">{s.utilizationPct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
