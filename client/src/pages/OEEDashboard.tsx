import { useState, useEffect, useRef, useCallback } from "react";
import { Redirect } from "wouter";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { useEcosystemEvents } from "@/hooks/useEcosystemEvents";
import { PageHeader } from "@/components/patterns";
import { RelatedViews } from "@/components/RelatedViews";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Gauge, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Calculator,
  BarChart3,
  Timer,
  Zap,
  Target,
  Play,
  Pause,
  StopCircle,
  Wrench,
  Settings2,
  Download,
  FileSpreadsheet,
  Wifi,
  WifiOff
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
  RadialBarChart,
  RadialBar,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from "recharts";
import { toast } from "sonner";
import { chartColor, chartGridProps, chartAxisProps, chartTooltipStyle } from "@/components/patterns";

interface OEEMetrics {
  machineId: number;
  machineCode: string;
  timestamp: Date;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  details: {
    plannedTime: number;
    runTime: number;
    downtime: number;
    idealCycleTime: number;
    totalCount: number;
    goodCount: number;
    rejectCount: number;
  };
}

interface DowntimeEvent {
  id: string;
  machineId: number;
  machineCode: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  category: 'planned' | 'unplanned' | 'breakdown' | 'changeover' | 'maintenance' | 'other';
  reason?: string;
  notes?: string;
  reportedBy?: string;
}

