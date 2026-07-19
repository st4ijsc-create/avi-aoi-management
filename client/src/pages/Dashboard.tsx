import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { DashboardTemplatePrompt } from "@/components/DashboardTemplatePrompt";
import { DashboardAIWidget } from "@/components/DashboardAIWidget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
// doc67 W4 (a11y/touch): Popover cho chip cảnh báo (tap mở được, không cần hover).
// doc67 W7 GĐ2: Sheet "Bộ lọc" mobile đã bỏ cùng 3 Select phạm vi cục bộ — trục
// ISA-95 toàn cục (AssetScopeBar shell) là nguồn phạm vi duy nhất.
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  ExternalLink,
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
  Palette,
  SlidersHorizontal
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { EmptyState, NoWorkstationData } from "@/components/EmptyState";
import {
  PageHeader,
  PageContainer,
  StatusBadge,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
  // doc67 W8 (việc 2) — chấm severity DS cho dải cảnh báo khẩn.
  severityDotClass,
} from "@/components/patterns";
// doc67 W7 GĐ2 — nền móng DS dùng chung: sparkline SVG token-driven (thay bản
// recharts inline), tone ISA-101 chuẩn (oeeTone 80/60 — QĐ #2; yieldTone 95/90)
// và formatter thống nhất (null → '—', % 1 chữ số).
import { Sparkline } from "@/components/patterns/Sparkline";
import { oeeTone, yieldTone, TONE_TEXT_CLASS, toneHex } from "@/components/patterns/isaStateBadges";
import { fmtPct, fmtInt } from "@/lib/format";
import { WidgetStylePresetManager, useWidgetStyle, type WidgetStyle } from "@/components/WidgetStylePresetManager";
import { CorporateFactoryStats } from "@/components/CorporateFactoryStats";
import { RelatedViews } from "@/components/RelatedViews";
import { ChartErrorBoundary, WidgetErrorBoundary } from "@/components/ErrorBoundary";
import { StatsCardSkeleton, ChartSkeleton, PieChartSkeleton, ListSkeleton, MachineGridSkeleton } from "@/components/AnalyticsSkeleton";
import { DeferredMount } from "@/components/DeferredMount";
import { WorkstationNGHeatmap, MeasurementPointNGList } from "@/components/NGVisualReflect";
import type { WidgetData } from "@/components/WidgetDataExport";
import CustomDashboardViewer from "@/components/CustomDashboardViewer";
import { useState, useMemo, useEffect, useCallback, useRef, memo, type CSSProperties } from "react";
// doc 64 IA-10 S1 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { Socket } from "socket.io-client";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { RealtimeBadge } from "@/components/RealtimeBadge";
import { PollFreshness } from "@/components/PollFreshness";
import { Link, useLocation } from "wouter";
import {
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
  /** Canonical FINAL yield % (NTF = pass) — decision #4 wire name. */
  yieldRate: number;
  /** Canonical TRUE first-pass yield % (first inspection per serial). */
  fpy: number;
};

