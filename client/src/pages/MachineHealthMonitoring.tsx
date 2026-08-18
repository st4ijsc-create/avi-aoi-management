import { useState, useMemo, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { useSetCopilotContext } from "@/contexts/AiCopilotContext";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  PageContainer,
  MetricCard,
  EmptyState,
  chartColor,
  chartGridProps,
  chartAxisProps,
  chartTooltipStyle,
} from "@/components/patterns";
// ⚠ 2026-08-18 — câu rỗng TRUNG THỰC. Màn này ăn toàn mảng trần (`getAllOEE`,
// `getAllMachineHealth`, `machine.list`) nên nhãn phạm vi phải tới bằng
// `mqttClient.getScopeLabels`. MỘT nguồn câu chữ (`common.scopeEmpty.*`), không chép chuỗi.
import { ScopeEmptyNotice, ScopeAwareEmpty, scopeEmptyReasonOf } from "@/components/ScopeEmptyNotice";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Heart,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Gauge,
  Clock,
  Zap,
  Settings2,
  BarChart3,
  Download,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  Cell
} from "recharts";
import { toast } from "sonner";

interface HealthScore {
  score: number;
  factors: { name: string; score: number; weight: number }[];
  lastUpdated: Date;
}

/** Clamp a percentage to a sane [0,100] for DISPLAY (defensive vs. bad inputs). */
const clampPct = (n: number) => Math.max(0, Math.min(100, n));
/** Honest percent label: "—" when missing, else a clamped integer percent. */
const pctLabel = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(clampPct(v))}%`;

// Health Status Badge
function HealthStatusBadge({ status }: { status: 'healthy' | 'warning' | 'critical' }) {
  const { t } = useTranslation();
  const config = {
    healthy: { label: t('machines.healthy'), variant: "default" as const, icon: CheckCircle2, color: "text-success" },
    warning: { label: t('machines.warning'), variant: "secondary" as const, icon: AlertTriangle, color: "text-warning" },
    critical: { label: t('machines.critical'), variant: "destructive" as const, icon: XCircle, color: "text-destructive" },
  };
  
  const { label, variant, icon: Icon, color } = config[status];
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      <Icon className={`h-3 w-3 ${color}`} />
      {label}
    </Badge>
  );
}

// Health Score Gauge
function HealthGauge({ score, size = "lg" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const getColor = (score: number) => {
    if (score >= 80) return "var(--success)";
    if (score >= 40) return "var(--warning)";
    return "var(--destructive)";
  };

  const sizeClasses = {
    sm: "h-20 w-20",
    md: "h-32 w-32",
    lg: "h-40 w-40"
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl"
  };

  return (
    <div className={`relative ${sizeClasses[size]}`}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={getColor(score)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${score * 2.83} 283`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold ${textSizes[size]}`} style={{ color: getColor(score) }}>
          {score.toFixed(0)}
        </span>
        <span className="text-xs text-muted-foreground">Health Score</span>
      </div>
    </div>
  );
}

// Factor Card
function FactorCard({ 
  title, 
  value, 
  icon: Icon, 
  description, 
  trend 
}: { 
  title: string; 
  value: number; 
  icon: React.ComponentType<{ className?: string }>; 
  description: string;
  trend?: number;
}) {
  const getColor = (value: number) => {
    if (value >= 80) return "text-success";
    if (value >= 40) return "text-warning";
    return "text-destructive";
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-muted ${getColor(value)}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className={`text-2xl font-bold ${getColor(value)}`}>{value.toFixed(1)}%</p>
            </div>
          </div>
          {trend !== undefined && (
            <div className={`flex items-center ${trend >= 0 ? 'text-success' : 'text-destructive'}`}>
              {trend >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">{description}</p>
        <Progress value={value} className="mt-2 h-2" />
      </CardContent>
    </Card>
  );
}

export function MachineHealthMonitoringContent() {
  const { t } = useTranslation();
  const [selectedMachine, setSelectedMachine] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month">("week");

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: allOEE, refetch: refetchOEE, isLoading: oeeLoading } = trpc.mqttClient.getAllOEE.useQuery();
  // ★ LÝ DO phạm vi rỗng. Cả ba truy vấn danh sách của màn này trả MẢNG TRẦN, và nhãn của
  // `withScopeLabels` không-liệt-kê-được nên chết ở biên superjson — không có truy vấn nào trên
  // màn mang nhãn để mượn. Vì thế hỏi riêng (xem docblock `mqttClient.getScopeLabels`).
  // ⚠ Chỉ đổi câu khi máy chủ khai ĐÚNG mã `no_factory_assignment`. Một đội máy CÓ gán mà chưa
  // máy nào báo OEE trong cửa sổ vẫn nhận `null` ⇒ giữ nguyên câu "chưa có dữ liệu" cũ.
  const { data: healthScope } = trpc.mqttClient.getScopeLabels.useQuery();
  const scopeEmptyReason = scopeEmptyReasonOf(healthScope);
  // REAL per-machine health scores (same source the Details tab reads). Used to
  // drive the fleet overview so it agrees with the detail view. Machines without
  // a calculated score come back as null → rendered as an honest "—".
  const { data: allMachineHealth, refetch: refetchAllHealth } =
    trpc.mqttClient.getAllMachineHealth.useQuery();
  // DB-backed predictive-maintenance risk per machine (computeFailureRisk over
  // heartbeat / anomaly / reliability history). Used as a REAL fallback fleet-health
  // source when the in-memory calculated score (getAllMachineHealth) is null — health
  // index = 100 - failureRisk, only for machines with actual data points. This keeps the
  // fleet overview non-zero from real telemetry instead of an empty in-memory map, while
  // still preferring an explicitly-calculated score when one exists.
  const { data: rulForecast, refetch: refetchRul } =
    trpc.predictiveMaintenance.listRulForecast.useQuery(
      { limit: 200 },
      { staleTime: 60_000 },
    );

  // C3a — publish the currently-selected machine to the AI copilot so questions
  // like "OEE máy này?" resolve to this machine's code without typing it.
  const setCopilotContext = useSetCopilotContext();
  const selectedMachineCode = useMemo(
    () => machines?.find((m) => m.id === selectedMachine)?.code,
    [machines, selectedMachine],
  );
  useEffect(() => {
    setCopilotContext(
      selectedMachine != null
        ? { selectedMachineId: selectedMachine, selectedMachineCode }
        : {},
    );
  }, [selectedMachine, selectedMachineCode, setCopilotContext]);
  const { data: machineHealth, refetch: refetchHealth } = trpc.mqttClient.getMachineHealth.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );

  const { data: healthHistoryRows } = trpc.mqttClient.getMachineHealthHistory.useQuery(
    { machineId: selectedMachine!, range: timeRange, limit: 500 },
    { enabled: !!selectedMachine, refetchInterval: 60000 }
  );

  // WS-4: predictive maintenance — failure risk + RUL and reliability (MTBF/MTTR)
  const { data: pmRisk } = trpc.predictiveMaintenance.getMachineRisk.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const { data: pmReliability } = trpc.predictiveMaintenance.getReliabilityStats.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );

  // Calculate health for all machines
  const calculateHealthMutation = trpc.mqttClient.calculateMachineHealth.useMutation({
    onSuccess: () => {
      toast.success(t('machines.healthScoreCalculated'));
      refetchHealth();
    },
  });

  // Health history time-series — REAL machine_health_history rows only. When no
  // history exists yet the chart renders an honest empty state (no fabricated
  // telemetry / synthetic random walk).
  const healthHistoryData = useMemo(() => {
    if (!healthHistoryRows || healthHistoryRows.length === 0) return [];
    return healthHistoryRows.map((r: any) => {
      const ts = new Date(r.timestamp);
      return {
        time: timeRange === "day"
          ? ts.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          : ts.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        healthScore: Number(r.healthScore ?? 0),
        oee: Number(r.oeeScore ?? r.currentOEE ?? 0),
        uptime: Number(r.uptimeScore ?? r.uptimePercentage ?? 0),
        errorRate: Math.max(0, 100 - Number(r.errorRateScore ?? 0)),
      };
    });
  }, [healthHistoryRows, timeRange]);

  // Radar chart data for factors
  const radarData = useMemo(() => {
    if (!machineHealth?.factors) return [];
    return machineHealth.factors.map(f => ({
      factor: f.name,
      value: f.score,
      fullMark: 100
    }));
  }, [machineHealth]);

  // Machine comparison data. healthScore is the REAL score from getAllMachineHealth
  // (identical to the Details tab), joined by machineId — never an OEE-derived
  // invention. Machines with no calculated score yet are null → rendered as "—".
  const machineComparisonData = useMemo(() => {
    if (!allOEE) return [];
    const healthById = new Map<number, number | null>(
      (allMachineHealth ?? []).map((h) => [h.machineId, h.healthScore]),
    );
    // Fallback health index derived from real PdM risk (100 - failureRisk), only for
    // machines that actually have data points (dataPoints > 0) — never fabricated.
    const riskHealthById = new Map<number, number | null>(
      (rulForecast ?? []).map((r) => [
        r.machineId,
        r.dataPoints > 0 ? clampPct(100 - r.failureRisk) : null,
      ]),
    );
    return allOEE.map(oee => ({
      name: oee.machineCode,
      machineId: oee.machineId,
      oee: oee.oee,
      availability: oee.availability,
      performance: oee.performance,
      quality: oee.quality,
      // Prefer an explicitly-calculated in-memory score; else fall back to the
      // DB-backed PdM-risk-derived health index; else honest "—" (null).
      healthScore: (healthById.get(oee.machineId)
        ?? riskHealthById.get(oee.machineId)
        ?? null) as number | null,
    }));
  }, [allOEE, allMachineHealth, rulForecast]);

  // Machines that actually have a real health score (for counts / averages that
  // must exclude the "—" machines rather than treat a missing score as 0).
  const scoredMachines = useMemo(
    () => machineComparisonData.filter(
      (m): m is typeof m & { healthScore: number } => m.healthScore != null,
    ),
    [machineComparisonData],
  );
  const avgHealthLabel = scoredMachines.length > 0
    ? `${(scoredMachines.reduce((sum, m) => sum + m.healthScore, 0) / scoredMachines.length).toFixed(0)}%`
    : '—';

  // Get health status color (semantic theme tokens, dark/light aware).
  // A null (unknown) score renders in the neutral muted tone, not red.
  const getHealthColor = (score: number | null) => {
    if (score == null) return "var(--muted-foreground)";
    if (score >= 80) return "var(--success)";
    if (score >= 40) return "var(--warning)";
    return "var(--destructive)";
  };

  // Export health report
  const exportHealthReport = () => {
    if (!machineComparisonData.length) {
      toast.error(t('machines.noDataToExport'));
      return;
    }

    const headers = [t('machines.machine'), 'Health Score', 'OEE (%)', 'Availability (%)', 'Performance (%)', 'Quality (%)'];
    const rows = machineComparisonData.map(m => [
      m.name,
      m.healthScore ?? '—',
      m.oee.toFixed(2),
      m.availability.toFixed(2),
      m.performance.toFixed(2),
      m.quality.toFixed(2)
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Machine_Health_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('machines.healthReportExported'));
  };

  return (
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<Heart className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
          title={t('machines.healthMonitoringTitle', 'Machine Health Monitoring')}
          description={t('machines.trackHealthAndMaintenance')}
          actions={
            <>
              <Button variant="outline" onClick={exportHealthReport}>
                <Download className="h-4 w-4 mr-2" />
                {t('machines.exportReport')}
              </Button>
              <Button variant="outline" onClick={() => { refetchOEE(); refetchHealth(); refetchAllHealth(); refetchRul(); }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('machines.refresh')}
              </Button>
            </>
          }
        />

        {/* ★ Dải phạm-vi-rỗng — tự trả `null` khi phạm vi bình thường, nên gọi vô điều kiện.
            ⚠ Một mình dải này KHÔNG đủ: các thẻ số bên dưới vẫn hiện "0" và mắt đọc khối gần
            nhất, nên khối tổng quan còn được bọc `ScopeAwareEmpty` riêng. */}
        <ScopeEmptyNotice reason={scopeEmptyReason} />

        {/* Machine Selection */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium">{t('machines.selectMachineForDetails')}</label>
                <Select
                  value={selectedMachine?.toString() || ""}
                  onValueChange={(v) => setSelectedMachine(parseInt(v))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('machines.selectMachine')} />
                  </SelectTrigger>
                  <SelectContent>
                    {machines?.map(m => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">{t('machines.timeRange')}</label>
                <Select value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
                  <SelectTrigger className="mt-1 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">{t('machines.24hours')}</SelectItem>
                    <SelectItem value="week">{t('machines.7days')}</SelectItem>
                    <SelectItem value="month">{t('machines.30days')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">{t('machines.overview')}</TabsTrigger>
            <TabsTrigger value="details">{t('machines.machineDetails')}</TabsTrigger>
            <TabsTrigger value="comparison">{t('machines.machineComparison')}</TabsTrigger>
            <TabsTrigger value="alerts">{t('machines.alertsAndRecommendations')}</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {/* DEV-11 — nhánh isLoading TRƯỚC empty-state: đang tải thì hiện skeleton
                thay vì bảng/thẻ rỗng (nhìn như nhà máy không có máy). */}
            {oeeLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardContent className="pt-6"><div className="h-14 bg-muted rounded" /></CardContent>
                    </Card>
                  ))}
                </div>
                <Card className="animate-pulse">
                  <CardContent className="pt-6"><div className="h-72 bg-muted rounded" /></CardContent>
                </Card>
              </div>
            ) : machineComparisonData.length === 0 ? (
              /* ★ 2026-08-18 — TRƯỚC bản vá này, 0 máy KHÔNG hiện câu nào cả: bốn thẻ "0", một
                 biểu đồ trống và một bảng không dòng. Đó là lời khai *"đội máy khoẻ 0/0"* —
                 tệ hơn một câu sai, vì nó trông như một phép đo đã chạy xong.
                 `EmptyState` tự chọn giữa HAI câu theo `scopeEmptyReason`, và câu phạm-vi-rỗng
                 THẮNG cả `title`/`description` truyền vào (xem docblock của nó):
                   · `no_factory_assignment` ⇒ "chưa được gán nhà máy" (lỗi ở BẢNG PHÂN QUYỀN);
                   · `null` ⇒ "chưa có dữ liệu trong cửa sổ 24 giờ" (lỗi ở DÂY CHUYỀN).
                 Hai lý do "0 máy" ấy cùng tồn tại trên CSDL dev, nên phải phân biệt được. */
              <EmptyState
                scopeEmptyReason={scopeEmptyReason}
                variant="no-analytics"
                title={t('machines.noFleetHealth')}
                description={t('machines.noFleetHealthDesc')}
              />
            ) : (
            <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <MetricCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                label={t('machines.healthyMachines')}
                value={machineComparisonData.filter(m => m.healthScore != null && m.healthScore >= 80).length}
                tone="success"
              />
              <MetricCard
                icon={<AlertTriangle className="h-5 w-5" />}
                label={t('machines.needAttention')}
                value={machineComparisonData.filter(m => m.healthScore != null && m.healthScore >= 60 && m.healthScore < 80).length}
                tone="warning"
              />
              <MetricCard
                icon={<XCircle className="h-5 w-5" />}
                label={t('machines.needMaintenance')}
                value={machineComparisonData.filter(m => m.healthScore != null && m.healthScore < 60).length}
                tone="danger"
              />
              <MetricCard
                icon={<Activity className="h-5 w-5" />}
                label={t('machines.avgHealth', 'Average health')}
                value={avgHealthLabel}
                tone="info"
              />
            </div>

            {/* Machine Health Overview Chart */}
            <Card>
              <CardHeader>
                <CardTitle>{t('machines.healthScoreByMachine')}</CardTitle>
                <CardDescription>{t('machines.compareHealthScores')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={machineComparisonData}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="name" {...chartAxisProps} />
                      <YAxis domain={[0, 100]} {...chartAxisProps} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value) => [value == null ? '—' : `${Number(value).toFixed(1)}%`, 'Health Score']}
                      />
                      <Bar dataKey="healthScore" name="Health Score">
                        {machineComparisonData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getHealthColor(entry.healthScore)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Machine List Table */}
            <Card>
              <CardHeader>
                <CardTitle>{t('machines.machineList')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('machines.machine')}</TableHead>
                      <TableHead>Health Score</TableHead>
                      <TableHead>OEE</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Performance</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machineComparisonData.map((machine) => (
                      <TableRow 
                        key={machine.machineId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedMachine(machine.machineId)}
                      >
                        <TableCell className="font-medium">{machine.name}</TableCell>
                        <TableCell>
                          {machine.healthScore != null ? (
                            <div className="flex items-center gap-2">
                              <Progress value={machine.healthScore} className="w-20 h-2" />
                              <span className="font-medium" style={{ color: getHealthColor(machine.healthScore) }}>
                                {machine.healthScore}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{machine.oee.toFixed(1)}%</TableCell>
                        <TableCell>{machine.availability.toFixed(1)}%</TableCell>
                        <TableCell>{machine.performance.toFixed(1)}%</TableCell>
                        <TableCell>{machine.quality.toFixed(1)}%</TableCell>
                        <TableCell>
                          {machine.healthScore != null ? (
                            <HealthStatusBadge
                              status={
                                machine.healthScore >= 80 ? 'healthy' :
                                machine.healthScore >= 60 ? 'warning' : 'critical'
                              }
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            </>
            )}
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4">
            {selectedMachine ? (
              <>
                {/* WS-4: Predictive Maintenance — RUL + MTBF/MTTR */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('machines.predictiveMaintenance')}</CardTitle>
                    <CardDescription>{t('machines.predictiveMaintenanceDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">{t('machines.failureRisk')}</p>
                        <p className="text-2xl font-bold text-destructive">{pctLabel(pmRisk?.failureRisk)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">{t('machines.confidence')}</p>
                        <p className="text-2xl font-bold">{pctLabel(pmRisk?.confidenceScore)}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">{t('machines.mtbf')}</p>
                        <p className="text-2xl font-bold">{pmReliability?.mtbfHours != null ? `${pmReliability.mtbfHours.toFixed(1)}h` : '—'}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">{t('machines.mttr')}</p>
                        <p className="text-2xl font-bold">{pmReliability?.mttrHours != null ? `${pmReliability.mttrHours.toFixed(1)}h` : '—'}</p>
                      </div>
                    </div>
                    {pmRisk?.predictedTimeframe && (
                      <p className="mt-3 text-sm">
                        {t('machines.rulForecast')}: <strong>{pmRisk.predictedTimeframe}</strong>
                        {pmRisk.recommendedMaintenanceDate && (
                          <> — {t('machines.recommendedMaintenance')}: {new Date(pmRisk.recommendedMaintenanceDate).toLocaleString()}</>
                        )}
                      </p>
                    )}
                    {pmRisk?.factors && pmRisk.factors.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {pmRisk.factors.map((f: any) => (
                          <div key={f.name} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{f.name}: {f.description}</span>
                            <span className="font-medium">{f.contribution}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Health Score Display */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="md:col-span-1">
                    <CardHeader>
                      <CardTitle>Health Score</CardTitle>
                      <CardDescription>
                        {machines?.find(m => m.id === selectedMachine)?.name || 'N/A'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center">
                      <HealthGauge score={machineHealth?.score || 0} />
                      <div className="mt-4">
                        <HealthStatusBadge 
                          status={
                            (machineHealth?.score || 0) >= 80 ? 'healthy' :
                            (machineHealth?.score || 0) >= 60 ? 'warning' : 'critical'
                          } 
                        />
                      </div>
                      <Button 
                        className="mt-4"
                        onClick={() => {
                          const machine = machines?.find(m => m.id === selectedMachine);
                          if (machine) {
                            calculateHealthMutation.mutate({
                              machineId: machine.id,
                              machineCode: machine.code,
                            });
                          }
                        }}
                      >
                      {t('machines.recalculateHealthScore')}
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Radar Chart */}
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle>{t('machines.factorAnalysis')}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={radarData}>
                            <PolarGrid stroke="var(--border)" />
                            <PolarAngleAxis dataKey="factor" tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                            <Radar
                              name="Health Factors"
                              dataKey="value"
                              stroke={chartColor(0)}
                              fill={chartColor(0)}
                              fillOpacity={0.6}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Factor Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {machineHealth?.factors?.slice(0, 4).map((factor, index) => {
                    const icons = [Gauge, Clock, AlertTriangle, Zap];
                    const descriptions = [
                      t('machines.overallEquipmentEfficiency'),
                      t('machines.operatingTime'),
                      t('machines.errorFreeRate'),
                      t('machines.cycleStability')
                    ];
                    return (
                      <FactorCard
                        key={factor.name}
                        title={factor.name}
                        value={factor.score}
                        icon={icons[index] || Activity}
                        description={descriptions[index] || ''}
                      />
                    );
                  })}
                </div>

                {/* Health History Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('machines.healthScoreHistory')}</CardTitle>
                    <CardDescription>{t('machines.healthScoreTrend')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      {healthHistoryData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={healthHistoryData}>
                            <CartesianGrid {...chartGridProps} />
                            <XAxis dataKey="time" {...chartAxisProps} />
                            <YAxis domain={[0, 100]} {...chartAxisProps} />
                            <Tooltip contentStyle={chartTooltipStyle} />
                            <Legend />
                            <Area
                              type="monotone"
                              dataKey="healthScore"
                              name="Health Score"
                              stroke={chartColor(0)}
                              fill={chartColor(0)}
                              fillOpacity={0.3}
                            />
                            <Line
                              type="monotone"
                              dataKey="oee"
                              name="OEE"
                              stroke={chartColor(1)}
                              strokeDasharray="5 5"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <EmptyState
                          variant="no-analytics"
                          title={t('machines.noHealthHistory', 'No health history yet')}
                          description={t('machines.noHealthHistoryDesc', 'Health history is recorded over time as the machine reports telemetry. Nothing has been logged for the selected range yet.')}
                          compact
                        />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              /* ⚠ "Chọn một máy" là NGÕ CỤT khi phạm vi rỗng — ô chọn máy phía trên không có mục
                 nào. Phạm vi bình thường mà chưa chọn thì câu cũ vẫn đúng. */
              <ScopeAwareEmpty reason={scopeEmptyReason} variant="block">
                <Card>
                  <CardContent className="py-12 text-center">
                    <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t('machines.selectMachineForHealthMonitoring')}</p>
                  </CardContent>
                </Card>
              </ScopeAwareEmpty>
            )}
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('machines.performanceComparison')}</CardTitle>
                <CardDescription>{t('machines.compareMetrics')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={machineComparisonData} layout="vertical">
                      <CartesianGrid {...chartGridProps} />
                      <XAxis type="number" domain={[0, 100]} {...chartAxisProps} />
                      <YAxis type="category" dataKey="name" width={80} {...chartAxisProps} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                      <Bar dataKey="healthScore" name="Health Score" fill={chartColor(0)} />
                      <Bar dataKey="oee" name="OEE" fill={chartColor(1)} />
                      <Bar dataKey="availability" name="Availability" fill={chartColor(2)} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('machines.alertsAndRecommendations')}</CardTitle>
                <CardDescription>{t('machines.machinesNeedAttention')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {scoredMachines
                    .filter(m => m.healthScore < 80)
                    .sort((a, b) => a.healthScore - b.healthScore)
                    .map((machine) => (
                      <div 
                        key={machine.machineId}
                        className={`p-4 rounded-lg border ${
                          machine.healthScore < 60 ? 'border-destructive bg-destructive/10' :
                          'border-warning bg-warning/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {machine.healthScore < 60 ? (
                              <XCircle className="h-6 w-6 text-destructive" />
                            ) : (
                              <AlertTriangle className="h-6 w-6 text-warning" />
                            )}
                            <div>
                              <p className="font-medium">{machine.name}</p>
                              <p className="text-sm text-muted-foreground">
                                Health Score: {machine.healthScore}%
                              </p>
                            </div>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedMachine(machine.machineId)}
                          >
                            {t('machines.viewDetails')}
                          </Button>
                        </div>
                        <div className="mt-3 text-sm">
                          <p className="font-medium">{t('machines.recommendations')}:</p>
                          <ul className="list-disc list-inside text-muted-foreground">
                            {machine.healthScore < 60 && (
                              <li>{t('machines.needImmediateMaintenance')}</li>
                            )}
                            {machine.oee < 70 && (
                              <li>{t('machines.lowOEE', { value: machine.oee.toFixed(1) })}</li>
                            )}
                            {machine.availability < 85 && (
                              <li>{t('machines.lowAvailability', { value: machine.availability.toFixed(1) })}</li>
                            )}
                            {machine.quality < 95 && (
                              <li>{t('machines.lowQuality', { value: machine.quality.toFixed(1) })}</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    ))}
                  {scoredMachines.filter(m => m.healthScore < 80).length === 0 && (
                    /* ★★ "Tất cả máy đều tốt" trên một phạm vi RỖNG là lời khai SAI VỀ THẾ GIỚI ở
                       đúng chỗ nguy hiểm nhất: một lời TRẤN AN cũng là một kết luận, và người đọc
                       nó sẽ THÔI đi kiểm tra. Cùng lớp lỗi đã vá ở `controlTower/panels.tsx`
                       ("All clear" cho tài khoản 0 gán). Phạm vi bình thường mà đội máy thật sự
                       khoẻ thì câu này vẫn ĐÚNG — giữ nguyên. */
                    <ScopeAwareEmpty reason={scopeEmptyReason} variant="block">
                      <div className="text-center py-8">
                        <CheckCircle2 className="h-12 w-12 mx-auto text-success mb-4" />
                        <p className="text-muted-foreground">{t('machines.allMachinesGood')}</p>
                      </div>
                    </ScopeAwareEmpty>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>
  );
}

export default function MachineHealthMonitoring() {
  return (
    <DashboardLayout>
      <MachineHealthMonitoringContent />
    </DashboardLayout>
  );
}