// OEE Gauge Component
function OEEGauge({ value, label, color }: { value: number; label: string; color: string }) {
  const data = [{ name: label, value, fill: color }];
  
  return (
    <div className="relative h-32 w-32">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="100%"
          barSize={10}
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar
            background
            dataKey="value"
            cornerRadius={5}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{value.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// Downtime Category Badge
function DowntimeCategoryBadge({ category }: { category: DowntimeEvent['category'] }) {
  const { t } = useTranslation();
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    planned: { label: t('oee.planned'), variant: "secondary" },
    unplanned: { label: t('oee.unplanned'), variant: "destructive" },
    breakdown: { label: t('oee.breakdown'), variant: "destructive" },
    changeover: { label: t('oee.changeover'), variant: "outline" },
    maintenance: { label: t('oee.maintenance'), variant: "default" },
    other: { label: t('oee.other'), variant: "outline" },
  };
  
  const { label, variant } = config[category] || config.other;
  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * doc 40 Wave 4 DEV-10 — OEE & Downtime body, extracted WITHOUT its own
 * DashboardLayout so it can render as the "oee" tab of DeviceHub (/device-monitor
 * ?tab=oee) alongside Fleet / Health / Field. The standalone /oee-dashboard route
 * now just redirects here (see the thin default export below), keeping deep-links.
 */
export function OEEDashboardContent() {
  const { t } = useTranslation();
  const [selectedMachine, setSelectedMachine] = useState<number | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showDowntimeDialog, setShowDowntimeDialog] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    machineId: 0,
    machineCode: "",
    plannedTime: 480,
    runTime: 420,
    idealCycleTime: 30,
    totalCount: 800,
    goodCount: 760,
  });
  const [downtimeData, setDowntimeData] = useState({
    machineId: 0,
    machineCode: "",
    category: "unplanned" as DowntimeEvent['category'],
    reason: "",
  });

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  // doc 40 DEV-10 — auto-refresh mỗi 60s (trước đây chỉ cập nhật khi bấm Refresh).
  const { data: allOEE, refetch: refetchOEE } = trpc.mqttClient.getAllOEE.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: machineOEE } = trpc.mqttClient.getMachineOEE.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const { data: activeDowntime } = trpc.mqttClient.getActiveDowntime.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const { data: downtimeHistory } = trpc.mqttClient.getDowntimeHistory.useQuery({});
  const { data: machineHealth } = trpc.mqttClient.getMachineHealth.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const semiE10Q = trpc.mqttClient.semiE10Breakdown.useQuery(
    {
      machineId: selectedMachine!,
      from: new Date(Date.now() - 8 * 3600 * 1000),
      to: new Date(),
      totalCount: machineOEE?.details?.totalCount ?? 0,
      goodCount: machineOEE?.details?.goodCount ?? 0,
      idealCycleTimeSec: machineOEE?.details?.idealCycleTime ?? 30,
    },
    { enabled: !!selectedMachine && !!machineOEE, refetchInterval: 60_000 },
  );

  // doc 46 FE-W2 — socket-first freshness. The OEE/downtime/health data is driven by
  // the unified U1 stream: an `oee` / `downtime` / `maintenance` ecosystem event
  // invalidates the relevant mqttClient queries so the board updates live. A short
  // trailing debounce collapses a burst of events into ONE refetch. The 60s polls
  // above stay as the fallback backstop for when the socket is down.
  const utils = trpc.useUtils();
  const oeeInvalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleOeeInvalidate = useCallback(() => {
    if (oeeInvalidateTimer.current) clearTimeout(oeeInvalidateTimer.current);
    oeeInvalidateTimer.current = setTimeout(() => {
      utils.mqttClient.getAllOEE.invalidate();
      utils.mqttClient.getMachineOEE.invalidate();
      utils.mqttClient.getActiveDowntime.invalidate();
      utils.mqttClient.getDowntimeHistory.invalidate();
      utils.mqttClient.semiE10Breakdown.invalidate();
      utils.mqttClient.getMachineHealth.invalidate();
    }, 1500);
  }, [utils]);
  useEffect(() => () => { if (oeeInvalidateTimer.current) clearTimeout(oeeInvalidateTimer.current); }, []);
  // Full `ecosystem:event` stream (NOT alertsOnly) — `oee` + `downtime` are not
  // alert-class kinds, so they only ride the unfiltered channel.
  const { isConnected: liveConnected } = useEcosystemEvents({
    bufferSize: 1,
    onEvent: (evt) => {
      if (evt.kind === "oee" || evt.kind === "downtime" || evt.kind === "maintenance") {
        scheduleOeeInvalidate();
      }
    },
  });

  // Mutations
  const calculateOEEMutation = trpc.mqttClient.calculateOEE.useMutation({
    onSuccess: () => {
      toast.success(t('oee.oeeCalculated'));
      refetchOEE();
      setShowCalculator(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const startDowntimeMutation = trpc.mqttClient.startDowntime.useMutation({
    onSuccess: () => {
      toast.success(t('oee.downtimeStarted'));
      setShowDowntimeDialog(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const endDowntimeMutation = trpc.mqttClient.endDowntime.useMutation({
    onSuccess: () => {
      toast.success(t('oee.downtimeEnded'));
    },
  });

  const calculateHealthMutation = trpc.mqttClient.calculateMachineHealth.useMutation({
    onSuccess: () => {
      toast.success(t('oee.healthCalculated'));
    },
  });

  // Calculate average OEE
  const avgOEE = allOEE && allOEE.length > 0
    ? allOEE.reduce((sum, m) => sum + m.oee, 0) / allOEE.length
    : 0;

  // Downtime by category
  const downtimeByCategory = downtimeHistory?.reduce((acc, d) => {
    acc[d.category] = (acc[d.category] || 0) + (d.duration || 0);
    return acc;
  }, {} as Record<string, number>) || {};

  const downtimePieData = Object.entries(downtimeByCategory).map(([category, duration]) => ({
    name: category === 'planned' ? t('oee.planned') :
          category === 'unplanned' ? t('oee.unplannedShort') :
          category === 'breakdown' ? t('oee.breakdown') :
          category === 'changeover' ? t('oee.changeoverShort') :
          category === 'maintenance' ? t('oee.maintenance') : t('oee.other'),
    value: duration,
  }));

  const COLORS = [chartColor(0), chartColor(1), chartColor(2), chartColor(3), chartColor(4), chartColor(0)];

  // Export OEE data to CSV
  const exportToCSV = () => {
    if (!allOEE || allOEE.length === 0) {
      toast.error(t('oee.noDataToExport'));
      return;
    }

    const headers = [
      t('oee.csvMachine'),
      t('oee.csvMachineCode'),
      t('oee.csvTime'),
      'Availability (%)',
      'Performance (%)',
      'Quality (%)',
      'OEE (%)',
      t('oee.csvPlannedTime'),
      t('oee.csvRunTime'),
      t('oee.csvDowntime'),
      t('oee.csvTotalOutput'),
      t('oee.csvOkOutput'),
      t('oee.csvNgOutput')
    ];

    const rows = allOEE.map(oee => [
      machines?.find(m => m.id === oee.machineId)?.name || `Machine ${oee.machineId}`,
      oee.machineCode,
      new Date(oee.timestamp).toLocaleString('vi-VN'),
      oee.availability.toFixed(2),
      oee.performance.toFixed(2),
      oee.quality.toFixed(2),
      oee.oee.toFixed(2),
      oee.details?.plannedTime || 0,
      oee.details?.runTime || 0,
      oee.details?.downtime || 0,
      oee.details?.totalCount || 0,
      oee.details?.goodCount || 0,
      oee.details?.rejectCount || 0
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OEE_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('oee.csvExported'));
  };

  // Export OEE data to Excel (XLSX format via CSV)
  const exportToExcel = () => {
    if (!allOEE || allOEE.length === 0) {
      toast.error(t('oee.noDataToExport'));
      return;
    }

    const headers = [
      t('oee.csvMachine'),
      t('oee.csvMachineCode'),
      t('oee.csvTime'),
      'Availability (%)',
      'Performance (%)',
      'Quality (%)',
      'OEE (%)',
      t('oee.csvPlannedTime'),
      t('oee.csvRunTime'),
      t('oee.csvDowntime'),
      t('oee.csvTotalOutput'),
      t('oee.csvOkOutput'),
      t('oee.csvNgOutput')
    ];

    const oeeRows = allOEE.map(oee => [
      machines?.find(m => m.id === oee.machineId)?.name || `Machine ${oee.machineId}`,
      oee.machineCode,
      new Date(oee.timestamp).toLocaleString('vi-VN'),
      oee.availability.toFixed(2),
      oee.performance.toFixed(2),
      oee.quality.toFixed(2),
      oee.oee.toFixed(2),
      oee.details?.plannedTime || 0,
      oee.details?.runTime || 0,
      oee.details?.downtime || 0,
      oee.details?.totalCount || 0,
      oee.details?.goodCount || 0,
      oee.details?.rejectCount || 0
    ]);

    // Add summary section
    const summaryRows = [
      [],
      [t('oee.summaryTitle')],
      [t('oee.avgOee'), `${avgOEE.toFixed(2)}%`],
      [t('oee.machineCount'), allOEE.length],
      [t('oee.exportTime'), new Date().toLocaleString('vi-VN')],
    ];

    // Add downtime summary if available
    if (downtimeHistory && downtimeHistory.length > 0) {
      summaryRows.push(
        [],
        [t('oee.downtimeStats')],
        [t('oee.categoryLabel'), t('oee.durationMinutes')]
      );
      Object.entries(downtimeByCategory).forEach(([category, duration]) => {
        const categoryName = category === 'planned' ? t('oee.planned') :
              category === 'unplanned' ? t('oee.unplanned') :
              category === 'breakdown' ? t('oee.breakdown') :
              category === 'changeover' ? t('oee.changeover') :
              category === 'maintenance' ? t('oee.maintenance') : t('oee.other');
        summaryRows.push([categoryName, duration]);
      });
    }

    const allRows = [headers, ...oeeRows, ...summaryRows];
    const csvContent = allRows
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OEE_Report_${new Date().toISOString().split('T')[0]}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('oee.excelExported'));
  };

  return (
      <div className="space-y-4 sm:space-y-6 mobile-safe-bottom">
        {/* Header */}
        <PageHeader
          icon={<Gauge className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
          title="OEE Dashboard"
          description={t('oee.subtitle')}
          actions={
            <>
            {liveConnected ? (
              <Badge variant="outline" className="gap-1 border-success/40 text-success">
                <Wifi className="h-3.5 w-3.5" /> {t('common.live', 'Live')}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                <WifiOff className="h-3.5 w-3.5" /> {t('common.polling', 'Polling')}
              </Badge>
            )}
            <Button variant="outline" onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              {t('oee.exportCsv')}
            </Button>
            <Button variant="outline" onClick={exportToExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              {t('oee.exportExcel')}
            </Button>
            <Button variant="outline" onClick={() => refetchOEE()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
            <Dialog open={showCalculator} onOpenChange={setShowCalculator}>
              <DialogTrigger asChild>
                <Button>
                  <Calculator className="h-4 w-4 mr-2" />
                  {t('oee.calculateOee')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{t('oee.calculateOeeTitle')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('oee.calculateOeeTitle')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>{t('oee.machine')}</Label>
                    <Select
                      value={calculatorData.machineId.toString()}
                      onValueChange={(v) => {
                        const machine = machines?.find(m => m.id === parseInt(v));
                        setCalculatorData({
                          ...calculatorData,
                          machineId: parseInt(v),
                          machineCode: machine?.code || "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('oee.selectMachine')} />
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t('oee.plannedTimeMin')}</Label>
                      <Input
                        type="number"
                        value={calculatorData.plannedTime}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          plannedTime: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                    <div>
                      <Label>{t('oee.runTimeMin')}</Label>
                      <Input
                        type="number"
                        value={calculatorData.runTime}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          runTime: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>{t('oee.idealCycleTime')}</Label>
                    <Input
                      type="number"
                      value={calculatorData.idealCycleTime}
                      onChange={(e) => setCalculatorData({
                        ...calculatorData,
                        idealCycleTime: parseInt(e.target.value) || 0,
                      })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t('oee.totalOutput')}</Label>
                      <Input
                        type="number"
                        value={calculatorData.totalCount}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          totalCount: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                    <div>
                      <Label>{t('oee.goodProducts')}</Label>
                      <Input
                        type="number"
                        value={calculatorData.goodCount}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          goodCount: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCalculator(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={() => calculateOEEMutation.mutate(calculatorData)}
                    disabled={!calculatorData.machineId || calculateOEEMutation.isPending}
                  >
                    {t('oee.calculate')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </>
          }
        />

        {/* U7 cross-links — OEE-focused view; the Command Center KPI strip + the
            device monitor give the wider live picture. */}
        <RelatedViews
          links={[
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
            { href: "/device-monitor", labelKey: "nav.deviceMonitor", labelDefault: "Device Monitor" },
          ]}
        />

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Gauge className="h-3 w-3 sm:h-4 sm:w-4 text-info" />
                <span className="hidden sm:inline">{t('oee.avgOee')}</span>
                <span className="sm:hidden">{t('oee.avgOeeShort')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">{avgOEE.toFixed(1)}%</div>
              <Progress value={avgOEE} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {avgOEE >= 85 ? "World Class" : avgOEE >= 60 ? "Typical" : t('oee.needsImprovement')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Activity className="h-3 w-3 sm:h-4 sm:w-4 text-success" />
                <span className="hidden sm:inline">{t('oee.machinesMonitored')}</span>
                <span className="sm:hidden">{t('oee.machinesShort')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">{allOEE?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                / {machines?.length || 0} {t('oee.totalMachines')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-warning" />
                <span className="hidden sm:inline">{t('oee.downtimeToday')}</span>
                <span className="sm:hidden">Downtime</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {Object.values(downtimeByCategory).reduce((a, b) => a + b, 0)} {t('oee.minutes')}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Object.keys(downtimeByCategory).length} {t('oee.events')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-destructive" />
                {t('oee.alerts')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {allOEE?.filter(m => m.oee < 60).length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('oee.lowOeeMachines')}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="oee" className="space-y-4">
          <TabsList>
            <TabsTrigger value="oee">OEE Machines</TabsTrigger>
            <TabsTrigger value="downtime">Downtime</TabsTrigger>
            <TabsTrigger value="health">Machine Health</TabsTrigger>
          </TabsList>

          {/* OEE Tab */}
          <TabsContent value="oee" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Machine List */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg">{t('oee.machineList')}</CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto space-y-2">
                  {allOEE?.map((m) => (
                    <div
                      key={m.machineId}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedMachine === m.machineId
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedMachine(m.machineId)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.machineCode}</span>
                        <Badge
                          variant={m.oee >= 85 ? "default" : m.oee >= 60 ? "secondary" : "destructive"}
                        >
                          {m.oee.toFixed(1)}%
                        </Badge>
                      </div>
                      <Progress value={m.oee} className="mt-2 h-1" />
                    </div>
                  ))}
                  {(!allOEE || allOEE.length === 0) && (
                    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                      <p className="font-medium text-foreground">{t('oee.noOeeData')}</p>
                      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                        {t('oee.noOeeDataHelp', 'Start recording inspections or reconnect a machine to populate OEE, downtime, and comparison charts.')}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* OEE Details */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {machineOEE ? t('oee.oeeDetail', { code: machineOEE.machineCode }) : t('oee.selectMachineToView')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {machineOEE ? (
                    <div className="space-y-6">
                      {/* OEE Gauges */}
                      <div className="flex justify-around">
                        <OEEGauge
                          value={machineOEE.availability}
                          label="Availability"
                          color="var(--success)"
                        />
                        <OEEGauge
                          value={machineOEE.performance}
                          label="Performance"
                          color="var(--info)"
                        />
                        <OEEGauge
                          value={machineOEE.quality}
                          label="Quality"
                          color="var(--warning)"
                        />
                        <OEEGauge
                          value={machineOEE.oee}
                          label="OEE"
                          color="var(--primary)"
                        />
                      </div>

                      {/* Details Table */}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('oee.plannedTime')}:</span>
                            <span className="font-medium">{machineOEE.details.plannedTime} {t('oee.minutes')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('oee.runTime')}:</span>
                            <span className="font-medium">{machineOEE.details.runTime} {t('oee.minutes')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Downtime:</span>
                            <span className="font-medium text-destructive">{machineOEE.details.downtime} {t('oee.minutes')}</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('oee.totalOutput')}:</span>
                            <span className="font-medium">{machineOEE.details.totalCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('oee.goodProducts')}:</span>
                            <span className="font-medium text-success">{machineOEE.details.goodCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{t('oee.rejects')}:</span>
                            <span className="font-medium text-destructive">{machineOEE.details.rejectCount}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDowntimeData({
                              machineId: machineOEE.machineId,
                              machineCode: machineOEE.machineCode,
                              category: "unplanned",
                              reason: "",
                            });
                            setShowDowntimeDialog(true);
                          }}
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          {t('oee.recordDowntime')}
                        </Button>
                        {activeDowntime && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => endDowntimeMutation.mutate({ machineId: machineOEE.machineId })}
                          >
                            <Play className="h-4 w-4 mr-2" />
                            {t('oee.endDowntime')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <Gauge className="h-12 w-12 mb-4" />
                      <p>{t('oee.selectMachineForDetails')}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* SEMI E10 / ISO 22400 Breakdown (8h window) */}
            {selectedMachine && semiE10Q.data && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    SEMI E10 / ISO 22400-2 — 8h Equipment State Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(() => {
                    const b = semiE10Q.data.breakdown;
                    const a = semiE10Q.data.alert;
                    const banner =
                      a.level === "critical"
                        ? "bg-destructive/10 border-destructive/50 text-destructive"
                        : a.level === "warning"
                          ? "bg-warning/10 border-warning/50 text-warning"
                          : "bg-success/10 border-success/50 text-success";
                    const tiles: Array<{ k: keyof typeof b.states; label: string; color: string }> = [
                      { k: "PT", label: "Productive (PT)", color: "text-success" },
                      { k: "SB", label: "Standby (SB)", color: "text-info" },
                      { k: "ET", label: "Engineering (ET)", color: "text-primary" },
                      { k: "SD", label: "Sched. Downtime (SD)", color: "text-warning" },
                      { k: "UD", label: "Unsched. Down (UD)", color: "text-destructive" },
                      { k: "NS", label: "Non-Scheduled (NS)", color: "text-muted-foreground" },
                    ];
                    return (
                      <>
                        <div className={`rounded-md border p-3 ${banner}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{a.message}</span>
                            <Badge variant="outline" className="font-mono">
                              OEE {(a.oeePct / 100).toFixed(1)}%
                            </Badge>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                          {tiles.map((t) => (
                            <div key={t.k} className="rounded-md border p-3">
                              <div className="text-xs text-muted-foreground">{t.label}</div>
                              <div className={`text-xl font-semibold ${t.color}`}>
                                {Math.round(b.states[t.k])}
                                <span className="text-xs text-muted-foreground ml-1">min</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span>Availability</span>
                              <span className="font-mono">{(b.availability * 100).toFixed(1)}%</span>
                            </div>
                            <Progress value={b.availability * 100} />
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span>Performance</span>
                              <span className="font-mono">{(b.performance * 100).toFixed(1)}%</span>
                            </div>
                            <Progress value={b.performance * 100} />
                          </div>
                          <div>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span>Quality</span>
                              <span className="font-mono">{(b.quality * 100).toFixed(1)}%</span>
                            </div>
                            <Progress value={b.quality * 100} />
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* OEE Comparison Chart */}
            {allOEE && allOEE.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('oee.oeeComparison')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={allOEE}>
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="machineCode" {...chartAxisProps} />
                        <YAxis domain={[0, 100]} {...chartAxisProps} />
                        <Tooltip contentStyle={chartTooltipStyle} />
                        <Legend />
                        <Bar dataKey="availability" name="Availability" fill="var(--success)" />
                        <Bar dataKey="performance" name="Performance" fill="var(--info)" />
                        <Bar dataKey="quality" name="Quality" fill="var(--warning)" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Downtime Tab */}
          <TabsContent value="downtime" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Downtime by Category */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('oee.downtimeByCategory')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {downtimePieData.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={downtimePieData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, value }) => `${name}: ${value}m`}
                            outerRadius={80}
                            fill={chartColor(0)}
                            dataKey="value"
                          >
                            {downtimePieData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={chartTooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      {t('oee.noDowntimeData')}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Downtime Events */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('oee.recentDowntime')}</CardTitle>
                </CardHeader>
                <CardContent className="max-h-80 overflow-y-auto">
                  <div className="space-y-3">
                    {downtimeHistory?.slice(-10).reverse().map((event) => (
                      <div key={event.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{event.machineCode}</span>
                          <DowntimeCategoryBadge category={event.category} />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <div>{t('oee.startTime')}: {new Date(event.startTime).toLocaleString('vi-VN')}</div>
                          {event.endTime && (
                            <div>{t('oee.endTime')}: {new Date(event.endTime).toLocaleString('vi-VN')}</div>
                          )}
                          {event.duration && <div>{t('oee.duration')}: {event.duration} {t('oee.minutes')}</div>}
                          {event.reason && <div>{t('oee.reason')}: {event.reason}</div>}
                        </div>
                      </div>
                    ))}
                    {(!downtimeHistory || downtimeHistory.length === 0) && (
                      <p className="text-center text-muted-foreground py-4">
                        {t('oee.noDowntimeEvents')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Start Downtime Dialog */}
            <Dialog open={showDowntimeDialog} onOpenChange={setShowDowntimeDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('oee.recordDowntime')}</DialogTitle>
                  <DialogDescription className="sr-only">{t('oee.recordDowntime')}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>{t('oee.machine')}</Label>
                    <Select
                      value={downtimeData.machineId.toString()}
                      onValueChange={(v) => {
                        const machine = machines?.find(m => m.id === parseInt(v));
                        setDowntimeData({
                          ...downtimeData,
                          machineId: parseInt(v),
                          machineCode: machine?.code || "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('oee.selectMachine')} />
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
                    <Label>{t('oee.downtimeType')}</Label>
                    <Select
                      value={downtimeData.category}
                      onValueChange={(v) => setDowntimeData({
                        ...downtimeData,
                        category: v as DowntimeEvent['category'],
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planned">{t('oee.planned')}</SelectItem>
                        <SelectItem value="unplanned">{t('oee.unplanned')}</SelectItem>
                        <SelectItem value="breakdown">{t('oee.breakdown')}</SelectItem>
                        <SelectItem value="changeover">{t('oee.changeover')}</SelectItem>
                        <SelectItem value="maintenance">{t('oee.maintenance')}</SelectItem>
                        <SelectItem value="other">{t('oee.other')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('oee.reason')}</Label>
                    <Input
                      value={downtimeData.reason}
                      onChange={(e) => setDowntimeData({
                        ...downtimeData,
                        reason: e.target.value,
                      })}
                      placeholder={t('oee.reasonPlaceholder')}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDowntimeDialog(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={() => startDowntimeMutation.mutate(downtimeData)}
                    disabled={!downtimeData.machineId || startDowntimeMutation.isPending}
                  >
                    {t('oee.start')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Machine Health Tab */}
          <TabsContent value="health" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Machine Health & Predictive Maintenance
                </CardTitle>
                <CardDescription>
                  {t('oee.machineHealthDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {machineHealth && selectedMachine ? (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="relative h-32 w-32">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadialBarChart
                            cx="50%"
                            cy="50%"
                            innerRadius="60%"
                            outerRadius="100%"
                            barSize={10}
                            data={[{ value: machineHealth.score, fill:
                              machineHealth.score >= 80 ? 'var(--success)' :
                              machineHealth.score >= 50 ? 'var(--warning)' : 'var(--destructive)'
                            }]}
                            startAngle={180}
                            endAngle={0}
                          >
                            <RadialBar background dataKey="value" cornerRadius={5} />
                          </RadialBarChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold">{machineHealth.score.toFixed(0)}</span>
                          <span className="text-xs text-muted-foreground">Health Score</span>
                        </div>
                      </div>
                      <div className="flex-1 space-y-2">
                        {machineHealth.factors.map((factor) => (
                          <div key={factor.name} className="flex items-center gap-2">
                            <span className="w-32 text-sm">{factor.name}</span>
                            <Progress value={factor.score} className="flex-1" />
                            <span className="w-12 text-right text-sm">{factor.score.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t('oee.lastUpdated')}: {new Date(machineHealth.lastUpdated).toLocaleString('vi-VN')}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Settings2 className="h-12 w-12 mb-4" />
                    <p>{t('oee.selectMachineForHealth')}</p>
                    <p className="text-sm mt-2">
                      {t('oee.orCalculateHealth')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
  );
}

/**
 * doc 40 Wave 4 DEV-10 — OEE & Downtime is now the 4th tab of DeviceHub. The
 * legacy /oee-dashboard route stays as a thin redirect into the hub so bookmarks,
 * the nav item, and cross-links keep working.
 */
export default function OEEDashboard() {
  return <Redirect to="/device-monitor?tab=oee" />;
}
