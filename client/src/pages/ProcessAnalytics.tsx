/**
 * doc 56 Đ3 (client) — PROCESS ANALYTICS — pass/fail + parameter-trend over the
 * generic process-result telemetry that automation / IoT stations emit.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * READ-ONLY analytics. Consumes the aggregate reads committed in Đ3:
 *   • trpc.processResult.stats        → { pass, fail, warn, skip }
 *   • trpc.processResult.metricSeries → [{ bucket, ts, value, samples }]
 *   • trpc.processResult.stepTypes    → [{ code, nameVi, machineType }]
 *   • trpc.processResult.listBySerial → raw rows (optional serial lookup)
 *
 * All four are gated server-side by PROCESS_ANALYTICS_ENABLED — when OFF they
 * return EMPTY (never error), so this page degrades to honest empty-states
 * (hinting the operator to enable PROCESS_ANALYTICS_ENABLED / the ingest flag)
 * instead of showing a spinner or a crash.
 *
 * Two entry points, ONE shared body (`ProcessAnalyticsContent`):
 *   • default export  ProcessAnalyticsPage  — the standalone `/process-analytics`
 *       route (DashboardLayout + PageHeader + machine picker across all
 *       automation/IoT machines). Route is wired by the orchestrator.
 *   • named export    ProcessAnalyticsPanel  — the single-machine embed for the
 *       MachineCockpit "Kết quả process" tab (machineId locked, no page chrome).
 *
 * The parameter-trend ±2σ band mirrors SensorTrendTab: it is a STATISTICAL
 * reference computed from the window's bucket means — NOT an engineering limit.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  PageContainer,
  StatChip,
  StatChipRow,
  StatusBadge,
  EmptyState,
} from "@/components/patterns";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { trpc } from "@/lib/trpc";
import { useMachineTypes } from "@/hooks/useMachineTypes";
import type { Tone } from "@/components/patterns/tokens";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import {
  Activity, TrendingUp, RefreshCw, Info, Search, ClipboardList, Percent, LayoutGrid,
} from "lucide-react";

// ── small helpers ────────────────────────────────────────────────────────────
function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}
function tsLabel(t: number | Date): string {
  const d = t instanceof Date ? t : new Date(t);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** ±2σ statistical band over the bucket means (mirrors SensorTrendTab). */
interface Band { mean: number; std: number; upper: number; lower: number }
function computeBand(values: number[]): Band | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return { mean, std, upper: mean + 2 * std, lower: mean - 2 * std };
}

const LINE_COLOR = "#3b82f6";
const BAND_COLOR = "#ef4444";

/** result outcome → donut colour + StatChip tone. */
const RESULT_META = [
  { key: "pass", color: "#10b981", tone: "success" as Tone, labelKey: "processAnalytics.resultPass", labelDefault: "Đạt" },
  { key: "fail", color: "#ef4444", tone: "error" as Tone, labelKey: "processAnalytics.resultFail", labelDefault: "Lỗi" },
  { key: "warn", color: "#f59e0b", tone: "warning" as Tone, labelKey: "processAnalytics.resultWarn", labelDefault: "Cảnh báo" },
  { key: "skip", color: "#94a3b8", tone: "default" as Tone, labelKey: "processAnalytics.resultSkip", labelDefault: "Bỏ qua" },
] as const;

/** Suggested numeric metric keys — free-text input still allowed. */
const METRIC_PRESETS = [
  "torque", "angle", "force", "height", "temperature",
  "pressure", "current", "voltage", "cycleTime", "resistance",
] as const;

const RANGES = [
  { days: 1, labelKey: "processAnalytics.range1d", labelDefault: "24 giờ" },
  { days: 7, labelKey: "processAnalytics.range7d", labelDefault: "7 ngày" },
  { days: 30, labelKey: "processAnalytics.range30d", labelDefault: "30 ngày" },
] as const;

