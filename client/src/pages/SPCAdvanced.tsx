import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart3,
  Target,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle,
  ShieldAlert,
  Info,
  Calculator,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

function cpkColor(value: number | null | undefined): string {
  if (value == null) return "text-muted-foreground";
  if (value >= 1.33) return "text-green-600";
  if (value >= 1.0) return "text-yellow-600";
  return "text-red-600";
}

function cpkBg(value: number | null | undefined): string {
  if (value == null) return "bg-muted";
  if (value >= 1.33) return "bg-green-500";
  if (value >= 1.0) return "bg-yellow-500";
  return "bg-red-500";
}

function severityBadge(severity: string, t: (key: string) => string) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">{t('spc.critical')}</Badge>;
    case "warning":
      return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">{t('spc.warning')}</Badge>;
    case "info":
      return <Badge variant="secondary">{t('spc.info')}</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SPCAdvancedContent() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("control-charts");
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [selectedMeasurementPoint, setSelectedMeasurementPoint] = useState<string>("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [subgroupSize, setSubgroupSize] = useState(5);

  // Detection-specific measurement point (Tab 3)
  const [detectMpId, setDetectMpId] = useState<string>("");

  // CPK Trend measurement point (Tab 4)
  const [trendMpId, setTrendMpId] = useState<string>("");

  // Calculate CPK mutation inputs
  const [calcStart, setCalcStart] = useState(dateRange.startDate);
  const [calcEnd, setCalcEnd] = useState(dateRange.endDate);

  // Reference data
  const { data: measurementPoints } = trpc.measurementPoint.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();

  // Derived
  const mpId = selectedMeasurementPoint ? Number(selectedMeasurementPoint) : undefined;
  const machineId = selectedMachine !== "all" ? Number(selectedMachine) : undefined;

  // ---- Tab 1: Control Chart ----
  const {
    data: chartData,
    isLoading: chartLoading,
    refetch: refetchChart,
  } = trpc.workstationSpc.controlChart.useQuery(
    {
      measurementPointDefId: mpId!,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      machineId,
      subgroupSize,
    },
    { enabled: !!mpId },
  );

  // ---- Tab 2: Capability ----
  const {
    data: capData,
    isLoading: capLoading,
  } = trpc.workstationSpc.capability.useQuery(
    {
      measurementPointDefId: mpId!,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      machineId,
    },
    { enabled: !!mpId },
  );

  // ---- Tab 3: Rule Violations ----
  const detectMpIdNum = detectMpId ? Number(detectMpId) : undefined;

  const {
    data: detectData,
    isLoading: detectLoading,
    refetch: refetchDetect,
  } = trpc.spcRuleViolation.detect.useQuery(
    {
      measurementPointDefId: detectMpIdNum!,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      machineId,
      subgroupSize,
    },
    { enabled: !!detectMpIdNum },
  );

  const {
    data: savedViolations,
    isLoading: savedLoading,
    refetch: refetchSaved,
  } = trpc.spcRuleViolation.list.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: 50,
  });

  const ackMutation = trpc.spcRuleViolation.acknowledge.useMutation({
    onSuccess: () => refetchSaved(),
  });
  const resolveMutation = trpc.spcRuleViolation.resolve.useMutation({
    onSuccess: () => refetchSaved(),
  });

  // ---- Tab 4: CPK Trend ----
  const trendMpIdNum = trendMpId ? Number(trendMpId) : undefined;

  const {
    data: trendData,
    isLoading: trendLoading,
  } = trpc.cpkTrend.trend.useQuery(
    {
      measurementPointDefId: trendMpIdNum!,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      limit: 30,
    },
    { enabled: !!trendMpIdNum },
  );

  const calcMutation = trpc.cpkTrend.calculate.useMutation();

  // ---- Chart helpers ----
  const xBarChartHeight = 200;
  const rChartHeight = 160;

  const xBarBounds = useMemo(() => {
    if (!chartData || !chartData.controlLimits || !chartData.subgroups.length) return { min: 0, max: 1 };
    const allVals = chartData.subgroups.map((s) => s.mean);
    const limVals = [
      chartData.controlLimits.xBar.UCL,
      chartData.controlLimits.xBar.LCL,
    ];
    const min = Math.min(...allVals, ...limVals) * 0.95;
    const max = Math.max(...allVals, ...limVals) * 1.05;
    return { min: min === max ? min - 1 : min, max: max === min ? max + 1 : max };
  }, [chartData]);

  const rBounds = useMemo(() => {
    if (!chartData || !chartData.controlLimits || !chartData.subgroups.length) return { min: 0, max: 1 };
    const allVals = chartData.subgroups.map((s) => s.range);
    const limVals = [
      chartData.controlLimits.range.UCL,
      chartData.controlLimits.range.LCL ?? 0,
    ];
    const min = Math.min(...allVals, ...limVals, 0);
    const max = Math.max(...allVals, ...limVals) * 1.1;
    return { min, max: max === min ? max + 1 : max };
  }, [chartData]);

  function yPos(value: number, bounds: { min: number; max: number }, height: number) {
    const ratio = (value - bounds.min) / (bounds.max - bounds.min);
    return height - ratio * height;
  }

  // ---- CPK Trend chart helpers ----
  const maxCpk = useMemo(() => {
    if (!trendData?.data?.length) return 2;
    return Math.max(2, ...trendData.data.map((d) => d.cpk ?? 0)) * 1.1;
  }, [trendData]);

  // ---- Shared filter bar ----
  const filterBar = (
    <Card>
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label>{t('spc.measurementPoint')}</Label>
            <Select value={selectedMeasurementPoint} onValueChange={setSelectedMeasurementPoint}>
              <SelectTrigger>
                <SelectValue placeholder={t('spc.select')} />
              </SelectTrigger>
              <SelectContent>
                {measurementPoints?.map((mp: { id: number; code: string; name: string }) => (
                  <SelectItem key={mp.id} value={String(mp.id)}>
                    {mp.code} – {mp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('common.startDate')}</Label>
            <Input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('common.endDate')}</Label>
            <Input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('common.machine')}</Label>
            <Select value={selectedMachine} onValueChange={setSelectedMachine}>
              <SelectTrigger>
                <SelectValue placeholder={t('common.allMachines')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.allMachines')}</SelectItem>
                {machines?.map((m: { id: number; name: string }) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('spc.subgroupSize', { size: subgroupSize })}</Label>
            <Input
              type="range"
              min={2}
              max={25}
              value={subgroupSize}
              onChange={(e) => setSubgroupSize(Number(e.target.value))}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('spc.spcAdvanced')}</h1>
            <p className="text-muted-foreground">
              {t('spc.spcAdvancedDesc')}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="control-charts" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t('spc.controlCharts')}
            </TabsTrigger>
            <TabsTrigger value="capability" className="flex items-center gap-2">
              <Target className="h-4 w-4" />
              {t('spc.capability')}
            </TabsTrigger>
            <TabsTrigger value="rule-violations" className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              {t('spc.ruleViolations')}
            </TabsTrigger>
            <TabsTrigger value="cpk-trend" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('spc.cpkTrend')}
            </TabsTrigger>
          </TabsList>

          {/* ================================================================
              TAB 1: Control Charts
          ================================================================= */}
          <TabsContent value="control-charts" className="space-y-6">
            {filterBar}

            {!mpId && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>{t('spc.selectMeasurementPoint')}</AlertTitle>
                <AlertDescription>{t('spc.selectMeasurementPointCharts')}</AlertDescription>
              </Alert>
            )}

            {chartLoading && mpId && (
              <div className="space-y-4">
                <Skeleton className="h-[240px] w-full" />
                <Skeleton className="h-[200px] w-full" />
              </div>
            )}

            {chartData && !chartData.insufficient && chartData.controlLimits && (
              <>
                {/* Stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.sampleCount')}</CardDescription>
                      <CardTitle className="text-xl">{chartData.sampleCount}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.subgroups')}</CardDescription>
                      <CardTitle className="text-xl">{chartData.subgroupCount}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>X̄ CL</CardDescription>
                      <CardTitle className="text-xl">{chartData.controlLimits.xBar.CL.toFixed(4)}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>Est. σ</CardDescription>
                      <CardTitle className="text-xl">{chartData.controlLimits.estimatedSigma.toFixed(4)}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* X-bar Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('spc.xBarChart')}</CardTitle>
                    <CardDescription>
                      UCL: {chartData.controlLimits.xBar.UCL.toFixed(4)} | CL: {chartData.controlLimits.xBar.CL.toFixed(4)} | LCL: {chartData.controlLimits.xBar.LCL.toFixed(4)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative border rounded-md bg-muted/20 overflow-hidden" style={{ height: xBarChartHeight }}>
                      {/* UCL line */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10"
                        style={{ top: yPos(chartData.controlLimits.xBar.UCL, xBarBounds, xBarChartHeight) }}
                      >
                        <span className="absolute right-1 -top-4 text-[10px] text-red-500 font-medium">UCL</span>
                      </div>
                      {/* CL line */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-green-500 z-10"
                        style={{ top: yPos(chartData.controlLimits.xBar.CL, xBarBounds, xBarChartHeight) }}
                      >
                        <span className="absolute right-1 -top-4 text-[10px] text-green-600 font-medium">CL</span>
                      </div>
                      {/* LCL line */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10"
                        style={{ top: yPos(chartData.controlLimits.xBar.LCL, xBarBounds, xBarChartHeight) }}
                      >
                        <span className="absolute right-1 top-0 text-[10px] text-red-500 font-medium">LCL</span>
                      </div>
                      {/* Data points */}
                      <div className="absolute inset-0 flex items-end justify-around px-1 z-20">
                        {chartData.subgroups.map((sg, i) => {
                          const outOfControl =
                            sg.mean > chartData.controlLimits.xBar.UCL ||
                            sg.mean < chartData.controlLimits.xBar.LCL;
                          const top = yPos(sg.mean, xBarBounds, xBarChartHeight);
                          return (
                            <div
                              key={i}
                              className="relative flex flex-col items-center"
                              style={{ height: "100%" }}
                              title={`#${sg.index} Mean: ${sg.mean.toFixed(4)}`}
                            >
                              <div
                                className={`absolute w-2.5 h-2.5 rounded-full ${outOfControl ? "bg-red-500" : "bg-blue-500"}`}
                                style={{ top }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* R Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('spc.rChart')}</CardTitle>
                    <CardDescription>
                      UCL: {chartData.controlLimits.range.UCL.toFixed(4)} | CL: {chartData.controlLimits.range.CL.toFixed(4)} | LCL: {(chartData.controlLimits.range.LCL ?? 0).toFixed(4)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="relative border rounded-md bg-muted/20 overflow-hidden" style={{ height: rChartHeight }}>
                      {/* UCL */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10"
                        style={{ top: yPos(chartData.controlLimits.range.UCL, rBounds, rChartHeight) }}
                      >
                        <span className="absolute right-1 -top-4 text-[10px] text-red-500 font-medium">UCL</span>
                      </div>
                      {/* CL */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-green-500 z-10"
                        style={{ top: yPos(chartData.controlLimits.range.CL, rBounds, rChartHeight) }}
                      >
                        <span className="absolute right-1 -top-4 text-[10px] text-green-600 font-medium">CL</span>
                      </div>
                      {/* LCL */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 z-10"
                        style={{ top: yPos(chartData.controlLimits.range.LCL ?? 0, rBounds, rChartHeight) }}
                      >
                        <span className="absolute right-1 top-0 text-[10px] text-red-500 font-medium">LCL</span>
                      </div>
                      {/* Data points */}
                      <div className="absolute inset-0 flex items-end justify-around px-1 z-20">
                        {chartData.subgroups.map((sg, i) => {
                          const outOfControl =
                            sg.range > chartData.controlLimits.range.UCL ||
                            sg.range < (chartData.controlLimits.range.LCL ?? 0);
                          const top = yPos(sg.range, rBounds, rChartHeight);
                          return (
                            <div
                              key={i}
                              className="relative flex flex-col items-center"
                              style={{ height: "100%" }}
                              title={`#${sg.index} Range: ${sg.range.toFixed(4)}`}
                            >
                              <div
                                className={`absolute w-2.5 h-2.5 rounded-full ${outOfControl ? "bg-red-500" : "bg-orange-400"}`}
                                style={{ top }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {chartData?.insufficient && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('spc.insufficientData')}</AlertTitle>
                <AlertDescription>
                  {t('spc.insufficientDataCharts', { count: chartData.sampleCount })}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* ================================================================
              TAB 2: Capability
          ================================================================= */}
          <TabsContent value="capability" className="space-y-6">
            {filterBar}

            {!mpId && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>{t('spc.selectMeasurementPoint')}</AlertTitle>
                <AlertDescription>{t('spc.selectMeasurementPointCapability')}</AlertDescription>
              </Alert>
            )}

            {capLoading && mpId && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            )}

            {capData && !capData.insufficient && capData.indices && (
              <>
                {/* Capability Index Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(
                    [
                      { label: "Cp", value: capData.indices.cp },
                      { label: "Cpk", value: capData.indices.cpk },
                      { label: "Pp", value: capData.indices.pp },
                      { label: "Ppk", value: capData.indices.ppk },
                    ] as const
                  ).map(({ label, value }) => (
                    <Card key={label}>
                      <CardHeader className="pb-2">
                        <CardDescription>{label}</CardDescription>
                        <CardTitle className={`text-3xl font-bold ${cpkColor(value)}`}>
                          {value != null ? value.toFixed(3) : "–"}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Badge
                          variant="outline"
                          className={value != null && value >= 1.33 ? "border-green-500 text-green-600" : value != null && value >= 1.0 ? "border-yellow-500 text-yellow-600" : "border-red-500 text-red-600"}
                        >
                          {value == null
                            ? "N/A"
                            : value >= 1.33
                              ? t('spc.capable')
                              : value >= 1.0
                                ? t('spc.marginal')
                                : t('spc.notCapable')}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('spc.specLimits')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">USL</span>
                        <span className="font-medium">{capData.specLimits?.usl ?? "–"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Nominal</span>
                        <span className="font-medium">{capData.specLimits?.nominal ?? "–"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">LSL</span>
                        <span className="font-medium">{capData.specLimits?.lsl ?? "–"}</span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('spc.processStatistics')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mean</span>
                        <span className="font-medium">{capData.indices.mean?.toFixed(4) ?? "–"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Std Dev</span>
                        <span className="font-medium">{capData.indices.stdDev?.toFixed(4) ?? "–"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sample Size</span>
                        <span className="font-medium">{capData.indices.sampleSize ?? capData.sampleCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cpu</span>
                        <span className="font-medium">{capData.indices.cpu?.toFixed(3) ?? "–"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Cpl</span>
                        <span className="font-medium">{capData.indices.cpl?.toFixed(3) ?? "–"}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Process Distribution Bar */}
                {capData.specLimits?.usl != null && capData.specLimits?.lsl != null && capData.indices.mean != null && capData.indices.stdDev != null && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('spc.processDistribution')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DistributionBar
                        usl={capData.specLimits.usl}
                        lsl={capData.specLimits.lsl}
                        nominal={capData.specLimits.nominal ?? undefined}
                        mean={capData.indices.mean}
                        stdDev={capData.indices.stdDev}
                      />
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {capData?.insufficient && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('spc.insufficientData')}</AlertTitle>
                <AlertDescription>
                  {capData.reason ?? t('spc.insufficientDataSamples', { count: capData.sampleCount })}
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          {/* ================================================================
              TAB 3: Rule Violations
          ================================================================= */}
          <TabsContent value="rule-violations" className="space-y-6">
            {/* Detection filters */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('spc.detectRuleViolations')}</CardTitle>
                <CardDescription>
                  {t('spc.detectRuleViolationsDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>{t('spc.measurementPoint')}</Label>
                    <Select value={detectMpId} onValueChange={setDetectMpId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('spc.select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {measurementPoints?.map((mp: { id: number; code: string; name: string }) => (
                          <SelectItem key={mp.id} value={String(mp.id)}>
                            {mp.code} – {mp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.startDate')}</Label>
                    <Input
                      type="date"
                      value={dateRange.startDate}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.endDate')}</Label>
                    <Input
                      type="date"
                      value={dateRange.endDate}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => refetchDetect()} disabled={!detectMpIdNum || detectLoading}>
                      <RefreshCw className={`h-4 w-4 mr-2 ${detectLoading ? "animate-spin" : ""}`} />
                      {t('spc.runDetection')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {detectLoading && (
              <Skeleton className="h-48 w-full" />
            )}

            {detectData && !detectData.insufficient && detectData.summary && (
              <>
                {/* Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.totalViolations')}</CardDescription>
                      <CardTitle className="text-xl">{detectData.summary.total}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.critical')}</CardDescription>
                      <CardTitle className="text-xl text-red-600">{detectData.summary.critical}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.warning')}</CardDescription>
                      <CardTitle className="text-xl text-yellow-600">{detectData.summary.warning}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.info')}</CardDescription>
                      <CardTitle className="text-xl text-blue-600">{detectData.summary.info}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* Violation list */}
                {detectData.violations.length > 0 ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('spc.detectedViolations')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {detectData.violations.map((v, idx) => (
                        <div
                          key={idx}
                          className="border rounded-lg p-4 space-y-2"
                        >
                          <div className="flex items-center gap-3">
                            {severityBadge(v.severity, t)}
                            <span className="font-semibold">{v.ruleName}</span>
                            <span className="text-xs text-muted-foreground">({v.ruleType})</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{v.ruleDescription}</p>
                          <div className="flex flex-wrap gap-1 text-xs">
                            <span className="text-muted-foreground">Indices:</span>
                            {v.violatingIndices.map((idx2) => (
                              <Badge key={idx2} variant="outline" className="text-xs">
                                #{idx2}
                              </Badge>
                            ))}
                          </div>
                          {v.violatingValues && v.violatingValues.length > 0 && (
                            <div className="flex flex-wrap gap-1 text-xs">
                              <span className="text-muted-foreground">Values:</span>
                              {v.violatingValues.map((val, vi) => (
                                <Badge key={vi} variant="secondary" className="text-xs">
                                  {typeof val === "number" ? val.toFixed(4) : String(val)}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>{t('spc.noViolationsDetected')}</AlertTitle>
                    <AlertDescription>
                      {t('spc.noViolationsDetectedDesc')}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}

            {detectData?.insufficient && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{t('spc.insufficientData')}</AlertTitle>
                <AlertDescription>
                  {t('spc.insufficientDataViolations', { count: detectData.sampleCount })}
                </AlertDescription>
              </Alert>
            )}

            {/* Saved / Historical violations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('spc.savedViolations')}</CardTitle>
                <CardDescription>{t('spc.savedViolationsDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {savedLoading ? (
                  <Skeleton className="h-32 w-full" />
                ) : savedViolations && savedViolations.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>{t('spc.rule')}</TableHead>
                          <TableHead>{t('spc.severity')}</TableHead>
                          <TableHead>{t('spc.active')}</TableHead>
                          <TableHead className="text-right">{t('spc.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {savedViolations.map((sv: { id: number; ruleName?: string; ruleType?: string; severity?: string; isActive?: boolean }) => (
                          <TableRow key={sv.id}>
                            <TableCell className="font-mono text-xs">{sv.id}</TableCell>
                            <TableCell>{sv.ruleName ?? sv.ruleType ?? "–"}</TableCell>
                            <TableCell>{severityBadge(sv.severity ?? "info", t)}</TableCell>
                            <TableCell>
                              {sv.isActive ? (
                                <Badge variant="destructive">{t('spc.activeBadge')}</Badge>
                              ) : (
                                <Badge variant="secondary">{t('spc.resolvedBadge')}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={ackMutation.isPending}
                                onClick={() => ackMutation.mutate({ id: sv.id })}
                              >
                                {t('spc.acknowledge')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={resolveMutation.isPending}
                                onClick={() => resolveMutation.mutate({ id: sv.id })}
                              >
                                {t('spc.resolve')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('spc.noSavedViolations')}</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================================================================
              TAB 4: CPK Trend
          ================================================================= */}
          <TabsContent value="cpk-trend" className="space-y-6">
            {/* Filters */}
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label>{t('spc.measurementPoint')}</Label>
                    <Select value={trendMpId} onValueChange={setTrendMpId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('spc.select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {measurementPoints?.map((mp: { id: number; code: string; name: string }) => (
                          <SelectItem key={mp.id} value={String(mp.id)}>
                            {mp.code} – {mp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.startDate')}</Label>
                    <Input
                      type="date"
                      value={dateRange.startDate}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('common.endDate')}</Label>
                    <Input
                      type="date"
                      value={dateRange.endDate}
                      onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button variant="outline" onClick={() => { /* no-op, auto-fetches */ }} disabled={!trendMpIdNum}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('common.refresh')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!trendMpIdNum && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>{t('spc.selectMeasurementPoint')}</AlertTitle>
                <AlertDescription>{t('spc.selectMeasurementPointCpk')}</AlertDescription>
              </Alert>
            )}

            {trendLoading && trendMpIdNum && (
              <Skeleton className="h-64 w-full" />
            )}

            {trendData && (
              <>
                {/* Alert banner */}
                {trendData.alert && (
                  <Alert variant={trendData.alert.level === "critical" ? "destructive" : "default"}>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{t('spc.cpkAlert')}</AlertTitle>
                    <AlertDescription>{trendData.alert.message}</AlertDescription>
                  </Alert>
                )}

                {/* Trend direction + latest CPK */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.latestCpk')}</CardDescription>
                      <CardTitle className={`text-3xl font-bold ${cpkColor(trendData.latestCpk)}`}>
                        {trendData.latestCpk != null ? trendData.latestCpk.toFixed(3) : "–"}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.trendDirection')}</CardDescription>
                      <CardTitle className="text-xl flex items-center gap-2">
                        {trendData.trendDirection === "improving" && (
                          <>
                            <TrendingUp className="h-5 w-5 text-green-500" />
                            <span className="text-green-600">{t('spc.improving')}</span>
                          </>
                        )}
                        {trendData.trendDirection === "declining" && (
                          <>
                            <TrendingDown className="h-5 w-5 text-red-500" />
                            <span className="text-red-600">{t('spc.declining')}</span>
                          </>
                        )}
                        {trendData.trendDirection === "stable" && (
                          <>
                            <Minus className="h-5 w-5 text-blue-500" />
                            <span className="text-blue-600">{t('spc.stable')}</span>
                          </>
                        )}
                        {!trendData.trendDirection && <span className="text-muted-foreground">N/A</span>}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardDescription>{t('spc.dataPoints')}</CardDescription>
                      <CardTitle className="text-xl">{trendData.data.length}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* CPK Trend Chart */}
                {trendData.data.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{t('spc.cpkOverTime')}</CardTitle>
                      <CardDescription>{t('spc.cpkOverTimeDesc')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="relative border rounded-md bg-muted/20 p-4" style={{ height: 220 }}>
                        {/* Threshold lines */}
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-green-400 z-10"
                          style={{ bottom: `${(1.33 / maxCpk) * 100}%` }}
                        >
                          <span className="absolute right-1 -top-4 text-[10px] text-green-600">1.33</span>
                        </div>
                        <div
                          className="absolute left-0 right-0 border-t border-dashed border-yellow-400 z-10"
                          style={{ bottom: `${(1.0 / maxCpk) * 100}%` }}
                        >
                          <span className="absolute right-1 -top-4 text-[10px] text-yellow-600">1.00</span>
                        </div>

                        {/* Bars */}
                        <div className="flex items-end gap-1 h-full">
                          {trendData.data.map((d, i) => {
                            const cpk = d.cpk ?? 0;
                            const heightPct = Math.max(1, (cpk / maxCpk) * 100);
                            return (
                              <div
                                key={d.id ?? i}
                                className="flex-1 flex flex-col items-center justify-end h-full"
                              >
                                <div
                                  className={`w-full max-w-[32px] rounded-t ${cpkBg(cpk)} transition-all`}
                                  style={{ height: `${heightPct}%` }}
                                  title={`CPK: ${cpk.toFixed(3)} | ${d.periodStart ?? ""} – ${d.periodEnd ?? ""}`}
                                />
                                <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-[40px]">
                                  {d.periodStart ? new Date(d.periodStart).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : i + 1}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Calculate new CPK section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Calculator className="h-4 w-4" />
                      {t('spc.calculateStoreCpk')}
                    </CardTitle>
                    <CardDescription>
                      {t('spc.calculateStoreCpkDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <div className="space-y-2">
                        <Label>{t('common.start')}</Label>
                        <Input type="date" value={calcStart} onChange={(e) => setCalcStart(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>{t('common.end')}</Label>
                        <Input type="date" value={calcEnd} onChange={(e) => setCalcEnd(e.target.value)} />
                      </div>
                      <div>
                        <Button
                          onClick={() => {
                            if (!trendMpIdNum) return;
                            calcMutation.mutate({
                              measurementPointDefId: trendMpIdNum,
                              startDate: calcStart,
                              endDate: calcEnd,
                              machineId,
                            });
                          }}
                          disabled={!trendMpIdNum || calcMutation.isPending}
                        >
                          {calcMutation.isPending ? (
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Calculator className="h-4 w-4 mr-2" />
                          )}
                          {t('spc.calculate')}
                        </Button>
                      </div>
                      {calcMutation.data && (
                        <div className="text-sm">
                          <Badge variant="outline" className="mr-2">
                            CPK: {calcMutation.data.indices?.cpk?.toFixed(3) ?? "–"}
                          </Badge>
                          <Badge variant="outline">
                            CP: {calcMutation.data.indices?.cp?.toFixed(3) ?? "–"}
                          </Badge>
                        </div>
                      )}
                    </div>
                    {calcMutation.isError && (
                      <Alert variant="destructive" className="mt-4">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>{t('spc.calculationFailed')}</AlertTitle>
                        <AlertDescription>{String(calcMutation.error)}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: Distribution bar (capability tab)
// ---------------------------------------------------------------------------

function DistributionBar({
  usl,
  lsl,
  nominal,
  mean,
  stdDev,
}: {
  usl: number;
  lsl: number;
  nominal?: number;
  mean: number;
  stdDev: number;
}) {
  const { t } = useTranslation();
  const spread = usl - lsl;
  const padding = spread * 0.15;
  const rangeMin = Math.min(lsl, mean - 3 * stdDev) - padding;
  const rangeMax = Math.max(usl, mean + 3 * stdDev) + padding;
  const total = rangeMax - rangeMin;

  const toPercent = (v: number) => ((v - rangeMin) / total) * 100;

  const lslPct = toPercent(lsl);
  const uslPct = toPercent(usl);
  const meanPct = toPercent(mean);
  const minus3s = toPercent(mean - 3 * stdDev);
  const plus3s = toPercent(mean + 3 * stdDev);
  const nomPct = nominal != null ? toPercent(nominal) : undefined;

  return (
    <div className="space-y-2">
      {/* Labels */}
      <div className="relative h-5 text-[10px] text-muted-foreground">
        <span className="absolute" style={{ left: `${lslPct}%`, transform: "translateX(-50%)" }}>
          LSL
        </span>
        {nomPct != null && (
          <span className="absolute" style={{ left: `${nomPct}%`, transform: "translateX(-50%)" }}>
            Nom
          </span>
        )}
        <span className="absolute" style={{ left: `${uslPct}%`, transform: "translateX(-50%)" }}>
          USL
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-8 bg-gray-200 rounded overflow-hidden">
        {/* Spec range */}
        <div
          className="absolute top-0 bottom-0 bg-green-100 border-l-2 border-r-2 border-green-500"
          style={{ left: `${lslPct}%`, width: `${uslPct - lslPct}%` }}
        />
        {/* Process spread (±3σ) */}
        <div
          className="absolute top-1 bottom-1 bg-blue-400/40 rounded"
          style={{
            left: `${Math.max(0, minus3s)}%`,
            width: `${Math.min(100, plus3s) - Math.max(0, minus3s)}%`,
          }}
        />
        {/* Mean marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-blue-700 z-10"
          style={{ left: `${meanPct}%` }}
        />
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-500" /> {t('spc.specRange')}
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-blue-400/40" /> {t('spc.threeStdDev')}
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-blue-700" /> {t('spc.mean')}
        </span>
      </div>
    </div>
  );
}
