import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { 
  Activity, 
  AlertTriangle, 
  Box, 
  CheckCircle2, 
  Cpu, 
  RefreshCw, 
  TrendingUp,
  TrendingDown,
  XCircle,
  Clock,
  LayoutGrid,
  FileText,
  History,
  ChevronRight,
  Eye,
  Zap,
  Target,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Bell,
  Sun,
  Moon,
  Sunrise,
  Play,
  Pause,
  Settings2,
  Award,
  ThumbsDown
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line
} from "recharts";

// Types
type DashboardStats = {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
};

type StatsWithComparison = {
  current: DashboardStats;
  previous: DashboardStats | null;
  trends: {
    output: number;
    fpy: number;
    ok: number;
    ng: number;
    ntf: number;
  } | null;
};

type MachineStats = {
  id: number;
  name: string;
  code: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
  lineId?: number;
  lineName?: string;
  stationId?: number;
  stationName?: string;
  workshopId?: number;
  workshopName?: string;
  factoryId?: number;
  factoryName?: string;
};

type InspectionResult = {
  id: number;
  serialNumber: string;
  productModel: string | null;
  overallResult: string;
  createdAt: Date;
  machineName?: string;
};

type ShiftStats = {
  shift: string;
  shiftName: string;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  fpy: number;
};