/** result string → StatusBadge tone (recent-rows table). */
function resultTone(result: string): Exclude<Tone, "accent"> {
  switch (result) {
    case "pass": return "success";
    case "fail": return "error";
    case "warn": return "warning";
    default: return "default";
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED BODY — used by both the standalone page and the cockpit tab.
// ════════════════════════════════════════════════════════════════════════════
interface ProcessAnalyticsContentProps {
  /** Locks analytics to ONE machine (cockpit tab). Omitted = cross-machine page. */
  machineId?: number;
  /** true = embedded (cockpit): hide the machine picker + the serial-lookup card. */
  embedded?: boolean;
}

function ProcessAnalyticsContent({ machineId: fixedMachineId, embedded = false }: ProcessAnalyticsContentProps) {
  const { t } = useTranslation();

  // ── filter state ──
  const [machineSel, setMachineSel] = useState<string>("all");
  const [stepType, setStepType] = useState<string>("all");
  const [sinceDays, setSinceDays] = useState<number>(7);
  const [metricInput, setMetricInput] = useState<string>("torque");
  const [metricKey, setMetricKey] = useState<string>("torque");
  const [serialInput, setSerialInput] = useState<string>("");
  const [serial, setSerial] = useState<string>("");

  const commitMetric = (v: string) => {
    const k = v.trim();
    setMetricInput(k);
    setMetricKey(k);
  };

  // Effective machine filter: fixed (embedded) or from the dropdown.
  const machineId = embedded
    ? fixedMachineId
    : machineSel !== "all" && Number.isFinite(Number(machineSel))
      ? Number(machineSel)
      : undefined;

  const bucket: "hour" | "day" = sinceDays >= 30 ? "day" : "hour";

  // ── machine picker (cross-machine page only) — automation/IoT only ──
  const { types } = useMachineTypes();
  const processTypes = useMemo(
    () => new Set<string>(
      types.filter((e) => e.deviceClass === "automation" || e.deviceClass === "iot").map((e) => e.type),
    ),
    [types],
  );
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: !embedded });
  const machines = useMemo(
    () => (machinesQ.data ?? []).filter((m) => processTypes.has(String((m as { machineType?: string }).machineType))),
    [machinesQ.data, processTypes],
  );
  const machineName = (id: number | null | undefined) => {
    if (id == null) return "—";
    const m = (machinesQ.data ?? []).find((x) => x.id === id);
    return m?.name ?? `#${id}`;
  };

  // ── reads (all gated by PROCESS_ANALYTICS_ENABLED → empty when OFF) ──
  const stepTypesQ = trpc.processResult.stepTypes.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const stepTypeList = stepTypesQ.data ?? [];

  const commonFilter = {
    ...(machineId != null ? { machineId } : {}),
    ...(stepType !== "all" ? { stepType } : {}),
    sinceDays,
  };

  const statsQ = trpc.processResult.stats.useQuery(commonFilter);
  const seriesQ = trpc.processResult.metricSeries.useQuery(
    { ...(machineId != null ? { machineId } : {}), ...(stepType !== "all" ? { stepType } : {}), metricKey, sinceDays, bucket },
    { enabled: metricKey.length > 0 },
  );
  const serialQ = trpc.processResult.listBySerial.useQuery(
    { serialNumber: serial, limit: 200 },
    { enabled: !embedded && serial.length > 0 },
  );
  // doc 56 Đ5 — server-authoritative SPC (I-MR control limits + Cpk) for the metric.
  const spcQ = trpc.processResult.spcChart.useQuery(
    { ...(machineId != null ? { machineId } : {}), ...(stepType !== "all" ? { stepType } : {}), metricKey, sinceDays },
    { enabled: metricKey.length > 0 },
  );
  // doc 56 Đ5 — fleet rollup by machineType (cross-machine page only).
  const fleetQ = trpc.processResult.fleetRollup.useQuery({ sinceDays }, { enabled: !embedded });

  const refetchAll = () => {
    void statsQ.refetch();
    void seriesQ.refetch();
    void spcQ.refetch();
    if (!embedded) void fleetQ.refetch();
    if (serial.length > 0) void serialQ.refetch();
  };
  const spc = spcQ.data;

  // ── derived: pass/fail ──
  const stats = statsQ.data ?? { pass: 0, fail: 0, warn: 0, skip: 0 };
  const total = stats.pass + stats.fail + stats.warn + stats.skip;
  const failRate = total > 0 ? (stats.fail / total) * 100 : 0;
  const donutData = RESULT_META
    .map((m) => ({ key: m.key, name: t(m.labelKey, m.labelDefault), value: stats[m.key], color: m.color }))
    .filter((d) => d.value > 0);

  // ── derived: metric trend + band ──
  const series = seriesQ.data ?? [];
  const band = useMemo(() => computeBand(series.map((p) => p.value)), [series]);
  const chartData = series.map((p) => ({ ts: p.ts, value: p.value, samples: p.samples }));

  const emptyHint = (
    <EmptyState
      variant="no-analytics"
      title={t("processAnalytics.emptyTitle", "Chưa có dữ liệu kết quả process")}
      description={t(
        "processAnalytics.emptyHint",
        "Bật cờ PROCESS_ANALYTICS_ENABLED (đọc) và PROCESS_RESULT_INGEST_ENABLED (ghi), rồi để máy gửi kết quả bước công đoạn.",
      )}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Filter bar ── */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            {!embedded && (
              <div>
                <Label className="text-sm">{t("processAnalytics.filterMachine", "Máy")}</Label>
                <Select value={machineSel} onValueChange={setMachineSel}>
                  <SelectTrigger className="mt-1 w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("processAnalytics.allMachines", "Tất cả máy")}</SelectItem>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-sm">{t("processAnalytics.filterStepType", "Bước công đoạn")}</Label>
              <Select value={stepType} onValueChange={setStepType}>
                <SelectTrigger className="mt-1 w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("processAnalytics.allStepTypes", "Tất cả bước")}</SelectItem>
                  {stepTypeList.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.nameVi ?? s.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-sm">{t("processAnalytics.range", "Khoảng thời gian")}</Label>
              <div className="mt-1 flex gap-1">
                {RANGES.map((r) => (
                  <Button
                    key={r.days}
                    size="sm"
                    variant={r.days === sinceDays ? "default" : "outline"}
                    className="h-9 px-3 text-xs"
                    onClick={() => setSinceDays(r.days)}
                  >
                    {t(r.labelKey, r.labelDefault)}
                  </Button>
                ))}
              </div>
            </div>

            <Button variant="outline" size="sm" className="ml-auto h-9" onClick={refetchAll}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${statsQ.isFetching || seriesQ.isFetching ? "animate-spin" : ""}`} />
              {t("processAnalytics.refresh", "Làm mới")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Panel 1 — pass/fail ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t("processAnalytics.panelPassFail", "Tỉ lệ pass/fail")}
          </CardTitle>
          <CardDescription>
            {t("processAnalytics.panelPassFailDesc", "Kết quả bước công đoạn trong kỳ đã chọn")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AsyncBoundary
            isLoading={statsQ.isLoading}
            isError={statsQ.isError}
            error={statsQ.error}
            isEmpty={total === 0}
            onRetry={statsQ.refetch}
            preset="chart"
            errorTitle={t("processAnalytics.loadError", "Không tải được dữ liệu")}
            emptyState={emptyHint}
          >
            <div className="grid items-center gap-6 md:grid-cols-2">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="80%"
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {donutData.map((d) => <Cell key={d.key} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [fmt(v, 0), n]} contentStyle={{ fontSize: 12 }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-4">
                <StatChipRow className="flex-wrap">
                  {RESULT_META.map((m) => (
                    <StatChip
                      key={m.key}
                      label={t(m.labelKey, m.labelDefault)}
                      value={fmt(stats[m.key], 0)}
                      tone={m.tone}
                    />
                  ))}
                </StatChipRow>
                <div className="flex flex-wrap items-center gap-3">
                  <StatChip
                    icon={<Percent className="h-3.5 w-3.5" />}
                    label={t("processAnalytics.failRate", "Tỉ lệ lỗi")}
                    value={`${fmt(failRate, 1)}%`}
                    tone={failRate > 5 ? "error" : failRate > 1 ? "warning" : "success"}
                  />
                  <StatChip
                    label={t("processAnalytics.total", "Tổng")}
                    value={fmt(total, 0)}
                    tone="info"
                  />
                </div>
              </div>
            </div>
          </AsyncBoundary>
        </CardContent>
      </Card>

      {/* ── Panel 2 — parameter trend + ±2σ band ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {t("processAnalytics.panelTrend", "Xu hướng thông số")}
          </CardTitle>
          <CardDescription>
            {t("processAnalytics.panelTrendDesc", "Giá trị trung bình theo bucket kèm dải tham chiếu ±2σ")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* metric-key chooser */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-sm">{t("processAnalytics.metricKey", "Thông số")}</Label>
              <Input
                value={metricInput}
                onChange={(e) => setMetricInput(e.target.value)}
                onBlur={() => commitMetric(metricInput)}
                onKeyDown={(e) => { if (e.key === "Enter") commitMetric(metricInput); }}
                placeholder={t("processAnalytics.metricKeyHint", "vd torque, angle…")}
                className="mt-1 w-52"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {METRIC_PRESETS.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === metricKey ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => commitMetric(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>

          <AsyncBoundary
            isLoading={seriesQ.isLoading && metricKey.length > 0}
            isError={seriesQ.isError}
            error={seriesQ.error}
            isEmpty={chartData.length === 0}
            onRetry={seriesQ.refetch}
            preset="chart"
            errorTitle={t("processAnalytics.loadError", "Không tải được dữ liệu")}
            emptyState={
              <EmptyState
                variant="no-analytics"
                title={t("processAnalytics.emptyTrendTitle", "Chưa có dữ liệu thông số")}
                description={t(
                  "processAnalytics.emptyTrendHint",
                  "Không có mẫu số cho khoá thông số này trong kỳ. Thử khoá khác hoặc mở rộng khoảng thời gian.",
                )}
              />
            }
          >
            <>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      scale="time"
                      tickFormatter={(v) => tsLabel(Number(v))}
                      tick={{ fontSize: 11 }}
                      minTickGap={40}
                    />
                    <YAxis tick={{ fontSize: 11 }} width={52} domain={["auto", "auto"]} />
                    <Tooltip
                      labelFormatter={(v) => tsLabel(Number(v))}
                      formatter={(val: number, _n, item) => {
                        const samples = (item?.payload as { samples?: number } | undefined)?.samples;
                        return [`${fmt(Number(val), 3)}${samples != null ? ` (${samples})` : ""}`, metricKey];
                      }}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {/* doc 56 Đ5 — prefer server-authoritative I-MR control limits; fall back to the client ±2σ band. */}
                    {spc?.ok && spc.limits ? (
                      <>
                        <ReferenceLine y={spc.limits.CL} stroke={LINE_COLOR} strokeDasharray="4 4" strokeOpacity={0.7}
                          label={{ value: "CL", fontSize: 10, fill: LINE_COLOR, position: "right" }} />
                        <ReferenceLine y={spc.limits.UCL} stroke={BAND_COLOR} strokeDasharray="2 4" strokeOpacity={0.7}
                          label={{ value: "UCL", fontSize: 10, fill: BAND_COLOR, position: "right" }} />
                        <ReferenceLine y={spc.limits.LCL} stroke={BAND_COLOR} strokeDasharray="2 4" strokeOpacity={0.7}
                          label={{ value: "LCL", fontSize: 10, fill: BAND_COLOR, position: "right" }} />
                      </>
                    ) : band ? (
                      <>
                        <ReferenceLine y={band.mean} stroke={LINE_COLOR} strokeDasharray="4 4" strokeOpacity={0.6}
                          label={{ value: t("processAnalytics.mean", "TB"), fontSize: 10, fill: LINE_COLOR, position: "right" }} />
                        <ReferenceLine y={band.upper} stroke={BAND_COLOR} strokeDasharray="2 4" strokeOpacity={0.6}
                          label={{ value: "+2σ", fontSize: 10, fill: BAND_COLOR, position: "right" }} />
                        <ReferenceLine y={band.lower} stroke={BAND_COLOR} strokeDasharray="2 4" strokeOpacity={0.6}
                          label={{ value: "-2σ", fontSize: 10, fill: BAND_COLOR, position: "right" }} />
                      </>
                    ) : null}
                    <Line type="monotone" dataKey="value" stroke={LINE_COLOR} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {band && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>{t("processAnalytics.mean", "TB")}: <span className="font-mono text-foreground">{fmt(band.mean, 3)}</span></span>
                  <span>σ: <span className="font-mono text-foreground">{fmt(band.std, 3)}</span></span>
                  <span>{t("processAnalytics.buckets", "Số bucket")}: <span className="font-mono text-foreground">{chartData.length}</span></span>
                </div>
              )}
              {/* doc 56 Đ5 — SPC (I-MR) verdict from the server: control limits, σ̂, Cpk, #out-of-control. */}
              {spc?.ok && spc.limits && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t("processAnalytics.spc", "SPC (I-MR)")}:</span>
                  <span>UCL <span className="font-mono text-foreground">{fmt(spc.limits.UCL, 3)}</span></span>
                  <span>CL <span className="font-mono text-foreground">{fmt(spc.limits.CL, 3)}</span></span>
                  <span>LCL <span className="font-mono text-foreground">{fmt(spc.limits.LCL, 3)}</span></span>
                  <span>σ̂ <span className="font-mono text-foreground">{fmt(spc.estimatedSigma, 3)}</span></span>
                  {spc.capability?.cpk != null && (
                    <span>Cpk <span className={`font-mono ${spc.capability.cpk >= 1.33 ? "text-success" : spc.capability.cpk >= 1 ? "text-warning" : "text-destructive"}`}>{fmt(spc.capability.cpk, 2)}</span></span>
                  )}
                  <span className={spc.outOfControlCount > 0 ? "text-destructive" : ""}>
                    {t("processAnalytics.outOfControl", "Ngoài kiểm soát")}: <span className="font-mono">{spc.outOfControlCount}/{spc.n}</span>
                  </span>
                </div>
              )}
              {band && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Info className="h-3 w-3 shrink-0" />
                  {t("processAnalytics.bandNote", "Dải ±2σ là tham chiếu thống kê từ dữ liệu trong kỳ — không phải giới hạn kỹ thuật.")}
                </div>
              )}
            </>
          </AsyncBoundary>
        </CardContent>
      </Card>

      {/* ── doc 56 Đ5 — Fleet rollup by machineType / deviceClass (cross-machine page only) ── */}
      {!embedded && (fleetQ.data ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              {t("processAnalytics.fleetTitle", "Tổng hợp theo loại máy")}
            </CardTitle>
            <CardDescription>
              {t("processAnalytics.fleetDesc", "Pass-rate & first-pass yield theo loại thiết bị trong kỳ")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("processAnalytics.colType", "Loại máy")}</TableHead>
                    <TableHead>{t("processAnalytics.colClass", "Nhóm")}</TableHead>
                    <TableHead className="text-right">{t("processAnalytics.colTotal", "Tổng")}</TableHead>
                    <TableHead className="text-right">{t("processAnalytics.colPass", "Đạt")}</TableHead>
                    <TableHead className="text-right">{t("processAnalytics.colFail", "Lỗi")}</TableHead>
                    <TableHead className="text-right">{t("processAnalytics.colFpy", "FPY")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(fleetQ.data ?? []).map((r) => {
                    const fpy = r.firstPassYield;
                    return (
                      <TableRow key={String(r.machineType ?? "?")}>
                        <TableCell className="font-mono text-xs">{r.machineType ?? "—"}</TableCell>
                        <TableCell className="text-xs capitalize text-muted-foreground">{r.deviceClass ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.total}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-success">{r.pass}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-destructive">{r.fail}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {fpy != null ? <span className={fpy >= 0.95 ? "text-success" : fpy >= 0.8 ? "text-warning" : "text-destructive"}>{fmt(fpy * 100, 1)}%</span> : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Optional — recent rows by serial (standalone page only) ── */}
      {!embedded && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              {t("processAnalytics.recentTitle", "Bản ghi gần đây theo serial")}
            </CardTitle>
            <CardDescription>
              {t("processAnalytics.recentDesc", "Tra cứu kết quả process theo số serial cụ thể")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="grow">
                <Label className="text-sm">{t("processAnalytics.serial", "Số serial")}</Label>
                <Input
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") setSerial(serialInput.trim()); }}
                  placeholder={t("processAnalytics.serialPlaceholder", "Nhập số serial…")}
                  className="mt-1 max-w-sm"
                />
              </div>
              <Button size="sm" className="h-9" onClick={() => setSerial(serialInput.trim())}>
                <Search className="mr-1.5 h-4 w-4" />
                {t("processAnalytics.search", "Tra cứu")}
              </Button>
            </div>

            {serial.length > 0 && (
              <AsyncBoundary
                isLoading={serialQ.isLoading}
                isError={serialQ.isError}
                error={serialQ.error}
                isEmpty={(serialQ.data?.length ?? 0) === 0}
                onRetry={serialQ.refetch}
                preset="table"
                errorTitle={t("processAnalytics.loadError", "Không tải được dữ liệu")}
                emptyState={
                  <EmptyState
                    variant="no-results"
                    title={t("processAnalytics.recentEmpty", "Không có bản ghi cho serial này")}
                    description={t("processAnalytics.recentEmptyHint", "Serial chưa có kết quả process, hoặc cờ analytics đang tắt.")}
                  />
                }
              >
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("processAnalytics.colTime", "Thời điểm")}</TableHead>
                        <TableHead>{t("processAnalytics.colStep", "Bước")}</TableHead>
                        <TableHead>{t("processAnalytics.colResult", "Kết quả")}</TableHead>
                        <TableHead>{t("processAnalytics.colMachine", "Máy")}</TableHead>
                        <TableHead>{t("processAnalytics.colMetrics", "Thông số")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(serialQ.data ?? []).map((row) => {
                        const r = row as Record<string, unknown>;
                        const metrics = (r.metrics ?? {}) as Record<string, unknown>;
                        const metricStr = Object.entries(metrics)
                          .map(([k, v]) => `${k}: ${v ?? "—"}`)
                          .join(" · ");
                        return (
                          <TableRow key={String(r.id)}>
                            <TableCell className="text-xs">{r.measuredAt ? tsLabel(new Date(String(r.measuredAt))) : "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{String(r.stepType ?? "—")}</TableCell>
                            <TableCell>
                              <StatusBadge status={String(r.result ?? "—")} tone={resultTone(String(r.result ?? ""))} className="px-1.5 py-0 text-[11px] capitalize" />
                            </TableCell>
                            <TableCell className="text-xs">{machineName(r.machineId != null ? Number(r.machineId) : null)}</TableCell>
                            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={metricStr}>
                              {metricStr || "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </AsyncBoundary>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PUBLIC ENTRY POINTS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Single-machine embed for the MachineCockpit "Kết quả process" tab. No page
 * chrome — the cockpit supplies the tab + layout. `machineId` locks the filter.
 */
export function ProcessAnalyticsPanel({ machineId }: { machineId: number }) {
  return <ProcessAnalyticsContent machineId={machineId} embedded />;
}

/** Standalone `/process-analytics` route (orchestrator wires the router entry). */
export default function ProcessAnalyticsPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <PageContainer className="flex flex-col gap-6 space-y-0">
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("processAnalytics.title", "Phân tích kết quả process")}
          description={t(
            "processAnalytics.subtitle",
            "Tỉ lệ pass/fail và xu hướng thông số theo bước công đoạn (máy tự động hoá / IoT)",
          )}
        />
        <ProcessAnalyticsContent />
      </PageContainer>
    </DashboardLayout>
  );
}
