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
  ThumbsDown,
  Wifi,
  WifiOff
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
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
  image2DUrl?: string | null;
  image3DUrl?: string | null;
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
  const [activeTab, setActiveTab] = useState<"overview" | "layout">("overview");
  const [machineStatusFilter, setMachineStatusFilter] = useState<"all" | "online" | "offline">("all");
  
  // Machine online status from WebSocket
  const [onlineMachines, setOnlineMachines] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);

  // WebSocket connection for realtime machine status
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/api/socket.io',
      transports: ['polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Dashboard] WebSocket connected');
      // Request current online machines
      socket.emit('admin:get_online_machines');
    });

    socket.on('machine:online_list', (data: { machines: string[] }) => {
      setOnlineMachines(new Set(data.machines));
    });

    socket.on('machine:status_change', (data: { machineCode: string; status: 'online' | 'offline' }) => {
      setOnlineMachines(prev => {
        const newSet = new Set(prev);
        if (data.status === 'online') {
          newSet.add(data.machineCode);
        } else {
          newSet.delete(data.machineCode);
        }
        return newSet;
      });
    });

    socket.on('disconnect', () => {
      console.log('[Dashboard] WebSocket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, []);
  
  // Metrics customization state
  const [metricsSettingsOpen, setMetricsSettingsOpen] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<{
    fpy: boolean;
    fy: boolean;
    ntfy: boolean;
    output: boolean;
  }>(() => {
    const saved = localStorage.getItem('dashboard_visible_metrics');
    return saved ? JSON.parse(saved) : { fpy: true, fy: true, ntfy: true, output: true };
  });
  
  // Save metrics settings to localStorage
  useEffect(() => {
    localStorage.setItem('dashboard_visible_metrics', JSON.stringify(visibleMetrics));
  }, [visibleMetrics]);

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

  // Fetch hourly stats for timeline chart
  const { data: hourlyStats } = trpc.dashboard.getHourlyStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    hours: 24,
  }, {
    refetchInterval: isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch factories, workshops, lines for filters
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Fetch line product assignments and production orders for line info
  const { data: lineProductAssignments } = trpc.lineProductAssignment.list.useQuery();
  const { data: productionOrders } = trpc.productionOrder.list.useQuery();
  const { data: productModels } = trpc.productModel.list.useQuery();

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
      
      // Apply machine status filter
      if (machineStatusFilter !== "all") {
        const isOnline = onlineMachines.has(machine.code);
        if (machineStatusFilter === "online" && !isOnline) return;
        if (machineStatusFilter === "offline" && isOnline) return;
      }
      
      const lineKey = machine.lineName || "Chưa phân loại";
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, []);
      }
      grouped.get(lineKey)!.push(machine);
    });
    
    return grouped;
  }, [machinesStats, selectedFactory, selectedWorkshop, selectedLine, machineStatusFilter, onlineMachines]);

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

        {/* Machine Status Widget - Fixed at top */}
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Trạng thái kết nối máy
              </CardTitle>
              <Link href="/machine-status">
                <Button variant="ghost" size="sm" className="text-xs">
                  Xem chi tiết
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{machinesStats?.length || 0}</p>
                  <p className="text-xs text-muted-foreground">Tổng số máy</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10">
                <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Wifi className="h-5 w-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-emerald-500">{onlineMachines.size}</p>
                  <p className="text-xs text-muted-foreground">Online</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10">
                <div className="h-10 w-10 rounded-lg bg-red-500/20 flex items-center justify-center">
                  <WifiOff className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-500">
                    {Math.max(0, (machinesStats?.length || 0) - onlineMachines.size)}
                  </p>
                  <p className="text-xs text-muted-foreground">Offline</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Activity className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {machinesStats?.length ? Math.round((onlineMachines.size / machinesStats.length) * 100) : 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Availability</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Overview and Layout */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "layout")} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Tổng quan
            </TabsTrigger>
            <TabsTrigger value="layout" className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              Layout dây chuyền
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
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

        {/* Timeline Chart - Full Width */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Biểu đồ theo thời gian (24 giờ qua)
            </CardTitle>
            <CardDescription>FPY, FY, NTFY và Output theo từng giờ</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {hourlyStats && hourlyStats.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={hourlyStats.map((h: { hour: string; fpy: string; fy: string; ntfy: string; total: number }) => ({
                      time: h.hour.split(' ')[1] || h.hour,
                      FPY: parseFloat(h.fpy),
                      FY: parseFloat(h.fy),
                      NTFY: parseFloat(h.ntfy),
                      Total: h.total,
                    }))}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <XAxis 
                      dataKey="time" 
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis 
                      yAxisId="left"
                      tick={{ fontSize: 10 }}
                      domain={[0, 100]}
                      label={{ value: '%', angle: -90, position: 'insideLeft', fontSize: 10 }}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10 }}
                      label={{ value: 'Output', angle: 90, position: 'insideRight', fontSize: 10 }}
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(0,0,0,0.8)', 
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '12px'
                      }}
                    />
                    <Legend />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="FPY" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="FY" 
                      stroke="#ef4444" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="NTFY" 
                      stroke="#f59e0b" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="Total" 
                      stroke="#06b6d4" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Chưa có dữ liệu
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-base">Phân bố kết quả</CardTitle>
              <CardDescription>Tỷ lệ OK/NG/NTF tổng hợp</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
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
              <div className="h-[200px]">
                {machinesStats && (machinesStats as any[]).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(machinesStats as any[])
                        .map(m => ({
                          name: m.machine.name.length > 8 ? m.machine.name.substring(0, 8) + '...' : m.machine.name,
                          output: m.stats.total,
                          fpy: m.stats.yieldRate,
                        }))
                        .sort((a, b) => b.output - a.output)
                        .slice(0, 8)
                      }
                      layout="vertical"
                      margin={{ left: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} />
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
          </TabsContent>

          {/* Layout Tab */}
          <TabsContent value="layout" className="space-y-6 mt-6">
            <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Layout Dây chuyền sản xuất
            </h2>
            <div className="flex items-center gap-2">
              {/* Machine Status Filter */}
              <Select value={machineStatusFilter} onValueChange={(v: "all" | "online" | "offline") => setMachineStatusFilter(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="online">
                    <span className="flex items-center gap-2">
                      <Wifi className="h-3 w-3 text-green-500" />
                      Online
                    </span>
                  </SelectItem>
                  <SelectItem value="offline">
                    <span className="flex items-center gap-2">
                      <WifiOff className="h-3 w-3 text-red-500" />
                      Offline
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMetricsSettingsOpen(true)}
                className="gap-1"
              >
                <Settings2 className="h-4 w-4" />
                Tùy chỉnh chỉ số
              </Button>
              <Badge variant="outline" className="text-muted-foreground">
                {machinesByLine.size} dây chuyền • {Array.from(machinesByLine.values()).flat().length} máy
              </Badge>
            </div>
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
                
                // Get line info (product and production order)
                const lineId = machines[0]?.lineId;
                const lineAssignment = lineProductAssignments?.find(a => a.lineId === lineId && a.isActive);
                const productModel = productModels?.find((p: any) => p.id === lineAssignment?.productModelId);
                const productionOrder = productionOrders?.find(o => o.id === lineAssignment?.productionOrderId);

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
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-foreground">{lineName}</h3>
                              {productModel && (
                                <Badge variant="secondary" className="text-xs">
                                  <Box className="h-3 w-3 mr-1" />
                                  {productModel.code}
                                </Badge>
                              )}
                              {productionOrder && (
                                <Badge variant="outline" className="text-xs border-primary/50 text-primary">
                                  <FileText className="h-3 w-3 mr-1" />
                                  {productionOrder.orderCode}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {machines.length} máy hoạt động
                              {productModel && ` • ${productModel.name}`}
                            </p>
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
                          const machineImage = machine.image2DUrl || machine.image3DUrl;

                          return (
                            <div
                              key={machine.id}
                              className="relative rounded-xl cursor-pointer transition-all hover:shadow-xl hover:scale-[1.02] overflow-hidden bg-card border border-border/50 group"
                              onClick={() => openMachineDetail(machine)}
                            >
                              {/* Metrics Bar at Top - Customizable */}
                              <div className="flex items-stretch bg-black/90 text-white">
                                {visibleMetrics.fpy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-white/20">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">FPY</p>
                                    <p className={`text-base font-bold ${fpyNum >= 90 ? 'text-emerald-400' : fpyNum >= 70 ? 'text-amber-400' : 'text-rose-400'}`}>
                                      {fpy}%
                                    </p>
                                  </div>
                                )}
                                {visibleMetrics.fy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-white/20">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">FY</p>
                                    <p className="text-base font-bold text-rose-400">{fy}%</p>
                                  </div>
                                )}
                                {visibleMetrics.ntfy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-white/20">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">NTFY</p>
                                    <p className="text-base font-bold text-amber-400">{ntfy}%</p>
                                  </div>
                                )}
                                {visibleMetrics.output && (
                                  <div className="flex-1 text-center py-2 px-1 relative">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">Output</p>
                                    <p className="text-base font-bold text-cyan-400">{machine.total}</p>
                                  </div>
                                )}
                                {/* Status indicator */}
                                <div className="flex items-center px-2">
                                  <StatusIcon className={`h-4 w-4 ${status.color}`} />
                                </div>
                              </div>

                              {/* Machine Image - Large */}
                              <div className="relative h-40 w-full bg-gradient-to-br from-slate-800 to-slate-900">
                                {machineImage ? (
                                  <>
                                    <img
                                      src={machineImage}
                                      alt={machine.name}
                                      className="w-full h-full object-contain p-2"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Cpu className="h-16 w-16 text-muted-foreground/30" />
                                  </div>
                                )}
                              </div>

                              {/* Machine info */}
                              <div className="p-3 bg-card border-t border-border/30">
                                <div className="flex items-center justify-between">
                                  <div className="min-w-0 flex-1">
                                    <h4 className="font-semibold text-foreground truncate">{machine.name}</h4>
                                    <p className="text-xs text-muted-foreground">{machine.code}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {/* Online/Offline indicator */}
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs ${
                                            onlineMachines.has(machine.code)
                                              ? 'bg-emerald-500/20 text-emerald-400'
                                              : 'bg-muted text-muted-foreground'
                                          }`}>
                                            {onlineMachines.has(machine.code) ? (
                                              <Wifi className="h-3 w-3" />
                                            ) : (
                                              <WifiOff className="h-3 w-3" />
                                            )}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                          <p>{onlineMachines.has(machine.code) ? 'Online' : 'Offline'}</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <span className="text-xs text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <Eye className="h-3 w-3" />
                                    </span>
                                  </div>
                                </div>
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
          </TabsContent>
        </Tabs>
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

      {/* Metrics Settings Dialog */}
      <Dialog open={metricsSettingsOpen} onOpenChange={setMetricsSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Tùy chỉnh chỉ số hiển thị
            </DialogTitle>
            <DialogDescription>
              Chọn các chỉ số bạn muốn hiển thị trên thẻ máy
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Target className="h-4 w-4 text-emerald-500" />
                </div>
                <div>
                  <p className="font-medium">FPY (First Pass Yield)</p>
                  <p className="text-xs text-muted-foreground">Tỷ lệ sản phẩm đạt lần đầu</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.fpy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, fpy: !prev.fpy }))}
              >
                {visibleMetrics.fpy ? "Hiển thị" : "Ẩn"}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center">
                  <ThumbsDown className="h-4 w-4 text-rose-500" />
                </div>
                <div>
                  <p className="font-medium">FY (Fail Yield)</p>
                  <p className="text-xs text-muted-foreground">Tỷ lệ sản phẩm lỗi</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.fy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, fy: !prev.fy }))}
              >
                {visibleMetrics.fy ? "Hiển thị" : "Ẩn"}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <p className="font-medium">NTFY (No Test Found Yield)</p>
                  <p className="text-xs text-muted-foreground">Tỷ lệ không tìm thấy kết quả</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.ntfy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, ntfy: !prev.ntfy }))}
              >
                {visibleMetrics.ntfy ? "Hiển thị" : "Ẩn"}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-cyan-500" />
                </div>
                <div>
                  <p className="font-medium">Output</p>
                  <p className="text-xs text-muted-foreground">Tổng số sản phẩm đã kiểm tra</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.output ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, output: !prev.output }))}
              >
                {visibleMetrics.output ? "Hiển thị" : "Ẩn"}
              </Button>
            </div>
          </div>
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisibleMetrics({ fpy: true, fy: true, ntfy: true, output: true })}
            >
              Đặt lại mặc định
            </Button>
            <Button
              onClick={() => setMetricsSettingsOpen(false)}
            >
              Xong
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