// Auto-refresh intervals
const REFRESH_INTERVALS = [
  { value: "5", label: "5 giây" },
  { value: "10", label: "10 giây" },
  { value: "30", label: "30 giây" },
  { value: "60", label: "1 phút" },
  { value: "0", label: "Tắt" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState("today");
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>("all");
  const [selectedLine, setSelectedLine] = useState<string>("all");
  const [selectedMachine, setSelectedMachine] = useState<MachineStats | null>(null);
  const [machineDetailOpen, setMachineDetailOpen] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState("30");
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(true);
  const [lastRefreshTime, setLastRefreshTime] = useState(new Date());

  // Calculate date range based on selection
  const dateRange = useMemo(() => {
    const now = new Date();
    const endDate = now;
    let startDate = new Date();
    
    switch (timeRange) {
      case "today":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setHours(0, 0, 0, 0);
    }
    
    return { startDate, endDate };
  }, [timeRange]);

  // Fetch stats with comparison
  const { data: statsWithComparison, isLoading: statsLoading, refetch: refetchStats } = trpc.dashboard.getStatsWithComparison.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch all machines stats
  const { data: machinesStats, isLoading: machinesLoading, refetch: refetchMachines } = trpc.dashboard.getAllMachinesStats.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch shift stats
  const { data: shiftStats } = trpc.dashboard.getShiftStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch top/bottom machines
  const { data: topBottomMachines } = trpc.dashboard.getTopBottomMachines.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: 5,
  }, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch active alerts count
  const { data: activeAlertsCount } = trpc.dashboard.getActiveAlertsCount.useQuery(undefined, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch daily stats for sparklines
  const { data: dailyStats } = trpc.dashboard.getDailyStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    days: 7,
  });

  // Fetch factories, workshops, lines for filters
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Fetch recent inspections for selected machine
  const { data: recentInspections } = trpc.inspection.list.useQuery({
    machineId: selectedMachine?.id,
    limit: 20,
  }, {
    enabled: !!selectedMachine,
  });

  // Update last refresh time
  useEffect(() => {
    if (statsWithComparison) {
      setLastRefreshTime(new Date());
    }
  }, [statsWithComparison]);

  // Manual refresh
  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchMachines();
    setLastRefreshTime(new Date());
  }, [refetchStats, refetchMachines]);

  // Filter workshops by selected factory
  const filteredWorkshops = useMemo(() => {
    if (!workshops || selectedFactory === "all") return workshops || [];
    return workshops.filter(w => w.factoryId === parseInt(selectedFactory));
  }, [workshops, selectedFactory]);

  // Filter lines by selected workshop
  const filteredLines = useMemo(() => {
    if (!lines || selectedWorkshop === "all") return lines || [];
    return lines.filter(l => l.workshopId === parseInt(selectedWorkshop));
  }, [lines, selectedWorkshop]);

  // Group machines by production line
  const machinesByLine = useMemo(() => {
    if (!machinesStats) return new Map<string, MachineStats[]>();
    
    type MachineWithHierarchy = {
      machine: { id: number; code: string; name: string };
      station: { id: number; name: string; lineId: number } | null;
      line: { id: number; name: string; workshopId: number } | null;
      workshop: { id: number; name: string; factoryId: number } | null;
      factory: { id: number; name: string } | null;
      stats: { total: number; ok: number; ng: number; ntf: number; yieldRate: number };
    };
    
    const machines = (machinesStats as MachineWithHierarchy[]).map(m => ({
      id: m.machine.id,
      name: m.machine.name,
      code: m.machine.code,
      total: m.stats.total,
      ok: m.stats.ok,
      ng: m.stats.ng,
      ntf: m.stats.ntf,
      yieldRate: m.stats.yieldRate,
      lineId: m.line?.id,
      lineName: m.line?.name || 'Chưa phân loại',
      stationId: m.station?.id,
      stationName: m.station?.name,
      workshopId: m.workshop?.id,
      workshopName: m.workshop?.name,
      factoryId: m.factory?.id,
      factoryName: m.factory?.name,
    }));
    const grouped = new Map<string, MachineStats[]>();
    
    machines.forEach(machine => {
      // Apply filters
      if (selectedFactory !== "all" && machine.factoryId !== parseInt(selectedFactory)) return;
      if (selectedWorkshop !== "all" && machine.workshopId !== parseInt(selectedWorkshop)) return;
      if (selectedLine !== "all" && machine.lineId !== parseInt(selectedLine)) return;
      
      const lineKey = machine.lineName || "Chưa phân loại";
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, []);
      }
      grouped.get(lineKey)!.push(machine);
    });
    
    return grouped;
  }, [machinesStats, selectedFactory, selectedWorkshop, selectedLine]);

  // Calculate FPY, FY, NTFY for a machine
  const calculateYields = (machine: MachineStats) => {
    const total = machine.total || 1;
    const fpy = ((machine.ok / total) * 100).toFixed(1);
    const fy = ((machine.ng / total) * 100).toFixed(1);
    const ntfy = ((machine.ntf / total) * 100).toFixed(1);
    return { fpy, fy, ntfy };
  };

  // Get status color based on FPY
  const getStatusColor = (fpy: number) => {
    if (fpy >= 95) return "text-success border-success/50 bg-success/10";
    if (fpy >= 85) return "text-warning border-warning/50 bg-warning/10";
    return "text-destructive border-destructive/50 bg-destructive/10";
  };

  // Get status indicator
  const getStatusIndicator = (fpy: number) => {
    if (fpy >= 95) return { icon: CheckCircle2, color: "text-success", label: "Tốt" };
    if (fpy >= 85) return { icon: AlertTriangle, color: "text-warning", label: "Cảnh báo" };
    return { icon: XCircle, color: "text-destructive", label: "Cần xử lý" };
  };

  // Trend indicator component
  const TrendIndicator = ({ value, suffix = "%" }: { value: number | undefined; suffix?: string }) => {
    if (value === undefined || value === 0) return null;
    const isPositive = value > 0;
    return (
      <span className={`text-xs flex items-center gap-0.5 ${isPositive ? 'text-success' : 'text-destructive'}`}>
        {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isPositive ? '+' : ''}{value.toFixed(1)}{suffix}
      </span>
    );
  };

  // Sparkline component
  const Sparkline = ({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) => {
    if (!data || data.length === 0) return null;
    return (
      <div className="h-8 w-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Area 
              type="monotone" 
              dataKey={dataKey} 
              stroke={color} 
              fill={color} 
              fillOpacity={0.2}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const pieData = useMemo(() => {
    const stats = (statsWithComparison as StatsWithComparison | undefined)?.current;
    if (!stats) return [];
    return [
      { name: "OK", value: stats.ok, color: "oklch(0.72 0.17 145)" },
      { name: "NG", value: stats.ng, color: "oklch(0.65 0.2 25)" },
      { name: "NTF", value: stats.ntf, color: "oklch(0.78 0.15 75)" },
    ].filter(item => item.value > 0);
  }, [statsWithComparison]);

  const openMachineDetail = (machine: MachineStats) => {
    setSelectedMachine(machine);
    setMachineDetailOpen(true);
  };

  const stats = (statsWithComparison as StatsWithComparison | undefined)?.current;
  const trends = (statsWithComparison as StatsWithComparison | undefined)?.trends;

  // Prepare sparkline data
  const sparklineData = useMemo(() => {
    if (!dailyStats || !Array.isArray(dailyStats)) return [];
    return [...(dailyStats as any[])].reverse().map((d: any) => ({
      date: d.date,
      output: d.totalProducts,
      fpy: d.totalProducts > 0 ? ((d.okCount + d.ntfCount) / d.totalProducts) * 100 : 0,
    }));
  }, [dailyStats]);

  return (
    <DashboardLayout 
      title="Dashboard" 
      navItems={navItems}
      currentPath="/dashboard"
    >
      <div className="space-y-6">
        {/* Header with filters and auto-refresh controls */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Production Dashboard
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-muted-foreground text-sm">Theo dõi chất lượng sản xuất theo dây chuyền</p>
              <span className="text-xs text-muted-foreground">
                • Cập nhật lúc {lastRefreshTime.toLocaleTimeString('vi-VN')}
              </span>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Alert Badge */}
            {(activeAlertsCount as number) > 0 && (
              <Link href="/alerts">
                <Button variant="outline" size="sm" className="relative">
                  <Bell className="h-4 w-4 mr-1" />
                  Cảnh báo
                  <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                    {activeAlertsCount as number}
                  </Badge>
                </Button>
              </Link>
            )}

            <Select value={selectedFactory} onValueChange={(v) => {
              setSelectedFactory(v);
              setSelectedWorkshop("all");
              setSelectedLine("all");
            }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Nhà máy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả nhà máy</SelectItem>
                {factories?.map((factory) => (
                  <SelectItem key={factory.id} value={String(factory.id)}>
                    {factory.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedWorkshop} onValueChange={(v) => {
              setSelectedWorkshop(v);
              setSelectedLine("all");
            }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Nhà xưởng" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả xưởng</SelectItem>
                {filteredWorkshops?.map((workshop) => (
                  <SelectItem key={workshop.id} value={String(workshop.id)}>
                    {workshop.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedLine} onValueChange={setSelectedLine}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Dây chuyền" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả line</SelectItem>
                {filteredLines?.map((line) => (
                  <SelectItem key={line.id} value={String(line.id)}>
                    {line.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hôm nay</SelectItem>
                <SelectItem value="week">7 ngày</SelectItem>
                <SelectItem value="month">30 ngày</SelectItem>
              </SelectContent>
            </Select>

            {/* Auto-refresh controls */}
            <div className="flex items-center gap-1 border rounded-md">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-9 w-9"
                      onClick={() => setIsAutoRefreshing(!isAutoRefreshing)}
                    >
                      {isAutoRefreshing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isAutoRefreshing ? 'Tạm dừng auto-refresh' : 'Bật auto-refresh'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <Select value={autoRefreshInterval} onValueChange={setAutoRefreshInterval}>
                <SelectTrigger className="w-[90px] border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFRESH_INTERVALS.map((interval) => (
                    <SelectItem key={interval.value} value={interval.value}>
                      {interval.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary Stats Cards with Trends */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Output</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-foreground">
                      {statsLoading ? "..." : stats?.total?.toLocaleString() || 0}
                    </p>
                    <TrendIndicator value={trends?.output} suffix="%" />
                  </div>
                  <Sparkline data={sparklineData} dataKey="output" color="oklch(0.7 0.15 200)" />
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Box className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">FPY</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-success">
                      {statsLoading ? "..." : `${stats?.yieldRate?.toFixed(1) || 0}%`}
                    </p>
                    <TrendIndicator value={trends?.fpy} suffix="pp" />
                  </div>
                  <Sparkline data={sparklineData} dataKey="fpy" color="oklch(0.72 0.17 145)" />
                </div>
                <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <Target className="h-5 w-5 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">OK</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-success">
                      {statsLoading ? "..." : stats?.ok?.toLocaleString() || 0}
                    </p>
                    <TrendIndicator value={trends?.ok} />
                  </div>
                </div>
                <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">NG</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-destructive">
                      {statsLoading ? "..." : stats?.ng?.toLocaleString() || 0}
                    </p>
                    <TrendIndicator value={trends?.ng} />
                  </div>
                </div>
                <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                  <XCircle className="h-5 w-5 text-destructive" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">NTF</p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-2xl font-bold text-warning">
                      {statsLoading ? "..." : stats?.ntf?.toLocaleString() || 0}
                    </p>
                    <TrendIndicator value={trends?.ntf} />
                  </div>
                </div>
                <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Shift Stats & Top/Bottom Machines */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Shift Statistics */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Thống kê theo ca
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(shiftStats as ShiftStats[] | undefined)?.map((shift) => {
                  const ShiftIcon = shift.shift === 'morning' ? Sunrise : shift.shift === 'afternoon' ? Sun : Moon;
                  return (
                    <div key={shift.shift} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2">
                        <ShiftIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{shift.shiftName}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">{shift.total} sp</span>
                        <span className={shift.fpy >= 95 ? 'text-success' : shift.fpy >= 85 ? 'text-warning' : 'text-destructive'}>
                          {shift.fpy}%
                        </span>
                      </div>
                    </div>
                  );
                })}
                {(!shiftStats || (shiftStats as ShiftStats[]).length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Chưa có dữ liệu</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Performing Machines */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-success" />
                Top 5 máy tốt nhất
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(topBottomMachines as { top: any[]; bottom: any[] } | undefined)?.top?.map((machine, index) => (
                  <div key={machine.id} className="flex items-center justify-between p-2 rounded-lg bg-success/5 border border-success/20">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-success w-5">#{index + 1}</span>
                      <span className="text-sm truncate max-w-[120px]">{machine.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{machine.total} sp</span>
                      <Badge variant="outline" className="text-success border-success/50">
                        {machine.fpy}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!topBottomMachines || (topBottomMachines as { top: any[] }).top?.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Chưa có dữ liệu</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bottom Performing Machines */}
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-destructive" />
                Top 5 máy cần cải thiện
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(topBottomMachines as { top: any[]; bottom: any[] } | undefined)?.bottom?.map((machine, index) => (
                  <div key={machine.id} className="flex items-center justify-between p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-destructive w-5">#{index + 1}</span>
                      <span className="text-sm truncate max-w-[120px]">{machine.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{machine.total} sp</span>
                      <Badge variant="outline" className="text-destructive border-destructive/50">
                        {machine.fpy}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!topBottomMachines || (topBottomMachines as { bottom: any[] }).bottom?.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Chưa có dữ liệu</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Production Line Layout */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Layout Dây chuyền sản xuất
            </h2>
            <Badge variant="outline" className="text-muted-foreground">
              {machinesByLine.size} dây chuyền • {Array.from(machinesByLine.values()).flat().length} máy
            </Badge>
          </div>

          {machinesLoading ? (
            <div className="grid grid-cols-1 gap-6">
              {[1, 2].map((i) => (
                <Card key={i} className="glass-card animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-1/4"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="h-32 bg-muted rounded"></div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : machinesByLine.size === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-12 text-center">
                <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Chưa có máy nào trong bộ lọc hiện tại</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Array.from(machinesByLine.entries()).map(([lineName, machines]) => {
                // Calculate line totals
                const lineTotal = machines.reduce((sum, m) => sum + m.total, 0);
                const lineOk = machines.reduce((sum, m) => sum + m.ok, 0);
                const lineNg = machines.reduce((sum, m) => sum + m.ng, 0);
                const lineNtf = machines.reduce((sum, m) => sum + m.ntf, 0);
                const lineFpy = lineTotal > 0 ? ((lineOk / lineTotal) * 100).toFixed(1) : "0";

                return (
                  <Card key={lineName} className="glass-card overflow-hidden">
                    {/* Line Header */}
                    <div className="bg-gradient-to-r from-primary/10 to-transparent border-b border-border/50 px-6 py-4">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                            <Zap className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">{lineName}</h3>
                            <p className="text-sm text-muted-foreground">{machines.length} máy hoạt động</p>
                          </div>
                        </div>
                        
                        {/* Line Summary Stats */}
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-center">
                            <p className="text-muted-foreground">Output</p>
                            <p className="font-semibold text-foreground">{lineTotal.toLocaleString()}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">FPY</p>
                            <p className={`font-semibold ${parseFloat(lineFpy) >= 95 ? 'text-success' : parseFloat(lineFpy) >= 85 ? 'text-warning' : 'text-destructive'}`}>
                              {lineFpy}%
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">OK/NG/NTF</p>
                            <p className="font-semibold">
                              <span className="text-success">{lineOk}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-destructive">{lineNg}</span>
                              <span className="text-muted-foreground">/</span>
                              <span className="text-warning">{lineNtf}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Machines Grid */}
                    <CardContent className="p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {machines.map((machine) => {
                          const { fpy, fy, ntfy } = calculateYields(machine);
                          const fpyNum = parseFloat(fpy);
                          const status = getStatusIndicator(fpyNum);
                          const StatusIcon = status.icon;

                          return (
                            <div
                              key={machine.id}
                              className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] ${getStatusColor(fpyNum)}`}
                              onClick={() => openMachineDetail(machine)}
                            >
                              {/* Status indicator */}
                              <div className="absolute top-3 right-3">
                                <StatusIcon className={`h-5 w-5 ${status.color}`} />
                              </div>

                              {/* Machine info */}
                              <div className="mb-3">
                                <h4 className="font-semibold text-foreground truncate pr-6">{machine.name}</h4>
                                <p className="text-xs text-muted-foreground">{machine.code}</p>
                              </div>

                              {/* Stats grid */}
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="text-center p-2 rounded-lg bg-background/50">
                                  <p className="text-xs text-muted-foreground">FPY</p>
                                  <p className={`font-bold ${fpyNum >= 95 ? 'text-success' : fpyNum >= 85 ? 'text-warning' : 'text-destructive'}`}>
                                    {fpy}%
                                  </p>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-background/50">
                                  <p className="text-xs text-muted-foreground">Output</p>
                                  <p className="font-bold text-foreground">{machine.total}</p>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-background/50">
                                  <p className="text-xs text-muted-foreground">FY</p>
                                  <p className="font-bold text-destructive">{fy}%</p>
                                </div>
                                <div className="text-center p-2 rounded-lg bg-background/50">
                                  <p className="text-xs text-muted-foreground">NTFY</p>
                                  <p className="font-bold text-warning">{ntfy}%</p>
                                </div>
                              </div>

                              {/* View detail link */}
                              <div className="mt-3 text-center">
                                <span className="text-xs text-primary flex items-center justify-center gap-1">
                                  <Eye className="h-3 w-3" />
                                  Xem chi tiết
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Phân bố kết quả</CardTitle>
              <CardDescription>Tỷ lệ OK/NG/NTF tổng hợp</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Chưa có dữ liệu
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bar Chart - Top machines */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Top máy theo sản lượng</CardTitle>
              <CardDescription>10 máy có output cao nhất</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                {machinesStats && (machinesStats as any[]).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(machinesStats as any[])
                        .map(m => ({
                          name: m.machine.name.length > 10 ? m.machine.name.substring(0, 10) + '...' : m.machine.name,
                          output: m.stats.total,
                          fpy: m.stats.yieldRate,
                        }))
                        .sort((a, b) => b.output - a.output)
                        .slice(0, 10)
                      }
                      layout="vertical"
                      margin={{ left: 80 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} />
                      <RechartsTooltip />
                      <Bar dataKey="output" fill="oklch(0.7 0.15 200)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Chưa có dữ liệu
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Machine Detail Modal */}
      <Dialog open={machineDetailOpen} onOpenChange={setMachineDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              {selectedMachine?.name}
            </DialogTitle>
            <DialogDescription>
              Mã máy: {selectedMachine?.code} • {selectedMachine?.lineName}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">Tổng quan</TabsTrigger>
              <TabsTrigger value="recent">Kết quả gần nhất</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {selectedMachine && (
                <>
                  {/* Stats Grid */}
                  <div className="grid grid-cols-4 gap-4">
                    <div className="text-center p-4 rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground">Total Output</p>
                      <p className="text-2xl font-bold text-foreground">{selectedMachine.total}</p>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-success/10">
                      <p className="text-sm text-muted-foreground">FPY</p>
                      <p className="text-2xl font-bold text-success">
                        {calculateYields(selectedMachine).fpy}%
                      </p>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-destructive/10">
                      <p className="text-sm text-muted-foreground">FY</p>
                      <p className="text-2xl font-bold text-destructive">
                        {calculateYields(selectedMachine).fy}%
                      </p>
                    </div>
                    <div className="text-center p-4 rounded-lg bg-warning/10">
                      <p className="text-sm text-muted-foreground">NTFY</p>
                      <p className="text-2xl font-bold text-warning">
                        {calculateYields(selectedMachine).ntfy}%
                      </p>
                    </div>
                  </div>

                  {/* Mini Pie Chart */}
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "OK", value: selectedMachine.ok, color: "oklch(0.72 0.17 145)" },
                            { name: "NG", value: selectedMachine.ng, color: "oklch(0.65 0.2 25)" },
                            { name: "NTF", value: selectedMachine.ntf, color: "oklch(0.78 0.15 75)" },
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                        >
                          {[
                            { name: "OK", value: selectedMachine.ok, color: "oklch(0.72 0.17 145)" },
                            { name: "NG", value: selectedMachine.ng, color: "oklch(0.65 0.2 25)" },
                            { name: "NTF", value: selectedMachine.ntf, color: "oklch(0.78 0.15 75)" },
                          ].filter(d => d.value > 0).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="recent">
              <ScrollArea className="h-[300px]">
                <div className="space-y-2">
                  {recentInspections?.data?.map((inspection: InspectionResult) => (
                    <div
                      key={inspection.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/30"
                    >
                      <div>
                        <p className="font-medium text-foreground">{inspection.serialNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {inspection.productModel} • {new Date(inspection.createdAt).toLocaleString('vi-VN')}
                        </p>
                      </div>
                      <Badge
                        variant={
                          inspection.overallResult === "OK"
                            ? "default"
                            : inspection.overallResult === "NG"
                            ? "destructive"
                            : "secondary"
                        }
                        className={
                          inspection.overallResult === "OK"
                            ? "bg-success text-success-foreground"
                            : inspection.overallResult === "NTF"
                            ? "bg-warning text-warning-foreground"
                            : ""
                        }
                      >
                        {inspection.overallResult}
                      </Badge>
                    </div>
                  ))}
                  {(!recentInspections?.data || recentInspections.data.length === 0) && (
                    <p className="text-center text-muted-foreground py-8">
                      Chưa có kết quả kiểm tra
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
