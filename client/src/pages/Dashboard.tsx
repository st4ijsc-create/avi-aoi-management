import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
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
  WifiOff,
  Factory,
  FileDown,
  Calendar,
  Palette
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { EmptyState, NoWorkstationData } from "@/components/EmptyState";
import { WidgetStylePresetManager, useWidgetStyle, type WidgetStyle } from "@/components/WidgetStylePresetManager";
import { CorporateFactoryStats } from "@/components/CorporateFactoryStats";
import { ChartErrorBoundary, WidgetErrorBoundary } from "@/components/ErrorBoundary";
import { StatsCardSkeleton, ChartSkeleton, PieChartSkeleton, ListSkeleton, MachineGridSkeleton } from "@/components/AnalyticsSkeleton";
import { WorkstationNGHeatmap, MeasurementPointNGList } from "@/components/NGVisualReflect";
import type { WidgetData } from "@/components/WidgetDataExport";
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
  const [activeTab, setActiveTab] = useState<"overview" | "layout" | "ng-visual" | "corporate-stats">("overview");
  const [machineStatusFilter, setMachineStatusFilter] = useState<"all" | "online" | "offline">("all");
  const [ngTimeFilter, setNgTimeFilter] = useState<"day" | "week" | "month">("month"); // Default to month for more data
  const [selectedWorkstationForDrilldown, setSelectedWorkstationForDrilldown] = useState<{ id: number; code: string; name: string } | null>(null);
  const [trendFilterWorkstationId, setTrendFilterWorkstationId] = useState<number | undefined>(undefined);
  const [trendFilterMeasurementPointId, setTrendFilterMeasurementPointId] = useState<number | undefined>(undefined);
  const [drilldownDialogOpen, setDrilldownDialogOpen] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  
  // Widget style state with localStorage persistence
  const [widgetStyle, setWidgetStyle] = useState<WidgetStyle>(() => {
    const saved = localStorage.getItem('dashboard_widget_style');
    return saved ? JSON.parse(saved) : {
      backgroundColor: '#ffffff',
      textColor: '#1f2937',
      borderColor: '#e5e7eb',
      accentColor: '#3b82f6',
      borderRadius: '0.5rem',
      shadow: 'sm',
      opacity: '1.00',
    };
  });
  
  // Save widget style to localStorage
  useEffect(() => {
    localStorage.setItem('dashboard_widget_style', JSON.stringify(widgetStyle));
  }, [widgetStyle]);
  
  // Get style props for cards
  const cardStyleProps = useMemo(() => {
    const shadowMap: Record<string, string> = {
      'none': '',
      'sm': 'shadow-sm',
      'md': 'shadow-md',
      'lg': 'shadow-lg',
      'xl': 'shadow-xl',
    };
    return {
      style: {
        backgroundColor: widgetStyle.backgroundColor,
        color: widgetStyle.textColor,
        borderColor: widgetStyle.borderColor,
        borderRadius: widgetStyle.borderRadius,
        opacity: parseFloat(widgetStyle.opacity),
      },
      className: `border ${shadowMap[widgetStyle.shadow] || ''}`,
      accentColor: widgetStyle.accentColor,
      textColor: widgetStyle.textColor,
    };
  }, [widgetStyle]);
  
  // Helper to get contrasting text color based on background
  const getContrastColor = (hexColor: string) => {
    // Convert hex to RGB
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#1f2937' : '#f9fafb';
  };
  
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

  // Calculate date range for NG Visual based on ngTimeFilter
  const ngDateRange = useMemo(() => {
    const now = new Date();
    const endDate = now;
    let startDate = new Date();
    
    switch (ngTimeFilter) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        break;
      default:
        startDate.setDate(now.getDate() - 7);
    }
    
    return { startDate, endDate };
  }, [ngTimeFilter]);

  // Calculate comparison dates for NG Visual (current period vs previous period)
  const ngComparisonDates = useMemo(() => {
    const now = new Date();
    let currentStartDate = new Date();
    let previousStartDate = new Date();
    let previousEndDate = new Date();
    
    switch (ngTimeFilter) {
      case "day":
        // Today vs Yesterday
        currentStartDate.setHours(0, 0, 0, 0);
        previousStartDate = new Date(now);
        previousStartDate.setDate(now.getDate() - 1);
        previousStartDate.setHours(0, 0, 0, 0);
        previousEndDate = new Date(previousStartDate);
        previousEndDate.setHours(23, 59, 59, 999);
        break;
      case "week":
        // This week vs Last week
        currentStartDate.setDate(now.getDate() - 7);
        previousStartDate = new Date(now);
        previousStartDate.setDate(now.getDate() - 14);
        previousEndDate = new Date(now);
        previousEndDate.setDate(now.getDate() - 7);
        break;
      case "month":
        // This month vs Last month
        currentStartDate.setMonth(now.getMonth() - 1);
        previousStartDate = new Date(now);
        previousStartDate.setMonth(now.getMonth() - 2);
        previousEndDate = new Date(now);
        previousEndDate.setMonth(now.getMonth() - 1);
        break;
      default:
        currentStartDate.setDate(now.getDate() - 7);
        previousStartDate = new Date(now);
        previousStartDate.setDate(now.getDate() - 14);
        previousEndDate = new Date(now);
        previousEndDate.setDate(now.getDate() - 7);
    }
    
    return {
      currentStartDate,
      currentEndDate: now,
      previousStartDate,
      previousEndDate,
    };
  }, [ngTimeFilter]);

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

  // Fetch yield alert thresholds for realtime alerts
  const { data: yieldThresholds } = trpc.yieldThreshold.list.useQuery();

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

  // Fetch workstation summary for top defects (overview tab)
  const { data: workstationSummary } = trpc.workstation.summary.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  // Fetch top NG measurement points (overview tab)
  const { data: topNGPoints } = trpc.workstation.topNGMeasurementPoints.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: 15,
  });

  // Fetch workstation summary for NG Visual tab (with separate time filter)
  const { data: ngWorkstationSummary, isLoading: ngWorkstationLoading } = trpc.workstation.summary.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
  });

  // Fetch top NG measurement points for NG Visual tab
  const { data: ngTopNGPoints, isLoading: ngTopNGLoading } = trpc.workstation.topNGMeasurementPoints.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
    limit: 20,
  });

  // Fetch measurement points for selected workstation drilldown
  const { data: drilldownMeasurementPoints, isLoading: drilldownLoading } = trpc.workstation.measurementPointsByWorkstation.useQuery({
    workstationId: selectedWorkstationForDrilldown?.id || 0,
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
  }, {
    enabled: !!selectedWorkstationForDrilldown,
  });

  // Fetch NG trend data for chart
  const { data: ngTrendData, isLoading: ngTrendLoading } = trpc.workstation.ngTrend.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
    workstationId: trendFilterWorkstationId,
    measurementPointDefId: trendFilterMeasurementPointId,
  });

  // Fetch NG comparison data
  const { data: ngComparisonData, isLoading: ngComparisonLoading } = trpc.workstation.ngComparison.useQuery(ngComparisonDates);

  // Fetch all workstations for filter dropdown
  const { data: allWorkstations } = trpc.workstation.list.useQuery();

  // Fetch all measurement points for filter dropdown (we'll filter by workstation in UI)
  const { data: allMeasurementPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: 0 }, // Get all measurement points
    { enabled: false } // Disable for now, will use ngTopNGPoints data
  );

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

  // Export NG Visual as PDF
  const handleExportPDF = useCallback(async () => {
    setExportingPDF(true);
    try {
      // Prepare data for PDF
      const workstationData = ngWorkstationSummary ? (ngWorkstationSummary as any[]).map((ws: any) => ({
        code: ws.workstationCode || '',
        name: ws.workstationName || 'Unknown',
        total: ws.totalInspections || 0,
        ng: ws.ngCount || 0,
        ngRate: ws.totalInspections > 0 ? ((ws.ngCount || 0) / ws.totalInspections * 100).toFixed(1) : '0.0',
      })) : [];

      const measurementPointData = ngTopNGPoints ? (ngTopNGPoints as any[]).map((mp: any) => ({
        code: mp.measurementPointCode || '',
        name: mp.measurementPointName || 'Unknown',
        workstation: mp.workstationName || 'N/A',
        total: mp.totalCount || 0,
        ng: mp.ngCount || 0,
        ngRate: mp.totalCount > 0 ? ((mp.ngCount || 0) / mp.totalCount * 100).toFixed(1) : '0.0',
      })) : [];

      const timeRangeLabel = ngTimeFilter === "day" ? "Hôm nay" : ngTimeFilter === "week" ? "7 ngày qua" : "30 ngày qua";
      const exportDate = new Date().toLocaleString('vi-VN');

      // Create HTML content for PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Báo cáo NG Visual - ${timeRangeLabel}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
            h1 { color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
            h2 { color: #374151; margin-top: 30px; }
            .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .meta { color: #6b7280; font-size: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; }
            th { background-color: #f3f4f6; font-weight: 600; }
            .ng-good { color: #16a34a; }
            .ng-warning { color: #ca8a04; }
            .ng-danger { color: #dc2626; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Báo cáo NG Visual</h1>
            <div class="meta">
              <p>Khoảng thời gian: <strong>${timeRangeLabel}</strong></p>
              <p>Ngày xuất: ${exportDate}</p>
            </div>
          </div>

          <h2>Tỉ lệ NG theo Công trạm</h2>
          <table>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên công trạm</th>
                <th>Tổng kiểm tra</th>
                <th>Số NG</th>
                <th>Tỉ lệ NG (%)</th>
              </tr>
            </thead>
            <tbody>
              ${workstationData.map((ws: any) => {
                const ngClass = parseFloat(ws.ngRate) <= 2 ? 'ng-good' : parseFloat(ws.ngRate) <= 5 ? 'ng-warning' : 'ng-danger';
                return `<tr>
                  <td>${ws.code}</td>
                  <td>${ws.name}</td>
                  <td>${ws.total}</td>
                  <td>${ws.ng}</td>
                  <td class="${ngClass}"><strong>${ws.ngRate}%</strong></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>

          <h2>Top Điểm đo có tỉ lệ NG cao</h2>
          <table>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên điểm đo</th>
                <th>Công trạm</th>
                <th>Tổng kiểm tra</th>
                <th>Số NG</th>
                <th>Tỉ lệ NG (%)</th>
              </tr>
            </thead>
            <tbody>
              ${measurementPointData.map((mp: any) => {
                const ngClass = parseFloat(mp.ngRate) <= 2 ? 'ng-good' : parseFloat(mp.ngRate) <= 5 ? 'ng-warning' : 'ng-danger';
                return `<tr>
                  <td>${mp.code}</td>
                  <td>${mp.name}</td>
                  <td>${mp.workstation}</td>
                  <td>${mp.total}</td>
                  <td>${mp.ng}</td>
                  <td class="${ngClass}"><strong>${mp.ngRate}%</strong></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>

          <div class="footer">
            <p>Báo cáo được tạo tự động bởi hệ thống AVI/AOI Management</p>
          </div>
        </body>
        </html>
      `;

      // Create blob and download
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ng-visual-report-${ngTimeFilter}-${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Xuất báo cáo thành công!", {
        description: "File HTML đã được tải xuống. Bạn có thể mở và in thành PDF.",
      });
    } catch (error) {
      console.error('Export PDF error:', error);
      toast.error("Lỗi xuất báo cáo", {
        description: "Không thể tạo file báo cáo. Vui lòng thử lại.",
      });
    } finally {
      setExportingPDF(false);
    }
  }, [ngWorkstationSummary, ngTopNGPoints, ngTimeFilter]);

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

  // Calculate yield alerts based on thresholds
  const yieldAlerts = useMemo(() => {
    const currentStats = (statsWithComparison as StatsWithComparison | undefined)?.current;
    if (!currentStats || !yieldThresholds) return [];
    
    const alerts: Array<{
      type: 'FPY' | 'FY' | 'NTF' | 'UPH';
      level: 'warning' | 'critical';
      currentValue: number;
      threshold: number;
      target: number;
      message: string;
    }> = [];

    const total = currentStats.total || 1;
    const fpy = (currentStats.ok / total) * 100;
    const fy = (currentStats.ng / total) * 100;
    const ntf = (currentStats.ntf / total) * 100;

    yieldThresholds.forEach(threshold => {
      if (!threshold.isEnabled) return;
      
      let currentValue = 0;
      switch (threshold.metricType) {
        case 'FPY': currentValue = fpy; break;
        case 'FY': currentValue = fy; break;
        case 'NTF': currentValue = ntf; break;
        case 'UPH': currentValue = currentStats.total; break;
      }

      const warningVal = parseFloat(threshold.warningThreshold);
      const criticalVal = parseFloat(threshold.criticalThreshold);
      const targetVal = threshold.targetValue ? parseFloat(threshold.targetValue) : 0;
      const isHigherBetter = threshold.comparisonOperator === 'gte';

      // Check critical first
      if (isHigherBetter ? currentValue < criticalVal : currentValue > criticalVal) {
        if (threshold.notifyOnCritical) {
          alerts.push({
            type: threshold.metricType as 'FPY' | 'FY' | 'NTF' | 'UPH',
            level: 'critical',
            currentValue,
            threshold: criticalVal,
            target: targetVal,
            message: `${threshold.metricType} ${isHigherBetter ? 'dưới' : 'vượt'} ngưỡng nguy hiểm: ${currentValue.toFixed(2)}% (ngưỡng: ${criticalVal}%)`
          });
        }
      } else if (isHigherBetter ? currentValue < warningVal : currentValue > warningVal) {
        if (threshold.notifyOnWarning) {
          alerts.push({
            type: threshold.metricType as 'FPY' | 'FY' | 'NTF' | 'UPH',
            level: 'warning',
            currentValue,
            threshold: warningVal,
            target: targetVal,
            message: `${threshold.metricType} ${isHigherBetter ? 'dưới' : 'vượt'} ngưỡng cảnh báo: ${currentValue.toFixed(2)}% (ngưỡng: ${warningVal}%)`
          });
        }
      }
    });

    return alerts;
  }, [statsWithComparison, yieldThresholds]);

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
      <div className="space-y-4 sm:space-y-6">
        {/* Header with filters and auto-refresh controls */}
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
                <Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                Production Dashboard
              </h1>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mt-1">
                <p className="text-muted-foreground text-xs sm:text-sm">Theo dõi chất lượng sản xuất</p>
                <span className="text-xs text-muted-foreground">
                  • Cập nhật lúc {lastRefreshTime.toLocaleTimeString('vi-VN')}
                </span>
              </div>
            </div>
            
            {/* Quick actions - visible on mobile */}
            <div className="flex items-center gap-2 sm:hidden">
              <Button variant="outline" size="icon" onClick={handleRefresh} className="h-9 w-9">
                <RefreshCw className="h-4 w-4" />
              </Button>
              {(activeAlertsCount as number) > 0 && (
                <Link href="/alerts">
                  <Button variant="outline" size="icon" className="relative h-9 w-9">
                    <Bell className="h-4 w-4" />
                    <Badge variant="destructive" className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                      {activeAlertsCount as number}
                    </Badge>
                  </Button>
                </Link>
              )}
            </div>
          </div>
          
          {/* Filters - scrollable on mobile */}
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2 sm:pb-0 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
            {/* Alert Badge - hidden on mobile (shown in quick actions) */}
            <div className="hidden sm:block">
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
            </div>

            <Select value={selectedFactory} onValueChange={(v) => {
              setSelectedFactory(v);
              setSelectedWorkshop("all");
              setSelectedLine("all");
            }}>
              <SelectTrigger className="w-[120px] sm:w-[160px] shrink-0">
                <Factory className="h-4 w-4 mr-1 sm:hidden" />
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
              <SelectTrigger className="w-[120px] sm:w-[160px] shrink-0">
                <SelectValue placeholder="Xưởng" />
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
              <SelectTrigger className="w-[100px] sm:w-[160px] shrink-0">
                <SelectValue placeholder="Line" />
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
              <SelectTrigger className="w-[90px] sm:w-[120px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hôm nay</SelectItem>
                <SelectItem value="week">7 ngày</SelectItem>
                <SelectItem value="month">30 ngày</SelectItem>
              </SelectContent>
            </Select>

            {/* Auto-refresh controls - hidden on mobile */}
            <div className="hidden sm:flex items-center gap-1 border rounded-md shrink-0">
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

            {/* Refresh button - hidden on mobile (shown in quick actions) */}
            <Button variant="outline" size="icon" onClick={handleRefresh} className="hidden sm:flex shrink-0">
              <RefreshCw className="h-4 w-4" />
            </Button>
            
            {/* Widget Style Presets - hidden on mobile */}
            <div className="hidden md:block shrink-0">
              <WidgetStylePresetManager
                currentStyle={widgetStyle}
                onStyleChange={setWidgetStyle}
              />
            </div>
          </div>
        </div>

        {/* Summary Stats Cards with Trends - Moved to top */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatsCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>Total Output</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold">
                        {statsLoading ? "..." : stats?.total?.toLocaleString() || 0}
                      </p>
                      <TrendIndicator value={trends?.output} suffix="%" />
                    </div>
                    <Sparkline data={sparklineData} dataKey="output" color={cardStyleProps.accentColor} />
                  </div>
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${cardStyleProps.accentColor}20` }}>
                    <Box className="h-5 w-5" style={{ color: cardStyleProps.accentColor }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>FPY</p>
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

            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>OK</p>
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

            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>NG</p>
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

            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>NTF</p>
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
        )}

        {/* Yield Alert Widget + Machine Status Widget - Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Yield Alert Widget - Compact Realtime alerts */}
          <Card className="glass-card">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`h-6 w-6 rounded-md flex items-center justify-center ${
                    yieldAlerts.some(a => a.level === 'critical') ? 'bg-destructive/20' : 'bg-warning/20'
                  }`}>
                    <AlertTriangle className={`h-3.5 w-3.5 ${
                      yieldAlerts.some(a => a.level === 'critical') ? 'text-destructive' : 'text-warning'
                    }`} />
                  </div>
                  <span className="text-sm font-medium">Cảnh báo Yield</span>
                  <Badge variant="secondary" className="text-xs h-5">{yieldAlerts.length}</Badge>
                </div>
                <Link href="/settings">
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
                    Cấu hình
                  </Button>
                </Link>
              </div>
              {yieldAlerts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {yieldAlerts.map((alert, index) => (
                    <TooltipProvider key={`${alert.type}-${alert.level}-${index}`}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer ${
                            alert.level === 'critical' 
                              ? 'bg-destructive/10 border border-destructive/30 text-destructive' 
                              : 'bg-warning/10 border border-warning/30 text-warning'
                          }`}>
                            {alert.level === 'critical' 
                              ? <XCircle className="h-3 w-3" />
                              : <AlertTriangle className="h-3 w-3" />
                            }
                            <span className="font-medium">{alert.type}</span>
                            <span>{alert.currentValue.toFixed(1)}%</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <p className="font-medium">{alert.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">Mục tiêu: {alert.target}% | Ngưỡng: {alert.threshold}%</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
                  <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
                  Không có cảnh báo
                </div>
              )}
            </CardContent>
          </Card>

          {/* Machine Status Widget - Compact */}
          <Card className="glass-card">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md flex items-center justify-center bg-primary/20">
                    <Activity className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-medium">Trạng thái kết nối máy</span>
                </div>
                <Link href="/machine-status">
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
                    Chi tiết
                  </Button>
                </Link>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/30">
                  <p className="text-lg font-bold">{machinesStats?.length || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Tổng</p>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-emerald-500/10">
                  <p className="text-lg font-bold text-emerald-500">{onlineMachines.size}</p>
                  <p className="text-[10px] text-muted-foreground">Online</p>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-red-500/10">
                  <p className="text-lg font-bold text-red-500">
                    {Math.max(0, (machinesStats?.length || 0) - onlineMachines.size)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Offline</p>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-primary/10">
                  <p className="text-lg font-bold">
                    {machinesStats?.length ? Math.round((onlineMachines.size / machinesStats.length) * 100) : 0}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">Avail</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for Overview and Layout */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "layout" | "ng-visual" | "corporate-stats")} className="w-full">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Tổng quan
            </TabsTrigger>
            <TabsTrigger value="ng-visual" className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              NG Visual
            </TabsTrigger>
            <TabsTrigger value="layout" className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              Layout dây chuyền
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* MQTT Alert Widget */}
            <MqttAlertWidget />

            {/* Shift Stats & Top/Bottom Machines */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Shift Statistics */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />
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
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
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
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
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
        <Card className={cardStyleProps.className} style={cardStyleProps.style}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />
              Biểu đồ theo thời gian (24 giờ qua)
            </CardTitle>
            <CardDescription>FPY, FY, NTFY và Output theo từng giờ</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartErrorBoundary>
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
                      key="yaxis-left"
                      yAxisId="left"
                      tick={{ fontSize: 10 }}
                      domain={[0, 100]}
                      label={{ value: '%', angle: -90, position: 'insideLeft', fontSize: 10 }}
                    />
                    <YAxis 
                      key="yaxis-right"
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
                      key="line-fpy"
                      yAxisId="left"
                      type="monotone" 
                      dataKey="FPY" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      key="line-fy"
                      yAxisId="left"
                      type="monotone" 
                      dataKey="FY" 
                      stroke="#ef4444" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line 
                      key="line-ntfy"
                      yAxisId="left"
                      type="monotone" 
                      dataKey="NTFY" 
                      stroke="#f59e0b" 
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line 
                      key="line-total"
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
            </ChartErrorBoundary>
          </CardContent>
        </Card>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader>
              <CardTitle className="text-base">Phân bố kết quả</CardTitle>
              <CardDescription>Tỷ lệ OK/NG/NTF tổng hợp</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary>
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
              </ChartErrorBoundary>
            </CardContent>
          </Card>

          {/* Bar Chart - Top machines */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader>
              <CardTitle className="text-base">Top máy theo sản lượng</CardTitle>
              <CardDescription>10 máy có output cao nhất</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary>
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
              </ChartErrorBoundary>
            </CardContent>
          </Card>

          {/* Top 5 Workstations with Defects */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Factory className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />
                Top 5 Công trạm có lỗi cao nhất
              </CardTitle>
              <CardDescription>Công trạm cần ưu tiên cải thiện</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {workstationSummary && (workstationSummary as any[]).length > 0 ? (
                  (workstationSummary as any[])
                    .sort((a: any, b: any) => (b.ngCount || 0) - (a.ngCount || 0))
                    .slice(0, 5)
                    .map((ws: any, index: number) => {
                      const totalDefects = (ws.ngCount || 0) + (ws.ntfCount || 0);
                      const yieldRate = ws.totalCount > 0 ? ((ws.okCount + ws.ntfCount) / ws.totalCount * 100) : 0;
                      return (
                        <div key={ws.workstationId} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-sm font-semibold text-orange-600">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{ws.workstationName || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{ws.workstationCode}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm font-semibold text-red-600">{totalDefects}</div>
                              <div className="text-xs text-muted-foreground">Lỗi</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-blue-600">{yieldRate.toFixed(1)}%</div>
                              <div className="text-xs text-muted-foreground">Yield</div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <EmptyState
                    variant="no-analytics"
                    title="Chưa có dữ liệu công trạm"
                    description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."
                    compact
                  />
                )}
              </div>
            </CardContent>
          </Card>
            </div>
          </TabsContent>

          {/* NG Visual Tab */}
          <TabsContent value="ng-visual" className="space-y-6 mt-6">
            <div className="space-y-6">
              {/* Time Filter and Legend */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-lg border">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-muted-foreground font-medium">Mức độ NG:</span>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-green-500" />
                    <span>≤2% (Tốt)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-yellow-500" />
                    <span>2-5% (Chấp nhận)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-orange-500" />
                    <span>5-10% (Cảnh báo)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-red-500" />
                    <span>&gt;10% (Nghiêm trọng)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Select value={ngTimeFilter} onValueChange={(v) => setNgTimeFilter(v as "day" | "week" | "month")}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Hôm nay</SelectItem>
                      <SelectItem value="week">7 ngày qua</SelectItem>
                      <SelectItem value="month">30 ngày qua</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportPDF}
                    disabled={exportingPDF || (!ngWorkstationSummary && !ngTopNGPoints)}
                    className="flex items-center gap-1"
                  >
                    {exportingPDF ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                    {exportingPDF ? "Đang xuất..." : "Xuất báo cáo"}
                  </Button>
                </div>
              </div>

              {/* NG Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Current Period Stats */}
                <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>
                      {ngTimeFilter === "day" ? "Hôm nay" : ngTimeFilter === "week" ? "7 ngày qua" : "30 ngày qua"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : ngComparisonData ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{ngComparisonData.current.ngRate.toFixed(2)}%</span>
                          <span className="text-sm text-muted-foreground">Tỉ lệ NG</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Tổng: {ngComparisonData.current.totalCount.toLocaleString()}</span>
                          <span className="text-red-500">NG: {ngComparisonData.current.ngCount.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">Không có dữ liệu</div>
                    )}
                  </CardContent>
                </Card>

                {/* Previous Period Stats */}
                <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>
                      {ngTimeFilter === "day" ? "Hôm qua" : ngTimeFilter === "week" ? "7 ngày trước" : "30 ngày trước"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : ngComparisonData ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{ngComparisonData.previous.ngRate.toFixed(2)}%</span>
                          <span className="text-sm text-muted-foreground">Tỉ lệ NG</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">Tổng: {ngComparisonData.previous.totalCount.toLocaleString()}</span>
                          <span className="text-red-500">NG: {ngComparisonData.previous.ngCount.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">Không có dữ liệu</div>
                    )}
                  </CardContent>
                </Card>

                {/* Change Indicator */}
                <Card className={`${cardStyleProps.className} ${ngComparisonData?.changes.isImproved ? 'border-green-500/50' : 'border-red-500/50'}`} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>So sánh</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : ngComparisonData ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          {ngComparisonData.changes.isImproved ? (
                            <TrendingDown className="h-6 w-6 text-green-500" />
                          ) : (
                            <TrendingUp className="h-6 w-6 text-red-500" />
                          )}
                          <span className={`text-2xl font-bold ${ngComparisonData.changes.isImproved ? 'text-green-500' : 'text-red-500'}`}>
                            {ngComparisonData.changes.ngRateChange > 0 ? '+' : ''}{ngComparisonData.changes.ngRateChange.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-sm">
                          {ngComparisonData.changes.isImproved ? (
                            <span className="text-green-500">Cải thiện so với kỳ trước</span>
                          ) : ngComparisonData.changes.ngRateChange === 0 ? (
                            <span className="text-muted-foreground">Không thay đổi</span>
                          ) : (
                            <span className="text-red-500">Tăng so với kỳ trước</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">Không có dữ liệu</div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* NG Trend Chart */}
              <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                <CardHeader>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" style={{ color: cardStyleProps.accentColor }} />
                        Xu hướng tỉ lệ NG theo ngày
                        {(trendFilterWorkstationId || trendFilterMeasurementPointId) && (
                          <Badge variant="secondary" className="ml-2">Đã lọc</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        Biểu đồ thể hiện xu hướng tỉ lệ NG theo thời gian
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select 
                        value={trendFilterWorkstationId?.toString() || "all"} 
                        onValueChange={(v) => {
                          setTrendFilterWorkstationId(v === "all" ? undefined : Number(v));
                          setTrendFilterMeasurementPointId(undefined); // Reset measurement point filter
                        }}
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Chọn công trạm" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Tất cả công trạm</SelectItem>
                          {allWorkstations?.map((ws: any) => (
                            <SelectItem key={ws.id} value={ws.id.toString()}>
                              {ws.code} - {ws.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {trendFilterWorkstationId && (
                        <Select 
                          value={trendFilterMeasurementPointId?.toString() || "all"} 
                          onValueChange={(v) => setTrendFilterMeasurementPointId(v === "all" ? undefined : Number(v))}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Chọn điểm đo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Tất cả điểm đo</SelectItem>
                            {ngTopNGPoints
                              ?.filter((mp: any) => mp.workstationId === trendFilterWorkstationId)
                              .map((mp: any) => (
                                <SelectItem key={mp.measurementPointDefId} value={mp.measurementPointDefId.toString()}>
                                  {mp.measurementPointCode} - {mp.measurementPointName}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                      
                      {(trendFilterWorkstationId || trendFilterMeasurementPointId) && (
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setTrendFilterWorkstationId(undefined);
                            setTrendFilterMeasurementPointId(undefined);
                          }}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Xóa bộ lọc
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {ngTrendLoading ? (
                    <div className="flex items-center justify-center h-64">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : ngTrendData && ngTrendData.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={ngTrendData.map((item: any) => ({
                          date: new Date(item.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                          ngRate: Number(item.ngRate),
                          totalCount: Number(item.totalCount),
                          ngCount: Number(item.ngCount),
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={{ stroke: 'hsl(var(--border))' }}
                          />
                          <YAxis 
                            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                            axisLine={{ stroke: 'hsl(var(--border))' }}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px',
                            }}
                            formatter={(value: number, name: string) => {
                              if (name === 'ngRate') return [`${value.toFixed(2)}%`, 'Tỉ lệ NG'];
                              if (name === 'totalCount') return [value.toLocaleString(), 'Tổng kiểm tra'];
                              if (name === 'ngCount') return [value.toLocaleString(), 'Số lỗi NG'];
                              return [value, name];
                            }}
                          />
                          <Line 
                            type="monotone" 
                            dataKey="ngRate" 
                            stroke="hsl(var(--destructive))" 
                            strokeWidth={2}
                            dot={{ fill: 'hsl(var(--destructive))', strokeWidth: 2, r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState
                      variant="no-analytics"
                      title="Chưa có dữ liệu xu hướng"
                      description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra theo ngày."
                      compact
                    />
                  )}
                </CardContent>
              </Card>

              {/* Workstation NG Heatmap */}
              <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Factory className="h-5 w-5" style={{ color: cardStyleProps.accentColor }} />
                    Tỉ lệ NG theo Công trạm
                  </CardTitle>
                  <CardDescription>
                    Hiển thị tỉ lệ lỗi của từng công trạm, màu sắc thể hiện mức độ nghiêm trọng
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ngWorkstationLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : ngWorkstationSummary && (ngWorkstationSummary as any[]).length > 0 ? (
                    <WorkstationNGHeatmap
                      data={(ngWorkstationSummary as any[]).map((ws: any) => ({
                        id: ws.workstationId,
                        code: ws.workstationCode || '',
                        name: ws.workstationName || 'Unknown',
                        total: ws.totalInspections || 0,
                        ng: ws.ngCount || 0,
                        ngRate: ws.totalInspections > 0 ? ((ws.ngCount || 0) / ws.totalInspections * 100) : 0,
                      }))}
                      onWorkstationClick={(ws) => {
                        setSelectedWorkstationForDrilldown({ id: ws.id, code: ws.code, name: ws.name });
                        setDrilldownDialogOpen(true);
                      }}
                    />
                  ) : (
                    <EmptyState
                      variant="no-analytics"
                      title="Chưa có dữ liệu công trạm"
                      description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."
                      compact
                    />
                  )}
                </CardContent>
              </Card>

              {/* Top NG Measurement Points */}
              <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-5 w-5" style={{ color: cardStyleProps.accentColor }} />
                    Top Điểm đo có tỉ lệ NG cao
                  </CardTitle>
                  <CardDescription>
                    Các điểm đo có tỉ lệ lỗi cao nhất, cần ưu tiên kiểm tra và cải thiện
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ngTopNGLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : ngTopNGPoints && (ngTopNGPoints as any[]).length > 0 ? (
                    <MeasurementPointNGList
                      data={(ngTopNGPoints as any[]).map((mp: any) => ({
                        id: mp.measurementPointId,
                        code: mp.measurementPointCode || '',
                        name: mp.measurementPointName || 'Unknown',
                        workstationId: mp.workstationId,
                        workstationName: mp.workstationName,
                        total: mp.totalCount || 0,
                        ng: mp.ngCount || 0,
                        ngRate: mp.totalCount > 0 ? ((mp.ngCount || 0) / mp.totalCount * 100) : 0,
                      }))}
                      maxItems={20}
                    />
                  ) : (
                    <EmptyState
                      variant="no-analytics"
                      title="Chưa có dữ liệu điểm đo"
                      description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra."
                      compact
                    />
                  )}
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
            <MachineGridSkeleton count={8} />
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
                          const machineImage = machine.image2DUrl || machine.image3DUrl || '/default-machine-2d.svg';

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

      {/* Workstation Drilldown Dialog */}
      <Dialog open={drilldownDialogOpen} onOpenChange={setDrilldownDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-primary" />
              Chi tiết công trạm: {selectedWorkstationForDrilldown?.name}
            </DialogTitle>
            <DialogDescription>
              Mã: {selectedWorkstationForDrilldown?.code} • Dữ liệu từ {ngTimeFilter === "day" ? "hôm nay" : ngTimeFilter === "week" ? "7 ngày qua" : "30 ngày qua"}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            {drilldownLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : drilldownMeasurementPoints && drilldownMeasurementPoints.length > 0 ? (
              <div className="space-y-3 pr-4">
                {drilldownMeasurementPoints.map((mp: any) => {
                  const ngRate = mp.totalCount > 0 ? (mp.ngCount / mp.totalCount * 100) : 0;
                  const getNGColorClass = (rate: number) => {
                    if (rate <= 2) return "text-green-500 bg-green-500/10 border-green-500/30";
                    if (rate <= 5) return "text-yellow-500 bg-yellow-500/10 border-yellow-500/30";
                    if (rate <= 10) return "text-orange-500 bg-orange-500/10 border-orange-500/30";
                    return "text-red-500 bg-red-500/10 border-red-500/30";
                  };
                  return (
                    <div key={mp.measurementPointId} className={`p-4 rounded-lg border ${getNGColorClass(ngRate)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-semibold">{mp.measurementPointCode}</p>
                          <p className="text-sm text-muted-foreground">{mp.measurementPointName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">{ngRate.toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">NG Rate</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold">{mp.totalCount}</p>
                          <p className="text-xs text-muted-foreground">Tổng</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-green-500">{mp.okCount}</p>
                          <p className="text-xs text-muted-foreground">OK</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-red-500">{mp.ngCount}</p>
                          <p className="text-xs text-muted-foreground">NG</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-yellow-500">{mp.ntfCount}</p>
                          <p className="text-xs text-muted-foreground">NTF</p>
                        </div>
                      </div>
                      {(mp.lowerLimit !== null || mp.upperLimit !== null) && (
                        <div className="mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
                          <span>Giới hạn: </span>
                          {mp.lowerLimit !== null && <span>Min: {mp.lowerLimit}</span>}
                          {mp.lowerLimit !== null && mp.upperLimit !== null && <span> - </span>}
                          {mp.upperLimit !== null && <span>Max: {mp.upperLimit}</span>}
                          {mp.unit && <span> ({mp.unit})</span>}
                          {mp.avgValue !== 0 && <span className="ml-4">Avg: {mp.avgValue.toFixed(2)}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                variant="no-analytics"
                title="Chưa có điểm đo"
                description="Công trạm này chưa có điểm đo nào được gán hoặc chưa có dữ liệu kiểm tra."
                compact
              />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

// MQTT Alert Widget Component - Combined alerts from mqttAlert and mqttClientManagement
function MqttAlertWidget() {
  // Rule-based alerts
  const { data: unresolvedAlerts } = trpc.mqttAlert.unresolved.useQuery(undefined, {
    refetchInterval: 30000,
  });

  // Connection alerts from scheduler
  const { data: connectionAlerts } = trpc.mqttClientManagement.getAlertWidgetData.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const totalRuleAlerts = unresolvedAlerts?.length || 0;
  const totalConnectionAlerts = connectionAlerts?.total || 0;
  const totalAlerts = totalRuleAlerts + totalConnectionAlerts;

  if (totalAlerts === 0) {
    return null;
  }

  // Combine and sort alerts by time
  const combinedAlerts: Array<{
    id: string | number;
    type: 'rule' | 'connection';
    title: string;
    message: string;
    severity: string;
    triggeredAt: Date;
  }> = [];

  // Add rule-based alerts
  unresolvedAlerts?.forEach((alert: any) => {
    combinedAlerts.push({
      id: `rule-${alert.id}`,
      type: 'rule',
      title: alert.ruleName,
      message: alert.message,
      severity: 'warning',
      triggeredAt: new Date(alert.triggeredAt),
    });
  });

  // Add connection alerts
  connectionAlerts?.recentAlerts?.forEach((alert: any) => {
    combinedAlerts.push({
      id: `conn-${alert.id}`,
      type: 'connection',
      title: alert.title,
      message: alert.alertType.replace(/_/g, ' '),
      severity: alert.severity,
      triggeredAt: new Date(alert.triggeredAt),
    });
  });

  // Sort by time descending
  combinedAlerts.sort((a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime());

  const hasCritical = (connectionAlerts?.critical || 0) > 0;

  return (
    <Card className={`glass-card ${hasCritical ? 'border-red-500/50 bg-red-500/5' : 'border-yellow-500/50 bg-yellow-500/5'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${hasCritical ? 'text-red-400' : 'text-yellow-400'}`} />
            MQTT Alerts
            <div className="flex gap-1 ml-2">
              {(connectionAlerts?.critical || 0) > 0 && (
                <Badge variant="destructive">{connectionAlerts?.critical} critical</Badge>
              )}
              {(connectionAlerts?.warning || 0) > 0 && (
                <Badge variant="outline" className="border-yellow-500 text-yellow-500">{connectionAlerts?.warning} warning</Badge>
              )}
              {totalRuleAlerts > 0 && (
                <Badge variant="secondary">{totalRuleAlerts} rules</Badge>
              )}
            </div>
          </CardTitle>
          <div className="flex gap-2">
            <Link href="/mqtt-profiles?tab=alerts">
              <Button variant="outline" size="sm">
                Connection Alerts
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/mqtt-alerts">
              <Button variant="outline" size="sm">
                Rule Alerts
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
        <CardDescription>Unresolved MQTT system alerts ({totalAlerts} total)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {combinedAlerts.slice(0, 5).map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 p-3 rounded-lg bg-background/50 border ${
                alert.severity === 'critical' ? 'border-red-500/20' : 'border-yellow-500/20'
              }`}
            >
              <div className="mt-0.5">
                <AlertTriangle className={`w-4 h-4 ${
                  alert.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{alert.title}</p>
                  <Badge variant="outline" className="text-xs">
                    {alert.type === 'rule' ? 'Rule' : 'Connection'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {alert.message}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {alert.triggeredAt.toLocaleString('vi-VN')}
                </p>
              </div>
            </div>
          ))}
          {combinedAlerts.length > 5 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              +{combinedAlerts.length - 5} more alerts
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
