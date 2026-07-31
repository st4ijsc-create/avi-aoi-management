import { useState, useMemo } from "react";
// doc 64 IA-10 S2 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AdvancedSection } from "@/components/AdvancedSection";
import {
  PageHeader, chartColor, chartGridProps, chartAxisTick, chartTooltipStyle,
} from "@/components/patterns";
import {
  ComposedChart, Line, Scatter, Bar, BarChart, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceArea, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  AlertTriangle, CheckCircle, RefreshCw, Download, ChevronDown, Lightbulb,
  Target, Activity,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────
function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function cpkColor(v: number | null | undefined): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 1.33) return "text-success";
  if (v >= 1.0) return "text-warning";
  return "text-destructive";
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ChartType = 'xbar_r' | 'xbar_s' | 'individual_mr';

export default function SPCAnalysis() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t('spc.spcAnalysisTitle')}>
      <SPCAnalysisContent />
    </DashboardLayout>
  );
}

// Embeddable content (no DashboardLayout) — reused by QualityCockpit's SPC tab.
export function SPCAnalysisContent() {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [selectedMP, setSelectedMP] = useState<string>("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<string>("all");
  const [chartType, setChartType] = useState<ChartType>("xbar_r");
  const [subgroupSize, setSubgroupSize] = useState(5);

  const { data: machines } = trpc.machine.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery(undefined as any);
  const { data: measurementPoints } = trpc.measurementPoint.list.useQuery();

  // doc 64 IA-10 S2 — trục phạm vi: dropdown máy tại-trang THẮNG, trục lấp khi "all".
  const { scope: assetScope } = useScope(["machine"]);
  useScopeWired();

  const mpId = selectedMP ? Number(selectedMP) : undefined;
  const machineId = selectedMachine !== "all" ? Number(selectedMachine) : assetScope.machineId;
  const productModelId = selectedProduct !== "all" ? Number(selectedProduct) : undefined;

  // USL/LSL/Target overrides (user-entered). null = use DB spec (or none).
  const [uslInput, setUslInput] = useState<string>("");
  const [lslInput, setLslInput] = useState<string>("");
  const [targetInput, setTargetInput] = useState<string>("");
  // Applied override values fed into query A (only change on "Apply").
  const [uslApplied, setUslApplied] = useState<number | null>(null);
  const [lslApplied, setLslApplied] = useState<number | null>(null);
  const [specPrefilledFor, setSpecPrefilledFor] = useState<string>("");

  // ─── Query A: spec-driven panels (capability / Pareto / spec-KPI). ─────────
  // Key = {filters + USL/LSL}. NOT keyed on chartType/subgroupSize → switching
  // the chart type does NOT refetch this query. Uses fixed defaults so the
  // within-subgroup sigma (and thus Cpk) stays stable across chart-type changes.
  const { data, isLoading, refetch, isFetching } = trpc.spcAnalysis.fullAnalysis.useQuery(
    {
      measurementPointDefId: mpId!,
      productModelId,
      machineId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      subgroupSize: 5,
      chartType: 'xbar_r',
      uslOverride: uslApplied,
      lslOverride: lslApplied,
    },
    { enabled: !!mpId },
  );

  // ─── Query B: control chart only. Key = {filters + chartType + subgroupSize}.
  // Switching chartType re-fetches ONLY this query; placeholderData keeps the
  // previous chart visible (no flicker) while the new one loads.
  const {
    data: ctrl,
    isFetching: isCtrlFetching,
  } = trpc.spcAnalysis.controlChart.useQuery(
    {
      measurementPointDefId: mpId!,
      productModelId,
      machineId,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      subgroupSize,
      chartType,
    },
    { enabled: !!mpId, placeholderData: (prev) => prev },
  );

  // Optional AI root-cause (preserved as collapsible, also available on AI Inspection Analytics)
  const { data: rootCauseData } = trpc.spcAnalysis.rootCauseSuggestions.useQuery(
    {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      machineId,
    },
    { enabled: !!mpId },
  );

  // CPK trend collapsible
  const { data: cpkTrendData } = trpc.cpkTrend.trend.useQuery(
    { measurementPointDefId: mpId!, startDate: dateRange.startDate, endDate: dateRange.endDate, limit: 30 },
    { enabled: !!mpId },
  );

  // Saved violations collapsible
  const { data: savedViolations, refetch: refetchSaved } = trpc.spcRuleViolation.list.useQuery(
    { startDate: dateRange.startDate, endDate: dateRange.endDate, limit: 50 },
    { enabled: !!mpId },
  );
  const ackMutation = trpc.spcRuleViolation.acknowledge.useMutation({ onSuccess: () => refetchSaved() });
  const resolveMutation = trpc.spcRuleViolation.resolve.useMutation({ onSuccess: () => refetchSaved() });

  // Prefill USL/LSL/Target inputs from DB spec when point changes (user can override).
  const pointDef = data?.pointDef as { upperLimit?: any; lowerLimit?: any; nominalValue?: any } | null | undefined;
  if (pointDef !== undefined && selectedMP && specPrefilledFor !== selectedMP) {
    const dbUsl = pointDef?.upperLimit != null ? String(Number(pointDef.upperLimit)) : "";
    const dbLsl = pointDef?.lowerLimit != null ? String(Number(pointDef.lowerLimit)) : "";
    const dbTarget = pointDef?.nominalValue != null ? String(Number(pointDef.nominalValue)) : "";
    setUslInput(dbUsl);
    setLslInput(dbLsl);
    setTargetInput(dbTarget);
    setUslApplied(dbUsl !== "" ? Number(dbUsl) : null);
    setLslApplied(dbLsl !== "" ? Number(dbLsl) : null);
    setSpecPrefilledFor(selectedMP);
  }

  const applySpec = () => {
    setUslApplied(uslInput.trim() !== "" ? Number(uslInput) : null);
    setLslApplied(lslInput.trim() !== "" ? Number(lslInput) : null);
  };

  // Lưu spec vào điểm đo (DB) → lần sau tự prefill cho mọi người.
  const saveSpecMutation = trpc.spcAnalysis.saveSpecLimits.useMutation({
    onSuccess: () => { toast.success(t('spc.specSaved')); refetch(); },
    onError: (e) => toastTrpcError(e),
  });
  const saveSpec = () => {
    if (!mpId) return;
    applySpec();
    const num = (s: string) => (s.trim() !== "" ? Number(s) : null);
    saveSpecMutation.mutate({
      measurementPointDefId: mpId,
      usl: num(uslInput),
      lsl: num(lslInput),
      target: num(targetInput),
    });
  };

  // ─── Primary control chart data for Recharts (from query B = ctrl) ─────────
  const primaryChartData = useMemo(() => {
    if (!ctrl?.chart) return [];
    return ctrl.chart.primary.points.map((p) => ({
      index: p.index + 1,
      value: p.value,
      ooc: p.outOfControl ? p.value : null,
      rules: p.violatedRules,
    }));
  }, [ctrl]);

  const secondaryChartData = useMemo(() => {
    if (!ctrl?.chart) return [];
    return ctrl.chart.secondary.points.map((p) => ({
      index: p.index + 1,
      value: p.value,
      ooc: p.outOfControl ? p.value : null,
    }));
  }, [ctrl]);

  const histogramData = useMemo(() => {
    if (!data?.capability?.histogram) return [];
    const usl = data.specLimits?.usl;
    const lsl = data.specLimits?.lsl;
    return data.capability.histogram.map((b: any) => {
      const outOfSpec = (usl != null && b.binMid > usl) || (lsl != null && b.binMid < lsl);
      return { label: b.binMid, count: b.count, normal: b.normalCount, outOfSpec };
    });
  }, [data]);

  const paretoData = useMemo(() => {
    if (!data?.pareto) return [];
    return data.pareto.map((p) => ({
      code: p.pointCode,
      ngCount: p.ngCount,
      cumulative: p.cumulativePercent,
    }));
  }, [data]);

  // ─── Export ───────────────────────────────────────────────────────────────
  const handleExportJSON = () => {
    if (!data) return;
    downloadFile(`spc-analysis-${selectedMP}-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const handleExportCSV = () => {
    if (!ctrl?.chart) return;
    const rows: string[] = ['index,primary_value,out_of_control,violated_rules'];
    for (const p of ctrl.chart.primary.points) {
      rows.push(`${p.index + 1},${p.value},${p.outOfControl},"${p.violatedRules.join(';')}"`);
    }
    downloadFile(`spc-chart-${selectedMP}-${Date.now()}.csv`, rows.join('\n'), 'text/csv');
  };

  const chart = ctrl?.chart;
  const cap = data?.capability;
  const spec = data?.specLimits;
  // KPI: spec-driven values from query A; %OOC from query B (chart-dependent).
  const kpi = data?.kpi ? { ...data.kpi, oocPercent: ctrl?.oocPercent ?? data.kpi.oocPercent } : null;

  // Zone boundaries (A/B/C) from CL ± k*plotSigma
  const zones = useMemo(() => {
    if (!chart) return null;
    const cl = chart.primary.limits.CL;
    const s = chart.plotSigma;
    return {
      cl,
      c1Top: cl + s, c1Bot: cl - s,
      b2Top: cl + 2 * s, b2Bot: cl - 2 * s,
      a3Top: chart.primary.limits.UCL, a3Bot: chart.primary.limits.LCL,
    };
  }, [chart]);

  return (
      <div className="space-y-4">
        {/* Header */}
        <PageHeader
          title={t('spc.spcAnalysisTitle')}
          description={t('spc.spcAnalysisFullDesc')}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={!mpId}>
                <RefreshCw className={`h-4 w-4 mr-2 ${(isFetching || isCtrlFetching) ? 'animate-spin' : ''}`} />
                {t('common.refresh')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!ctrl?.chart}>
                <Download className="h-4 w-4 mr-2" />CSV
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportJSON} disabled={!data}>
                <Download className="h-4 w-4 mr-2" />JSON
              </Button>
            </>
          }
        />

        {/* Sticky Filters */}
        <Card className="sticky top-0 z-10">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3 items-end">
              <div className="space-y-1 xl:col-span-2">
                <Label>{t('spc.measurementPoint')}</Label>
                <Select value={selectedMP} onValueChange={setSelectedMP}>
                  <SelectTrigger><SelectValue placeholder={t('spc.select')} /></SelectTrigger>
                  <SelectContent>
                    {measurementPoints?.map((mp: { id: number; code: string; name: string }) => (
                      <SelectItem key={mp.id} value={String(mp.id)}>{mp.code} – {mp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t('common.product')}</Label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {products?.map((p: { id: number; name: string; code: string }) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t('common.machine')}</Label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.allMachines')}</SelectItem>
                    {machines?.map((m: { id: number; name: string }) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t('spc.subgroupSize', { size: subgroupSize })}</Label>
                <Input type="range" min={2} max={25} value={subgroupSize}
                  disabled={chartType === 'individual_mr'}
                  onChange={(e) => setSubgroupSize(Number(e.target.value))} />
              </div>
              <div className="space-y-1">
                <Label>{t('common.startDate')}</Label>
                <Input type="date" value={dateRange.startDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('common.endDate')}</Label>
                <Input type="date" value={dateRange.endDate}
                  onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {!mpId ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-3 opacity-40" />
            {t('spc.selectMeasurementPointPrompt')}
          </CardContent></Card>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        ) : data?.insufficient ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('spc.insufficientData')}</AlertTitle>
            <AlertDescription>{t('spc.insufficientDataSamples')} ({data.sampleCount})</AlertDescription>
          </Alert>
        ) : (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <KpiCard label="Cpk" value={kpi?.cpk?.toFixed(2) ?? '—'} className={cpkColor(kpi?.cpk)} />
              <KpiCard label="Ppk" value={kpi?.ppk?.toFixed(2) ?? '—'} className={cpkColor(kpi?.ppk)} />
              <KpiCard label={t('spc.oocPercent')} value={`${kpi?.oocPercent ?? 0}%`} />
              <KpiCard label={t('spc.sigmaLevel')} value={`${kpi?.sigmaLevel ?? 0}σ`} />
              <KpiCard label="DPMO" value={(kpi?.dpmo ?? 0).toLocaleString()} />
              <KpiCard label={t('spc.yield')} value={`${kpi?.yield ?? 0}%`} />
              <KpiCard label={t('spc.sampleCount')} value={(kpi?.sampleCount ?? 0).toLocaleString()} />
            </div>

            {/* (A) Control Chart + (B) Capability */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Control Chart */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Activity className="h-4 w-4" />
                        {chartType === 'xbar_r' ? t('spc.chartXbarR') : chartType === 'xbar_s' ? t('spc.chartXbarS') : t('spc.chartImr')}
                      </CardTitle>
                      <CardDescription>
                        CL {chart?.primary.limits.CL} · UCL {chart?.primary.limits.UCL} · LCL {chart?.primary.limits.LCL}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      {isCtrlFetching && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      <Select value={chartType} onValueChange={(v) => setChartType(v as ChartType)}>
                        <SelectTrigger className="h-8 w-40" aria-label={t('spc.chartType')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="xbar_r">{t('spc.chartXbarR')}</SelectItem>
                          <SelectItem value="xbar_s">{t('spc.chartXbarS')}</SelectItem>
                          <SelectItem value="individual_mr">{t('spc.chartImr')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {!chart || primaryChartData.length === 0 ? (
                    <div className="h-[240px] flex flex-col items-center justify-center text-center text-muted-foreground">
                      <Activity className="h-8 w-8 mb-2 opacity-40" />
                      <p className="text-sm">{t('spc.noDataInRange')}</p>
                    </div>
                  ) : (
                    <>
                      {/* X̄ / Individuals chart: measurement series with CL/UCL/LCL
                          control limits and Nelson-zone bands (A/B/C). Out-of-control
                          points (the `ooc` flag already computed server-side) are
                          overplotted as a destructive-coloured Scatter. */}
                      <ResponsiveContainer width="100%" height={240}>
                        <ComposedChart data={primaryChartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid {...chartGridProps} />
                          <XAxis dataKey="index" tick={chartAxisTick} />
                          <YAxis tick={chartAxisTick} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={chartTooltipStyle} />
                          {zones && (
                            <>
                              <ReferenceArea y1={zones.c1Bot} y2={zones.c1Top} fill="var(--success)" fillOpacity={0.1} />
                              <ReferenceArea y1={zones.c1Top} y2={zones.b2Top} fill="var(--warning)" fillOpacity={0.1} />
                              <ReferenceArea y1={zones.b2Bot} y2={zones.c1Bot} fill="var(--warning)" fillOpacity={0.1} />
                              <ReferenceArea y1={zones.b2Top} y2={zones.a3Top} fill="var(--destructive)" fillOpacity={0.08} />
                              <ReferenceArea y1={zones.a3Bot} y2={zones.b2Bot} fill="var(--destructive)" fillOpacity={0.08} />
                            </>
                          )}
                          <ReferenceLine y={chart.primary.limits.UCL} stroke="var(--destructive)" strokeDasharray="4 2" label={{ value: 'UCL', fontSize: 10, position: 'right', fill: 'var(--muted-foreground)' }} />
                          <ReferenceLine y={chart.primary.limits.CL} stroke={chartColor(1)} label={{ value: 'CL', fontSize: 10, position: 'right', fill: 'var(--muted-foreground)' }} />
                          <ReferenceLine y={chart.primary.limits.LCL} stroke="var(--destructive)" strokeDasharray="4 2" label={{ value: 'LCL', fontSize: 10, position: 'right', fill: 'var(--muted-foreground)' }} />
                          <Line type="monotone" dataKey="value" stroke={chartColor(0)} strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
                          <Scatter dataKey="ooc" fill="var(--destructive)" shape="circle" isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>

                      {/* Secondary (R / S / MR) chart */}
                      <ResponsiveContainer width="100%" height={140}>
                        <ComposedChart data={secondaryChartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                          <CartesianGrid {...chartGridProps} />
                          <XAxis dataKey="index" tick={chartAxisTick} />
                          <YAxis tick={chartAxisTick} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={chartTooltipStyle} />
                          <ReferenceLine y={chart.secondary.limits.UCL} stroke="var(--destructive)" strokeDasharray="4 2" />
                          <ReferenceLine y={chart.secondary.limits.CL} stroke={chartColor(1)} />
                          <ReferenceLine y={chart.secondary.limits.LCL} stroke="var(--destructive)" strokeDasharray="4 2" />
                          <Line type="monotone" dataKey="value" stroke={chartColor(4)} strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
                          <Scatter dataKey="ooc" fill="var(--destructive)" shape="circle" isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                      <p className="text-xs text-muted-foreground mt-1">
                        {chart.secondary.label === 'range' ? t('spc.rChart') : chart.secondary.label === 'stddev' ? t('spc.sChart') : t('spc.mrChart')}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Capability + Histogram */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />{t('spc.capability')}
                  </CardTitle>
                  <CardDescription>
                    {t('spc.mean')} {cap?.mean} · σ̂ {cap?.estimatedSigma} · USL {spec?.usl ?? '—'} / LSL {spec?.lsl ?? '—'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                    <CapBox label="Cp" value={cap?.cp} />
                    <CapBox label="Cpk" value={cap?.cpk} />
                    <CapBox label="Pp" value={cap?.pp} />
                    <CapBox label="Ppk" value={cap?.ppk} />
                  </div>

                  {/* USL / LSL / Target inputs — drive capability (query A). */}
                  <div className="flex flex-wrap items-end gap-2 mb-2">
                    <div className="space-y-1">
                      <Label className="text-xs">USL</Label>
                      <Input type="number" step="any" className="h-8 w-24" value={uslInput}
                        placeholder="—" onChange={(e) => setUslInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">LSL</Label>
                      <Input type="number" step="any" className="h-8 w-24" value={lslInput}
                        placeholder="—" onChange={(e) => setLslInput(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('spc.target')}</Label>
                      <Input type="number" step="any" className="h-8 w-24" value={targetInput}
                        placeholder="—" onChange={(e) => setTargetInput(e.target.value)} />
                    </div>
                    <Button size="sm" className="h-8" onClick={applySpec} disabled={isFetching}>
                      {t('spc.applySpec')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={saveSpec}
                      disabled={!mpId || saveSpecMutation.isPending}>
                      {t('spc.saveSpec')}
                    </Button>
                  </div>
                  {cap?.cpk == null && spec?.usl == null && spec?.lsl == null && (
                    <p className="text-xs text-warning mb-2">{t('spc.enterSpecToComputeCpk')}</p>
                  )}

                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={histogramData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="label" tick={chartAxisTick} />
                      <YAxis tick={chartAxisTick} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="count" fillOpacity={0.75} isAnimationActive={false}>
                        {histogramData.map((b: any, i: number) => <Cell key={i} fill={b.outOfSpec ? 'var(--destructive)' : chartColor(0)} />)}
                      </Bar>
                      <Line type="monotone" dataKey="normal" stroke={chartColor(1)} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground mt-1">{t('spc.histogramNormalOverlay')}</p>
                </CardContent>
              </Card>
            </div>

            {/* (C) Violations + Pareto */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />{t('spc.ruleViolations')}
                    <Badge variant="secondary">{ctrl?.violations.summary.total ?? 0}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {t('spc.critical')}: {ctrl?.violations.summary.critical ?? 0} · {t('spc.warning')}: {ctrl?.violations.summary.warning ?? 0} · {t('spc.info')}: {ctrl?.violations.summary.info ?? 0}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ctrl?.violations.items.length ? (
                    <div className="overflow-auto max-h-72">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b text-left">
                          <th className="py-1 px-2">{t('spc.rule')}</th>
                          <th className="py-1 px-2">{t('spc.dataPoints')}</th>
                          <th className="py-1 px-2 text-right">{t('common.value')}</th>
                          <th className="py-1 px-2">{t('spc.severity')}</th>
                        </tr></thead>
                        <tbody>
                          {ctrl.violations.items.map((v, i) => (
                            <tr key={i} className="border-b hover:bg-muted/50">
                              <td className="py-1 px-2">{v.ruleName}</td>
                              <td className="py-1 px-2">#{v.pointIndex + 1}</td>
                              <td className="py-1 px-2 text-right font-mono">{v.value}</td>
                              <td className="py-1 px-2">
                                <Badge variant={v.severity === 'critical' ? 'destructive' : v.severity === 'warning' ? 'secondary' : 'outline'}>
                                  {t(`spc.${v.severity}`)}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle className="h-10 w-10 text-success mx-auto mb-2" />
                      {t('spc.noViolationsDetected')}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{t('spc.paretoAnalysis')}</CardTitle>
                  <CardDescription>{t('spc.topNgPointsDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={paretoData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="code" tick={chartAxisTick} />
                      <YAxis yAxisId="left" tick={chartAxisTick} />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={chartAxisTick} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar yAxisId="left" dataKey="ngCount" fill={chartColor(0)} isAnimationActive={false}>
                        {paretoData.map((_, i) => <Cell key={i} fill={i < 3 ? 'var(--destructive)' : chartColor(0)} />)}
                      </Bar>
                      <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke={chartColor(1)} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Progressive disclosure: group the advanced/optional analyses under a
                single "Nâng cao" section (collapsed by default; preference persisted).
                Basic users see a simpler surface; nothing is removed. */}
            <AdvancedSection storageKey="spc-analysis" className="mt-2">
            {/* Collapsible: CPK Trend */}
            <CollapsibleSection title={t('spc.cpkTrend')}>
              {cpkTrendData?.data?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={[...cpkTrendData.data].reverse().map((d, i) => ({ i: i + 1, cpk: d.cpk ?? 0, ppk: d.ppk ?? 0 }))}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="i" tick={chartAxisTick} />
                    <YAxis tick={chartAxisTick} />
                    <Tooltip contentStyle={chartTooltipStyle} /><Legend />
                    <ReferenceLine y={1.33} stroke="var(--success)" strokeDasharray="4 2" />
                    <ReferenceLine y={1.0} stroke="var(--destructive)" strokeDasharray="4 2" />
                    <Bar dataKey="cpk" fill={chartColor(0)} isAnimationActive={false} />
                    <Bar dataKey="ppk" fill={chartColor(2)} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-muted-foreground py-4">{t('spc.noTrendData')}</p>}
            </CollapsibleSection>

            {/* Collapsible: Saved violations */}
            <CollapsibleSection title={t('spc.savedViolations')}>
              {savedViolations?.length ? (
                <div className="overflow-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b text-left">
                      <th className="py-1 px-2">{t('spc.rule')}</th>
                      <th className="py-1 px-2">{t('spc.severity')}</th>
                      <th className="py-1 px-2">{t('spc.actions')}</th>
                    </tr></thead>
                    <tbody>
                      {savedViolations.map((v: any) => (
                        <tr key={v.id} className="border-b">
                          <td className="py-1 px-2">{v.ruleName}</td>
                          <td className="py-1 px-2"><Badge variant="outline">{v.severity}</Badge></td>
                          <td className="py-1 px-2 flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => ackMutation.mutate({ id: v.id })}>{t('spc.acknowledge')}</Button>
                            <Button size="sm" variant="ghost" onClick={() => resolveMutation.mutate({ id: v.id })}>{t('spc.resolve')}</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-muted-foreground py-4">{t('spc.noSavedViolations')}</p>}
            </CollapsibleSection>

            {/* Collapsible: AI Root Cause */}
            <CollapsibleSection title={t('spc.aiRootCauseSuggestions')} icon={<Lightbulb className="h-4 w-4" />}>
              {rootCauseData?.suggestions?.length ? (
                <div className="space-y-3">
                  {rootCauseData.suggestions.map((s, i) => (
                    <Alert key={i} variant={s.severity === 'high' ? 'destructive' : 'default'}>
                      <AlertTitle className="flex items-center gap-2">
                        {s.title}
                        <Badge variant={s.severity === 'high' ? 'destructive' : 'secondary'}>{s.severity}</Badge>
                      </AlertTitle>
                      <AlertDescription>
                        <p className="mb-1">{s.description}</p>
                        <p className="font-medium text-sm">💡 {t('spc.recommendation')}: {s.recommendation}</p>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground py-4">{t('spc.noAnalysisData')}</p>}
            </CollapsibleSection>
            </AdvancedSection>
          </>
        )}
      </div>
  );
}

function KpiCard({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${className ?? ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function CapBox({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${cpkColor(value)}`}>{value != null ? value.toFixed(2) : '—'}</p>
    </div>
  );
}

function CollapsibleSection({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-3 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
