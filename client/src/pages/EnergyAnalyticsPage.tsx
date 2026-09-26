/**
 * Sprint G2.6b — Energy Analytics UI (READ / ANALYTICS only).
 *
 * SAFETY: this page is read-only analytics over energy telemetry, plus an OPTIONAL
 * manual `recordReading` form that writes a DATA row (telemetry, canCreate) — NOT a
 * machine control command. It NEVER calls commandDispatcher / driver writes.
 *
 * Demand-response suggestions are rendered as TEXT ONLY, explicitly labelled
 * "Chỉ gợi ý — không tự thực thi" / advisory. Nothing here sheds load or dispatches.
 *
 * RBAC: module "energy" — canView gates the whole page; the manual reading form is
 * only shown with canCreate.
 *
 * Backend (G2.6a): trpc.energy.{recipeEnergy, peakDemand, powerFactor, forecast,
 * demandResponse, enpi, recordReading}. Signatures read directly from
 * server/routers/energyRouter.ts — do not change without re-checking.
 */
import { useMemo, useState } from "react";
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  PageContainer,
  chartColor,
  chartAxisTick,
  chartGridProps,
  chartTooltipStyle,
  chartTooltipLabelStyle,
} from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, ReferenceLine, ReferenceDot,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  Zap, Gauge, TrendingUp, BarChart3, Info, AlertTriangle, Plus, RefreshCw, Leaf,
} from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";