type StatsWithComparison = {
  current: DashboardStats;
  previous: DashboardStats | null;
  trends: {
    output: number;
    fpy: number;
    finalYield: number;
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
  /** Canonical TRUE first-pass yield % per machine (server getMachineStats). */
  fpy?: number;
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

// Live OEE row (mirrors server LiveOEEMetrics — factors are honestly null when
// the inputs are missing, NEVER synthesized).
type LiveOEERow = {
  machineId: number;
  machineCode: string;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
};

// Auto-refresh intervals
// REFRESH_INTERVALS moved inside component for i18n

export default function Dashboard() {
  const { t } = useTranslation();
  type DashboardTimeRange = "today" | "yesterday" | "7days" | "15days" | "30days" | "custom";
  const isDashboardTimeRange = (value: string): value is DashboardTimeRange => {
    return ["today", "yesterday", "7days", "15days", "30days", "custom"].includes(value);
  };
  
  const REFRESH_INTERVALS = useMemo(() => [
    { value: "5", label: t("dashboard.5seconds") },
    { value: "10", label: t("dashboard.10seconds") },
    { value: "30", label: t("dashboard.30seconds") },
    { value: "60", label: t("dashboard.1minute") },
    { value: "0", label: t("dashboard.off") },
  ], [t]);
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState<DashboardTimeRange>("7days");
  const timeRangeStorageHydratedRef = useRef(false);
  const [customFromDate, setCustomFromDate] = useState<string>("");
  const [customToDate, setCustomToDate] = useState<string>("");
  // doc67 W7 GĐ2 — XÓA 3 state bộ lọc cục bộ selectedFactory/Workshop/Line:
  // trục ISA-95 toàn cục (useScope → assetScope) là nguồn phạm vi duy nhất.
  const [selectedMachine, setSelectedMachine] = useState<MachineStats | null>(null);
  const [machineDetailOpen, setMachineDetailOpen] = useState(false);
  const [machineDialogStatusFilter, setMachineDialogStatusFilter] = useState<"all" | "OK" | "NG" | "NTF">("all");
  const [, setLocation] = useLocation();
  const [autoRefreshInterval, setAutoRefreshInterval] = useState("30");
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(true);
  // doc 67 W8 (việc 2): đọc ?tab= lúc mount để deep-link từ Dashboard Center
  // ("Mở" dashboard tùy chỉnh → /dashboard?tab=custom&dashboardId=...) vào đúng tab.
  const [activeTab, setActiveTab] = useState<"overview" | "layout" | "ng-visual" | "corporate-stats" | "custom">(() => {
    const tabParam = new URLSearchParams(window.location.search).get("tab");
    return tabParam === "overview" || tabParam === "layout" || tabParam === "ng-visual" ||
      tabParam === "corporate-stats" || tabParam === "custom"
      ? tabParam
      : "overview";
  });
  // doc67 W8 [P2] (việc 1) — TAB SYNC URL: ghi ngược ?tab= khi đổi tab (replace,
  // GIỮ các query param khác như dashboardId) — bookmark/kiosk mở đúng tab.
  // Tab mặc định "overview" thì xoá param cho URL sạch (khớp mount-read ở trên).
  const handleTabChange = useCallback((v: string) => {
    const tab = v as "overview" | "layout" | "ng-visual" | "corporate-stats" | "custom";
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    if (tab === "overview") params.delete("tab");
    else params.set("tab", tab);
    const qs = params.toString();
    setLocation(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [setLocation]);
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
      mode: 'theme' as const, // follow the app dark/light theme by default
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
    const shadow = shadowMap[widgetStyle.shadow] || '';
    // THEME MODE (default + legacy): follow the app's dark/light theme via tokens — no
    // forced bg/text/border colours, so cards match the rest of the system. Only an
    // explicit 'custom' style overrides the theme with the user's picked colours.
    if (widgetStyle.mode !== 'custom') {
      return {
        style: {
          borderRadius: widgetStyle.borderRadius,
          opacity: parseFloat(widgetStyle.opacity),
        },
        className: `border bg-card text-card-foreground ${shadow}`,
        accentColor: widgetStyle.accentColor,
        textColor: widgetStyle.textColor,
      };
    }
    return {
      style: {
        backgroundColor: widgetStyle.backgroundColor,
        color: widgetStyle.textColor,
        borderColor: widgetStyle.borderColor,
        borderRadius: widgetStyle.borderRadius,
        opacity: parseFloat(widgetStyle.opacity),
      },
      className: `border ${shadow}`,
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
  const [urgentAlerts, setUrgentAlerts] = useState<Array<{id: string; type: string; severity: string; title: string; message: string; timestamp: Date}>>([]);
  const socketRef = useRef<Socket | null>(null);
  // Realtime connection state. doc67 W6 [P1-3]: liveOEE/lastRealtimeAt đã TÁCH khỏi
  // root — trước đây mỗi push oee:update setState ở gốc → re-render cả cây ~3400
  // dòng. Nay <LiveOeeWidget>/<HeaderRealtimePulse> tự subscribe socket và giữ
  // state riêng; root chỉ còn socketConnected (đổi hiếm: connect/disconnect).
  const [socketConnected, setSocketConnected] = useState(false);

  // doc67 W6 [P1-2] — socket-invalidate: khi socket LIVE, các query nặng NGỪNG poll
  // (refetchInterval: false); nhịp làm-mới lấy từ server đẩy:
  //   - oee:update       heartbeat ~60s (OEE_BROADCAST_INTERVAL_SEC, mặc định 60)
  //   - dashboard:update mỗi inspection mới
  // → invalidate cụm dashboard, throttle 55s ⇒ tối đa ~1 refetch/phút thay vì
  // 8 query × 30s. invalidate() chỉ refetch query ĐANG ACTIVE nên các query đã
  // gate theo tab (P0) không bị kéo dậy.
  const trpcUtils = trpc.useUtils();
  const trpcUtilsRef = useRef(trpcUtils);
  trpcUtilsRef.current = trpcUtils;
  // Khởi tạo = now: các query vừa fetch lúc mount, khỏi invalidate ngay nhịp đầu.
  const lastSocketInvalidateRef = useRef(Date.now());

  // WebSocket connection for realtime machine status + urgent alerts
  useEffect(() => {
    const socket = getSharedSocket();
    socketRef.current = socket;

    const onConnect = () => {
      console.log('[Dashboard] WebSocket connected');
      setSocketConnected(true);
      socket.emit('admin:get_online_machines');
      // Join the global room so the canonical OEE broadcaster (oee:update) reaches us.
      socket.emit('subscribe', {});
    };

    const onOnlineList = (data: { machines: string[] }) => {
      setOnlineMachines(new Set(data.machines));
    };

    // doc67 W6 [P1-2] — nhịp làm-mới theo socket (KHÔNG setState → không re-render):
    // throttle 55s để mỗi phút tối đa 1 loạt invalidate cho cụm query nặng.
    const invalidateDashboardOnPush = () => {
      const now = Date.now();
      if (now - lastSocketInvalidateRef.current < 55_000) return;
      lastSocketInvalidateRef.current = now;
      const u = trpcUtilsRef.current;
      void u.dashboard.getStatsWithComparison.invalidate();
      void u.dashboard.getAllMachinesStats.invalidate();
      void u.dashboard.getShiftStats.invalidate();
      void u.dashboard.getTopBottomMachines.invalidate();
      void u.dashboard.getActiveAlertsCount.invalidate();
      void u.dashboard.getHourlyStats.invalidate();
      // 2 query của MqttAlertWidget cũng ngừng poll khi socket live → mời theo nhịp này.
      void u.mqttAlert.unresolved.invalidate();
      void u.mqttClientManagement.getAlertWidgetData.invalidate();
    };

    const onStatusChange = (data: { machineCode: string; status: 'online' | 'offline' }) => {
      setOnlineMachines(prev => {
        const newSet = new Set(prev);
        if (data.status === 'online') {
          newSet.add(data.machineCode);
        } else {
          newSet.delete(data.machineCode);
        }
        return newSet;
      });
    };

    // Urgent alert listeners for real-time push notifications
    const handleUrgentAlert = (data: any, type: string) => {
      const alert = {
        id: `${type}-${Date.now()}`,
        type,
        severity: data.severity || 'warning',
        title: data.title || type,
        message: data.message || JSON.stringify(data),
        timestamp: new Date(),
      };
      setUrgentAlerts(prev => [alert, ...prev].slice(0, 20));
      
      // Show toast notification for urgent alerts
      if (data.severity === 'critical') {
        toast.error(alert.title, { description: alert.message, duration: 8000 });
      } else {
        toast.warning(alert.title, { description: alert.message, duration: 5000 });
      }
    };

    const onInspectionAlert = (data: any) => handleUrgentAlert(data, 'inspection');
    const onYieldWarning = (data: any) => handleUrgentAlert(data, 'yield');
    const onNgAlert = (data: any) => handleUrgentAlert(data, 'ng');
    const onQualityGate = (data: any) => handleUrgentAlert(data, 'qualityGate');
    const onAndon = (data: any) => handleUrgentAlert(data, 'andon');

    const onDisconnect = () => {
      console.log('[Dashboard] WebSocket disconnected');
      setSocketConnected(false);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('machine:online_list', onOnlineList);
    socket.on('machine:status_change', onStatusChange);
    socket.on('oee:update', invalidateDashboardOnPush);
    socket.on('dashboard:update', invalidateDashboardOnPush);
    socket.on('inspection:alert', onInspectionAlert);
    socket.on('yield:warning', onYieldWarning);
    socket.on('ng:alert', onNgAlert);
    socket.on('qualityGate:triggered', onQualityGate);
    socket.on('andon:event', onAndon);

    // If already connected, sync state + request online machines immediately
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('machine:online_list', onOnlineList);
      socket.off('machine:status_change', onStatusChange);
      socket.off('oee:update', invalidateDashboardOnPush);
      socket.off('dashboard:update', invalidateDashboardOnPush);
      socket.off('inspection:alert', onInspectionAlert);
      socket.off('yield:warning', onYieldWarning);
      socket.off('ng:alert', onNgAlert);
      socket.off('qualityGate:triggered', onQualityGate);
      socket.off('andon:event', onAndon);
      releaseSharedSocket();
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

  const timeRangeStorageKey = useMemo(() => {
    return user?.id ? `dashboard_time_range_user_${user.id}` : null;
  }, [user?.id]);

  // Restore last selected dashboard time range for current user
  useEffect(() => {
    if (!timeRangeStorageKey) return;
    const saved = localStorage.getItem(timeRangeStorageKey);
    if (saved && isDashboardTimeRange(saved)) {
      setTimeRange(saved);
    }
    timeRangeStorageHydratedRef.current = true;
  }, [timeRangeStorageKey]);

  // Persist dashboard time range per user after hydration
  useEffect(() => {
    if (!timeRangeStorageKey || !timeRangeStorageHydratedRef.current) return;
    localStorage.setItem(timeRangeStorageKey, timeRange);
  }, [timeRangeStorageKey, timeRange]);

  // Calculate date range based on selection
  const dateRange = useMemo(() => {
    const now = new Date();
    let endDate = now;
    let startDate = new Date();
    
    switch (timeRange) {
      case "today":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "yesterday": {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 1);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setHours(23, 59, 59, 999);
        break;
      }
      case "7days":
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "15days":
        startDate.setDate(now.getDate() - 14);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "30days":
        startDate.setDate(now.getDate() - 29);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "custom": {
        if (customFromDate && customToDate) {
          const from = new Date(`${customFromDate}T00:00:00`);
          const to = new Date(`${customToDate}T23:59:59.999`);
          if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
            startDate = from;
            endDate = to;
          } else {
            startDate.setHours(0, 0, 0, 0);
          }
        } else {
          startDate.setHours(0, 0, 0, 0);
        }
        break;
      }
      default:
        startDate.setHours(0, 0, 0, 0);
    }
    
    return { startDate, endDate };
  }, [timeRange, customFromDate, customToDate]);

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

  // doc 64 IA-10 S1 — trục phạm vi ISA-95: axis THẮNG dropdown factory cục bộ;
  // machineId từ trục đi thẳng vào stats.
  // doc65 W1 — wired thêm: getDailyStats/getHourlyStats/getTopBottomMachines
  // nay đều theo effectiveFactoryId (hourly nhận cả lineId/machineId). Còn lệch
  // duy nhất: sparkline 7 ngày không hỗ trợ machineId (có ghi chú trung thực).
  const { scope: assetScope } = useScope(["factory", "line", "machine"]);
  useScopeWired();
  // doc67 W7 GĐ2 — dropdown factory cục bộ đã xóa: phạm vi CHỈ từ trục ISA-95.
  const effectiveFactoryId = assetScope.factoryId;

  // Fetch stats with comparison
  // doc65 W2 (AUD-01) — lấy thêm dataUpdatedAt/isFetching để khai TUỔI DỮ LIỆU
  // trung thực qua PollFreshness (thay chuỗi "Cập nhật lúc HH:mm" tĩnh cũ).
  const {
    data: statsWithComparison,
    isLoading: statsLoading,
    refetch: refetchStats,
    dataUpdatedAt: statsUpdatedAt,
    isFetching: statsFetching,
  } = trpc.dashboard.getStatsWithComparison.useQuery({
    factoryId: effectiveFactoryId,
    machineId: assetScope.machineId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    // doc67 W6 [P1-2] — socket LIVE: ngừng poll, dựa socket-invalidate (nhịp đẩy
    // ~60s ở effect socket phía trên). Poll theo Play/Pause + interval chỉ còn là
    // FALLBACK khi socket rớt (cùng pattern getAllOEE trong LiveOeeWidget).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch all machines stats
  const {
    data: machinesStats,
    isLoading: machinesLoading,
    refetch: refetchMachines,
    dataUpdatedAt: machinesUpdatedAt,
    isFetching: machinesFetching,
  } = trpc.dashboard.getAllMachinesStats.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    // doc 64 IA-10 S2 — lưới máy lọc theo trục (server DEP-S2 đã nhận).
    factoryId: effectiveFactoryId,
    lineId: assetScope.lineId,
  }, {
    // doc67 W6 [P1-2] — poll chỉ khi socket rớt (socket live → socket-invalidate).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // doc65 W2 (AUD-01) — TUỔI DỮ LIỆU của các KPI chính: mốc MỚI NHẤT trong
  // dataUpdatedAt của hai query nền tảng (stats + machines). PollFreshness tự
  // tick mỗi giây nên "Ns trước" luôn tươi và có cảnh báo amber khi cũ — khác
  // với chuỗi "Cập nhật lúc HH:mm" tĩnh cũ (không tick, không cảnh báo).
  const kpiUpdatedAt = Math.max(statsUpdatedAt || 0, machinesUpdatedAt || 0) || undefined;
  const kpiFetching = statsFetching || machinesFetching;
  // Ngưỡng "cũ" = 2× chu kỳ auto-refresh hiện hành (sàn 15s để không nhấp nháy
  // với chu kỳ 5s). Khi người dùng TẮT auto-refresh, dữ liệu già theo chủ ý →
  // nới ngưỡng 5 phút (quá 5 phút vẫn cảnh báo trung thực).
  // doc67 W6 [P1-2] — socket LIVE: các query nặng KHÔNG poll nữa mà làm mới theo
  // nhịp socket-invalidate (~60s heartbeat oee:update) → ngưỡng cũ = 2× nhịp = 120s.
  const kpiRefreshMs =
    isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : 0;
  const kpiStaleAfterMs = socketConnected
    ? 120_000
    : kpiRefreshMs > 0 ? Math.max(kpiRefreshMs * 2, 15_000) : 300_000;

  // Fetch shift stats
  const { data: shiftStats } = trpc.dashboard.getShiftStats.useQuery({
    factoryId: effectiveFactoryId,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    // doc67 W6 [P1-2] — poll chỉ khi socket rớt (socket live → socket-invalidate).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch top/bottom machines
  const { data: topBottomMachines } = trpc.dashboard.getTopBottomMachines.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    limit: 5,
    // doc65 W1 — xếp hạng máy theo trục phạm vi ISA-95 (server nhận factoryId,
    // additive optional). Trục máy đơn không áp cho ranking đa-máy.
    factoryId: effectiveFactoryId,
  }, {
    // doc67 W6 [P1-2] — poll chỉ khi socket rớt (socket live → socket-invalidate).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch active alerts count
  const { data: activeAlertsCount } = trpc.dashboard.getActiveAlertsCount.useQuery(undefined, {
    // doc67 W6 [P1-2] — poll chỉ khi socket rớt (socket live → socket-invalidate).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch daily stats for sparklines
  // doc65 W1 — sparkline theo trục phạm vi (trước đây chỉ theo dropdown factory
  // cục bộ, lệch với KPI dùng effectiveFactoryId). Server chưa nhận machineId
  // cho daily rollup → khi trục chọn tới mức MÁY, sparkline vẫn cấp nhà máy
  // (có ghi chú trung thực tại khối KPI).
  const { data: dailyStats } = trpc.dashboard.getDailyStats.useQuery({
    factoryId: effectiveFactoryId,
    days: 7,
  });

  // Fetch hourly stats for timeline chart
  // doc65 W1 — chart 24h theo trục phạm vi ISA-95 đầy đủ (server vốn ĐÃ nhận
  // factoryId/lineId/machineId — trước đây client chỉ truyền dropdown factory).
  const { data: hourlyStats } = trpc.dashboard.getHourlyStats.useQuery({
    factoryId: effectiveFactoryId,
    lineId: assetScope.lineId,
    machineId: assetScope.machineId,
    hours: 24,
  }, {
    // doc67 W6 [P1-2] — poll chỉ khi socket rớt (socket live → socket-invalidate).
    refetchInterval: socketConnected
      ? false
      : isAutoRefreshing && autoRefreshInterval !== "0" ? parseInt(autoRefreshInterval) * 1000 : false,
  });

  // Fetch yield alert thresholds for realtime alerts
  const { data: yieldThresholds } = trpc.yieldThreshold.list.useQuery();

  // doc67 W7 GĐ2 — XÓA 3 query factory/workshop/line.list: chỉ phục vụ 3 Select
  // bộ lọc cục bộ đã bỏ (trục ISA-95 shell tự nạp danh mục của nó).

  // Fetch line product assignments and production orders for line info
  // doc67 W6 [P0] — 3 query này chỉ phục vụ tab "Bố cục" (thẻ line info) → gate
  // theo activeTab, không bắn khi mở trang ở tab Tổng quan mặc định.
  const { data: lineProductAssignments } = trpc.lineProductAssignment.list.useQuery(undefined, {
    enabled: activeTab === 'layout',
  });
  const { data: productionOrders } = trpc.productionOrder.list.useQuery(undefined, {
    enabled: activeTab === 'layout',
  });
  const { data: productModels } = trpc.productModel.list.useQuery(undefined, {
    enabled: activeTab === 'layout',
  });

  // doc67 W6 [P2] — XÓA query chết `recentInspections` (inspection.list limit 20):
  // không nơi nào tiêu thụ — dialog chi tiết máy dùng `filteredInspections` (query
  // riêng bên dưới, limit 50 + lọc trạng thái, enabled theo machineDetailOpen).

  // Fetch filtered inspections for selected machine (by status)
  const { data: filteredInspections, isLoading: filteredInspectionsLoading } = trpc.inspection.list.useQuery({
    machineId: selectedMachine?.id,
    result: machineDialogStatusFilter !== "all" ? machineDialogStatusFilter as "OK" | "NG" | "NTF" : undefined,
    limit: 50,
  }, {
    enabled: !!selectedMachine && machineDetailOpen,
  });

  // Fetch workstation summary for top defects (overview tab)
  // doc67 W6 [P0] — card "Top 5 trạm lỗi cao" của tab Tổng quan dùng TRỰC TIẾP
  // query này (dải ngày dateRange người dùng chọn) → gate theo tab overview.
  // KHÔNG gộp được với bản ng-visual bên dưới: bản đó chạy dải ngày riêng
  // (ngDateRange theo ngTimeFilter, mặc định 1 tháng) — 2 input khác nhau nên
  // 2 cache-entry khác nhau; nhờ gate theo tab, mỗi thời điểm chỉ 1 bản bắn.
  const { data: workstationSummary } = trpc.workstation.summary.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    enabled: activeTab === 'overview',
  });

  // doc67 W6 [P2] — XÓA query chết `topNGPoints` (workstation.topNGMeasurementPoints
  // limit 15, dải dateRange): không nơi nào tiêu thụ — tab NG trực quan dùng
  // `ngTopNGPoints` (limit 20, dải ngDateRange) bên dưới.

  // doc67 W6 [P1-3] — query mqttClient.getAllOEE + effectiveOEE/oeeIsLive đã dời
  // vào <LiveOeeWidget> (cuối file) cùng state liveOEE/lastRealtimeAt.

  // Fetch workstation summary for NG Visual tab (with separate time filter)
  // doc67 W6 [P0] — cụm 7 query tab "NG trực quan" gate theo activeTab: không bắn
  // khi mở trang ở tab Tổng quan (TabsContent không mount tab ẩn nên không ai đọc).
  const { data: ngWorkstationSummary, isLoading: ngWorkstationLoading } = trpc.workstation.summary.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
  }, {
    enabled: activeTab === 'ng-visual',
  });

  // doc67 W6 [P0] — điều kiện cho 2 query *Direct fallback: chỉ bắn khi nguồn chính
  // (workstation.summary bản ng-visual) ĐÃ trả về và KHÔNG có dữ liệu thực — khớp
  // cách effectiveNGSummary chọn nguồn (length > 0 && some(totalInspections > 0)).
  const ngWorkstationSourceEmpty = useMemo(() => {
    const wsData = ngWorkstationSummary as any[] | undefined;
    if (wsData === undefined) return false; // chưa trả → chưa cho fallback bắn
    return !(wsData.length > 0 && wsData.some((w: any) => Number(w.totalInspections) > 0));
  }, [ngWorkstationSummary]);

  // Fetch top NG measurement points for NG Visual tab
  const { data: ngTopNGPoints, isLoading: ngTopNGLoading } = trpc.workstation.topNGMeasurementPoints.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
    limit: 20,
  }, {
    enabled: activeTab === 'ng-visual',
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
  }, {
    enabled: activeTab === 'ng-visual',
  });

  // Fetch NG comparison data
  const { data: ngComparisonData, isLoading: ngComparisonLoading } = trpc.workstation.ngComparison.useQuery(ngComparisonDates, {
    enabled: activeTab === 'ng-visual',
  });

  // Fallback: NG summary by machine (when workstation data is unavailable)
  const { data: ngMachineSummary } = trpc.workstation.ngSummaryByMachine.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
  }, {
    enabled: activeTab === 'ng-visual',
  });

  // Fallback: NG trend from product_inspections directly
  // doc67 W6 [P0] — fallback *Direct chỉ bắn khi nguồn workstation đã trả RỖNG
  // (ngWorkstationSourceEmpty): pipeline workstation có dữ liệu thì 2 query này
  // là tải thừa trên mỗi lần mở tab.
  const { data: ngTrendDirectData } = trpc.workstation.ngTrendDirect.useQuery({
    startDate: ngDateRange.startDate,
    endDate: ngDateRange.endDate,
    machineId: trendFilterWorkstationId, // reuse filter for machine
  }, {
    enabled: activeTab === 'ng-visual' && ngWorkstationSourceEmpty,
  });

  // Fallback: NG comparison from product_inspections directly
  const { data: ngComparisonDirectData } = trpc.workstation.ngComparisonDirect.useQuery(ngComparisonDates, {
    enabled: activeTab === 'ng-visual' && ngWorkstationSourceEmpty,
  });

  // Determine effective NG data: prefer workstation-based, fallback to machine-based
  const effectiveNGSummary = useMemo(() => {
    const wsData = ngWorkstationSummary as any[] | undefined;
    if (wsData && wsData.length > 0 && wsData.some((w: any) => Number(w.totalInspections) > 0)) {
      return { source: 'workstation' as const, data: wsData };
    }
    const machData = ngMachineSummary as any[] | undefined;
    if (machData && machData.length > 0 && machData.some((m: any) => Number(m.totalInspections) > 0)) {
      return { source: 'machine' as const, data: machData };
    }
    return { source: 'none' as const, data: [] as any[] };
  }, [ngWorkstationSummary, ngMachineSummary]);

  const effectiveNGTrend = useMemo(() => {
    const wsData = ngTrendData as any[] | undefined;
    if (wsData && wsData.length > 0) return wsData;
    return (ngTrendDirectData as any[]) || [];
  }, [ngTrendData, ngTrendDirectData]);

  const effectiveNGComparison = useMemo(() => {
    if (ngComparisonData && (ngComparisonData as any)?.current?.totalCount > 0) return ngComparisonData;
    if (ngComparisonDirectData && (ngComparisonDirectData as any)?.current?.totalCount > 0) return ngComparisonDirectData;
    return ngComparisonData || ngComparisonDirectData;
  }, [ngComparisonData, ngComparisonDirectData]);

  // Fetch all workstations for filter dropdown
  // doc67 W6 [P0] — dropdown lọc trạm chỉ nằm trong tab NG trực quan → gate theo tab.
  const { data: allWorkstations } = trpc.workstation.list.useQuery(undefined, {
    enabled: activeTab === 'ng-visual',
  });

  // Fetch all measurement points for filter dropdown (we'll filter by workstation in UI)
  const { data: allMeasurementPoints } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: 0 }, // Get all measurement points
    { enabled: false } // Disable for now, will use ngTopNGPoints data
  );

  // Manual refresh — mốc "cập nhật lúc" nay lấy thẳng từ dataUpdatedAt của
  // react-query (doc65 W2), không cần state lastRefreshTime tự chế nữa.
  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchMachines();
  }, [refetchStats, refetchMachines]);

  // doc65 W1 [P1 đã duyệt] — builder HTML báo cáo NG dùng chung cho hai đường xuất:
  //  - "Xuất PDF (in)": mở cửa sổ mới + print-stylesheet A4 + window.print()
  //  - "Xuất HTML": tải tệp .html (behavior cũ, dưới nhãn trung thực)
  const buildNGReportHtml = useCallback((opts: { autoPrint: boolean }) => {
      // Prepare data for report
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

      const timeRangeLabel = ngTimeFilter === "day" ? t("dashboard.today") : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod");
      const exportDate = new Date().toLocaleString('vi-VN');

      // Create HTML content for PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>${t("dashboard.ngReportTitle")} - ${timeRangeLabel}</title>
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
            /* doc65 W1 — print-stylesheet: khổ A4, font hệ, bảng không vỡ hàng qua trang, ẩn phần tử không in */
            @page { size: A4; margin: 12mm; }
            @media print {
              body { padding: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, "Helvetica Neue", sans-serif; }
              table { page-break-inside: auto; }
              tr { page-break-inside: avoid; }
              thead { display: table-header-group; }
              .no-print { display: none !important; }
            }
          </style>
          ${opts.autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });</' + 'script>' : ''}
        </head>
        <body>
          ${opts.autoPrint ? `<div class="no-print" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#1e40af;">
            ${t("dashboard.exportReport")}: chọn "Save as PDF / Lưu thành PDF" trong hộp thoại in. <button onclick="window.print()" style="margin-left:8px;padding:4px 10px;border:1px solid #1e40af;border-radius:6px;background:#fff;color:#1e40af;cursor:pointer;">In / Lưu PDF</button>
          </div>` : ''}
          <div class="header">
            <h1>${t("dashboard.ngReportTitle")}</h1>
            <div class="meta">
              <p>${t("dashboard.timeRangeLabel")}: <strong>${timeRangeLabel}</strong></p>
              <p>${t("dashboard.exportDateLabel")}: ${exportDate}</p>
            </div>
          </div>

          <h2>${t("dashboard.ngRateByWorkstation")}</h2>
          <table>
            <thead>
              <tr>
                <th>${t("dashboard.codeCol")}</th>
                <th>${t("dashboard.workstationNameCol")}</th>
                <th>${t("dashboard.totalInspectionCol")}</th>
                <th>${t("dashboard.ngCountCol")}</th>
                <th>${t("dashboard.ngRateCol")}</th>
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

          <h2>${t("dashboard.topNgPoints")}</h2>
          <table>
            <thead>
              <tr>
                <th>${t("dashboard.codeCol")}</th>
                <th>${t("dashboard.pointNameCol")}</th>
                <th>${t("dashboard.workstationCol")}</th>
                <th>${t("dashboard.totalInspectionCol")}</th>
                <th>${t("dashboard.ngCountCol")}</th>
                <th>${t("dashboard.ngRateCol")}</th>
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
            <p>${t("dashboard.reportFooter")}</p>
          </div>
        </body>
        </html>
      `;

      return htmlContent;
  }, [ngWorkstationSummary, ngTopNGPoints, ngTimeFilter, t]);

  // doc65 W1 [P1 đã duyệt] — "Xuất PDF (in)": PDF THẬT qua hộp thoại in của trình
  // duyệt (người dùng chọn Save as PDF). Kiosk/panel-PC có thể chặn window.open
  // → toast hướng dẫn cho phép popup hoặc dùng "Xuất HTML".
  const handleExportPDF = useCallback(() => {
    setExportingPDF(true);
    try {
      const win = window.open('', '_blank');
      if (!win) {
        toast.error('Cửa sổ in bị trình duyệt chặn', {
          description: 'Hãy cho phép popup (cửa sổ bật lên) cho trang này rồi thử lại, hoặc dùng "Xuất HTML".',
        });
        return;
      }
      win.document.open();
      win.document.write(buildNGReportHtml({ autoPrint: true }));
      win.document.close();
      win.focus();
    } catch (error) {
      console.error('Export PDF error:', error);
      toast.error(t("dashboard.exportReportError"), {
        description: t("dashboard.exportReportErrorDesc"),
      });
    } finally {
      setExportingPDF(false);
    }
  }, [buildNGReportHtml, t]);

  // doc65 W1 — "Xuất HTML": giữ behavior tải tệp .html cũ, nay dưới nhãn trung thực.
  const handleExportHTML = useCallback(() => {
    setExportingPDF(true);
    try {
      const blob = new Blob([buildNGReportHtml({ autoPrint: false })], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ng-visual-report-${ngTimeFilter}-${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(t("dashboard.exportSuccess"), {
        description: t("dashboard.exportSuccessDesc"),
      });
    } catch (error) {
      console.error('Export HTML error:', error);
      toast.error(t("dashboard.exportReportError"), {
        description: t("dashboard.exportReportErrorDesc"),
      });
    } finally {
      setExportingPDF(false);
    }
  }, [buildNGReportHtml, ngTimeFilter, t]);

  // Group machines by production line
  const machinesByLine = useMemo(() => {
    if (!machinesStats) return new Map<string, MachineStats[]>();
    
    type MachineWithHierarchy = {
      machine: { id: number; code: string; name: string; image2DUrl?: string | null; image3DUrl?: string | null };
      station: { id: number; name: string; lineId: number } | null;
      line: { id: number; name: string; workshopId: number } | null;
      workshop: { id: number; name: string; factoryId: number } | null;
      factory: { id: number; name: string } | null;
      stats: { total: number; ok: number; ng: number; ntf: number; yieldRate: number; fpy: number };
    };
    
    const machines = (machinesStats as MachineWithHierarchy[]).map(m => ({
      id: m.machine.id,
      name: m.machine.name,
      code: m.machine.code,
      image2DUrl: m.machine.image2DUrl,
      image3DUrl: m.machine.image3DUrl,
      total: m.stats.total,
      ok: m.stats.ok,
      ng: m.stats.ng,
      ntf: m.stats.ntf,
      yieldRate: m.stats.yieldRate,
      // doc65 W1 — FPY canonical per-machine từ server (true first-pass yield).
      fpy: m.stats.fpy,
      lineId: m.line?.id,
      lineName: m.line?.name || t('dashboard.unclassified'),
      stationId: m.station?.id,
      stationName: m.station?.name,
      workshopId: m.workshop?.id,
      workshopName: m.workshop?.name,
      factoryId: m.factory?.id,
      factoryName: m.factory?.name,
    }));
    const grouped = new Map<string, MachineStats[]>();
    
    machines.forEach(machine => {
      // doc67 W7 GĐ2 — lọc factory/line đã thực hiện Ở SERVER theo trục ISA-95
      // (getAllMachinesStats nhận effectiveFactoryId + assetScope.lineId); bộ lọc
      // cục bộ trùng trục đã xóa. Chỉ còn lọc online/offline phía client.
      // Apply machine status filter
      if (machineStatusFilter !== "all") {
        const isOnline = onlineMachines.has(machine.code);
        if (machineStatusFilter === "online" && !isOnline) return;
        if (machineStatusFilter === "offline" && isOnline) return;
      }
      
      const lineKey = machine.lineName || t("dashboard.unclassified");
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, []);
      }
      grouped.get(lineKey)!.push(machine);
    });
    
    return grouped;
  }, [machinesStats, machineStatusFilter, onlineMachines]);

  // doc65 W1 — sự thật số liệu per-machine:
  //  - fpy: dùng trường CANONICAL từ server (true first-pass yield, getMachineStats);
  //    fallback ok/total chỉ khi server chưa trả (dữ liệu cũ trong cache).
  //  - ng/total và ntf/total KHÔNG phải "FY"/"NTFY" — đó là tỷ lệ NG và tỷ lệ NTF,
  //    trả về dưới tên trung thực ngPct/ntfPct (nhãn hiển thị "NG %"/"NTF %").
  // doc67 W7 GĐ2 — trả SỐ (không toFixed chuỗi); nơi hiển thị dùng fmtPct chung.
  const calculateYields = (machine: MachineStats) => {
    const total = machine.total || 1;
    const fpy = typeof machine.fpy === "number" ? machine.fpy : (machine.ok / total) * 100;
    const ngPct = (machine.ng / total) * 100;
    const ntfPct = (machine.ntf / total) * 100;
    return { fpy, ngPct, ntfPct };
  };

  // Calculate yield alerts based on thresholds
  const currentStats = (statsWithComparison as StatsWithComparison | undefined)?.current;

  const yieldAlerts = useMemo(() => {
    if (!currentStats || !yieldThresholds || (currentStats.total ?? 0) <= 0) return [];
    
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
            message: t('dashboard.criticalThresholdMsg', { metric: threshold.metricType, direction: isHigherBetter ? t('dashboard.below') : t('dashboard.exceeds'), value: currentValue.toFixed(2), threshold: criticalVal })
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
            message: t('dashboard.warningThresholdMsg', { metric: threshold.metricType, direction: isHigherBetter ? t('dashboard.below') : t('dashboard.exceeds'), value: currentValue.toFixed(2), threshold: warningVal })
          });
        }
      }
    });

    return alerts;
  }, [currentStats, yieldThresholds]);

  // Get status indicator
  // doc67 W7 GĐ2 — ngưỡng theo yieldTone chung (95/90 — thay bản local 95/85);
  // getStatusColor local (dead code) đã xóa.
  const getStatusIndicator = (fpy: number) => {
    const tone = yieldTone(fpy);
    if (tone === "success") return { icon: CheckCircle2, color: TONE_TEXT_CLASS.success, label: t("dashboard.good") };
    if (tone === "warning") return { icon: AlertTriangle, color: TONE_TEXT_CLASS.warning, label: t("dashboard.warning") };
    return { icon: XCircle, color: TONE_TEXT_CLASS.danger, label: t("dashboard.needsAttention") };
  };

  // Trend indicator component
  // doc65 PRO-100 (ISA-101): màu trend theo NGỮ NGHĨA, không theo dấu — NG/NTF tăng là XẤU
  // (goodWhen="down"); mặc định "up" cho sản lượng/FPY.
  const TrendIndicator = ({ value, suffix = "%", goodWhen = "up" }: { value: number | undefined; suffix?: string; goodWhen?: "up" | "down" }) => {
    if (value === undefined || value === 0) return null;
    const isUp = value > 0;
    const isGood = goodWhen === "up" ? isUp : !isUp;
    return (
      <span className={`text-xs flex items-center gap-0.5 ${isGood ? 'text-success' : 'text-destructive'}`}>
        {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
        {isUp ? '+' : ''}{value.toFixed(1)}{suffix}
      </span>
    );
  };

  // doc67 W7 GĐ2 — Sparkline inline (recharts, tái tạo mỗi render, 5 ResponsiveContainer)
  // đã XÓA: 5 call-site KPI dùng patterns/Sparkline (SVG thuần, token-driven).

  const pieData = useMemo(() => {
    const stats = (statsWithComparison as StatsWithComparison | undefined)?.current;
    if (!stats) return [];
    // doc67 W7 GĐ2 — oklch hardcode → toneHex (đọc CSS var theo theme đang bật).
    return [
      { name: "OK", value: stats.ok, color: toneHex("success") },
      { name: "NG", value: stats.ng, color: toneHex("danger") },
      { name: "NTF", value: stats.ntf, color: toneHex("warning") },
    ].filter(item => item.value > 0);
  }, [statsWithComparison]);

  const openMachineDetail = (machine: MachineStats) => {
    setSelectedMachine(machine);
    setMachineDialogStatusFilter("all");
    setMachineDetailOpen(true);
  };

  const stats = (statsWithComparison as StatsWithComparison | undefined)?.current;
  const trends = (statsWithComparison as StatsWithComparison | undefined)?.trends;
  const showNoTodayDataBanner =
    timeRange === "today" &&
    !statsLoading &&
    Boolean(statsWithComparison) &&
    (stats?.total ?? 0) <= 0;

  // Prepare sparkline data. Doc 27 Đợt 5 / W5-E (Đợt-1.4 leftover): fpy comes
  // from the SERVER canonical fields (getDailyStats now returns true per-day
  // FPY + finalYield) instead of the old client-side "(ok+ntf)/total" — that
  // formula is final yield, and mislabelling it FPY overstated the KPI.
  const sparklineData = useMemo(() => {
    if (!dailyStats || !Array.isArray(dailyStats)) return [];
    return [...(dailyStats as any[])].reverse().map((d: any) => ({
      date: d.date,
      output: d.totalProducts,
      fpy: Number(d.fpy) || 0,
      finalYield: Number(d.finalYield) || 0,
      // doc65 PRO-100: server vốn ĐÃ trả per-day ok/ng/ntf — map để sparkline đủ 5/5 card.
      ok: Number(d.okCount) || 0,
      ng: Number(d.ngCount) || 0,
      ntf: Number(d.ntfCount) || 0,
    }));
  }, [dailyStats]);

  return (
    <DashboardLayout
      title={t("nav.dashboardMain")}
      navItems={navItems}
      currentPath="/dashboard"
    >
      {/* U11 — first-visit nudge to start from a role-aligned dashboard template.
          doc67 W4: ẩn dưới md — trên mobile 390 banner chiếm chỗ KPI đầu màn. */}
      <div className="hidden md:block">
        <DashboardTemplatePrompt />
      </div>
      <PageContainer fluid className="p-0 md:p-0 space-y-4 sm:space-y-6">
        {/* Header with filters and auto-refresh controls */}
        <PageHeader
          icon={<Activity className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />}
          // doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.dashboardMain.
          title={t("nav.dashboardMain")}
          description={
            <span className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="text-xs sm:text-sm">{t("dashboard.monitoringQuality")}</span>
              {/* doc67 W6 [P1-3] — badge tự giữ mốc oee:update gần nhất, root không
                  còn setState theo từng push (khỏi re-render cả cây). */}
              <HeaderRealtimePulse connected={socketConnected} />
              {/* doc65 W2 (AUD-01) — TUỔI DỮ LIỆU KPI (poll) đặt CẠNH trạng thái
                  SOCKET: RealtimeBadge nói về kết nối đẩy, PollFreshness nói về
                  lần fetch KPI gần nhất — 2 khái niệm, cùng hiển thị. */}
              <PollFreshness
                updatedAt={kpiUpdatedAt}
                isFetching={kpiFetching}
                staleAfterMs={kpiStaleAfterMs}
              />
            </span>
          }
          actions={
            <>
            {/* Quick actions - visible on mobile */}
            <div className="flex items-center gap-2 sm:hidden">
              <Button variant="outline" size="icon" aria-label={t('common.refresh')} onClick={handleRefresh} className="h-9 w-9">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
              </Button>
              {(activeAlertsCount as number) > 0 && (
                <Link href="/alerts">
                  <Button variant="outline" size="icon" aria-label={t('nav.alerts', 'Alerts')} className="relative h-9 w-9">
                    <Bell aria-hidden="true" className="h-4 w-4" />
                    <Badge variant="destructive" className="absolute -top-2 -right-2 h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                      {activeAlertsCount as number}
                    </Badge>
                  </Button>
                </Link>
              )}
            </div>

          {/* doc 67 W5 (việc 6) — nút nhỏ admin-only: /dashboard-center đã dời sang
              group Admin; đây là lối tắt tùy biến bố cục ngay trên header. */}
          {user?.role === "admin" && (
            <Link href="/dashboard-center" className="hidden sm:block">
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="h-4 w-4 mr-1" />
                {t("dashboard.customizeLayout", "Tùy chỉnh bố cục")}
              </Button>
            </Link>
          )}

          {/* Filters - scrollable on mobile */}
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto pb-2 sm:pb-0 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap">
            {/* Alert Badge - hidden on mobile (shown in quick actions) */}
            <div className="hidden sm:block">
              {(activeAlertsCount as number) > 0 && (
                <Link href="/alerts">
                  <Button variant="outline" size="sm" className="relative">
                    <Bell className="h-4 w-4 mr-1" />
                    {t("dashboard.alerts")}
                    <Badge variant="destructive" className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
                      {activeAlertsCount as number}
                    </Badge>
                  </Button>
                </Link>
              )}
            </div>

            {/* doc67 W7 GĐ2 — 3 Select Nhà máy/Phân xưởng/Dây chuyền cục bộ (cả bản
                desktop lẫn Sheet mobile W4) đã XÓA: phạm vi ISA-95 chọn ở AssetScopeBar
                của shell (một trục duy nhất, hết "hai hệ filter song song").
                GIỮ Select khoảng-thời-gian + auto-refresh bên dưới. */}
            <Select value={timeRange} onValueChange={(value) => setTimeRange(value as DashboardTimeRange)}>
              <SelectTrigger className="w-28 sm:w-36 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">{t("dashboard.rangeToday", "Today")}</SelectItem>
                <SelectItem value="yesterday">{t("dashboard.rangeYesterday", "Yesterday")}</SelectItem>
                <SelectItem value="7days">{t("dashboard.range7Days", "7 Days")}</SelectItem>
                <SelectItem value="15days">{t("dashboard.range15Days", "15 Days")}</SelectItem>
                <SelectItem value="30days">{t("dashboard.range30Days", "30 Days")}</SelectItem>
                <SelectItem value="custom">{t("dashboard.rangeCustom", "Custom")}</SelectItem>
              </SelectContent>
            </Select>

            {timeRange === "custom" && (
              <>
                <Input
                  type="date"
                  value={customFromDate}
                  onChange={(e) => setCustomFromDate(e.target.value)}
                  className="w-35 sm:w-40 shrink-0"
                  aria-label={t("dashboard.fromDate", "From date")}
                />
                <Input
                  type="date"
                  value={customToDate}
                  onChange={(e) => setCustomToDate(e.target.value)}
                  className="w-35 sm:w-40 shrink-0"
                  aria-label={t("dashboard.toDate", "To date")}
                />
              </>
            )}

            {/* Auto-refresh controls - hidden on mobile */}
            <div className="hidden sm:flex items-center gap-1 border rounded-md shrink-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={isAutoRefreshing ? t('dashboard.pauseAutoRefresh') : t('dashboard.enableAutoRefresh')}
                      onClick={() => setIsAutoRefreshing(!isAutoRefreshing)}
                    >
                      {isAutoRefreshing ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isAutoRefreshing ? t('dashboard.pauseAutoRefresh') : t('dashboard.enableAutoRefresh')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <Select value={autoRefreshInterval} onValueChange={setAutoRefreshInterval}>
                <SelectTrigger className="w-28 border-0">
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
            <Button variant="outline" size="icon" aria-label={t('common.refresh')} onClick={handleRefresh} className="hidden sm:flex shrink-0">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            </Button>
            
            {/* Widget Style Presets - hidden on mobile */}
            <div className="hidden md:block shrink-0">
              <WidgetStylePresetManager
                currentStyle={widgetStyle}
                onStyleChange={setWidgetStyle}
              />
            </div>
          </div>
            </>
          }
        />

        {/* doc67 W8 [P2] (việc 2) — DẢI CẢNH BÁO KHẨN: trước đây urgentAlerts chỉ
            toast rồi biến mất (state nhận từ socket nhưng mảng không render).
            Dải mỏng aria-live="polite" cố định đầu trang (dưới PageHeader) giữ các
            cảnh báo CHƯA dismiss: chấm severity + tiêu đề + "Xem" → /ops-console +
            X bỏ từng cái; >3 thì collapse phần dư thành dòng "×N". */}
        {urgentAlerts.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            aria-label="Cảnh báo khẩn chưa xử lý"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 space-y-1"
          >
            {urgentAlerts.slice(0, 3).map((a) => (
              <div key={a.id} className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={cn("h-2 w-2 shrink-0 rounded-full", severityDotClass(a.severity))}
                />
                <span className="truncate font-medium">{a.title}</span>
                <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">
                  {a.message}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation("/ops-console")}
                  >
                    Xem
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Bỏ cảnh báo: ${a.title}`}
                    onClick={() => setUrgentAlerts((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <XCircle aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {urgentAlerts.length > 3 && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>×{urgentAlerts.length - 3} cảnh báo khẩn khác</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setLocation("/ops-console")}
                >
                  Xem tất cả
                </Button>
              </div>
            )}
          </div>
        )}

        {/* doc 67 W5 (việc 6) — rail 2-chiều từ map tập trung (RelatedViews.tsx):
            trang đã rút khỏi menu, đường về Tổng quan nhà máy + các màn anh em. */}
        <RelatedViews pageId="dashboard" />

        {showNoTodayDataBanner && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="py-3 px-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {t("dashboard.noTodayDataTitle", "No inspection data for today")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("dashboard.noTodayDataDesc", "Today currently has no records. Switch to a wider range to review recent production trends.")}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setTimeRange("7days")}>
                {t("dashboard.viewLast7Days", "View last 7 days")}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats Cards with Trends - Moved to top */}
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <StatsCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <>
          {/* doc65 W1 — ghi chú trung thực: số KPI lọc tới mức MÁY theo trục, nhưng
              sparkline 7 ngày (getDailyStats) chỉ hỗ trợ tới mức nhà máy. */}
          {assetScope.machineId != null && (
            <p className="text-xs text-muted-foreground -mb-2">
              Đồ thị xu hướng 7 ngày trong các thẻ KPI: phạm vi toàn nhà máy (chưa lọc theo máy đang chọn)
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card className={cardStyleProps.className} style={cardStyleProps.style}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>{t("dashboard.totalOutput")}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold">
                        {statsLoading ? "..." : fmtInt(stats?.total)}
                      </p>
                      <TrendIndicator value={trends?.output} suffix="%" />
                    </div>
                    <Sparkline data={sparklineData.map((d) => ({ x: d.date, y: d.output }))} width={80} height={32} showArea aria-label={t("dashboard.totalOutput")} />
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
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>{t("dashboard.fpy")}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {/* True FPY (server canonical) — was yieldRate (final yield) mislabelled as FPY */}
                      <p className="text-2xl font-bold text-success">
                        {statsLoading ? "..." : fmtPct(stats?.fpy)}
                      </p>
                      <TrendIndicator value={trends?.fpy} suffix="pp" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {t("dashboard.finalYield")}: {statsLoading ? "..." : fmtPct(stats?.yieldRate)}
                    </p>
                    <Sparkline data={sparklineData.map((d) => ({ x: d.date, y: d.fpy }))} width={80} height={32} tone="good" showArea aria-label={t("dashboard.fpy")} />
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
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>OK</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold text-success">
                        {statsLoading ? "..." : fmtInt(stats?.ok)}
                      </p>
                      <TrendIndicator value={trends?.ok} />
                    </div>
                    <Sparkline data={sparklineData.map((d) => ({ x: d.date, y: d.ok }))} width={80} height={32} tone="good" showArea aria-label="OK" />
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
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>NG</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold text-destructive">
                        {statsLoading ? "..." : fmtInt(stats?.ng)}
                      </p>
                      <TrendIndicator value={trends?.ng} goodWhen="down" />
                    </div>
                    <Sparkline data={sparklineData.map((d) => ({ x: d.date, y: d.ng }))} width={80} height={32} tone="critical" showArea aria-label="NG" />
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
                  <div className="flex-1 min-w-0">
                    <p className="text-xs uppercase tracking-wide" style={{ opacity: 0.7 }}>NTF</p>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-2xl font-bold text-warning">
                        {statsLoading ? "..." : fmtInt(stats?.ntf)}
                      </p>
                      <TrendIndicator value={trends?.ntf} goodWhen="down" />
                    </div>
                    <Sparkline data={sparklineData.map((d) => ({ x: d.date, y: d.ntf }))} width={80} height={32} tone="warning" showArea aria-label="NTF" />
                  </div>
                  <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-warning" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          </>
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
                  <span className="text-sm font-medium">{t("dashboard.yieldWarning")}</span>
                  <Badge variant="secondary" className="text-xs h-5">{yieldAlerts.length}</Badge>
                </div>
                <Link href="/settings">
                  <Button variant="ghost" size="sm" className="h-10 text-xs px-2">{t("dashboard.configuration")}</Button>
                </Link>
              </div>
              {yieldAlerts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {/* doc67 W4 (a11y/touch): Tooltip hover-only vô dụng với găng tay/touch —
                      đổi sang Popover (click/tap/Enter mở), nội dung message/ngưỡng/target giữ nguyên. */}
                  {yieldAlerts.map((alert, index) => (
                    <Popover key={`${alert.type}-${alert.level}-${index}`}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${t("dashboard.yieldWarning")}: ${alert.type} ${fmtPct(alert.currentValue)}`}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                            alert.level === 'critical'
                              ? 'bg-destructive/10 border border-destructive/30 text-destructive'
                              : 'bg-warning/10 border border-warning/30 text-warning'
                          }`}>
                          {alert.level === 'critical'
                            ? <XCircle aria-hidden="true" className="h-3 w-3" />
                            : <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                          }
                          <span className="font-medium">{alert.type}</span>
                          <span>{fmtPct(alert.currentValue)}</span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" className="max-w-xs w-auto p-3">
                        <p className="text-sm font-medium">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t("dashboard.target")}: {alert.target}% | {t("dashboard.threshold")}: {alert.threshold}%</p>
                      </PopoverContent>
                    </Popover>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-4 text-muted-foreground text-sm text-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>
                    {(currentStats?.total ?? 0) > 0
                      ? t("dashboard.noAlerts")
                      : t("dashboard.noDataForAlerts", "No inspection data yet. Alerts will appear once production data is available.")}
                  </span>
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
                  <span className="text-sm font-medium">{t("dashboard.machineConnectionStatus")}</span>
                </div>
                <Link href="/machine-status">
                  <Button variant="ghost" size="sm" className="h-10 text-xs px-2">
                    {t("common.details")}
                  </Button>
                </Link>
              </div>
              {/* doc65 V1 (ISA-101): màu THEO GIÁ TRỊ — "Trực tuyến 0" không được tô xanh
                  (0 máy online là tình trạng xấu nhất); "Ngoại tuyến 0" không được tô đỏ. */}
              <div className="grid grid-cols-4 gap-2">
                <div className="flex flex-col items-center p-2 rounded-lg bg-muted/30">
                  <p className="text-lg font-bold">{machinesStats?.length || 0}</p>
                  <p className="text-[10px] text-muted-foreground">{t("common.total")}</p>
                </div>
                <div className={cn("flex flex-col items-center p-2 rounded-lg", onlineMachines.size > 0 ? "bg-success/10" : "bg-muted/30")}>
                  <p className={cn("text-lg font-bold", onlineMachines.size > 0 ? "text-success" : "text-muted-foreground")}>{onlineMachines.size}</p>
                  <p className="text-[10px] text-muted-foreground">{t("dashboard.online")}</p>
                </div>
                {(() => {
                  const offlineN = Math.max(0, (machinesStats?.length || 0) - onlineMachines.size);
                  return (
                    <div className={cn("flex flex-col items-center p-2 rounded-lg", offlineN > 0 ? "bg-destructive/10" : "bg-muted/30")}>
                      <p className={cn("text-lg font-bold", offlineN > 0 ? "text-destructive" : "text-muted-foreground")}>{offlineN}</p>
                      <p className="text-[10px] text-muted-foreground">{t("dashboard.offline")}</p>
                    </div>
                  );
                })()}
                {(() => {
                  const availPct = machinesStats?.length ? Math.round((onlineMachines.size / machinesStats.length) * 100) : 0;
                  return (
                    <div className={cn("flex flex-col items-center p-2 rounded-lg", availPct > 0 ? "bg-primary/10" : "bg-muted/30")}>
                      <p className={cn("text-lg font-bold", availPct === 0 && "text-muted-foreground")}>{availPct}%</p>
                      <p className="text-[10px] text-muted-foreground">{t("dashboard.avail")}</p>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for Overview and Layout */}
        {/* doc67 W8 (việc 1) — onValueChange qua handleTabChange: state + ?tab= URL (replace). */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          {/* doc67 W4 (mobile 390): tab tràn ngang → cuộn ngang + scroll-snap dưới sm thay vì wrap vỡ hàng */}
          <TabsList className="flex w-full max-w-2xl flex-nowrap justify-start overflow-x-auto snap-x snap-mandatory sm:grid sm:grid-cols-4 h-auto">
            <TabsTrigger value="overview" className="flex flex-none sm:flex-1 items-center gap-2 snap-start whitespace-nowrap">
              <BarChart3 className="h-4 w-4" />{t("dashboard.overviewTab")}</TabsTrigger>
            <TabsTrigger value="ng-visual" className="flex flex-none sm:flex-1 items-center gap-2 snap-start whitespace-nowrap">
              <AlertTriangle className="h-4 w-4" />{t("dashboard.ngVisualTab")}</TabsTrigger>
            <TabsTrigger value="layout" className="flex flex-none sm:flex-1 items-center gap-2 snap-start whitespace-nowrap">
              <LayoutGrid className="h-4 w-4" />{t("dashboard.layoutTab")}</TabsTrigger>
            <TabsTrigger value="custom" className="flex flex-none sm:flex-1 items-center gap-2 snap-start whitespace-nowrap">
              <Palette className="h-4 w-4" />{t("dashboard.customTab")}</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            {/* doc64 S5-OPT-2: toàn bộ thân tab overview (widget + 3 chart + AI) mount SAU
                khe paint đầu — hero KPI/thẻ trạng thái phía trên paint được ngay thay vì
                chờ cả cây nặng render xong (LCP ~5s → mục tiêu <2,5s). */}
            <DeferredMount placeholder={<ChartSkeleton />}>
            {/* MQTT Alert Widget — doc67 W6 [P1-2]: socket live → ngừng poll 30s */}
            <MqttAlertWidget socketConnected={socketConnected} />

            {/* OEE Mini-widget — doc67 W6 [P1-3]: tách thành component con sở hữu
                state liveOEE/lastRealtimeAt riêng (tự subscribe oee:update); mỗi
                push chỉ re-render widget này, không re-render cả cây Dashboard. */}
            <LiveOeeWidget socketConnected={socketConnected} cardStyleProps={cardStyleProps} />

            {/* Shift Stats & Top/Bottom Machines */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Shift Statistics */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />{t("dashboard.shiftStats")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(shiftStats as ShiftStats[] | undefined)?.map((shift, index) => {
                  const ShiftIcon = shift.shift === 'morning' ? Sunrise : shift.shift === 'afternoon' ? Sun : Moon;
                  return (
                    <div key={`${shift.shift}-${shift.shiftName}-${index}`} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2">
                        <ShiftIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{shift.shiftName}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">{shift.total} {t("dashboard.pcsUnit", "pcs")}</span>
                        {/* doc67 W7 GĐ2 — yieldTone chung (95/90, thay ternary local 95/85) + fmtPct */}
                        <span className={TONE_TEXT_CLASS[yieldTone(shift.fpy)]}>
                          {fmtPct(shift.fpy)}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {(!shiftStats || (shiftStats as ShiftStats[]).length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("dashboard.noDataYet")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Performing Machines */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-success" />{t("dashboard.top5Best")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(topBottomMachines as { top: any[]; bottom: any[] } | undefined)?.top?.map((machine, index) => (
                  <div key={machine.id} className="flex items-center justify-between p-2 rounded-lg bg-success/5 border border-success/20">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-success w-5">#{index + 1}</span>
                      <span className="text-sm truncate max-w-30">{machine.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{machine.total} {t("dashboard.pcsUnit", "pcs")}</span>
                      <Badge variant="outline" className="text-success border-success/50">
                        {machine.fpy}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!topBottomMachines || (topBottomMachines as { top: any[] }).top?.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("dashboard.noDataYet")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bottom Performing Machines */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-destructive" />{t("dashboard.top5NeedImprovement")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(topBottomMachines as { top: any[]; bottom: any[] } | undefined)?.bottom?.map((machine, index) => (
                  <div key={machine.id} className="flex items-center justify-between p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-destructive w-5">#{index + 1}</span>
                      <span className="text-sm truncate max-w-30">{machine.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{machine.total} {t("dashboard.pcsUnit", "pcs")}</span>
                      <Badge variant="outline" className="text-destructive border-destructive/50">
                        {machine.fpy}%
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!topBottomMachines || (topBottomMachines as { bottom: any[] }).bottom?.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">{t("dashboard.noDataYet")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Timeline Chart - Full Width */}
        <Card className={cardStyleProps.className} style={cardStyleProps.style}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />{t("dashboard.timeChart24h")}</CardTitle>
            <CardDescription>{t("dashboard.hourlyChartDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartErrorBoundary>
            <div className="h-75">
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
                    <CartesianGrid {...chartGridProps} opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tick={chartAxisTick}
                      axisLine={{ stroke: 'var(--border)' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      key="yaxis-left"
                      yAxisId="left"
                      tick={chartAxisTick}
                      domain={[0, 100]}
                      label={{ value: '%', angle: -90, position: 'insideLeft', fontSize: 10 }}
                    />
                    <YAxis
                      key="yaxis-right"
                      yAxisId="right"
                      orientation="right"
                      tick={chartAxisTick}
                      label={{ value: 'Output', angle: 90, position: 'insideRight', fontSize: 10 }}
                    />
                    <RechartsTooltip contentStyle={chartTooltipStyle} />
                    <Legend />
                    <Line
                      key="line-fpy"
                      yAxisId="left"
                      type="monotone"
                      dataKey="FPY"
                      stroke="var(--success)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      key="line-fy"
                      yAxisId="left"
                      type="monotone"
                      dataKey="FY"
                      stroke="var(--destructive)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      key="line-ntfy"
                      yAxisId="left"
                      type="monotone"
                      dataKey="NTFY"
                      stroke="var(--warning)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      key="line-total"
                      yAxisId="right"
                      type="monotone"
                      dataKey="Total"
                      stroke="var(--info)"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">{t("dashboard.noDataYet")}</div>
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
              <CardTitle className="text-base">{t("dashboard.resultDistribution")}</CardTitle>
              <CardDescription>{t("dashboard.resultDistributionDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary>
              <div className="h-50">
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
                        label={({ name, percent }) => `${name} ${fmtPct(percent * 100, 0)}`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">{t("dashboard.noDataYet")}</div>
                )}
              </div>
              </ChartErrorBoundary>
            </CardContent>
          </Card>

          {/* Bar Chart - Top machines */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader>
              <CardTitle className="text-base">{t("dashboard.topMachinesByOutput")}</CardTitle>
              <CardDescription>{t("dashboard.top10MachinesDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartErrorBoundary>
              <div className="h-50">
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
                      <CartesianGrid {...chartGridProps} opacity={0.3} />
                      <XAxis type="number" tick={chartAxisTick} axisLine={{ stroke: 'var(--border)' }} />
                      <YAxis type="category" dataKey="name" tick={chartAxisTick} axisLine={{ stroke: 'var(--border)' }} />
                      <RechartsTooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="output" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground">{t("dashboard.noDataYet")}</div>
                )}
              </div>
              </ChartErrorBoundary>
            </CardContent>
          </Card>

          {/* Top 5 Workstations with Defects */}
          <Card className={cardStyleProps.className} style={cardStyleProps.style}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Factory className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />{t("dashboard.top5HighErrorWorkstations")}</CardTitle>
              <CardDescription>{t("dashboard.workstationsNeedImprovement")}</CardDescription>
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
                        <div key={`${ws.workstationId ?? "na"}-${ws.workstationCode ?? "code"}-${index}`} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="flex items-center gap-3 flex-1">
                            {/* doc67 W7 GĐ2 — orange hardcode → token warning */}
                            <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center text-sm font-semibold text-warning">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{ws.workstationName || 'Unknown'}</p>
                              <p className="text-xs text-muted-foreground">{ws.workstationCode}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm font-semibold text-destructive">{totalDefects}</div>
                              <div className="text-xs text-muted-foreground">{t("common.error")}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-info">{fmtPct(yieldRate)}</div>
                              <div className="text-xs text-muted-foreground">{t("dashboard.yield")}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <EmptyState
                    variant="no-analytics"
                    title={t("dashboard.noWorkstationData")}
                    description={t("dashboard.noWorkstationDataDesc")}
                    compact
                  />
                )}
              </div>
            </CardContent>
          </Card>
            </div>

            {/* AI Insights Widget */}
            <DashboardAIWidget />
            </DeferredMount>
          </TabsContent>

          {/* NG Visual Tab */}
          <TabsContent value="ng-visual" className="space-y-6 mt-6">
            <div className="space-y-6">
              {/* Time Filter and Legend */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-card p-4 rounded-lg border">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-muted-foreground font-medium">{t("dashboard.ngSeverityLabel")}</span>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-success" />
                    <span>{t("dashboard.ngLevelGood")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-warning" />
                    <span>{t("dashboard.ngLevelAcceptable")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* doc67 W7 GĐ2 — bậc 3/4 của thang NG cần HUE RIÊNG (giữa warning
                        và destructive): dùng token --alarm-high (ISA-18.2 P2, cam,
                        theme-aware) thay orange-500 hardcode. */}
                    <div className="w-3 h-3 rounded bg-(--alarm-high)" />
                    <span>{t("dashboard.ngLevelWarning")}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-destructive" />
                    <span>{t("dashboard.ngLevelCritical")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Select value={ngTimeFilter} onValueChange={(v) => setNgTimeFilter(v as "day" | "week" | "month")}>
                    <SelectTrigger className="w-35">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">{t("common.today")}</SelectItem>
                      <SelectItem value="week">{t("dashboard.last7Days")}</SelectItem>
                      <SelectItem value="month">{t("dashboard.last30Days")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* doc65 W1 [P1 đã duyệt] — gom 2 lựa chọn xuất vào 1 nút:
                      "Xuất PDF (in)" = print-dialog thật; "Xuất HTML" = tải tệp (behavior cũ, nhãn trung thực) */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingPDF || (effectiveNGSummary.source === 'none' && !ngTopNGPoints)}
                        className="flex items-center gap-1"
                      >
                        {exportingPDF ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileDown className="h-4 w-4" />
                        )}
                        {exportingPDF ? t("dashboard.exporting") : t("dashboard.exportReport")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleExportPDF}>
                        <FileText className="h-4 w-4" />
                        Xuất PDF (in)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportHTML}>
                        <FileDown className="h-4 w-4" />
                        Xuất HTML (tải tệp)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* NG Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Current Period Stats */}
                <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>
                      {ngTimeFilter === "day" ? t("dashboard.today") : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : effectiveNGComparison ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{fmtPct((effectiveNGComparison as any).current.ngRate, 2)}</span>
                          <span className="text-sm text-muted-foreground">{t("dashboard.ngRate")}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">{t("common.total")}: {(effectiveNGComparison as any).current.totalCount.toLocaleString()}</span>
                          <span className="text-destructive">NG: {(effectiveNGComparison as any).current.ngCount.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">{t("common.noData")}</div>
                    )}
                  </CardContent>
                </Card>

                {/* Previous Period Stats */}
                <Card className={cardStyleProps.className} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>
                      {ngTimeFilter === "day" ? t("common.yesterday") : ngTimeFilter === "week" ? t("dashboard.7daysBefore") : t("dashboard.30daysBefore")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : effectiveNGComparison ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-bold">{fmtPct((effectiveNGComparison as any).previous.ngRate, 2)}</span>
                          <span className="text-sm text-muted-foreground">{t("dashboard.ngRate")}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-muted-foreground">{t("common.total")}: {(effectiveNGComparison as any).previous.totalCount.toLocaleString()}</span>
                          <span className="text-destructive">NG: {(effectiveNGComparison as any).previous.ngCount.toLocaleString()}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">{t("common.noData")}</div>
                    )}
                  </CardContent>
                </Card>

                {/* Change Indicator */}
                <Card className={`${cardStyleProps.className} ${(effectiveNGComparison as any)?.changes?.isImproved ? 'border-success/50' : 'border-destructive/50'}`} style={cardStyleProps.style}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium" style={{ opacity: 0.7 }}>{t("dashboard.ngCompare")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ngComparisonLoading ? (
                      <div className="h-16 flex items-center justify-center">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : effectiveNGComparison ? (
                      <div className="space-y-2">
                        <div className="flex items-baseline gap-2">
                          {(effectiveNGComparison as any).changes.isImproved ? (
                            <TrendingDown className="h-6 w-6 text-success" />
                          ) : (
                            <TrendingUp className="h-6 w-6 text-destructive" />
                          )}
                          <span className={`text-2xl font-bold ${(effectiveNGComparison as any).changes.isImproved ? 'text-success' : 'text-destructive'}`}>
                            {(effectiveNGComparison as any).changes.ngRateChange > 0 ? '+' : ''}{fmtPct((effectiveNGComparison as any).changes.ngRateChange, 2)}
                          </span>
                        </div>
                        <div className="text-sm">
                          {(effectiveNGComparison as any).changes.isImproved ? (
                            <span className="text-success">{t("dashboard.improvedVsPrevious")}</span>
                          ) : (effectiveNGComparison as any).changes.ngRateChange === 0 ? (
                            <span className="text-muted-foreground">{t("dashboard.noChange")}</span>
                          ) : (
                            <span className="text-destructive">{t("dashboard.increasedVsPrevious")}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-sm">{t("common.noData")}</div>
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
                        {t("dashboard.ngTrendByDay")}
                        {(trendFilterWorkstationId || trendFilterMeasurementPointId) && (
                          <Badge variant="secondary" className="ml-2">{t("common.filtered")}</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {t("dashboard.ngTrendChartDesc")}
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
                        <SelectTrigger className="w-45">
                          <SelectValue placeholder={t("dashboard.selectWorkstation")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("dashboard.allWorkstations")}</SelectItem>
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
                          <SelectTrigger className="w-50">
                            <SelectValue placeholder={t("dashboard.selectPoint")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">{t("dashboard.allPoints")}</SelectItem>
                            {ngTopNGPoints
                              ?.filter((mp: any) => mp.workstationId === trendFilterWorkstationId)
                              .map((mp: any, index: number) => (
                                <SelectItem key={`${mp.measurementPointDefId}-${mp.measurementPointCode}-${index}`} value={mp.measurementPointDefId.toString()}>
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
                          {t("history.clearFilters")}
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
                  ) : effectiveNGTrend && effectiveNGTrend.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={effectiveNGTrend.map((item: any) => ({
                          date: new Date(item.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                          ngRate: Number(item.ngRate),
                          totalCount: Number(item.totalCount),
                          ngCount: Number(item.ngCount),
                        }))}>
                          <CartesianGrid {...chartGridProps} />
                          <XAxis
                            dataKey="date"
                            tick={chartAxisTick}
                            axisLine={{ stroke: 'var(--border)' }}
                          />
                          <YAxis
                            tick={chartAxisTick}
                            axisLine={{ stroke: 'var(--border)' }}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <RechartsTooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(value: number, name: string) => {
                              if (name === 'ngRate') return [fmtPct(value, 2), t('dashboard.ngRate')];
                              if (name === 'totalCount') return [value.toLocaleString(), t('dashboard.totalInspections')];
                              if (name === 'ngCount') return [value.toLocaleString(), t('dashboard.ngCountLabel')];
                              return [value, name];
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="ngRate"
                            stroke="var(--destructive)"
                            strokeWidth={2}
                            dot={{ fill: 'var(--destructive)', strokeWidth: 2, r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState
                      variant="no-analytics"
                      title={t("dashboard.noTrendData")}
                      description={t("dashboard.noTrendDataDesc")}
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
                    {t("dashboard.ngRateByWorkstation")}
                  </CardTitle>
                  <CardDescription>
                    {t("dashboard.ngRateByWorkstationDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ngWorkstationLoading ? (
                    <div className="flex items-center justify-center h-32">
                      <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : effectiveNGSummary.data.length > 0 ? (
                    <WorkstationNGHeatmap
                      data={effectiveNGSummary.data.map((ws: any) => ({
                        id: ws.workstationId || ws.machineId,
                        code: ws.workstationCode || ws.machineCode || '',
                        name: ws.workstationName || ws.machineName || 'Unknown',
                        total: Number(ws.totalInspections) || 0,
                        ng: Number(ws.ngCount) || 0,
                        ngRate: Number(ws.totalInspections) > 0 ? ((Number(ws.ngCount) || 0) / Number(ws.totalInspections) * 100) : 0,
                      }))}
                      onWorkstationClick={(ws) => {
                        setSelectedWorkstationForDrilldown({ id: ws.id, code: ws.code, name: ws.name });
                        setDrilldownDialogOpen(true);
                      }}
                    />
                  ) : (
                    <EmptyState
                      variant="no-analytics"
                      title={t("dashboard.noWorkstationData")}
                      description={t("dashboard.noWorkstationDataDesc")}
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
                    {t("dashboard.topNgPoints")}
                  </CardTitle>
                  <CardDescription>
                    {t("dashboard.topNgPointsDesc")}
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
                      title={t("dashboard.noPointData")}
                      description={t("dashboard.noPointDataDesc")}
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
              <LayoutGrid className="h-5 w-5 text-primary" />{t("dashboard.productionLineLayout")}</h2>
            <div className="flex items-center gap-2">
              {/* Machine Status Filter */}
              <Select value={machineStatusFilter} onValueChange={(v: "all" | "online" | "offline") => setMachineStatusFilter(v)}>
                <SelectTrigger className="w-35">
                  <SelectValue placeholder={t("common.status")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  <SelectItem value="online">
                    <span className="flex items-center gap-2">
                      <Wifi className="h-3 w-3 text-success" />
                      {t("dashboard.online")}
                    </span>
                  </SelectItem>
                  <SelectItem value="offline">
                    <span className="flex items-center gap-2">
                      <WifiOff className="h-3 w-3 text-destructive" />
                      {t("dashboard.offline")}
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
                <Settings2 className="h-4 w-4" />{t("dashboard.customizeMetrics")}</Button>
              <Badge variant="outline" className="text-muted-foreground">
                {machinesByLine.size} {t("dashboard.productionLines")} • {Array.from(machinesByLine.values()).flat().length} {t("dashboard.machines")}
              </Badge>
            </div>
          </div>

          {machinesLoading ? (
            <MachineGridSkeleton count={8} />
          ) : machinesByLine.size === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-12 text-center">
                <Cpu className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">{t("dashboard.noMachinesInFilter")}</p>
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
                // doc67 W7 GĐ2 — giữ SỐ, hiển thị qua fmtPct + tone qua yieldTone chung.
                const lineFpy = lineTotal > 0 ? (lineOk / lineTotal) * 100 : 0;
                
                // Get line info (product and production order)
                const lineId = machines[0]?.lineId;
                const lineAssignment = lineProductAssignments?.find(a => a.lineId === lineId && a.isActive);
                const productModel = productModels?.find((p: any) => p.id === lineAssignment?.productModelId);
                const productionOrder = productionOrders?.find(o => o.id === lineAssignment?.productionOrderId);

                return (
                  <Card key={lineName} className="glass-card overflow-hidden">
                    {/* Line Header */}
                    <div className="bg-linear-to-r from-primary/10 to-transparent border-b border-border/50 px-6 py-4">
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
                              {machines.length} {t("dashboard.machinesActive")}
                              {productModel && ` • ${productModel.name}`}
                            </p>
                          </div>
                        </div>
                        
                        {/* Line Summary Stats */}
                        <div className="flex items-center gap-6 text-sm">
                          <div className="text-center">
                            <p className="text-muted-foreground">{t("dashboard.output")}</p>
                            <p className="font-semibold text-foreground">{fmtInt(lineTotal)}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">{t("dashboard.fpy")}</p>
                            <p className={`font-semibold ${TONE_TEXT_CLASS[yieldTone(lineFpy)]}`}>
                              {fmtPct(lineFpy)}
                            </p>
                          </div>
                          <div className="text-center">
                            <p className="text-muted-foreground">{t("dashboard.okNgNtf")}</p>
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
                          const { fpy, ngPct, ntfPct } = calculateYields(machine);
                          const status = getStatusIndicator(fpy);
                          const StatusIcon = status.icon;
                          const machineImage = machine.image2DUrl || machine.image3DUrl || '/default-machine-2d.svg';

                          return (
                            <div
                              key={machine.id}
                              role="button"
                              tabIndex={0}
                              aria-label={`${t("common.details")}: ${machine.name}`}
                              className="relative rounded-xl cursor-pointer transition-all hover:shadow-xl hover:scale-[1.02] overflow-hidden bg-card border border-border/50 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              onClick={() => openMachineDetail(machine)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  openMachineDetail(machine);
                                }
                              }}
                            >
                              {/* Metrics Bar at Top - Customizable */}
                              <div className="flex items-stretch bg-muted text-foreground">
                                {visibleMetrics.fpy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-border/60">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">{t("dashboard.fpy")}</p>
                                    {/* doc67 W7 GĐ2 — yieldTone chung 95/90 (thay ternary local 90/70 trôi lệch) */}
                                    <p className={`text-base font-bold ${TONE_TEXT_CLASS[yieldTone(fpy)]}`}>
                                      {fmtPct(fpy)}
                                    </p>
                                  </div>
                                )}
                                {visibleMetrics.fy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-border/60">
                                    {/* doc65 W1 — giá trị là ng/total: nhãn trung thực "NG %" (trước đây ghi sai "FY") */}
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">NG %</p>
                                    <p className="text-base font-bold text-destructive">{fmtPct(ngPct)}</p>
                                  </div>
                                )}
                                {visibleMetrics.ntfy && (
                                  <div className="flex-1 text-center py-2 px-1 border-r border-border/60">
                                    {/* doc65 W1 — giá trị là ntf/total: nhãn trung thực "NTF %" (trước đây ghi sai "NTFY") */}
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">NTF %</p>
                                    <p className="text-base font-bold text-warning">{fmtPct(ntfPct)}</p>
                                  </div>
                                )}
                                {visibleMetrics.output && (
                                  <div className="flex-1 text-center py-2 px-1 relative">
                                    <p className="text-[10px] opacity-70 uppercase tracking-wider">{t("dashboard.output")}</p>
                                    <p className="text-base font-bold text-info">{fmtInt(machine.total)}</p>
                                  </div>
                                )}
                                {/* Status indicator */}
                                <div className="flex items-center px-2">
                                  <StatusIcon className={`h-4 w-4 ${status.color}`} />
                                </div>
                              </div>

                              {/* Machine Image - Large */}
                              <div className="relative h-40 w-full bg-linear-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
                                {machineImage ? (
                                  <>
                                    <img
                                      src={machineImage}
                                      alt={machine.name}
                                      className="w-full h-full object-contain p-2"
                                    />
                                    <div className="absolute inset-0 bg-linear-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
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
                                              ? 'bg-success/20 text-success'
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
                                          <p>{onlineMachines.has(machine.code) ? t("dashboard.online") : t("dashboard.offline")}</p>
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

          {/* Custom Dashboard Tab */}
          <TabsContent value="custom" className="space-y-6 mt-6">
            <CustomDashboardViewer />
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Machine Detail Modal */
      <Dialog open={machineDetailOpen} onOpenChange={setMachineDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              {selectedMachine?.name}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.machineCode")} {selectedMachine?.code} • {selectedMachine?.lineName}
            </DialogDescription>
          </DialogHeader>

          {/* Stats Boxes at Top - Clickable to filter */}
          {/* doc67 W4: grid-cols-2 dưới sm (4 ô nén trong dialog mobile) + 4 ô lọc bấm được bằng bàn phím */}
          {selectedMachine && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              <div
                role="button"
                tabIndex={0}
                aria-pressed={machineDialogStatusFilter === "all"}
                aria-label={`${t("dashboard.filterBy")}: ${t("dashboard.totalOutput")}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMachineDialogStatusFilter("all");
                  }
                }}
                className={`text-center p-4 rounded-lg cursor-pointer transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  machineDialogStatusFilter === "all"
                    ? "bg-primary/15 border-primary shadow-md scale-[1.02]"
                    : "bg-muted/30 border-transparent hover:bg-muted/50 hover:border-muted-foreground/20"
                }`}
                onClick={() => setMachineDialogStatusFilter("all")}
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("dashboard.totalOutput")}</p>
                <p className="text-2xl font-bold text-foreground">{selectedMachine.total}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  OK: {selectedMachine.ok} / NG: {selectedMachine.ng} / NTF: {selectedMachine.ntf}
                </p>
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={machineDialogStatusFilter === "OK"}
                aria-label={`${t("dashboard.filterBy")}: OK`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMachineDialogStatusFilter("OK");
                  }
                }}
                className={`text-center p-4 rounded-lg cursor-pointer transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  machineDialogStatusFilter === "OK"
                    ? "bg-success/20 border-success shadow-md scale-[1.02]"
                    : "bg-success/5 border-transparent hover:bg-success/10 hover:border-success/30"
                }`}
                onClick={() => setMachineDialogStatusFilter("OK")}
              >
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{t("dashboard.fpy")}</p>
                <p className="text-2xl font-bold text-success">
                  {fmtPct(calculateYields(selectedMachine).fpy)}
                </p>
                <p className="text-xs text-success/70 mt-1">{selectedMachine.ok} {t("common.items")}</p>
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={machineDialogStatusFilter === "NG"}
                aria-label={`${t("dashboard.filterBy")}: NG`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMachineDialogStatusFilter("NG");
                  }
                }}
                className={`text-center p-4 rounded-lg cursor-pointer transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  machineDialogStatusFilter === "NG"
                    ? "bg-destructive/20 border-destructive shadow-md scale-[1.02]"
                    : "bg-destructive/5 border-transparent hover:bg-destructive/10 hover:border-destructive/30"
                }`}
                onClick={() => setMachineDialogStatusFilter("NG")}
              >
                {/* doc65 W1 — nhãn trung thực: giá trị là ng/total (tỷ lệ NG), không phải "FY" */}
                <p className="text-xs text-muted-foreground uppercase tracking-wider">NG %</p>
                <p className="text-2xl font-bold text-destructive">
                  {fmtPct(calculateYields(selectedMachine).ngPct)}
                </p>
                <p className="text-xs text-destructive/70 mt-1">{selectedMachine.ng} {t("common.items")}</p>
              </div>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={machineDialogStatusFilter === "NTF"}
                aria-label={`${t("dashboard.filterBy")}: NTF`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMachineDialogStatusFilter("NTF");
                  }
                }}
                className={`text-center p-4 rounded-lg cursor-pointer transition-all border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  machineDialogStatusFilter === "NTF"
                    ? "bg-warning/20 border-warning shadow-md scale-[1.02]"
                    : "bg-warning/5 border-transparent hover:bg-warning/10 hover:border-warning/30"
                }`}
                onClick={() => setMachineDialogStatusFilter("NTF")}
              >
                {/* doc65 W1 — nhãn trung thực: giá trị là ntf/total (tỷ lệ NTF), không phải "NTFY" */}
                <p className="text-xs text-muted-foreground uppercase tracking-wider">NTF %</p>
                <p className="text-2xl font-bold text-warning">
                  {fmtPct(calculateYields(selectedMachine).ntfPct)}
                </p>
                <p className="text-xs text-warning/70 mt-1">{selectedMachine.ntf} {t("common.items")}</p>
              </div>
            </div>
          )}

          <Tabs defaultValue="overview" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="overview">{t("dashboard.overviewTab")}</TabsTrigger>
              <TabsTrigger value="recent">{t("dashboard.latestResults")}</TabsTrigger>
            </TabsList>

            {/* Overview Tab: 2-column layout - image left, chart right */}
            <TabsContent value="overview" className="space-y-4">
              {selectedMachine && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Machine Image */}
                  <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-linear-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 min-h-70">
                    {(selectedMachine.image2DUrl || selectedMachine.image3DUrl) ? (
                      <img
                        src={selectedMachine.image2DUrl || selectedMachine.image3DUrl || ''}
                        alt={selectedMachine.name}
                        className="max-h-62.5 w-full object-contain rounded-lg"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-muted-foreground gap-3">
                        <Cpu className="h-20 w-20 text-muted-foreground/30" />
                        <p className="text-sm">{t("dashboard.noMachineImage")}</p>
                      </div>
                    )}
                    <div className="mt-3 text-center">
                      <h4 className="font-semibold text-foreground">{selectedMachine.name}</h4>
                      <p className="text-xs text-muted-foreground">{selectedMachine.code} • {selectedMachine.stationName}</p>
                    </div>
                  </div>

                  {/* Right: Pie Chart + Bar breakdown */}
                  <div className="flex flex-col gap-4">
                    <div className="h-55 rounded-xl border border-border/50 bg-card p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: "OK", value: selectedMachine.ok, color: toneHex("success") },
                              { name: "NG", value: selectedMachine.ng, color: toneHex("danger") },
                              { name: "NTF", value: selectedMachine.ntf, color: toneHex("warning") },
                            ].filter(d => d.value > 0)}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={75}
                            paddingAngle={5}
                            dataKey="value"
                            label={({ name, value }) => `${name}: ${value}`}
                          >
                            {[
                              { name: "OK", value: selectedMachine.ok, color: toneHex("success") },
                              { name: "NG", value: selectedMachine.ng, color: toneHex("danger") },
                              { name: "NTF", value: selectedMachine.ntf, color: toneHex("warning") },
                            ].filter(d => d.value > 0).map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip contentStyle={chartTooltipStyle} />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    {/* Bar Chart showing OK/NG/NTF counts */}
                    <div className="h-30 rounded-xl border border-border/50 bg-card p-3">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[
                          { name: "OK", value: selectedMachine.ok, fill: toneHex("success") },
                          { name: "NG", value: selectedMachine.ng, fill: toneHex("danger") },
                          { name: "NTF", value: selectedMachine.ntf, fill: toneHex("warning") },
                        ]}>
                          <CartesianGrid {...chartGridProps} opacity={0.3} />
                          <XAxis dataKey="name" tick={chartAxisTick} axisLine={{ stroke: 'var(--border)' }} />
                          <YAxis tick={chartAxisTick} axisLine={{ stroke: 'var(--border)' }} />
                          <RechartsTooltip contentStyle={chartTooltipStyle} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {[
                              { name: "OK", value: selectedMachine.ok, fill: toneHex("success") },
                              { name: "NG", value: selectedMachine.ng, fill: toneHex("danger") },
                              { name: "NTF", value: selectedMachine.ntf, fill: toneHex("warning") },
                            ].map((entry, index) => (
                              <Cell key={`bar-${index}`} fill={entry.fill} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* Latest Results Tab: Filtered by status */}
            <TabsContent value="recent">
              {/* Active filter indicator */}
              {machineDialogStatusFilter !== "all" && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Badge variant="outline" className="gap-1">
                    {machineDialogStatusFilter === "OK" && <CheckCircle2 className="h-3 w-3 text-success" />}
                    {machineDialogStatusFilter === "NG" && <XCircle className="h-3 w-3 text-destructive" />}
                    {machineDialogStatusFilter === "NTF" && <AlertTriangle className="h-3 w-3 text-warning" />}
                    {t("dashboard.filterBy")}: {machineDialogStatusFilter}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setMachineDialogStatusFilter("all")}
                  >
                    {t("common.clear")}
                  </Button>
                </div>
              )}
              <ScrollArea className="h-100">
                <div className="space-y-2">
                  {filteredInspectionsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      {filteredInspections?.data?.map((inspection: InspectionResult) => (
                        <div
                          key={inspection.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`${t("common.details")}: ${inspection.serialNumber}`}
                          className="flex items-center justify-between p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/60 hover:shadow-sm transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(e) => {
                            // doc67 W4: kiosk/panel-PC chặn window.open — điều hướng in-app;
                            // desktop giữ Ctrl/Cmd+click để mở tab mới.
                            if (e.ctrlKey || e.metaKey) {
                              window.open(`/inspection/${inspection.id}`, '_blank');
                              return;
                            }
                            e.preventDefault();
                            setLocation(`/inspection/${inspection.id}`);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setLocation(`/inspection/${inspection.id}`);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="font-medium text-foreground group-hover:text-primary transition-colors">{inspection.serialNumber}</p>
                              <p className="text-xs text-muted-foreground">
                                {inspection.productModel} • {new Date(inspection.createdAt).toLocaleString('vi-VN')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge
                              status={inspection.overallResult}
                              map={{
                                OK: { variant: "default", className: "bg-success text-success-foreground" },
                                NG: { variant: "destructive" },
                                NTF: { variant: "secondary", className: "bg-warning text-warning-foreground" },
                              }}
                            />
                            <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      ))}
                      {(!filteredInspections?.data || filteredInspections.data.length === 0) && (
                        <div className="text-center py-8">
                          <p className="text-muted-foreground">{t("dashboard.noInspectionResults")}</p>
                          {machineDialogStatusFilter !== "all" && (
                            <Button
                              variant="link"
                              size="sm"
                              className="mt-2"
                              onClick={() => setMachineDialogStatusFilter("all")}
                            >
                              {t("dashboard.showAllResults")}
                            </Button>
                          )}
                        </div>
                      )}
                      {filteredInspections?.total && filteredInspections.total > 50 && (
                        <p className="text-center text-xs text-muted-foreground py-2">
                          {t("dashboard.showingOf", { showing: filteredInspections.data?.length || 0, total: filteredInspections.total })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      }
      {/* Metrics Settings Dialog */}
      <Dialog open={metricsSettingsOpen} onOpenChange={setMetricsSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />{t("dashboard.customizeMetricsTitle")}</DialogTitle>
            <DialogDescription>{t("dashboard.customizeMetricsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center">
                  <Target className="h-4 w-4 text-success" />
                </div>
                <div>
                  <p className="font-medium">{t("dashboard.fpyFullName")}</p>
                  <p className="text-xs text-muted-foreground">{t("dashboard.fpyDescription")}</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.fpy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, fpy: !prev.fpy }))}
              >
                {visibleMetrics.fpy ? t("dashboard.shown") : t("dashboard.hidden")}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center">
                  <ThumbsDown className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  {/* doc65 W1 — nhãn trung thực khớp thẻ máy: chỉ số này là tỷ lệ NG (ng/total) */}
                  <p className="font-medium">NG % — Tỷ lệ NG</p>
                  <p className="text-xs text-muted-foreground">Số bo NG / tổng số kiểm tra trên máy</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.fy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, fy: !prev.fy }))}
              >
                {visibleMetrics.fy ? t("dashboard.shown") : t("dashboard.hidden")}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                </div>
                <div>
                  {/* doc65 W1 — nhãn trung thực khớp thẻ máy: chỉ số này là tỷ lệ NTF (ntf/total) */}
                  <p className="font-medium">NTF % — Tỷ lệ NTF</p>
                  <p className="text-xs text-muted-foreground">Số bo NTF (lỗi ảo) / tổng số kiểm tra trên máy</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.ntfy ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, ntfy: !prev.ntfy }))}
              >
                {visibleMetrics.ntfy ? t("dashboard.shown") : t("dashboard.hidden")}
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-info/20 flex items-center justify-center">
                  <BarChart3 className="h-4 w-4 text-info" />
                </div>
                <div>
                  <p className="font-medium">{t("dashboard.outputLabel")}</p>
                  <p className="text-xs text-muted-foreground">{t("dashboard.outputDescription")}</p>
                </div>
              </div>
              <Button
                variant={visibleMetrics.output ? "default" : "outline"}
                size="sm"
                onClick={() => setVisibleMetrics(prev => ({ ...prev, output: !prev.output }))}
              >
                {visibleMetrics.output ? t("dashboard.shown") : t("dashboard.hidden")}
              </Button>
            </div>
          </div>
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisibleMetrics({ fpy: true, fy: true, ntfy: true, output: true })}
            >{t("dashboard.resetDefault")}</Button>
            <Button
              onClick={() => setMetricsSettingsOpen(false)}
            >{t("dashboard.done")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Workstation Drilldown Dialog */}
      <Dialog open={drilldownDialogOpen} onOpenChange={setDrilldownDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5 text-primary" />
              {t("dashboard.workstationDetail")} {selectedWorkstationForDrilldown?.name}
            </DialogTitle>
            <DialogDescription>
              {t("dashboard.stationCode")} {selectedWorkstationForDrilldown?.code} • {t("dashboard.dataFrom")} {ngTimeFilter === "day" ? t("dashboard.todayPeriod") : ngTimeFilter === "week" ? t("dashboard.7daysPeriod") : t("dashboard.30daysPeriod")}
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
                    if (rate <= 2) return "text-success bg-success/10 border-success/30";
                    if (rate <= 5) return "text-warning bg-warning/10 border-warning/30";
                    // doc67 W7 GĐ2 — bậc 3/4 thang NG: token --alarm-high (cam ISA-18.2 P2,
                    // theme-aware) thay orange-500 hardcode; khớp chú giải tab NG trực quan.
                    if (rate <= 10) return "text-(--alarm-high) bg-(--alarm-high)/10 border-(--alarm-high)/30";
                    return "text-destructive bg-destructive/10 border-destructive/30";
                  };
                  return (
                    <div key={mp.measurementPointId} className={`p-4 rounded-lg border ${getNGColorClass(ngRate)}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="font-semibold">{mp.measurementPointCode}</p>
                          <p className="text-sm text-muted-foreground">{mp.measurementPointName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold">{fmtPct(ngRate)}</p>
                          <p className="text-xs text-muted-foreground">{t("dashboard.ngRate")}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-sm">
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold">{mp.totalCount}</p>
                          <p className="text-xs text-muted-foreground">{t("common.total")}</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-success">{mp.okCount}</p>
                          <p className="text-xs text-muted-foreground">OK</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-destructive">{mp.ngCount}</p>
                          <p className="text-xs text-muted-foreground">NG</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded">
                          <p className="font-semibold text-warning">{mp.ntfCount}</p>
                          <p className="text-xs text-muted-foreground">NTF</p>
                        </div>
                      </div>
                      {(mp.lowerLimit !== null || mp.upperLimit !== null) && (
                        <div className="mt-2 pt-2 border-t border-border/30 text-xs text-muted-foreground">
                          <span>{t("dashboard.limit")} </span>
                          {mp.lowerLimit !== null && <span>{t("dashboard.min")}: {mp.lowerLimit}</span>}
                          {mp.lowerLimit !== null && mp.upperLimit !== null && <span> - </span>}
                          {mp.upperLimit !== null && <span>{t("dashboard.max")}: {mp.upperLimit}</span>}
                          {mp.unit && <span> ({mp.unit})</span>}
                          {mp.avgValue !== 0 && <span className="ml-4">{t("dashboard.avg")}: {mp.avgValue.toFixed(2)}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                variant="no-analytics"
                title={t("dashboard.noMeasurementPoints")}
                description={t("dashboard.noMeasurementPointsDesc")}
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
// doc67 W6 [P1-2] — socket live: ngừng poll 30s, 2 query này được root invalidate
// theo nhịp socket (~60s); chỉ poll khi socket rớt. memo: chỉ re-render khi
// socketConnected đổi (props duy nhất) thay vì theo mọi render của root.
const MqttAlertWidget = memo(function MqttAlertWidget({ socketConnected }: { socketConnected: boolean }) {
  const { t } = useTranslation();
  // Rule-based alerts
  // doc65 W2 (AUD-01) — widget poll 30s nhưng trước đây KHÔNG khai tuổi dữ liệu;
  // lấy dataUpdatedAt/isFetching để gắn PollFreshness ở header widget.
  const {
    data: unresolvedAlerts,
    dataUpdatedAt: ruleAlertsUpdatedAt,
    isFetching: ruleAlertsFetching,
  } = trpc.mqttAlert.unresolved.useQuery(undefined, {
    refetchInterval: socketConnected ? false : 30000,
  });

  // Connection alerts from scheduler
  const {
    data: connectionAlerts,
    dataUpdatedAt: connAlertsUpdatedAt,
    isFetching: connAlertsFetching,
  } = trpc.mqttClientManagement.getAlertWidgetData.useQuery(undefined, {
    refetchInterval: socketConnected ? false : 30000,
  });

  // Mốc mới nhất giữa hai query của widget (poll 30s → ngưỡng cũ mặc định 60s).
  const alertsUpdatedAt = Math.max(ruleAlertsUpdatedAt || 0, connAlertsUpdatedAt || 0) || undefined;

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
    <Card className={`glass-card ${hasCritical ? 'border-destructive/50 bg-destructive/5' : 'border-warning/50 bg-warning/5'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${hasCritical ? 'text-destructive' : 'text-warning'}`} />
            {t("dashboard.mqttAlerts")}
            <div className="flex gap-1 ml-2">
              {(connectionAlerts?.critical || 0) > 0 && (
                <Badge variant="destructive">{connectionAlerts?.critical} {t("dashboard.criticalLabel")}</Badge>
              )}
              {(connectionAlerts?.warning || 0) > 0 && (
                <Badge variant="outline" className="border-warning text-warning">{connectionAlerts?.warning} {t("dashboard.warningLabel")}</Badge>
              )}
              {totalRuleAlerts > 0 && (
                <Badge variant="secondary">{totalRuleAlerts} {t("dashboard.rulesLabel")}</Badge>
              )}
            </div>
            {/* doc65 W2 (AUD-01) — tuổi dữ liệu widget. doc67 W6 [P1-2]: socket live
                → làm mới theo nhịp socket-invalidate ~60s ⇒ ngưỡng cũ 2× = 120s;
                socket rớt → poll 30s ⇒ ngưỡng mặc định 60s như cũ. */}
            <PollFreshness
              updatedAt={alertsUpdatedAt}
              isFetching={ruleAlertsFetching || connAlertsFetching}
              staleAfterMs={socketConnected ? 120_000 : 60_000}
              className="ml-1 font-normal"
            />
          </CardTitle>
          <div className="flex gap-2">
            <Link href="/mqtt-profiles?tab=alerts">
              <Button variant="outline" size="sm">
                {t("dashboard.connectionAlerts")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link href="/mqtt-alerts">
              <Button variant="outline" size="sm">
                {t("dashboard.ruleAlerts")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
        <CardDescription>{t("dashboard.unresolvedMqttAlerts", { total: totalAlerts })}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {combinedAlerts.slice(0, 5).map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 p-3 rounded-lg bg-background/50 border ${
                alert.severity === 'critical' ? 'border-destructive/20' : 'border-warning/20'
              }`}
            >
              <div className="mt-0.5">
                <AlertTriangle className={`w-4 h-4 ${
                  alert.severity === 'critical' ? 'text-destructive' : 'text-warning'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{alert.title}</p>
                  <Badge variant="outline" className="text-xs">
                    {alert.type === 'rule' ? t("dashboard.ruleType") : t("dashboard.connectionType")}
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
              {t("dashboard.moreAlerts", { count: combinedAlerts.length - 5 })}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// doc67 W6 [P1-3] — HeaderRealtimePulse: RealtimeBadge ở header cần mốc push
// oee:update gần nhất. Tách khỏi root để mỗi nhịp đẩy (~60s) chỉ re-render badge
// nhỏ này thay vì cả cây Dashboard ~3400 dòng (trước đây setLastRealtimeAt ở gốc).
const HeaderRealtimePulse = memo(function HeaderRealtimePulse({ connected }: { connected: boolean }) {
  const [lastRealtimeAt, setLastRealtimeAt] = useState<Date | null>(null);

  useEffect(() => {
    const socket = getSharedSocket();
    const onOeeUpdate = () => setLastRealtimeAt(new Date());
    socket.on('oee:update', onOeeUpdate);
    return () => {
      socket.off('oee:update', onOeeUpdate);
      releaseSharedSocket();
    };
  }, []);

  return <RealtimeBadge connected={connected} pollingFallback lastEventAt={lastRealtimeAt} />;
});

// doc67 W6 [P1-3] — LiveOeeWidget: widget OEE sở hữu state liveOEE/lastRealtimeAt
// riêng + tự subscribe socket 'oee:update' (root chỉ truyền socketConnected +
// cardStyleProps đã memo). Query getAllOEE (fallback first-paint / socket rớt)
// cũng dời vào đây. Logic dữ liệu GIỮ NGUYÊN từ bản root (normalize mọi shape,
// honest null — không bịa factor).
const LiveOeeWidget = memo(function LiveOeeWidget({
  socketConnected,
  cardStyleProps,
}: {
  socketConnected: boolean;
  cardStyleProps: { style: CSSProperties; className: string; accentColor: string; textColor: string };
}) {
  const { t } = useTranslation();
  const [liveOEE, setLiveOEE] = useState<LiveOEERow[] | null>(null);
  const [lastRealtimeAt, setLastRealtimeAt] = useState<Date | null>(null);

  useEffect(() => {
    const socket = getSharedSocket();

    // Live OEE push — single source of truth (oeeService). The broadcaster sends
    // { metrics, at }; the legacy per-machine path may send a raw array/object.
    // Normalize all shapes; honour honest nulls (never synthesize a factor).
    const onOeeUpdate = (payload: any) => {
      const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.metrics)
          ? payload.metrics
          : payload && typeof payload === 'object' && payload.machineId != null
            ? [payload]
            : [];
      if (raw.length === 0) return;
      const rows: LiveOEERow[] = raw.map((m: any) => ({
        machineId: m.machineId,
        machineCode: m.machineCode ?? String(m.machineId),
        availability: m.availability ?? null,
        performance: m.performance ?? null,
        quality: m.quality ?? null,
        oee: m.oee ?? null,
      }));
      setLiveOEE((prev) => {
        // Merge per-machine updates over the existing live snapshot.
        const byId = new Map<number, LiveOEERow>((prev ?? []).map((r) => [r.machineId, r]));
        for (const r of rows) byId.set(r.machineId, r);
        return Array.from(byId.values()).sort((a, b) => a.machineId - b.machineId);
      });
      setLastRealtimeAt(new Date());
    };

    socket.on('oee:update', onOeeUpdate);
    return () => {
      socket.off('oee:update', onOeeUpdate);
      releaseSharedSocket();
    };
  }, []);

  // Fetch live OEE metrics — first-load fallback when no socket push has arrived
  // yet. Once oee:update pushes arrive (socketConnected), we stop polling and
  // rely on the realtime stream.
  const { data: allOEE } = trpc.mqttClient.getAllOEE.useQuery(undefined, {
    refetchInterval: socketConnected ? false : 30000,
  });

  // Effective OEE: prefer the realtime socket stream (oee:update), fall back to
  // the query for the first paint. No synthetic values — null factors stay null.
  const effectiveOEE = useMemo<LiveOEERow[]>(() => {
    if (liveOEE && liveOEE.length > 0) return liveOEE;
    const q = allOEE as LiveOEERow[] | undefined;
    return Array.isArray(q) ? q : [];
  }, [liveOEE, allOEE]);

  const oeeIsLive = !!(socketConnected && liveOEE && liveOEE.length > 0);

  if (effectiveOEE.length === 0) return null;

  const oeeData = effectiveOEE;
  // Average only over machines that actually have each factor (honest).
  const avgOf = (sel: (m: LiveOEERow) => number | null): number | null => {
    const vals = oeeData.map(sel).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const avgA = avgOf((m) => m.availability);
  const avgP = avgOf((m) => m.performance);
  const avgQ = avgOf((m) => m.quality);
  const avgOEE = avgOf((m) => m.oee);
  // doc67 W7 GĐ2 — tone OEE theo oeeTone chung 80/60 (QUYẾT ĐỊNH #2: ngưỡng success
  // đổi 85→80 CHỦ ĐÍCH, khớp PanelShell) + fmtPct chung (null → '—' thay "N/A").
  const oeeClass = (v: number | null) => TONE_TEXT_CLASS[oeeTone(v)];
  const fmt = (v: number | null) => fmtPct(v);

  return (
    <Card className={cardStyleProps.className} style={cardStyleProps.style}>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: cardStyleProps.accentColor }} />
          {t("dashboard.oeeTitle", "OEE — Overall Equipment Effectiveness")}
          <RealtimeBadge connected={oeeIsLive} pollingFallback lastEventAt={oeeIsLive ? lastRealtimeAt : null} />
        </CardTitle>
        <a href="/oee-dashboard" className="text-xs text-muted-foreground hover:underline">{t("common.viewAll", "Xem tất cả")}</a>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Aggregate 4-card OEE cluster */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { label: t("dashboard.oeeAvailability", "Availability"), value: avgA, icon: "A" },
            { label: t("dashboard.oeePerformance", "Performance"), value: avgP, icon: "P" },
            { label: t("dashboard.oeeQuality", "Quality"), value: avgQ, icon: "Q" },
            { label: "OEE", value: avgOEE, icon: "OEE" },
          ] as const).map((item) => (
            <a key={item.icon} href="/oee-dashboard" className="rounded-xl border bg-card p-3 text-center hover:shadow-md transition-shadow cursor-pointer block">
              <p className="text-xs text-muted-foreground font-medium">{item.icon}</p>
              <p className={cn("text-2xl font-bold mt-1", oeeClass(item.value))}>{fmt(item.value)}</p>
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
            </a>
          ))}
        </div>
        {/* Per-machine detail grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {oeeData.map((m) => {
            return (
              <div key={m.machineId} className="rounded-lg border p-2 space-y-1">
                <p className="text-xs font-medium truncate" title={m.machineCode}>{m.machineCode}</p>
                <p className={cn("text-xl font-bold", oeeClass(m.oee))}>{fmt(m.oee)}</p>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <div className="flex justify-between"><span>A</span><span>{fmt(m.availability)}</span></div>
                  <div className="flex justify-between"><span>P</span><span>{fmt(m.performance)}</span></div>
                  <div className="flex justify-between"><span>Q</span><span>{fmt(m.quality)}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
});