// ── helpers ───────────────────────────────────────────────────────────────
function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function toLocalInput(d: Date): string {
  // yyyy-MM-ddTHH:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function tsLabel(t: number | Date): string {
  const d = t instanceof Date ? t : new Date(t);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SOURCES = ["electricity", "compressed_air", "water", "gas", "steam", "other"] as const;

interface ReadingForm {
  machineId: string;
  source: (typeof SOURCES)[number];
  value: string;
  unit: string;
  powerKw: string;
  powerFactor: string;
  recipeRef: string;
}
const emptyReading: ReadingForm = {
  machineId: "", source: "electricity", value: "", unit: "kWh", powerKw: "", powerFactor: "", recipeRef: "",
};

export default function EnergyAnalyticsPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("energy", "canView");
  const canCreate = hasPermission("energy", "canCreate");

  // ── range + machine filter ──
  const defaults = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: toLocalInput(from), to: toLocalInput(to) };
  }, []);
  const [fromStr, setFromStr] = useState(defaults.from);
  const [toStr, setToStr] = useState(defaults.to);
  const [machineId, setMachineId] = useState<string>("all");
  const [thresholdKw, setThresholdKw] = useState<string>("100");

  // Applied (committed) filter — only re-query when the user clicks Apply.
  const [applied, setApplied] = useState({
    from: defaults.from, to: defaults.to, machineId: "all", thresholdKw: "100",
  });

  const machinesQuery = trpc.machine.list.useQuery(undefined, { enabled: canView });

  // doc 64 IA-10 S3-D — trục phạm vi: picker máy tại-trang (Apply) THẮNG, trục lấp khi "all".
  const { scope: assetScope } = useScope(["machine"]);
  useScopeWired();
  const range = useMemo(() => {
    const mId = applied.machineId !== "all" ? Number(applied.machineId) : assetScope.machineId;
    return {
      from: new Date(applied.from),
      to: new Date(applied.to),
      ...(mId != null && Number.isFinite(mId) ? { machineId: mId } : {}),
    };
  }, [applied, assetScope.machineId]);

  const thrKw = useMemo(() => {
    const n = Number(applied.thresholdKw);
    return Number.isFinite(n) && n > 0 ? n : 100;
  }, [applied.thresholdKw]);

  // ── queries (all read-only) ──
  const recipeEnergyQuery = trpc.energy.recipeEnergy.useQuery(range, { enabled: canView });
  const peakDemandQuery = trpc.energy.peakDemand.useQuery(range, { enabled: canView });
  const powerFactorQuery = trpc.energy.powerFactor.useQuery(range, { enabled: canView });
  const forecastQuery = trpc.energy.forecast.useQuery({ ...range, metric: "powerKw" }, { enabled: canView });
  const demandResponseQuery = trpc.energy.demandResponse.useQuery(
    { ...range, thresholdKw: thrKw },
    { enabled: canView },
  );
  const enpiQuery = trpc.energy.enpi.useQuery(
    { ...(range.machineId != null ? { machineId: range.machineId } : {}), from: range.from, to: range.to },
    { enabled: canView },
  );

  const refetchAll = () => {
    void recipeEnergyQuery.refetch();
    void peakDemandQuery.refetch();
    void powerFactorQuery.refetch();
    void forecastQuery.refetch();
    void demandResponseQuery.refetch();
    void enpiQuery.refetch();
  };

  const applyFilter = () => {
    setApplied({ from: fromStr, to: toStr, machineId, thresholdKw });
  };

  // ── manual reading form (telemetry, canCreate) ──
  const utils = trpc.useUtils();
  const [readingOpen, setReadingOpen] = useState(false);
  const [readingForm, setReadingForm] = useState<ReadingForm>(emptyReading);
  const recordReading = trpc.energy.recordReading.useMutation({
    onSuccess: () => {
      toast.success(t("energy.readingSaved", "Đã lưu chỉ số năng lượng"));
      setReadingOpen(false);
      setReadingForm(emptyReading);
      void utils.energy.recipeEnergy.invalidate();
      void utils.energy.peakDemand.invalidate();
      void utils.energy.powerFactor.invalidate();
    },
    onError: (e) => toastTrpcError(e),
  });
  const submitReading = () => {
    const value = Number(readingForm.value);
    if (!Number.isFinite(value) || value < 0) {
      toast.error(t("energy.invalidValue", "Giá trị không hợp lệ"));
      return;
    }
    const mId = readingForm.machineId ? Number(readingForm.machineId) : undefined;
    const powerKw = readingForm.powerKw ? Number(readingForm.powerKw) : undefined;
    const pf = readingForm.powerFactor ? Number(readingForm.powerFactor) : undefined;
    recordReading.mutate({
      ...(mId != null && Number.isFinite(mId) ? { machineId: mId } : {}),
      source: readingForm.source,
      value,
      unit: readingForm.unit || "kWh",
      ...(powerKw != null && Number.isFinite(powerKw) ? { powerKw } : {}),
      ...(pf != null && Number.isFinite(pf) ? { powerFactor: pf } : {}),
      ...(readingForm.recipeRef ? { recipeRef: readingForm.recipeRef } : {}),
    });
  };

  const machines = machinesQuery.data ?? [];
  const machineName = (id: number | null | undefined) =>
    id == null ? "—" : machines.find((m) => m.id === id)?.name ?? `#${id}`;

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>{t("energy.noPermission", "Bạn không có quyền xem phân tích năng lượng")}</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  // ── derived chart data ──
  const recipeRows = recipeEnergyQuery.data ?? [];
  const recipeBarData = recipeRows.map((r) => ({
    name: r.recipeCode ?? r.recipeRef,
    kwh: r.totalKwh,
    kwhPerUnit: r.kwhPerUnit ?? 0,
  }));

  const peak = peakDemandQuery.data;
  const peakLineData = (peak?.demandByBucket ?? []).map((b) => ({
    ts: new Date(b.bucket).getTime(),
    powerKw: b.avgPowerKw,
  }));

  const pf = powerFactorQuery.data;

  const forecast = forecastQuery.data;
  const forecastData = (forecast?.forecast ?? []).map((p) => ({
    ts: p.timestamp,
    predicted: p.predicted,
    lower: p.lower,
    // stacked area: render [lower, band] where band = upper-lower
    band: Math.max(0, p.upper - p.lower),
    upper: p.upper,
  }));

  const suggestions = demandResponseQuery.data?.suggestions ?? [];

  const enpiRows = enpiQuery.data ?? [];

  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-6 space-y-0">
        <PageHeader
          icon={<Zap className="h-6 w-6" />}
          title={t("energy.title", "Phân tích năng lượng")}
          description={t("energy.subtitle", "Phân tích kWh/recipe, đỉnh công suất, hệ số công suất, dự báo & EnPI (ISO 50001)")}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={refetchAll}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                {t("energy.refresh", "Làm mới")}
              </Button>
              {canCreate && (
                <Button size="sm" onClick={() => setReadingOpen(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t("energy.recordReading", "Nhập chỉ số")}
                </Button>
              )}
            </>
          }
        />

        {/* Filter bar */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <Label className="text-sm">{t("energy.from", "Từ")}</Label>
                <Input type="datetime-local" value={fromStr} onChange={(e) => setFromStr(e.target.value)} className="w-52 mt-1" />
              </div>
              <div>
                <Label className="text-sm">{t("energy.to", "Đến")}</Label>
                <Input type="datetime-local" value={toStr} onChange={(e) => setToStr(e.target.value)} className="w-52 mt-1" />
              </div>
              <div>
                <Label className="text-sm">{t("energy.machine", "Máy")}</Label>
                <Select value={machineId} onValueChange={setMachineId}>
                  <SelectTrigger className="w-44 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("energy.allMachines", "Tất cả máy")}</SelectItem>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">{t("energy.thresholdKw", "Ngưỡng hợp đồng (kW)")}</Label>
                <Input type="number" min={0} value={thresholdKw} onChange={(e) => setThresholdKw(e.target.value)} className="w-40 mt-1" />
              </div>
              <Button onClick={applyFilter}>
                <BarChart3 className="h-4 w-4 mr-1.5" />
                {t("energy.apply", "Áp dụng")}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="recipe">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="recipe"><BarChart3 className="h-4 w-4 mr-1.5" />{t("energy.tabRecipe", "Theo recipe")}</TabsTrigger>
            <TabsTrigger value="peak"><Zap className="h-4 w-4 mr-1.5" />{t("energy.tabPeak", "Đỉnh công suất")}</TabsTrigger>
            {pf?.available && (
              <TabsTrigger value="pf"><Gauge className="h-4 w-4 mr-1.5" />{t("energy.tabPf", "Hệ số công suất")}</TabsTrigger>
            )}
            <TabsTrigger value="forecast"><TrendingUp className="h-4 w-4 mr-1.5" />{t("energy.tabForecast", "Dự báo")}</TabsTrigger>
            <TabsTrigger value="enpi"><Leaf className="h-4 w-4 mr-1.5" />{t("energy.tabEnpi", "EnPI / ISO 50001")}</TabsTrigger>
          </TabsList>

          {/* ── Per-recipe ── */}
          <TabsContent value="recipe">
            <Card>
              <CardHeader>
                <CardTitle>{t("energy.tabRecipe", "Theo recipe")}</CardTitle>
                <CardDescription>{t("energy.recipeDesc", "kWh và kWh/đơn vị quy cho từng recipe trong kỳ")}</CardDescription>
              </CardHeader>
              <CardContent>
                {recipeEnergyQuery.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : recipeRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t("energy.noData", "Không có dữ liệu")}</p>
                ) : (
                  <div className="space-y-6">
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={recipeBarData}>
                          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="kwh" name={t("energy.colKwh", "kWh") as string} fill="#f59e0b" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="border rounded-lg overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("energy.colRecipe", "Recipe")}</TableHead>
                            <TableHead>{t("energy.colMachine", "Máy")}</TableHead>
                            <TableHead className="text-right">{t("energy.colKwh", "kWh")}</TableHead>
                            <TableHead className="text-right">{t("energy.colUnits", "Đơn vị")}</TableHead>
                            <TableHead className="text-right">{t("energy.colKwhPerUnit", "kWh/đơn vị")}</TableHead>
                            <TableHead className="text-right">{t("energy.colAvgKw", "kW TB")}</TableHead>
                            <TableHead className="text-right">{t("energy.colPeakKw", "Đỉnh kW")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {recipeRows.map((r, i) => (
                            <TableRow key={`${r.recipeRef}-${r.machineId ?? "x"}-${i}`}>
                              <TableCell className="font-medium">{r.recipeCode ?? r.recipeRef}</TableCell>
                              <TableCell>{machineName(r.machineId)}</TableCell>
                              <TableCell className="text-right">{fmt(r.totalKwh, 3)}</TableCell>
                              <TableCell className="text-right">{fmt(r.unitsProduced, 0)}</TableCell>
                              <TableCell className="text-right">{fmt(r.kwhPerUnit, 4)}</TableCell>
                              <TableCell className="text-right">{fmt(r.avgPowerKw, 2)}</TableCell>
                              <TableCell className="text-right">{fmt(r.peakDemandKw, 2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Peak demand ── */}
          <TabsContent value="peak">
            <Card>
              <CardHeader>
                <CardTitle>{t("energy.tabPeak", "Đỉnh công suất")}</CardTitle>
                <CardDescription>
                  {t("energy.peakDesc", "Công suất trung bình theo cửa sổ {{min}} phút; đường rolling + đỉnh tức thời", { min: peak?.rollingWindowMin ?? 15 })}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {peakDemandQuery.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : peakLineData.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t("energy.noData", "Không có dữ liệu")}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                      <Stat label={t("energy.instPeak", "Đỉnh tức thời")} value={`${fmt(peak?.instantaneousPeakKw, 2)} kW`} />
                      <Stat label={t("energy.rollingDemand", "Demand rolling")} value={`${fmt(peak?.rollingDemandKw, 2)} kW`} />
                      <Stat label={t("energy.peakAt", "Thời điểm đỉnh")} value={peak?.peakAt ? tsLabel(peak.peakAt) : "—"} />
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={peakLineData}>
                          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                          <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time"
                            tickFormatter={(v) => tsLabel(v)} tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip labelFormatter={(v) => tsLabel(Number(v))} />
                          <Legend />
                          <Line type="monotone" dataKey="powerKw" name={t("energy.power", "Công suất (kW)") as string}
                            stroke="#3b82f6" dot={false} connectNulls />
                          {peak?.rollingDemandKw != null && (
                            <ReferenceLine y={peak.rollingDemandKw} stroke="#f59e0b" strokeDasharray="4 4"
                              label={{ value: t("energy.rollingDemand", "Demand rolling") as string, position: "insideTopRight", fontSize: 10 }} />
                          )}
                          {peak?.peakAt && peak?.instantaneousPeakKw != null && (
                            <ReferenceDot x={new Date(peak.peakAt).getTime()} y={peak.instantaneousPeakKw}
                              r={5} fill="#ef4444" stroke="none" />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Power factor (only when available) ── */}
          {pf?.available && (
            <TabsContent value="pf">
              <Card>
                <CardHeader>
                  <CardTitle>{t("energy.tabPf", "Hệ số công suất")}</CardTitle>
                  <CardDescription>{t("energy.pfDesc", "PF trung bình / nhỏ nhất và % thời gian dưới ngưỡng")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label={t("energy.pfAvg", "PF trung bình")} value={fmt(pf.avgPowerFactor, 3)} />
                    <Stat label={t("energy.pfMin", "PF nhỏ nhất")} value={fmt(pf.minPowerFactor, 3)} />
                    <Stat label={t("energy.pfThreshold", "Ngưỡng")} value={fmt(pf.threshold, 2)} />
                    <Stat label={t("energy.pfPctBelow", "% dưới ngưỡng")}
                      value={pf.pctBelowThreshold != null ? `${fmt(pf.pctBelowThreshold, 1)}%` : "—"} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    {t("energy.pfSamples", "Mẫu PF: {{pf}} / {{total}}", { pf: pf.pfSamples, total: pf.samples })}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* ── Forecast + demand-response (text only) ── */}
          <TabsContent value="forecast">
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{t("energy.tabForecast", "Dự báo")}</CardTitle>
                  <CardDescription>{t("energy.forecastDesc", "Dự báo công suất (kW) với dải tin cậy (lower/upper)")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {forecastQuery.isLoading ? (
                    <Skeleton className="h-64 w-full" />
                  ) : !forecast?.available ? (
                    <p className="text-center text-muted-foreground py-8">
                      {t("energy.forecastInsufficient", "Không đủ dữ liệu để dự báo")}
                      {forecast?.pointsUsed != null && ` (${forecast.pointsUsed} ${t("energy.points", "điểm")})`}
                    </p>
                  ) : (
                    <>
                      <div className="mb-3 text-sm text-muted-foreground">
                        {t("energy.predictedPeak", "Đỉnh dự báo")}: <span className="font-semibold text-foreground">{fmt(forecast.predictedPeak, 2)} kW</span>
                      </div>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={forecastData}>
                            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                            <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time"
                              tickFormatter={(v) => tsLabel(v)} tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip labelFormatter={(v) => tsLabel(Number(v))} />
                            <Legend />
                            {/* Confidence band: invisible base (lower) + visible band (upper-lower) stacked */}
                            <Area type="monotone" dataKey="lower" stackId="band" stroke="none" fill="none" name="lower" legendType="none" />
                            <Area type="monotone" dataKey="band" stackId="band" stroke="none"
                              fill="#3b82f6" fillOpacity={0.15} name={t("energy.confidenceBand", "Dải tin cậy") as string} />
                            <Area type="monotone" dataKey="predicted" stroke="#3b82f6" strokeWidth={2}
                              fill="none" name={t("energy.predicted", "Dự đoán") as string} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    {t("energy.demandResponseTitle", "Gợi ý demand-response")}
                  </CardTitle>
                  <CardDescription>
                    <Badge variant="outline" className="border-amber-500 text-amber-600">
                      {t("energy.advisoryOnly", "Chỉ gợi ý — không tự thực thi")}
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {demandResponseQuery.isLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : suggestions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("energy.noSuggestions", "Không có gợi ý")}</p>
                  ) : (
                    suggestions.map((s, i) => (
                      <div key={i} className="border rounded-lg p-3 text-sm">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant={
                            s.severity === "critical" ? "destructive" : s.severity === "warning" ? "default" : "secondary"
                          }>
                            {s.severity}
                          </Badge>
                        </div>
                        <p>{t(s.messageKey, s.messageKey)}</p>
                        <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                          {Object.entries(s.detail).map(([k, v]) => `${k}: ${v ?? "—"}`).join("  ·  ")}
                        </pre>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── EnPI / ISO 50001 ── */}
          <TabsContent value="enpi">
            <Card>
              <CardHeader>
                <CardTitle>{t("energy.tabEnpi", "EnPI / ISO 50001")}</CardTitle>
                <CardDescription>{t("energy.enpiDesc", "kWh/đơn vị so với baseline + carbon (CO₂)")}</CardDescription>
              </CardHeader>
              <CardContent>
                {enpiQuery.isLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : enpiRows.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t("energy.noData", "Không có dữ liệu")}</p>
                ) : (
                  <div className="border rounded-lg overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("energy.colPeriod", "Kỳ")}</TableHead>
                          <TableHead>{t("energy.colMachine", "Máy")}</TableHead>
                          <TableHead>{t("energy.colRecipe", "Recipe")}</TableHead>
                          <TableHead className="text-right">{t("energy.colKwh", "kWh")}</TableHead>
                          <TableHead className="text-right">{t("energy.colKwhPerUnit", "kWh/đơn vị")}</TableHead>
                          <TableHead className="text-right">{t("energy.colBaseline", "Baseline")}</TableHead>
                          <TableHead className="text-right">{t("energy.colCarbon", "CO₂ (kg)")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {enpiRows.map((row, i) => {
                          const r = row as Record<string, unknown>;
                          const ps = r.periodStart ? new Date(String(r.periodStart)) : null;
                          const pe = r.periodEnd ? new Date(String(r.periodEnd)) : null;
                          const epu = r.energyPerUnit != null ? num(r.energyPerUnit) : null;
                          const base = r.baselineEnergyPerUnit != null ? num(r.baselineEnergyPerUnit) : null;
                          return (
                            <TableRow key={(r.id as number | undefined) ?? i}>
                              <TableCell className="text-xs">
                                {ps ? tsLabel(ps) : "—"}{pe ? ` → ${tsLabel(pe)}` : ""}
                              </TableCell>
                              <TableCell>{machineName(r.machineId != null ? num(r.machineId) : null)}</TableCell>
                              <TableCell>{(r.recipeCode as string | null) ?? "—"}</TableCell>
                              <TableCell className="text-right">{fmt(num(r.totalKwh), 2)}</TableCell>
                              <TableCell className="text-right">{epu != null ? fmt(epu, 4) : "—"}</TableCell>
                              <TableCell className="text-right">
                                {base != null ? (
                                  <span className={epu != null && epu > base ? "text-red-500" : "text-emerald-600"}>
                                    {fmt(base, 4)}
                                  </span>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="text-right">{r.carbonKg != null ? fmt(num(r.carbonKg), 2) : "—"}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Manual reading dialog (telemetry — canCreate) */}
      {canCreate && (
        <Dialog open={readingOpen} onOpenChange={setReadingOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("energy.recordReading", "Nhập chỉ số")}</DialogTitle>
              <DialogDescription>
                {t("energy.recordReadingDesc", "Ghi một bản đo năng lượng (dữ liệu telemetry — không phải lệnh điều khiển máy)")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">{t("energy.machine", "Máy")}</Label>
                <Select value={readingForm.machineId || "none"}
                  onValueChange={(v) => setReadingForm((f) => ({ ...f, machineId: v === "none" ? "" : v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("energy.noMachine", "Không gán máy")}</SelectItem>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">{t("energy.source", "Nguồn")}</Label>
                <Select value={readingForm.source}
                  onValueChange={(v) => setReadingForm((f) => ({ ...f, source: v as ReadingForm["source"] }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">{t("energy.value", "Giá trị")} *</Label>
                <Input type="number" min={0} value={readingForm.value}
                  onChange={(e) => setReadingForm((f) => ({ ...f, value: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">{t("energy.unit", "Đơn vị")}</Label>
                <Input value={readingForm.unit}
                  onChange={(e) => setReadingForm((f) => ({ ...f, unit: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">{t("energy.power", "Công suất (kW)")}</Label>
                <Input type="number" value={readingForm.powerKw}
                  onChange={(e) => setReadingForm((f) => ({ ...f, powerKw: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label className="text-sm">{t("energy.pf", "Hệ số công suất (0-1)")}</Label>
                <Input type="number" min={0} max={1} step={0.01} value={readingForm.powerFactor}
                  onChange={(e) => setReadingForm((f) => ({ ...f, powerFactor: e.target.value }))} className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-sm">{t("energy.recipeRef", "Recipe ref")}</Label>
                <Input value={readingForm.recipeRef}
                  onChange={(e) => setReadingForm((f) => ({ ...f, recipeRef: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReadingOpen(false)}>{t("energy.cancel", "Huỷ")}</Button>
              <Button onClick={submitReading} disabled={recordReading.isPending}>
                {recordReading.isPending ? t("energy.saving", "Đang lưu...") : t("energy.save", "Lưu")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}
