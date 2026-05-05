import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { 
  Search, 
  Filter, 
  ChevronLeft, 
  ChevronRight,
  Eye,
  Calendar,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  History as HistoryIcon,
  Download,
  Loader2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  PieChart,
  Target,
  Activity,
  Brain,
  Lightbulb,
  ArrowUp,
  ArrowDown,
  Minus,
  FileText,
  Columns,
  Save,
  Clock,
  RefreshCw,
  Settings2,
  QrCode,
  FileSpreadsheet,
  Factory,
  GitCompare,
  Image,
  Trash2,
  CheckCheck,
  X,
  SquareCheck
} from "lucide-react";
import { LayoutGrid, List } from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";
import ImageGallery, { GalleryImage } from "@/components/ImageGallery";
import { EmptyState, NoWorkstationData, NoChartData } from "@/components/EmptyState";
import HistoryComparison from "@/components/HistoryComparison";
import { AnnotationSearch } from "@/components/AnnotationSearch";
import { ChartErrorBoundary, TableErrorBoundary, AnalyticsErrorBoundary } from "@/components/ErrorBoundary";
import { StatsCardSkeleton, ChartSkeleton, TableSkeleton, WorkstationSummarySkeleton } from "@/components/AnalyticsSkeleton";
import { toast } from "sonner";
import { navItems } from "@/lib/navigation";
import { useState, useMemo, useCallback } from "react";
import { HistoryInfiniteScroll } from "@/components/HistoryInfiniteScroll";
import { Link } from "wouter";
import { format as formatDate, subDays, startOfDay, endOfDay } from "date-fns";
import { vi } from "date-fns/locale";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, ScatterChart, Scatter, ZAxis } from "recharts";

export default function History() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState({
    factoryCode: "",
    workshopCode: "",
    lineCode: "",
    stationCode: "",
    machineCode: "",
    serialNumber: "",
    productModel: "",
    result: "all" as "all" | "OK" | "NG" | "NTF",
    dateRange: "all" as "all" | "today" | "week" | "month" | "custom",
    startDate: "",
    endDate: "",
  });
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("list");
  const [workstationDateRange, setWorkstationDateRange] = useState("all" as "all" | "today" | "week" | "month" | "custom");
  const [workstationStartDate, setWorkstationStartDate] = useState("");
  const [workstationEndDate, setWorkstationEndDate] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [analysisLimit, setAnalysisLimit] = useState(100);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [listViewMode, setListViewMode] = useState<"card" | "table">("card");
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    serialNumber: true,
    machine: true,
    result: true,
    time: true,
    productModel: true,
    factory: false,
    workshop: false,
    line: false,
    station: false,
    okCount: false,
    ngCount: false,
    ntfCount: false,
  });
  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [isBulkAcknowledging, setIsBulkAcknowledging] = useState(false);

  const [savedFilters, setSavedFilters] = useState<Array<{
    name: string;
    filters: typeof filters;
  }>>([
    { name: t("history.filterNgToday"), filters: { ...filters, result: "NG" as const, dateRange: "today" as const } },
    { name: t("history.filterThisWeek"), filters: { ...filters, dateRange: "week" as const } },
  ]);

  type RecentSearch = { label: string; filters: typeof filters; ts: number };
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => {
    try {
      const saved = localStorage.getItem('history_recent_searches');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const limit = pageSize;

  // Calculate date range for workstation filter
  const workstationDateRangeValues = useMemo(() => {
    const now = new Date();
    switch (workstationDateRange) {
      case "today":
        return {
          startDate: startOfDay(now),
          endDate: endOfDay(now),
        };
      case "week":
        return {
          startDate: startOfDay(subDays(now, 7)),
          endDate: endOfDay(now),
        };
      case "month":
        return {
          startDate: startOfDay(subDays(now, 30)),
          endDate: endOfDay(now),
        };
      case "custom":
        return {
          startDate: workstationStartDate ? new Date(workstationStartDate) : undefined,
          endDate: workstationEndDate ? endOfDay(new Date(workstationEndDate)) : undefined,
        };
      default:
        return { startDate: undefined, endDate: undefined };
    }
  }, [workstationDateRange, workstationStartDate, workstationEndDate]);

  // Calculate date range based on selection
  const dateRangeValues = useMemo(() => {
    const now = new Date();
    switch (filters.dateRange) {
      case "today":
        return {
          startDate: startOfDay(now),
          endDate: endOfDay(now),
        };
      case "week":
        return {
          startDate: startOfDay(subDays(now, 7)),
          endDate: endOfDay(now),
        };
      case "month":
        return {
          startDate: startOfDay(subDays(now, 30)),
          endDate: endOfDay(now),
        };
      case "custom":
        return {
          startDate: filters.startDate ? new Date(filters.startDate) : undefined,
          endDate: filters.endDate ? endOfDay(new Date(filters.endDate)) : undefined,
        };
      default:
        return { startDate: undefined, endDate: undefined };
    }
  }, [filters.dateRange, filters.startDate, filters.endDate]);

  const { data, isLoading, refetch } = trpc.inspection.search.useQuery({
    factoryCode: filters.factoryCode || undefined,
    workshopCode: filters.workshopCode || undefined,
    lineCode: filters.lineCode || undefined,
    stationCode: filters.stationCode || undefined,
    machineCode: filters.machineCode || undefined,
    serialNumber: filters.serialNumber || undefined,
    productModel: filters.productModel || undefined,
    result: filters.result !== "all" ? filters.result : undefined,
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
    limit,
    offset: (page - 1) * limit,
  });

  // Fetch all data for analysis (no pagination)
  const { data: allData } = trpc.inspection.search.useQuery({
    factoryCode: filters.factoryCode || undefined,
    workshopCode: filters.workshopCode || undefined,
    lineCode: filters.lineCode || undefined,
    stationCode: filters.stationCode || undefined,
    machineCode: filters.machineCode || undefined,
    serialNumber: filters.serialNumber || undefined,
    productModel: filters.productModel || undefined,
    result: filters.result !== "all" ? filters.result : undefined,
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
    limit: analysisLimit, // Progressive loading for analysis
    offset: 0,
  });

  const { data: machines } = trpc.machine.list.useQuery();

  // Fetch top NG measurement points
  const { data: topNGPoints } = trpc.inspection.topNGPoints.useQuery({
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
    limit: 10,
  });

  // Fetch AI analysis data
  const { data: aiAnalysis, isLoading: isLoadingAI } = trpc.inspection.aiAnalysis.useQuery({
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
  });

  const { data: defectClusters } = trpc.inspection.defectPatternClusters.useQuery({
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
  });

  // Fetch gallery images (with measurement results that have images)
  const { data: galleryData, isLoading: isLoadingGallery } = trpc.inspection.gallery.useQuery({
    factoryCode: filters.factoryCode || undefined,
    workshopCode: filters.workshopCode || undefined,
    lineCode: filters.lineCode || undefined,
    stationCode: filters.stationCode || undefined,
    machineCode: filters.machineCode || undefined,
    serialNumber: filters.serialNumber || undefined,
    productModel: filters.productModel || undefined,
    result: filters.result !== "all" ? filters.result : undefined,
    startDate: dateRangeValues.startDate,
    endDate: dateRangeValues.endDate,
    limit: 200,
    offset: 0,
  });

  // Fetch workstation data
  const { data: workstationData } = trpc.workstation.defectsByWorkstation.useQuery({
    startDate: workstationDateRangeValues.startDate,
    endDate: workstationDateRangeValues.endDate,
  });

  // Fetch top NG measurement points by workstation
  const { data: topNGByWorkstation } = trpc.workstation.topNGMeasurementPoints.useQuery({
    startDate: workstationDateRangeValues.startDate,
    endDate: workstationDateRangeValues.endDate,
    limit: 10,
  });

  // Fetch workstation summary with date filter
  const { data: workstationSummaryFiltered } = trpc.workstation.summary.useQuery({
    startDate: workstationDateRangeValues.startDate,
    endDate: workstationDateRangeValues.endDate,
  });

  const totalPages = useMemo(() => {
    if (!data?.total) return 1;
    return Math.ceil(data.total / limit);
  }, [data?.total]);

  // Calculate analysis statistics
  const analysisStats = useMemo(() => {
    if (!allData?.data || allData.data.length === 0) {
      return null;
    }

    const inspections = allData.data;
    const total = inspections.length;
    const okCount = inspections.filter((i: any) => i.overallResult === "OK").length;
    const ngCount = inspections.filter((i: any) => i.overallResult === "NG").length;
    const ntfCount = inspections.filter((i: any) => i.overallResult === "NTF").length;
    const yieldRate = total > 0 ? ((okCount + ntfCount) / total * 100) : 0;

    // Group by machine
    const machineStats: Record<string, { ok: number; ng: number; ntf: number; total: number; name: string }> = {};
    inspections.forEach((i: any) => {
      const machineId = i.machineId;
      const machineName = machines?.find(m => m.id === machineId)?.name || `Machine #${machineId}`;
      if (!machineStats[machineId]) {
        machineStats[machineId] = { ok: 0, ng: 0, ntf: 0, total: 0, name: machineName };
      }
      machineStats[machineId].total++;
      if (i.overallResult === "OK") machineStats[machineId].ok++;
      else if (i.overallResult === "NG") machineStats[machineId].ng++;
      else if (i.overallResult === "NTF") machineStats[machineId].ntf++;
    });

    // Group by date
    const dateStats: Record<string, { ok: number; ng: number; ntf: number; total: number }> = {};
    inspections.forEach((i: any) => {
      const date = formatDate(new Date(i.inspectionTime), "dd/MM");
      if (!dateStats[date]) {
        dateStats[date] = { ok: 0, ng: 0, ntf: 0, total: 0 };
      }
      dateStats[date].total++;
      if (i.overallResult === "OK") dateStats[date].ok++;
      else if (i.overallResult === "NG") dateStats[date].ng++;
      else if (i.overallResult === "NTF") dateStats[date].ntf++;
    });

    // Group by product model
    const productStats: Record<string, { ok: number; ng: number; ntf: number; total: number }> = {};
    inspections.forEach((i: any) => {
      const model = i.productModel || t("common.unknown");
      if (!productStats[model]) {
        productStats[model] = { ok: 0, ng: 0, ntf: 0, total: 0 };
      }
      productStats[model].total++;
      if (i.overallResult === "OK") productStats[model].ok++;
      else if (i.overallResult === "NG") productStats[model].ng++;
      else if (i.overallResult === "NTF") productStats[model].ntf++;
    });

    return {
      total,
      okCount,
      ngCount,
      ntfCount,
      yieldRate,
      machineStats: Object.entries(machineStats).map(([id, stats]) => ({
        id,
        ...stats,
        yieldRate: stats.total > 0 ? ((stats.ok + stats.ntf) / stats.total * 100) : 0,
      })),
      dateStats: Object.entries(dateStats).map(([date, stats]) => ({
        date,
        ...stats,
        yieldRate: stats.total > 0 ? ((stats.ok + stats.ntf) / stats.total * 100) : 0,
      })).slice(-14), // Last 14 days
      productStats: Object.entries(productStats).map(([model, stats]) => ({
        model,
        ...stats,
        yieldRate: stats.total > 0 ? ((stats.ok + stats.ntf) / stats.total * 100) : 0,
      })),
    };
  }, [allData?.data, machines]);

  // Load more data for analysis
  const handleLoadMore = () => {
    if (analysisLimit < 1000) {
      setIsLoadingMore(true);
      setAnalysisLimit(prev => Math.min(prev + 200, 1000));
      setTimeout(() => setIsLoadingMore(false), 500);
    }
  };

  const canLoadMore = allData?.total && allData.total > analysisLimit && analysisLimit < 1000;

  const handleSearch = () => {
    setPage(1);
    refetch();

    // Build a label from active filters
    const parts: string[] = [];
    if (filters.result !== "all") parts.push(filters.result);
    if (filters.dateRange !== "all") parts.push(filters.dateRange);
    if (filters.factoryCode) parts.push(filters.factoryCode);
    if (filters.machineCode) parts.push(filters.machineCode);
    if (filters.serialNumber) parts.push(`SN:${filters.serialNumber}`);
    if (filters.productModel) parts.push(filters.productModel);
    if (parts.length === 0) return; // don't save empty searches

    const label = parts.join(", ");
    const entry: RecentSearch = { label, filters: { ...filters }, ts: Date.now() };
    const updated = [entry, ...recentSearches.filter(r => r.label !== label)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('history_recent_searches', JSON.stringify(updated));
  };

  const handleClearFilters = () => {
    setFilters({
      factoryCode: "",
      workshopCode: "",
      lineCode: "",
      stationCode: "",
      machineCode: "",
      serialNumber: "",
      productModel: "",
      result: "all",
      dateRange: "all",
      startDate: "",
      endDate: "",
    });
    setPage(1);
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportExcel = async () => {
    if (!data?.data || data.data.length === 0) {
      toast.error(t("history.noDataToExport"));
      return;
    }

    setIsExporting(true);
    try {
      const headers = [
        t("history.csvStt"),
        t("history.csvSnCode"),
        t("history.csvFactoryCode"),
        t("history.csvWorkshopCode"),
        t("history.csvLine"),
        t("history.csvWorkstation"),
        t("history.csvMachine"),
        t("history.csvMachineType"),
        t("history.csvProductCode"),
        t("history.csvResult"),
        t("history.csvTotalPoints"),
        "OK",
        "NG",
        "NTF",
        t("history.csvYieldRate"),
        t("history.csvInspectionTime"),
        t("history.csvRemarks")
      ];

      const rows = data.data.map((inspection: any, index: number) => {
        const okCount = inspection.okCount || 0;
        const ngCount = inspection.ngCount || 0;
        const ntfCount = inspection.ntfCount || 0;
        const total = okCount + ngCount + ntfCount;
        const yieldRate = total > 0 ? ((okCount + ntfCount) / total * 100).toFixed(2) : "0.00";
        
        return [
          index + 1,
          inspection.serialNumber,
          inspection.factoryCode || "-",
          inspection.workshopCode || "-",
          inspection.lineCode || "-",
          inspection.stationCode || "-",
          inspection.machineCode || "-",
          inspection.machineType || "-",
          inspection.productModelCode || "-",
          inspection.overallResult,
          total,
          okCount,
          ngCount,
          ntfCount,
          yieldRate,
          formatDate(new Date(inspection.inspectedAt), "dd/MM/yyyy HH:mm:ss"),
          inspection.remarks || "-"
        ];
      });

      const BOM = "\uFEFF";
      const csvContent = BOM + [
        headers.join(","),
        ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `inspection_history_${formatDate(new Date(), "yyyyMMdd_HHmmss")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(t("history.exportedRecords", { count: data.data.length }));
    } catch (error) {
      console.error("Export error:", error);
      toast.error(t("history.exportError"));
    } finally {
      setIsExporting(false);
    }
  };

  // Bulk selection handlers
  const handleSelectItem = useCallback((id: number, checked: boolean) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!data?.data) return;
    if (isSelectAll) {
      setSelectedIds(new Set());
      setIsSelectAll(false);
    } else {
      const allIds = new Set(data.data.map((i: any) => i.id));
      setSelectedIds(allIds);
      setIsSelectAll(true);
    }
  }, [data?.data, isSelectAll]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectAll(false);
  }, []);

  // Bulk Export function
  const handleBulkExport = async () => {
    if (selectedIds.size === 0) {
      toast.error(t("history.pleaseSelectAtLeast1"));
      return;
    }

    setIsBulkExporting(true);
    try {
      const selectedData = data?.data?.filter((i: any) => selectedIds.has(i.id)) || [];
      
      const headers = [
        t("history.csvStt"),
        t("history.csvSnCode"),
        t("history.csvFactoryCode"),
        t("history.csvWorkshopCode"),
        t("history.csvLine"),
        t("history.csvWorkstation"),
        t("history.csvMachine"),
        t("history.csvMachineType"),
        t("history.csvProductCode"),
        t("history.csvResult"),
        t("history.csvTotalPoints"),
        "OK",
        "NG",
        "NTF",
        t("history.csvYieldRate"),
        t("history.csvInspectionTime"),
        t("history.csvRemarks")
      ];

      const rows = selectedData.map((inspection: any, index: number) => {
        const okCount = inspection.okCount || 0;
        const ngCount = inspection.ngCount || 0;
        const ntfCount = inspection.ntfCount || 0;
        const total = okCount + ngCount + ntfCount;
        const yieldRate = total > 0 ? ((okCount + ntfCount) / total * 100).toFixed(2) : "0.00";
        
        return [
          index + 1,
          inspection.serialNumber,
          inspection.factoryCode || "-",
          inspection.workshopCode || "-",
          inspection.lineCode || "-",
          inspection.stationCode || "-",
          inspection.machineCode || "-",
          inspection.machineType || "-",
          inspection.productModelCode || "-",
          inspection.overallResult,
          total,
          okCount,
          ngCount,
          ntfCount,
          yieldRate,
          formatDate(new Date(inspection.inspectedAt), "dd/MM/yyyy HH:mm:ss"),
          inspection.remarks || "-"
        ];
      });

      const BOM = "\uFEFF";
      const csvContent = BOM + [
        headers.join(","),
        ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `bulk_export_${selectedIds.size}_records_${formatDate(new Date(), "yyyyMMdd_HHmmss")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(t("history.exportedRecords", { count: selectedIds.size }));
      handleClearSelection();
    } catch (error) {
      console.error("Bulk export error:", error);
      toast.error(t("history.bulkExportError"));
    } finally {
      setIsBulkExporting(false);
    }
  };

  // Bulk Acknowledge function
  const handleBulkAcknowledge = async () => {
    if (selectedIds.size === 0) {
      toast.error(t("history.pleaseSelectAtLeast1"));
      return;
    }

    setIsBulkAcknowledging(true);
    try {
      // Simulate acknowledge action - in real app, this would call an API
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success(t("history.acknowledgedRecords", { count: selectedIds.size }));
      handleClearSelection();
      refetch();
    } catch (error) {
      console.error("Bulk acknowledge error:", error);
      toast.error(t("history.acknowledgeError"));
    } finally {
      setIsBulkAcknowledging(false);
    }
  };

  // Export Yield Report function
  const exportYieldReport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!analysisStats) {
      toast.error(t("history.noYieldData"));
      return;
    }

    setIsExporting(true);
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `yield_report_${dateStr}`;

      // Prepare data
      const headers = [
        t("history.yieldDate"),
        t("history.yieldTotalProducts"),
        "OK",
        "NG", 
        "NTF",
        "FPY (%)",
        "Fail Rate (%)",
        "NTF Rate (%)",
        "UPH"
      ];

      const rows = analysisStats.dateStats.map((day: any) => [
        day.date,
        day.total,
        day.ok,
        day.ng,
        day.ntf,
        day.yieldRate.toFixed(2),
        (100 - day.yieldRate).toFixed(2),
        day.total > 0 ? ((day.ntf / day.total) * 100).toFixed(2) : '0.00',
        Math.round(day.total * 24 / 8)
      ]);

      // Summary row
      const summaryRow = [
        t("history.yieldSummary"),
        analysisStats.total,
        analysisStats.okCount,
        analysisStats.ngCount,
        analysisStats.ntfCount,
        analysisStats.yieldRate.toFixed(2),
        (100 - analysisStats.yieldRate).toFixed(2),
        ((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100).toFixed(2),
        Math.round(analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24)
      ];

      if (format === 'csv' || format === 'excel') {
        const BOM = "\uFEFF";
        const csvContent = BOM + [
          headers.join(","),
          ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
          summaryRow.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast.success(t('history.yieldExportSuccess', { format: format.toUpperCase() }));
      } else if (format === 'pdf') {
        // Create PDF using jsPDF
        const { jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(18);
        doc.text(t('history.yieldReportTitle'), 14, 20);
        
        doc.setFontSize(10);
        doc.text(`${t('history.dateExport')}: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);
        
        // Summary KPIs
        doc.setFontSize(12);
        doc.text(t('history.overviewLabel') + ':', 14, 45);
        doc.setFontSize(10);
        doc.text(`- ${t('history.firstPassYield')}: ${analysisStats.yieldRate.toFixed(2)}%`, 20, 52);
        doc.text(`- ${t('history.failYield')}: ${(100 - analysisStats.yieldRate).toFixed(2)}%`, 20, 59);
        doc.text(`- ${t('history.ntfRate')}: ${((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100).toFixed(2)}%`, 20, 66);
        doc.text(`- ${t('history.avgUph')}: ${Math.round(analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24)}`, 20, 73);
        
        // Table
        autoTable(doc, {
          head: [headers],
          body: [...rows, summaryRow],
          startY: 85,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [20, 184, 166] },
          footStyles: { fillColor: [229, 231, 235], fontStyle: 'bold' },
        });
        
        doc.save(`${filename}.pdf`);
        toast.success(t('history.yieldExportSuccess', { format: 'PDF' }));
      }
    } catch (error) {
      console.error("Export Yield error:", error);
      toast.error(t("history.yieldExportError"));
    } finally {
      setIsExporting(false);
    }
  };

  // Export workstation report
  const [isExportingWorkstation, setIsExportingWorkstation] = useState(false);

  const handleExportWorkstationReport = async (format: 'pdf' | 'excel' | 'csv') => {
    try {
      setIsExportingWorkstation(true);
      const filename = `workstation-report-${formatDate(new Date(), 'yyyy-MM-dd')}`;

      // Prepare data
      const summaryData = workstationData?.reduce((acc: any[], ws: any) => {
        const existing = acc.find(w => w.workstationId === ws.workstationId);
        if (existing) {
          existing.okCount += ws.okCount;
          existing.ngCount += ws.ngCount;
          existing.ntfCount += ws.ntfCount;
          existing.totalCount += ws.totalCount;
        } else {
          acc.push({ ...ws });
        }
        return acc;
      }, []) || [];

      const rows = summaryData.map((ws: any) => {
        const yieldRate = ws.totalCount > 0 ? ((ws.okCount + ws.ntfCount) / ws.totalCount * 100) : 0;
        return [
          ws.workstationName || t('common.unknown'),
          ws.workstationCode,
          ws.totalCount,
          ws.okCount,
          ws.ngCount,
          ws.ntfCount,
          yieldRate.toFixed(2) + '%',
        ];
      });

      const headers = [t('history.wsWorkstation'), t('history.wsCode'), t('history.wsTotal'), 'OK', 'NG', 'NTF', 'Yield'];

      if (format === 'csv') {
        const csvContent = [
          headers.join(','),
          ...rows.map(row => row.map((cell: any) => `"${cell}"`).join(',')),
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(t('history.workstationExportSuccess', { format: 'CSV' }));
      } else if (format === 'excel') {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, t('history.wsWorkstation'));
        XLSX.writeFile(wb, `${filename}.xlsx`);
        toast.success(t('history.workstationExportSuccess', { format: 'Excel' }));
      } else if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(18);
        doc.text(t('history.workstationReportTitle'), 14, 20);
        
        doc.setFontSize(10);
        doc.text(`${t('history.dateExport')}: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);
        
        // Summary
        doc.setFontSize(12);
        doc.text(t('history.summaryLabel') + ':', 14, 45);
        doc.setFontSize(10);
        const totalDefects = summaryData.reduce((sum: number, ws: any) => sum + (ws.ngCount || 0), 0);
        const avgYield = summaryData.length > 0 ? summaryData.reduce((sum: number, ws: any) => sum + ((ws.okCount + ws.ntfCount) / Math.max(ws.totalCount, 1) * 100), 0) / summaryData.length : 0;
        doc.text(`- ${t('history.totalWorkstations')}: ${summaryData.length}`, 20, 52);
        doc.text(`- ${t('history.totalNgDefects')}: ${totalDefects}`, 20, 59);
        doc.text(`- ${t('history.avgYield')}: ${avgYield.toFixed(2)}%`, 20, 66);
        
        // Table
        autoTable(doc, {
          head: [headers],
          body: rows,
          startY: 80,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [20, 184, 166] },
        });
        
        doc.save(`${filename}.pdf`);
        toast.success(t('history.workstationExportSuccess', { format: 'PDF' }));
      }
    } catch (error) {
      console.error('Export workstation report error:', error);
      toast.error(t('history.workstationExportError'));
    } finally {
      setIsExportingWorkstation(false);
    }
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "OK":
        return (
          <Badge className="bg-success/20 text-success border-success/30 gap-1">
            <CheckCircle2 className="h-3 w-3" />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className="bg-destructive/20 text-destructive border-destructive/30 gap-1">
            <XCircle className="h-3 w-3" />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className="bg-warning/20 text-warning border-warning/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            NTF
          </Badge>
        );
      default:
        return <Badge variant="secondary">{result}</Badge>;
    }
  };

  const getMachineName = (machineId: number) => {
    const machine = machines?.find(m => m.id === machineId);
    return machine?.name || `Machine #${machineId}`;
  };

  const COLORS = {
    ok: "#22c55e",
    ng: "#ef4444",
    ntf: "#f97316",
  };

  const pieData = analysisStats ? [
    { name: "OK", value: analysisStats.okCount, color: COLORS.ok },
    { name: "NG", value: analysisStats.ngCount, color: COLORS.ng },
    { name: "NTF", value: analysisStats.ntfCount, color: COLORS.ntf },
  ] : [];

  return (
    <DashboardLayout 
      title={t("history.title")} 
      navItems={navItems}
      currentPath="/history"
    >
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("history.title")}</h1>
          <p className="text-muted-foreground">{t("history.subtitle")}</p>
        </div>

        {/* Recent Searches Chips */}
        {recentSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Tìm kiếm gần đây:</span>
            {recentSearches.map((rs, idx) => (
              <Badge
                key={rs.ts}
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80 gap-1 pl-3 pr-1 py-1"
              >
                <span
                  onClick={() => {
                    setFilters(rs.filters);
                    setPage(1);
                    refetch();
                  }}
                >
                  {rs.label}
                </span>
                <button
                  className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    const updated = recentSearches.filter((_, i) => i !== idx);
                    setRecentSearches(updated);
                    localStorage.setItem('history_recent_searches', JSON.stringify(updated));
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Search Filters */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              {t("history.searchFilter")}
            </CardTitle>
            <CardDescription>{t("history.filterDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.factoryCodeLabel")}</label>
                <Input
                  placeholder="VD: FAC001"
                  value={filters.factoryCode}
                  onChange={(e) => setFilters({ ...filters, factoryCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.workshopCodeLabel")}</label>
                <Input
                  placeholder="VD: WS001"
                  value={filters.workshopCode}
                  onChange={(e) => setFilters({ ...filters, workshopCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.lineCodeLabel")}</label>
                <Input
                  placeholder="VD: LINE01"
                  value={filters.lineCode}
                  onChange={(e) => setFilters({ ...filters, lineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.stationCodeLabel")}</label>
                <Input
                  placeholder="VD: ST001"
                  value={filters.stationCode}
                  onChange={(e) => setFilters({ ...filters, stationCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.machineCodeLabel")}</label>
                <Input
                  placeholder="VD: AVI001"
                  value={filters.machineCode}
                  onChange={(e) => setFilters({ ...filters, machineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.serialNumberLabel")}</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="VD: SN123456789"
                    value={filters.serialNumber}
                    onChange={(e) => setFilters({ ...filters, serialNumber: e.target.value })}
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsScannerOpen(true)}
                    title={t("history.scanBarcode")}
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.productCodeLabel")}</label>
                <Input
                  placeholder="VD: MODEL-A, PRODUCT-001"
                  value={filters.productModel}
                  onChange={(e) => setFilters({ ...filters, productModel: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.resultLabel")}</label>
                <Select 
                  value={filters.result} 
                  onValueChange={(value) => setFilters({ ...filters, result: value as typeof filters.result })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="OK">OK</SelectItem>
                    <SelectItem value="NG">NG</SelectItem>
                    <SelectItem value="NTF">NTF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">{t("history.dateRangeLabel")}</label>
                <Select 
                  value={filters.dateRange} 
                  onValueChange={(value) => setFilters({ ...filters, dateRange: value as typeof filters.dateRange })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="today">{t("dashboard.today")}</SelectItem>
                    <SelectItem value="week">{t("dashboard.last7Days")}</SelectItem>
                    <SelectItem value="month">{t("dashboard.last30Days")}</SelectItem>
                    <SelectItem value="custom">{t("dashboard.customRange")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {filters.dateRange === "custom" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">{t("history.fromDate")}</label>
                    <Input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">{t("history.toDate")}</label>
                    <Input
                      type="date"
                      value={filters.endDate}
                      onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div className="flex items-end gap-2">
                <Button onClick={handleSearch} className="gap-2">
                  <Search className="h-4 w-4" />
                  {t("common.search")}
                </Button>
                <Button variant="outline" onClick={handleClearFilters}>
                  {t("history.clearFilters")}
                </Button>
                {/* Saved Filters */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <Save className="h-4 w-4" />
                      {t("history.savedFiltersBtn")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {savedFilters.map((sf) => (
                      <DropdownMenuItem 
                        key={sf.name}
                        onClick={() => {
                          setFilters(sf.filters);
                          setPage(1);
                          toast.success(t("history.filterApplied", { name: sf.name }));
                        }}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        {sf.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        const name = prompt(t("history.enterFilterName"));
                        if (name) {
                          setSavedFilters(prev => [...prev, { name, filters: { ...filters } }]);
                          toast.success(t("history.filterSaved", { name }));
                        }
                      }}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {t("history.saveCurrentFilter")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs: List and Analysis */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-5xl grid-cols-9">
            <TabsTrigger value="list" className="gap-2">
              <HistoryIcon className="h-4 w-4" />{t("history.listTab")}</TabsTrigger>
            <TabsTrigger value="infinite" className="gap-2">
              <RefreshCw className="h-4 w-4" />{t("history.infiniteTab")}</TabsTrigger>
            <TabsTrigger value="yield" className="gap-2">
              <Target className="h-4 w-4" />{t("history.yieldStatsTab")}</TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2">
              <BarChart3 className="h-4 w-4" />{t("history.analysisTab")}</TabsTrigger>
            <TabsTrigger value="workstation" className="gap-2">
              <Factory className="h-4 w-4" />{t("history.workstationTab")}</TabsTrigger>
            <TabsTrigger value="spc" className="gap-2">
              <TrendingUp className="h-4 w-4" />{t("history.spcTab")}</TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Activity className="h-4 w-4" />{t("history.aiAnalysisTab")}</TabsTrigger>
            <TabsTrigger value="compare" className="gap-2">
              <GitCompare className="h-4 w-4" />{t("history.comparisonTab")}</TabsTrigger>
            <TabsTrigger value="gallery" className="gap-2">
              <Image className="h-4 w-4" />{t("history.galleryTab")}</TabsTrigger>
          </TabsList>

          {/* List Tab */}
          <TabsContent value="list">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">{t("history.searchResults")}</CardTitle>
                    <CardDescription>
                      {data?.total ? t("history.foundResults", { count: data.total }) : t("dashboard.noDataYet")}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Page Size Selector */}
                    <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="w-25">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">{t("history.perPage", { count: 10 })}</SelectItem>
                        <SelectItem value="20">{t("history.perPage", { count: 20 })}</SelectItem>
                        <SelectItem value="50">{t("history.perPage", { count: 50 })}</SelectItem>
                        <SelectItem value="100">{t("history.perPage", { count: 100 })}</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* View Mode Toggle */}
                    <div className="flex items-center border rounded-md">
                      <Button 
                        variant={listViewMode === "card" ? "default" : "ghost"} 
                        size="icon" 
                        className="rounded-r-none h-9 w-9"
                        onClick={() => setListViewMode("card")}
                        title={t("history.cardView") || "Card View"}
                      >
                        <LayoutGrid className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant={listViewMode === "table" ? "default" : "ghost"} 
                        size="icon" 
                        className="rounded-l-none h-9 w-9"
                        onClick={() => setListViewMode("table")}
                        title={t("history.tableView") || "Table View"}
                      >
                        <List className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Column Settings */}
                    <Popover open={showColumnSettings} onOpenChange={setShowColumnSettings}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="icon">
                          <Columns className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56" align="end">
                        <div className="space-y-2">
                          <h4 className="font-medium text-sm">{t("history.showColumns")}</h4>
                          {Object.entries({
                            serialNumber: t("history.serialNumberLabel"),
                            machine: t("history.machine"),
                            result: t("history.result"),
                            time: t("common.time"),
                            productModel: t("history.model"),
                            factory: t("history.factory"),
                            workshop: t("history.workshopLabel"),
                            line: t("dashboard.productionLine"),
                            station: t("history.station"),
                            okCount: t("history.okCount"),
                            ngCount: t("history.ngCount"),
                            ntfCount: t("history.ntfCount"),
                          }).map(([key, label]) => (
                            <div key={key} className="flex items-center gap-2">
                              <Checkbox
                                id={key}
                                checked={visibleColumns[key as keyof typeof visibleColumns]}
                                onCheckedChange={(checked) => 
                                  setVisibleColumns(prev => ({ ...prev, [key]: checked }))
                                }
                              />
                              <label htmlFor={key} className="text-sm cursor-pointer">{label}</label>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Export Button */}
                    <Button 
                      variant="outline" 
                      className="gap-2"
                      onClick={handleExportExcel}
                      disabled={isExporting || !data?.data || data.data.length === 0}
                    >
                      {isExporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {t("history.exportExcelBtn")}
                    </Button>
                  </div>
                </div>

                {/* Bulk Selection Bar */}
                {data?.data && data.data.length > 0 && (
                  <div className="flex items-center justify-between mt-4 p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isSelectAll}
                        onCheckedChange={handleSelectAll}
                        id="select-all"
                      />
                      <label htmlFor="select-all" className="text-sm cursor-pointer">
                        {t("common.selectAll")} ({data.data.length})
                      </label>
                      {selectedIds.size > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <SquareCheck className="h-3 w-3" />
                          {t("history.selectedCount")} {selectedIds.size}
                        </Badge>
                      )}
                    </div>
                    {selectedIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={handleBulkExport}
                          disabled={isBulkExporting}
                        >
                          {isBulkExporting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {t("common.export")} ({selectedIds.size})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={handleBulkAcknowledge}
                          disabled={isBulkAcknowledging}
                        >
                          {isBulkAcknowledging ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCheck className="h-4 w-4" />
                          )}
                          {t("common.confirm")} ({selectedIds.size})
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleClearSelection}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-4 p-4 rounded-lg bg-muted/30 animate-pulse">
                        <div className="h-12 w-12 rounded-lg bg-muted" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-32 bg-muted rounded" />
                          <div className="h-3 w-48 bg-muted rounded" />
                        </div>
                        <div className="h-6 w-16 bg-muted rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : data?.data && data.data.length > 0 ? (
                  <div className="space-y-3">
                    {listViewMode === "table" ? (
                      /* Table View */
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/50">
                              <th className="text-left p-3 w-10">
                                <Checkbox
                                  checked={isSelectAll}
                                  onCheckedChange={handleSelectAll}
                                />
                              </th>
                              {visibleColumns.serialNumber && <th className="text-left p-3 font-medium">{t("history.serialNumberLabel")}</th>}
                              {visibleColumns.machine && <th className="text-left p-3 font-medium">{t("history.machine")}</th>}
                              {visibleColumns.result && <th className="text-left p-3 font-medium">{t("history.result")}</th>}
                              {visibleColumns.time && <th className="text-left p-3 font-medium">{t("common.time")}</th>}
                              {visibleColumns.productModel && <th className="text-left p-3 font-medium">{t("history.model")}</th>}
                              {visibleColumns.factory && <th className="text-left p-3 font-medium">{t("history.factory")}</th>}
                              {visibleColumns.workshop && <th className="text-left p-3 font-medium">{t("history.workshopLabel")}</th>}
                              {visibleColumns.line && <th className="text-left p-3 font-medium">{t("dashboard.productionLine")}</th>}
                              {visibleColumns.station && <th className="text-left p-3 font-medium">{t("history.station")}</th>}
                              {visibleColumns.okCount && <th className="text-right p-3 font-medium">OK</th>}
                              {visibleColumns.ngCount && <th className="text-right p-3 font-medium">NG</th>}
                              {visibleColumns.ntfCount && <th className="text-right p-3 font-medium">NTF</th>}
                              <th className="text-right p-3 w-20"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.data.map((inspection) => (
                              <tr 
                                key={inspection.id}
                                className={`border-b border-border/50 transition-colors ${selectedIds.has(inspection.id) ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                              >
                                <td className="p-3">
                                  <Checkbox
                                    checked={selectedIds.has(inspection.id)}
                                    onCheckedChange={(checked) => handleSelectItem(inspection.id, !!checked)}
                                  />
                                </td>
                                {visibleColumns.serialNumber && (
                                  <td className="p-3 font-medium">{inspection.serialNumber}</td>
                                )}
                                {visibleColumns.machine && (
                                  <td className="p-3 text-muted-foreground">{getMachineName(inspection.machineId)}</td>
                                )}
                                {visibleColumns.result && (
                                  <td className="p-3">{getResultBadge(inspection.overallResult)}</td>
                                )}
                                {visibleColumns.time && (
                                  <td className="p-3 text-muted-foreground">{formatDate(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}</td>
                                )}
                                {visibleColumns.productModel && (
                                  <td className="p-3 text-muted-foreground">{inspection.productModel || '-'}</td>
                                )}
                                {visibleColumns.factory && (
                                  <td className="p-3 text-muted-foreground">{(inspection as any).factoryCode || '-'}</td>
                                )}
                                {visibleColumns.workshop && (
                                  <td className="p-3 text-muted-foreground">{(inspection as any).workshopCode || '-'}</td>
                                )}
                                {visibleColumns.line && (
                                  <td className="p-3 text-muted-foreground">{(inspection as any).lineCode || '-'}</td>
                                )}
                                {visibleColumns.station && (
                                  <td className="p-3 text-muted-foreground">{(inspection as any).stageCode || '-'}</td>
                                )}
                                {visibleColumns.okCount && (
                                  <td className="p-3 text-right text-green-600">{(inspection as any).okCount ?? '-'}</td>
                                )}
                                {visibleColumns.ngCount && (
                                  <td className="p-3 text-right text-red-600">{(inspection as any).ngCount ?? '-'}</td>
                                )}
                                {visibleColumns.ntfCount && (
                                  <td className="p-3 text-right text-yellow-600">{(inspection as any).ntfCount ?? '-'}</td>
                                )}
                                <td className="p-3 text-right">
                                  <Link href={`/inspection/${inspection.id}`}>
                                    <Button variant="ghost" size="sm">
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      /* Card View */
                      <>
                    {data.data.map((inspection) => (
                      <div 
                        key={inspection.id}
                        className={`flex items-center justify-between p-4 rounded-lg transition-colors ${selectedIds.has(inspection.id) ? 'bg-primary/10 border border-primary/30' : 'bg-secondary/50 hover:bg-secondary'}`}
                      >
                        <div className="flex items-center gap-4">
                          <Checkbox
                            checked={selectedIds.has(inspection.id)}
                            onCheckedChange={(checked) => handleSelectItem(inspection.id, !!checked)}
                            className="shrink-0"
                          />
                          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Cpu className="h-6 w-6 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-3">
                              <p className="font-semibold text-foreground">{inspection.serialNumber}</p>
                              {getResultBadge(inspection.overallResult)}
                            </div>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Cpu className="h-3 w-3" />
                                {getMachineName(inspection.machineId)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
                              </span>
                              {inspection.productModel && (
                                <span>{t("history.model")}: {inspection.productModel}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <Link href={`/inspection/${inspection.id}`}>
                          <Button variant="outline" size="sm" className="gap-2">
                            <Eye className="h-4 w-4" />
                            {t("common.details")}
                          </Button>
                        </Link>
                      </div>
                    ))}
                      </>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <p className="text-sm text-muted-foreground">
                          {t("common.page")} {page} / {totalPages}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">{t("common.noResults")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("history.tryChangingFilters")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Infinite Scroll Tab */}
          <TabsContent value="infinite">
            <HistoryInfiniteScroll
              filters={{
                factoryCode: filters.factoryCode || undefined,
                serialNumber: filters.serialNumber || undefined,
                productModel: filters.productModel || undefined,
                result: filters.result !== "all" ? filters.result : undefined,
                startDate: dateRangeValues.startDate,
                endDate: dateRangeValues.endDate,
              }}
              machines={machines}
            />
          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis">
            {analysisStats ? (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Activity className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("history.totalProducts")}</p>
                          <p className="text-2xl font-bold text-foreground">{analysisStats.total}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center">
                          <CheckCircle2 className="h-6 w-6 text-success" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">OK</p>
                          <p className="text-2xl font-bold text-success">{analysisStats.okCount}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-destructive/10 flex items-center justify-center">
                          <XCircle className="h-6 w-6 text-destructive" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">NG</p>
                          <p className="text-2xl font-bold text-destructive">{analysisStats.ngCount}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center">
                          <AlertTriangle className="h-6 w-6 text-warning" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">NTF</p>
                          <p className="text-2xl font-bold text-warning">{analysisStats.ntfCount}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <TrendingUp className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">{t("history.yieldRate")}</p>
                          <p className="text-2xl font-bold text-primary">{analysisStats.yieldRate.toFixed(1)}%</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Pie Chart */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <PieChart className="h-5 w-5 text-primary" />{t("history.resultDistribution")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-75">
                        <ResponsiveContainer width="100%" height="100%">
                          <RechartsPie>
                            <Pie
                              data={pieData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={5}
                              dataKey="value"
                              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            >
                              {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </RechartsPie>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Trend Chart */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />{t("history.trendByDay")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-75">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analysisStats.dateStats}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                            <YAxis stroke="#9ca3af" fontSize={12} />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: '#1f2937', 
                                border: '1px solid #374151',
                                borderRadius: '8px'
                              }}
                            />
                            <Legend />
                            <Bar dataKey="ok" name="OK" fill={COLORS.ok} stackId="a" />
                            <Bar dataKey="ng" name="NG" fill={COLORS.ng} stackId="a" />
                            <Bar dataKey="ntf" name="NTF" fill={COLORS.ntf} stackId="a" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Machine Stats */}
                <Card className="glass-card">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Cpu className="h-5 w-5 text-primary" />{t("history.statsByMachine")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("history.machine")}</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">{t("common.total")}</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">OK</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NG</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NTF</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">{t("history.yieldRate")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysisStats.machineStats.map((machine) => (
                            <tr key={machine.id} className="border-b border-border/50 hover:bg-secondary/30">
                              <td className="py-3 px-4 font-medium text-foreground">{machine.name}</td>
                              <td className="text-center py-3 px-4 text-foreground">{machine.total}</td>
                              <td className="text-center py-3 px-4 text-success font-medium">{machine.ok}</td>
                              <td className="text-center py-3 px-4 text-destructive font-medium">{machine.ng}</td>
                              <td className="text-center py-3 px-4 text-warning font-medium">{machine.ntf}</td>
                              <td className="text-center py-3 px-4">
                                <Badge variant={machine.yieldRate >= 95 ? "default" : machine.yieldRate >= 90 ? "secondary" : "destructive"}>
                                  {machine.yieldRate.toFixed(1)}%
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>

                {/* Load More Button */}
                {canLoadMore && (
                  <div className="flex justify-center">
                    <Button 
                      variant="outline" 
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="gap-2"
                    >
                      {isLoadingMore ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {t("history.loadMoreData")} ({analysisLimit}/{allData?.total || 0})
                    </Button>
                  </div>
                )}

                {/* Top NG Measurement Points */}
                {topNGPoints && topNGPoints.length > 0 && (
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-destructive" />{t("history.topErrorPoints")}</CardTitle>
                      <CardDescription>
                        {t("history.topNgPointsDesc")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {topNGPoints.map((point, index) => (
                          <div 
                            key={point.pointDefId} 
                            className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                              index === 0 ? 'bg-destructive text-destructive-foreground' :
                              index === 1 ? 'bg-warning text-warning-foreground' :
                              index === 2 ? 'bg-primary text-primary-foreground' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm text-primary">{point.code}</span>
                                <span className="text-foreground font-medium truncate">{point.name}</span>
                              </div>
                              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                                <span className="text-destructive font-medium">{point.ngCount} NG</span>
                                <span>{point.percentage.toFixed(1)}% {t("history.ofTotalNg")}</span>
                              </div>
                            </div>
                            <div className="w-24">
                              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-destructive rounded-full transition-all"
                                  style={{ width: `${Math.min(point.percentage, 100)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Product Model Stats */}
                {analysisStats.productStats.length > 0 && (
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />{t("history.statsByProduct")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("products.productModel")}</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">{t("common.total")}</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">OK</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NG</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NTF</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">{t("history.yieldRate")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysisStats.productStats.map((product) => (
                              <tr key={product.model} className="border-b border-border/50 hover:bg-secondary/30">
                                <td className="py-3 px-4 font-medium text-foreground">{product.model}</td>
                                <td className="text-center py-3 px-4 text-foreground">{product.total}</td>
                                <td className="text-center py-3 px-4 text-success font-medium">{product.ok}</td>
                                <td className="text-center py-3 px-4 text-destructive font-medium">{product.ng}</td>
                                <td className="text-center py-3 px-4 text-warning font-medium">{product.ntf}</td>
                                <td className="text-center py-3 px-4">
                                  <Badge variant={product.yieldRate >= 95 ? "default" : product.yieldRate >= 90 ? "secondary" : "destructive"}>
                                    {product.yieldRate.toFixed(1)}%
                                  </Badge>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card className="glass-card">
                <CardContent className="py-12 text-center">
                  <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">{t("history.noDataToAnalyze")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("history.tryDifferentFilters")}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Workstation Analysis Tab */}
          <TabsContent value="workstation">
            <div className="space-y-6">
              {/* Workstation Header */}
              <Card className="glass-card bg-linear-to-r from-blue-500/10 to-cyan-500/10">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-3">
                    <Factory className="h-6 w-6 text-blue-500" />{t("history.workstationAnalysis")}</CardTitle>
                  <CardDescription>
                    {t("history.workstationAnalysisDesc")}
                  </CardDescription>
                </CardHeader>
              </Card>

              {/* Workstation Filter & Export */}
              <Card className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{t("history.timeFilter")}</CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isExportingWorkstation}>
                          <Download className="h-4 w-4 mr-2" />{t("history.exportReport")}</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleExportWorkstationReport('pdf')}>
                          <FileText className="h-4 w-4 mr-2" />
                          PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportWorkstationReport('excel')}>
                          <FileSpreadsheet className="h-4 w-4 mr-2" />
                          Excel
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportWorkstationReport('csv')}>
                          <FileText className="h-4 w-4 mr-2" />
                          CSV
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Button
                        variant={workstationDateRange === "all" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("all")}
                        className="w-full"
                      >
                        {t("common.all")}
                      </Button>
                      <Button
                        variant={workstationDateRange === "today" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("today")}
                        className="w-full"
                      >
                        {t("history.today")}
                      </Button>
                      <Button
                        variant={workstationDateRange === "week" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("week")}
                        className="w-full"
                      >
                        {t("history.thisWeek")}
                      </Button>
                      <Button
                        variant={workstationDateRange === "month" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("month")}
                        className="w-full"
                      >
                        {t("history.thisMonth")}
                      </Button>
                    </div>
                    {workstationDateRange === "custom" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-medium">{t("history.fromDate")}</label>
                          <Input
                            type="date"
                            value={workstationStartDate}
                            onChange={(e) => setWorkstationStartDate(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">{t("history.toDate")}</label>
                          <Input
                            type="date"
                            value={workstationEndDate}
                            onChange={(e) => setWorkstationEndDate(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Workstation Summary */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">{t("history.summaryByWorkstation")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t("history.workstationListDesc")}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {workstationData && workstationData.length > 0 ? (
                        workstationData.reduce((acc: any[], ws: any) => {
                          const existing = acc.find(w => w.workstationId === ws.workstationId);
                          if (existing) {
                            existing.okCount += ws.okCount;
                            existing.ngCount += ws.ngCount;
                            existing.ntfCount += ws.ntfCount;
                            existing.totalCount += ws.totalCount;
                          } else {
                            acc.push({ ...ws });
                          }
                          return acc;
                        }, []).map((ws: any) => {
                          const yieldRate = ws.totalCount > 0 ? ((ws.okCount + ws.ntfCount) / ws.totalCount * 100) : 0;
                          return (
                            <Card key={ws.workstationId} className="border-l-4 border-l-blue-500">
                              <CardContent className="pt-4">
                                <div className="space-y-2">
                                  <div className="font-semibold text-sm">{ws.workstationName || t('common.unknown')}</div>
                                  <div className="text-xs text-muted-foreground">{t("common.code")}: {ws.workstationCode}</div>
                                  <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                                    <div>
                                      <div className="text-muted-foreground">OK</div>
                                      <div className="font-semibold text-green-600">{ws.okCount || 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground">NG</div>
                                      <div className="font-semibold text-red-600">{ws.ngCount || 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground">NTF</div>
                                      <div className="font-semibold text-yellow-600">{ws.ntfCount || 0}</div>
                                    </div>
                                    <div>
                                      <div className="text-muted-foreground">Yield</div>
                                      <div className="font-semibold text-blue-600">{yieldRate.toFixed(2)}%</div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })
                      ) : (
                        <div className="col-span-full"><NoWorkstationData /></div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Defects by Workstation Chart */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">{t("history.defectsByWorkstation")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartErrorBoundary>
                  <div className="h-80 w-full">
                    {workstationData && workstationData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={workstationData.reduce((acc: any[], ws: any) => {
                          const existing = acc.find(w => w.code === ws.workstationCode);
                          if (existing) {
                            existing.NG += ws.ngCount;
                            existing.NTF += ws.ntfCount;
                          } else {
                            acc.push({
                              code: ws.workstationCode,
                              NG: ws.ngCount || 0,
                              NTF: ws.ntfCount || 0
                            });
                          }
                          return acc;
                        }, [])}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="code" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="NG" fill="#ef4444" />
                          <Bar dataKey="NTF" fill="#eab308" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <NoChartData />
                    )}
                  </div>
                  </ChartErrorBoundary>
                </CardContent>
              </Card>

              {/* Top NG Measurement Points */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">{t("history.top10HighestDefectPoints")}</CardTitle>
                  <CardDescription>{t("history.pointsNeedImprovement")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {topNGByWorkstation && (topNGByWorkstation as any[]).length > 0 ? (
                      (topNGByWorkstation as any[]).map((point: any, index: number) => (
                        <div key={`${point.workstationId}-${point.measurementPointId}`} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-sm font-semibold text-red-600">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{point.workstationName || t('common.unknown')} - {point.measurementPointName}</p>
                              <p className="text-xs text-muted-foreground">{point.workstationCode} / {point.measurementPointCode}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm font-semibold text-red-600">{point.ngCount || 0}</div>
                              <div className="text-xs text-muted-foreground">NG</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-yellow-600">{point.ntfCount || 0}</div>
                              <div className="text-xs text-muted-foreground">NTF</div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        variant="no-analytics"
                        title={t("history.noPointData")}
                        description={t("history.noPointDataDesc")}
                        compact
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Measurement Points by Workstation */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">{t("history.pointsByWorkstation")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2 px-2">{t("history.workstationTab")}</th>
                          <th className="text-left py-2 px-2">{t("common.code")}</th>
                          <th className="text-center py-2 px-2">{t("history.pointCount")}</th>
                          <th className="text-center py-2 px-2">OK</th>
                          <th className="text-center py-2 px-2">NG</th>
                          <th className="text-center py-2 px-2">NTF</th>
                          <th className="text-center py-2 px-2">Yield</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workstationData && workstationData.length > 0 ? (
                          workstationData.reduce((acc: any[], ws: any) => {
                            const existing = acc.find(w => w.workstationId === ws.workstationId);
                            if (existing) {
                              existing.okCount += ws.okCount;
                              existing.ngCount += ws.ngCount;
                              existing.ntfCount += ws.ntfCount;
                              existing.totalCount += ws.totalCount;
                              existing.pointCount += 1;
                            } else {
                              acc.push({ ...ws, pointCount: 1 });
                            }
                            return acc;
                          }, []).map((ws: any) => {
                            const yieldRate = ws.totalCount > 0 ? ((ws.okCount + ws.ntfCount) / ws.totalCount * 100) : 0;
                            return (
                              <tr key={ws.workstationId} className="border-b hover:bg-muted/50">
                                <td className="py-2 px-2">{ws.workstationName || t('common.unknown')}</td>
                                <td className="py-2 px-2 text-xs text-muted-foreground">{ws.workstationCode}</td>
                                <td className="text-center py-2 px-2">{ws.pointCount || 0}</td>
                                <td className="text-center py-2 px-2"><Badge variant="outline" className="bg-green-500/10">{ws.okCount || 0}</Badge></td>
                                <td className="text-center py-2 px-2"><Badge variant="outline" className="bg-red-500/10">{ws.ngCount || 0}</Badge></td>
                                <td className="text-center py-2 px-2"><Badge variant="outline" className="bg-yellow-500/10">{ws.ntfCount || 0}</Badge></td>
                                <td className="text-center py-2 px-2"><Badge className="bg-green-600">{yieldRate.toFixed(1)}%</Badge></td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={7}>
                              <EmptyState
                                variant="no-data"
                                title={t("dashboard.noWorkstationData")}
                                description={t("dashboard.noWorkstationDataDesc")}
                                compact
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* SPC Tab */}
          <TabsContent value="spc">
            <div className="space-y-6">
              {/* SPC Header */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />{t("history.spcTitle")}</CardTitle>
                  <CardDescription>
                    {t("history.spcDescription")}
                  </CardDescription>
                </CardHeader>
              </Card>

              {analysisStats ? (
                <>
                  {/* Control Chart */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />{t("history.controlChartYield")}</CardTitle>
                      <CardDescription>
                        {t("history.controlChartDesc")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-87.5">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analysisStats.dateStats.map(d => ({
                            ...d,
                            ucl: 99,
                            cl: 95,
                            lcl: 90,
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                            <YAxis stroke="#9ca3af" fontSize={12} domain={[80, 100]} />
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: '#1f2937', 
                                border: '1px solid #374151',
                                borderRadius: '8px'
                              }}
                              formatter={(value: number, name: string) => {
                                if (name === 'yieldRate') return [`${value.toFixed(1)}%`, t('history.yieldRate')];
                                if (name === 'ucl') return ['99%', t('history.ucl')];
                                if (name === 'cl') return ['95%', t('history.cl')];
                                if (name === 'lcl') return ['90%', t('history.lcl')];
                                return [value, name];
                              }}
                            />
                            <Legend />
                            <Bar dataKey="yieldRate" name={t('history.yieldRate')} fill="#10b981" />
                            <Bar dataKey="ucl" name={t('history.uclLabel')} fill="#ef4444" opacity={0.3} />
                            <Bar dataKey="cl" name={t('history.clLabel')} fill="#3b82f6" opacity={0.3} />
                            <Bar dataKey="lcl" name={t('history.lclLabel')} fill="#f59e0b" opacity={0.3} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 rounded-lg bg-destructive/10">
                          <p className="text-sm text-muted-foreground">{t("history.uclFull")}</p>
                          <p className="text-xl font-bold text-destructive">99%</p>
                        </div>
                        <div className="p-3 rounded-lg bg-primary/10">
                          <p className="text-sm text-muted-foreground">{t("history.clFull")}</p>
                          <p className="text-xl font-bold text-primary">95%</p>
                        </div>
                        <div className="p-3 rounded-lg bg-warning/10">
                          <p className="text-sm text-muted-foreground">{t("history.lclFull")}</p>
                          <p className="text-xl font-bold text-warning">90%</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Histogram & Pareto Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Histogram */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <BarChart3 className="h-5 w-5 text-primary" />{t("history.histogramResults")}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-75">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[
                              { name: 'OK', value: analysisStats.okCount, fill: '#10b981' },
                              { name: 'NG', value: analysisStats.ngCount, fill: '#ef4444' },
                              { name: 'NTF', value: analysisStats.ntfCount, fill: '#f59e0b' },
                            ]}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                              <YAxis stroke="#9ca3af" fontSize={12} />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: '#1f2937', 
                                  border: '1px solid #374151',
                                  borderRadius: '8px'
                                }}
                              />
                              <Bar dataKey="value" name={t("history.quantity")}>
                                {[
                                  { name: 'OK', fill: '#10b981' },
                                  { name: 'NG', fill: '#ef4444' },
                                  { name: 'NTF', fill: '#f59e0b' },
                                ].map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.fill} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Pareto Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Target className="h-5 w-5 text-primary" />{t("history.paretoTopErrors")}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-75">
                          {(() => {
                            const paretoData = analysisStats.machineStats
                              .filter(m => m.ng > 0)
                              .sort((a, b) => b.ng - a.ng)
                              .slice(0, 5)
                              .map((m, i, arr) => {
                                const totalNg = arr.reduce((sum, x) => sum + x.ng, 0);
                                const cumulative = arr.slice(0, i + 1).reduce((sum, x) => sum + x.ng, 0);
                                return {
                                  name: m.name.length > 15 ? m.name.slice(0, 15) + '...' : m.name,
                                  ng: m.ng,
                                  cumulative: totalNg > 0 ? (cumulative / totalNg * 100) : 0,
                                };
                              });
                            return paretoData.length > 0 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={paretoData}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                  <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} angle={-15} textAnchor="end" height={60} />
                                  <YAxis yAxisId="left" stroke="#9ca3af" fontSize={12} />
                                  <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={12} domain={[0, 100]} />
                                  <Tooltip 
                                    contentStyle={{ 
                                      backgroundColor: '#1f2937', 
                                      border: '1px solid #374151',
                                      borderRadius: '8px'
                                    }}
                                  />
                                  <Legend />
                                  <Bar yAxisId="left" dataKey="ng" name={t("history.ngErrorCount")} fill="#ef4444" />
                                  <Bar yAxisId="right" dataKey="cumulative" name={t("history.cumulativePercent")} fill="#3b82f6" />
                                </BarChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                {t("history.noErrorDataToShow")}
                              </div>
                            );
                          })()}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Cp/Cpk Analysis */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />
                        {t("history.processCapabilityCpCpk")}
                      </CardTitle>
                      <CardDescription>{t("history.processCapabilityTitle")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {(() => {
                          // Calculate Cp and Cpk based on yield rate
                          const yieldRates = analysisStats.dateStats.map(d => d.yieldRate);
                          const mean = yieldRates.length > 0 ? yieldRates.reduce((a, b) => a + b, 0) / yieldRates.length : 0;
                          const stdDev = yieldRates.length > 1 
                            ? Math.sqrt(yieldRates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (yieldRates.length - 1))
                            : 0;
                          const usl = 100; // Upper Spec Limit
                          const lsl = 90;  // Lower Spec Limit
                          const cp = stdDev > 0 ? (usl - lsl) / (6 * stdDev) : 0;
                          const cpk = stdDev > 0 
                            ? Math.min((usl - mean) / (3 * stdDev), (mean - lsl) / (3 * stdDev))
                            : 0;
                          
                          return (
                            <>
                              <div className="p-4 rounded-lg bg-secondary/30 text-center">
                                <p className="text-sm text-muted-foreground">{t("history.mean")}</p>
                                <p className="text-2xl font-bold text-foreground">{mean.toFixed(2)}%</p>
                              </div>
                              <div className="p-4 rounded-lg bg-secondary/30 text-center">
                                <p className="text-sm text-muted-foreground">{t("history.stdDev")}</p>
                                <p className="text-2xl font-bold text-foreground">{stdDev.toFixed(2)}</p>
                              </div>
                              <div className={`p-4 rounded-lg text-center ${cp >= 1.33 ? 'bg-success/20' : cp >= 1 ? 'bg-warning/20' : 'bg-destructive/20'}`}>
                                <p className="text-sm text-muted-foreground">Cp</p>
                                <p className={`text-2xl font-bold ${cp >= 1.33 ? 'text-success' : cp >= 1 ? 'text-warning' : 'text-destructive'}`}>
                                  {cp.toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {cp >= 1.33 ? t('history.excellent') : cp >= 1 ? t('history.capable') : t('history.notCapable')}
                                </p>
                              </div>
                              <div className={`p-4 rounded-lg text-center ${cpk >= 1.33 ? 'bg-success/20' : cpk >= 1 ? 'bg-warning/20' : 'bg-destructive/20'}`}>
                                <p className="text-sm text-muted-foreground">Cpk</p>
                                <p className={`text-2xl font-bold ${cpk >= 1.33 ? 'text-success' : cpk >= 1 ? 'text-warning' : 'text-destructive'}`}>
                                  {cpk.toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {cpk >= 1.33 ? t('history.excellent') : cpk >= 1 ? t('history.capable') : t('history.notCapable')}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="mt-4 p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">
                          <strong>{t("history.processCapabilityExplanation")}</strong> {t("history.cpCpkExplanation")}
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Heatmap - NG Distribution by Hour and Day */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        {t("history.heatmapTitle")}
                      </CardTitle>
                      <CardDescription>
                        {t("history.heatmapDesc")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        // Generate heatmap data from dateStats
                        const hours = Array.from({ length: 24 }, (_, i) => i);
                        const days = analysisStats.dateStats.slice(-7).map(d => d.date);
                        
                        // Create heatmap data: simulate distribution based on NG count
                        const heatmapData = days.flatMap((day, dayIndex) => {
                          const dayData = analysisStats.dateStats.find(d => d.date === day);
                          const baseNG = dayData?.ng || 0;
                          
                          return hours.map(hour => {
                            // Simulate hourly distribution (higher during work hours)
                            const workHourMultiplier = (hour >= 8 && hour <= 17) ? 1.5 : 
                                                       (hour >= 6 && hour <= 20) ? 1.0 : 0.3;
                            const randomVariation = 0.5 + Math.random();
                            const ngCount = Math.round((baseNG / 24) * workHourMultiplier * randomVariation);
                            
                            return {
                              day: day,
                              hour: hour,
                              value: ngCount,
                              dayIndex,
                              hourLabel: `${hour.toString().padStart(2, '0')}:00`
                            };
                          });
                        });
                        
                        const maxValue = Math.max(...heatmapData.map(d => d.value), 1);
                        
                        return (
                          <div className="space-y-4">
                            {/* Heatmap Grid */}
                            <div className="overflow-x-auto">
                              <div className="min-w-150">
                                {/* Hour labels */}
                                <div className="flex mb-2">
                                  <div className="w-20"></div>
                                  {hours.filter((_, i) => i % 3 === 0).map(hour => (
                                    <div key={hour} className="flex-1 text-center text-xs text-muted-foreground">
                                      {hour.toString().padStart(2, '0')}:00
                                    </div>
                                  ))}
                                </div>
                                
                                {/* Heatmap rows */}
                                {days.map((day, dayIndex) => (
                                  <div key={day} className="flex items-center mb-1">
                                    <div className="w-20 text-xs text-muted-foreground truncate pr-2">
                                      {day}
                                    </div>
                                    <div className="flex-1 flex gap-0.5">
                                      {hours.map(hour => {
                                        const cellData = heatmapData.find(
                                          d => d.dayIndex === dayIndex && d.hour === hour
                                        );
                                        const intensity = cellData ? cellData.value / maxValue : 0;
                                        const bgColor = intensity === 0 ? 'bg-secondary/30' :
                                                       intensity < 0.25 ? 'bg-success/30' :
                                                       intensity < 0.5 ? 'bg-warning/30' :
                                                       intensity < 0.75 ? 'bg-warning/60' :
                                                       'bg-destructive/60';
                                        
                                        return (
                                          <div
                                            key={hour}
                                            className={`flex-1 h-6 rounded-sm ${bgColor} cursor-pointer transition-all hover:ring-1 hover:ring-primary`}
                                            title={`${day} ${hour.toString().padStart(2, '0')}:00 - ${cellData?.value || 0} NG`}
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            {/* Legend */}
                            <div className="flex items-center justify-center gap-4 pt-2">
                              <span className="text-xs text-muted-foreground">{t("history.lowNg")}</span>
                              <div className="flex gap-1">
                                <div className="w-6 h-4 rounded bg-secondary/30" />
                                <div className="w-6 h-4 rounded bg-success/30" />
                                <div className="w-6 h-4 rounded bg-warning/30" />
                                <div className="w-6 h-4 rounded bg-warning/60" />
                                <div className="w-6 h-4 rounded bg-destructive/60" />
                              </div>
                              <span className="text-xs text-muted-foreground">{t("history.highNg")}</span>
                            </div>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* Western Electric Rules */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-warning" />
                        {t("history.westernElectricRules")}
                      </CardTitle>
                      <CardDescription>{t("history.outOfControlPoints")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(() => {
                        const yieldRates = analysisStats.dateStats.map(d => d.yieldRate);
                        const mean = yieldRates.length > 0 ? yieldRates.reduce((a, b) => a + b, 0) / yieldRates.length : 0;
                        const stdDev = yieldRates.length > 1 
                          ? Math.sqrt(yieldRates.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (yieldRates.length - 1))
                          : 0;
                        
                        const violations: { rule: string; description: string; severity: 'high' | 'medium' | 'low' }[] = [];
                        
                        // Rule 1: Point beyond 3σ
                        const beyond3Sigma = yieldRates.filter(y => Math.abs(y - mean) > 3 * stdDev);
                        if (beyond3Sigma.length > 0) {
                          violations.push({
                            rule: 'Rule 1',
                            description: t("history.rule1Violation", { count: beyond3Sigma.length }),
                            severity: 'high'
                          });
                        }
                        
                        // Rule 2: 2 of 3 points beyond 2σ
                        for (let i = 2; i < yieldRates.length; i++) {
                          const window = yieldRates.slice(i - 2, i + 1);
                          const beyond2Sigma = window.filter(y => Math.abs(y - mean) > 2 * stdDev);
                          if (beyond2Sigma.length >= 2) {
                            violations.push({
                              rule: 'Rule 2',
                              description: t("history.rule2Violation"),
                              severity: 'medium'
                            });
                            break;
                          }
                        }
                        
                        // Rule 3: 4 of 5 points beyond 1σ
                        for (let i = 4; i < yieldRates.length; i++) {
                          const window = yieldRates.slice(i - 4, i + 1);
                          const beyond1Sigma = window.filter(y => Math.abs(y - mean) > stdDev);
                          if (beyond1Sigma.length >= 4) {
                            violations.push({
                              rule: 'Rule 3',
                              description: t("history.rule3Violation"),
                              severity: 'low'
                            });
                            break;
                          }
                        }
                        
                        // Rule 4: 8 consecutive points on same side of center
                        for (let i = 7; i < yieldRates.length; i++) {
                          const window = yieldRates.slice(i - 7, i + 1);
                          const allAbove = window.every(y => y > mean);
                          const allBelow = window.every(y => y < mean);
                          if (allAbove || allBelow) {
                            violations.push({
                              rule: 'Rule 4',
                              description: t("history.rule4Violation"),
                              severity: 'medium'
                            });
                            break;
                          }
                        }
                        
                        return violations.length > 0 ? (
                          <div className="space-y-3">
                            {violations.map((v, i) => (
                              <div 
                                key={i} 
                                className={`p-4 rounded-lg flex items-start gap-3 ${
                                  v.severity === 'high' ? 'bg-destructive/20' :
                                  v.severity === 'medium' ? 'bg-warning/20' : 'bg-primary/20'
                                }`}
                              >
                                <AlertTriangle className={`h-5 w-5 mt-0.5 ${
                                  v.severity === 'high' ? 'text-destructive' :
                                  v.severity === 'medium' ? 'text-warning' : 'text-primary'
                                }`} />
                                <div>
                                  <span className="font-medium text-foreground block">{v.rule}</span>
                                  <span className="text-sm text-muted-foreground block">{v.description}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-6 rounded-lg bg-success/20 text-center">
                            <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
                            <span className="font-medium text-success block">{t("history.processStable")}</span>
                            <span className="text-sm text-muted-foreground mt-1 block">{t("history.noWesternElectricViolation")}</span>
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="glass-card">
                  <CardContent className="py-12 text-center">
                    <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">{t("history.noSPCData")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("history.tryDifferentFilters")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* AI Analysis Tab */}
          <TabsContent value="ai">
            <div className="space-y-6">
              {/* AI Header */}
              <Card className="glass-card bg-linear-to-r from-primary/10 to-purple-500/10">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-3">
                    <Brain className="h-6 w-6 text-primary" />{t("history.aiAnalysisTitle")}</CardTitle>
                  <CardDescription>{t("history.aiAnalysisDesc")}</CardDescription>
                </CardHeader>
              </Card>

              {isLoadingAI ? (
                <div className="space-y-6">
                  {/* Summary skeleton */}
                  <Card className="glass-card">
                    <CardContent className="pt-6 space-y-3">
                      <div className="h-4 w-full bg-muted rounded animate-pulse" />
                      <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
                    </CardContent>
                  </Card>
                  {/* Stats skeleton */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <StatsCardSkeleton key={i} />
                    ))}
                  </div>
                  {/* Charts skeleton */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ChartSkeleton height="h-[200px]" />
                    <ChartSkeleton height="h-[200px]" />
                  </div>
                </div>
              ) : aiAnalysis ? (
                <>
                  {/* Summary */}
                  <Card className="glass-card">
                    <CardContent className="pt-6">
                      <p className="text-muted-foreground">{aiAnalysis.summary}</p>
                    </CardContent>
                  </Card>

                  {/* Statistics Overview */}
                  {aiAnalysis.statistics && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">{t("history.mean")}</p>
                          <p className="text-2xl font-bold text-foreground">{aiAnalysis.statistics.mean.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">{t("history.stdDev")}</p>
                          <p className="text-2xl font-bold text-foreground">{aiAnalysis.statistics.stdDev.toFixed(2)}</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">{t("history.lowest")}</p>
                          <p className="text-2xl font-bold text-destructive">{aiAnalysis.statistics.min.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">{t("history.highest")}</p>
                          <p className="text-2xl font-bold text-success">{aiAnalysis.statistics.max.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">{t("history.current")}</p>
                          <p className={`text-2xl font-bold ${
                            aiAnalysis.statistics.current >= 95 ? 'text-success' :
                            aiAnalysis.statistics.current >= 90 ? 'text-warning' : 'text-destructive'
                          }`}>{aiAnalysis.statistics.current.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* Trend Prediction */}
                  {aiAnalysis.trendPrediction && (
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {aiAnalysis.trendPrediction.trend === 'increasing' ? (
                            <ArrowUp className="h-5 w-5 text-success" />
                          ) : aiAnalysis.trendPrediction.trend === 'decreasing' ? (
                            <ArrowDown className="h-5 w-5 text-destructive" />
                          ) : (
                            <Minus className="h-5 w-5 text-muted-foreground" />
                          )}
                          {t("history.trendPrediction")}
                          <Badge variant={aiAnalysis.trendPrediction.trend === 'increasing' ? 'default' : 
                            aiAnalysis.trendPrediction.trend === 'decreasing' ? 'destructive' : 'secondary'}>
                            {aiAnalysis.trendPrediction.trend === 'increasing' ? t('history.increasing') :
                             aiAnalysis.trendPrediction.trend === 'decreasing' ? t('history.decreasing') : t('history.stable')}
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          {t("history.predictionDesc", { confidence: aiAnalysis.trendPrediction.confidence.toFixed(0) })}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-62.5">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={aiAnalysis.trendPrediction.predictions}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                              <YAxis stroke="#9ca3af" fontSize={12} domain={[80, 100]} />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: '#1f2937', 
                                  border: '1px solid #374151',
                                  borderRadius: '8px'
                                }}
                                formatter={(value: number) => [`${value.toFixed(1)}%`, t('history.predictedYield')]}
                              />
                              <Bar dataKey="predictedYield" name={t("history.prediction")} fill="#14b8a6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Anomalies */}
                  {aiAnalysis.anomalies && aiAnalysis.anomalies.length > 0 && (
                    <Card className="glass-card border-warning/50">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-warning" />
                          {t("history.anomalyDetection")}
                          <Badge variant="outline" className="ml-2">{aiAnalysis.anomalies.length} {t("history.points")}</Badge>
                        </CardTitle>
                        <CardDescription>
                          {t("history.anomalyDesc")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {aiAnalysis.anomalies.map((anomaly) => (
                            <div 
                              key={`${anomaly.date}-${anomaly.type}`}
                              className={`p-4 rounded-lg flex items-center justify-between ${
                                anomaly.severity === 'critical' ? 'bg-destructive/20' : 'bg-warning/20'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {anomaly.type === 'low' ? (
                                  <TrendingDown className={`h-5 w-5 ${
                                    anomaly.severity === 'critical' ? 'text-destructive' : 'text-warning'
                                  }`} />
                                ) : (
                                  <TrendingUp className="h-5 w-5 text-success" />
                                )}
                                <div>
                                  <span className="font-medium text-foreground block">{anomaly.date}</span>
                                  <span className="text-sm text-muted-foreground block">
                                    Yield: {anomaly.yieldRate.toFixed(1)}% ({anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(1)}% {t("history.vsAverage")})
                                  </span>
                                </div>
                              </div>
                              <Badge variant={anomaly.severity === 'critical' ? 'destructive' : 'secondary'}>
                                {anomaly.severity === 'critical' ? t('history.critical') : t('history.warningLabel')}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Recommendations */}
                  {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Lightbulb className="h-5 w-5 text-yellow-500" />{t("history.improvementRecommendations")}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {aiAnalysis.recommendations.map((rec, index) => (
                            <div key={`recommendation-${index}`} className="p-4 rounded-lg bg-secondary/30 flex items-start gap-3">
                              <span className="text-lg">{rec.split(' ')[0]}</span>
                              <p className="text-foreground">{rec.substring(rec.indexOf(' ') + 1)}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Defect Pattern Clusters */}
                  {defectClusters && defectClusters.length > 0 && (
                    <Card className="glass-card border-primary/50">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Activity className="h-5 w-5 text-primary" />
                          Phân cụm mẫu lỗi (Defect Pattern Clustering)
                          <Badge variant="outline" className="ml-2">{defectClusters.length} cụm</Badge>
                        </CardTitle>
                        <CardDescription>
                          Nhóm các điểm đo NG theo loại lỗi, giúp nhận diện xu hướng lỗi và ưu tiên cải thiện
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {defectClusters.map((cluster) => (
                            <div key={cluster.type} className="p-4 rounded-lg bg-secondary/30 border border-border">
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="font-semibold text-foreground">{cluster.clusterName}</h4>
                                <Badge variant="destructive">{cluster.totalNG} NG</Badge>
                              </div>
                              <div className="flex gap-4 text-sm text-muted-foreground mb-3">
                                <span>Ảnh hưởng: {cluster.affectedInspections} lần kiểm tra</span>
                              </div>
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top điểm đo lỗi:</p>
                                {cluster.topPoints.map((point) => (
                                  <div key={point.pointDefId} className="flex items-center justify-between text-sm">
                                    <span className="text-foreground truncate mr-2" title={point.name}>
                                      {point.code} - {point.name}
                                    </span>
                                    <Badge variant="outline" className="shrink-0">{point.ngCount}×</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card className="glass-card">
                  <CardContent className="py-12 text-center">
                    <Brain className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">{t("history.noAIData")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("history.minDataRequired")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Yield Statistics Tab */}
          <TabsContent value="yield">
            <div className="space-y-6">
              {/* Yield Stats Header */}
              <Card className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Target className="h-5 w-5 text-primary" />{t("history.yieldStatsTitle")}</CardTitle>
                      <CardDescription>
                        {t("history.yieldStatsDesc")}
                      </CardDescription>
                    </div>
                    {analysisStats && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="gap-2">
                            <Download className="h-4 w-4" />{t("history.exportReport")}</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => exportYieldReport('pdf')}>
                            <FileText className="h-4 w-4 mr-2" />{t("history.exportPdf")}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportYieldReport('excel')}>
                            <FileSpreadsheet className="h-4 w-4 mr-2" />{t("history.exportExcelBtn")}</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => exportYieldReport('csv')}>
                            <Download className="h-4 w-4 mr-2" />{t("history.exportCsv")}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
              </Card>

              {analysisStats ? (
                <>
                  {/* KPI Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* FPY Card */}
                    <Card className="glass-card border-l-4 border-l-primary">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t("history.currentFpy")}</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-primary">
                              {analysisStats.yieldRate.toFixed(2)}%
                            </span>
                            <span className={`text-sm ${analysisStats.yieldRate >= 98.5 ? 'text-success' : 'text-warning'}`}>
                              {analysisStats.yieldRate >= 98.5 ? '↑' : '↓'}{Math.abs(analysisStats.yieldRate - 98.5).toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("history.targetFpy")}</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Daily Fail Yield Card */}
                    <Card className="glass-card border-l-4 border-l-warning">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t("history.dailyFailYield")}</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-warning">
                              {(100 - analysisStats.yieldRate).toFixed(2)}%
                            </span>
                            <span className={`text-sm ${(100 - analysisStats.yieldRate) <= 1.5 ? 'text-success' : 'text-destructive'}`}>
                              {(100 - analysisStats.yieldRate) <= 1.5 ? '↓' : '↑'}{Math.abs((100 - analysisStats.yieldRate) - 1.5).toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("history.thresholdFail")}</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* NTF Yield Card */}
                    <Card className="glass-card border-l-4 border-l-cyan-500">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t("history.avgNtfYield")}</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-cyan-500">
                              {((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100).toFixed(2)}%
                            </span>
                            <span className={`text-sm ${((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100) <= 1.0 ? 'text-success' : 'text-warning'}`}>
                              {((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100) <= 1.0 ? '↓' : '↑'}0.01%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("history.targetNtf")}</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* UPH Card */}
                    <Card className="glass-card border-l-4 border-l-success">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">{t("history.avgUph")}</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-success">
                              {Math.round(analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24)}
                            </span>
                            <span className="text-sm text-destructive">
                              ↓{Math.round(1500 - (analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24))}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{t("history.capacityUph")}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Charts Row 1 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* FPY Trend Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg">{t("history.fpyTrendTitle")}</CardTitle>
                        <CardDescription>{t("history.fpyTrendDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-70">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analysisStats.dateStats.map((d, i) => ({
                              ...d,
                              dayName: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i % 7]
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                              <XAxis dataKey="dayName" stroke="#6b7280" fontSize={12} axisLine={false} tickLine={false} />
                              <YAxis stroke="#6b7280" fontSize={12} domain={[96, 100]} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                                formatter={(value: number) => [`${value.toFixed(2)}%`, 'FPY']}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="yieldRate" 
                                stroke="#3b82f6" 
                                strokeWidth={3}
                                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                                activeDot={{ r: 6, fill: '#3b82f6' }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Fail Yield Trend Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg">{t("history.failYieldTrend")}</CardTitle>
                        <CardDescription>{t("history.failYieldTrendDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-70">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analysisStats.dateStats.map((d, i) => ({
                              ...d,
                              failRate: 100 - d.yieldRate,
                              dayName: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i % 7]
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                              <XAxis dataKey="dayName" stroke="#6b7280" fontSize={12} axisLine={false} tickLine={false} />
                              <YAxis stroke="#6b7280" fontSize={12} domain={[0, 5]} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                                formatter={(value: number) => [`${value.toFixed(2)}%`, 'Fail Rate']}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="failRate" 
                                stroke="#f97316" 
                                strokeWidth={3}
                                dot={{ fill: '#f97316', strokeWidth: 2, r: 4 }}
                                activeDot={{ r: 6, fill: '#f97316' }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Charts Row 2 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* NTF Yield Trend Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg">{t("history.ntfYieldTitle")}</CardTitle>
                        <CardDescription>{t("history.ntfYieldDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-70">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analysisStats.dateStats.map((d, i) => ({
                              ...d,
                              ntfRate: d.total > 0 ? (d.ntf / d.total) * 100 : 0,
                              dayName: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i % 7]
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                              <XAxis dataKey="dayName" stroke="#6b7280" fontSize={12} axisLine={false} tickLine={false} />
                              <YAxis stroke="#6b7280" fontSize={12} domain={[0, 3]} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                                formatter={(value: number) => [`${value.toFixed(2)}%`, 'NTF Rate']}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="ntfRate" 
                                stroke="#06b6d4" 
                                strokeWidth={3}
                                dot={{ fill: '#06b6d4', strokeWidth: 2, r: 4 }}
                                activeDot={{ r: 6, fill: '#06b6d4' }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>

                    {/* UPH Trend Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg">{t("history.uphTrendTitle")}</CardTitle>
                        <CardDescription>{t("history.uphTrendDesc")}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-70">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analysisStats.dateStats.map((d, i) => ({
                              ...d,
                              uph: Math.round(d.total * 24 / 8), // Assume 8 working hours
                              dayName: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][i % 7]
                            }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                              <XAxis dataKey="dayName" stroke="#6b7280" fontSize={12} axisLine={false} tickLine={false} />
                              <YAxis stroke="#6b7280" fontSize={12} axisLine={false} tickLine={false} />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                                formatter={(value: number) => [value, 'UPH']}
                              />
                              <Bar 
                                dataKey="uph" 
                                fill="#1e3a5f"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Summary Table */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />{t("history.yieldSummaryByDay")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">{t("common.date")}</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">{t("common.total")}</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">OK</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">NG</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">NTF</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">FPY</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Fail Rate</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">NTF Rate</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">UPH</th>
                            </tr>
                          </thead>
                          <tbody>
                            {analysisStats.dateStats.map((day, i) => (
                              <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                                <td className="py-3 px-4 text-sm font-medium">{day.date}</td>
                                <td className="py-3 px-4 text-sm text-right">{day.total}</td>
                                <td className="py-3 px-4 text-sm text-right text-success">{day.ok}</td>
                                <td className="py-3 px-4 text-sm text-right text-destructive">{day.ng}</td>
                                <td className="py-3 px-4 text-sm text-right text-warning">{day.ntf}</td>
                                <td className="py-3 px-4 text-sm text-right">
                                  <span className={day.yieldRate >= 98.5 ? 'text-success' : 'text-warning'}>
                                    {day.yieldRate.toFixed(2)}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-sm text-right">
                                  <span className={(100 - day.yieldRate) <= 1.5 ? 'text-success' : 'text-destructive'}>
                                    {(100 - day.yieldRate).toFixed(2)}%
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-sm text-right">
                                  {day.total > 0 ? ((day.ntf / day.total) * 100).toFixed(2) : '0.00'}%
                                </td>
                                <td className="py-3 px-4 text-sm text-right">
                                  {Math.round(day.total * 24 / 8)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card className="glass-card">
                  <CardContent className="py-12 text-center">
                    <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">{t("history.noYieldData")}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("history.tryDifferentFilters")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Compare Tab */}
          <TabsContent value="compare">
            <HistoryComparison />
          </TabsContent>

          {/* Gallery Tab */}
          <TabsContent value="gallery">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Image className="h-5 w-5" />{t("history.galleryTitle")}</CardTitle>
                  <CardDescription>
                    {t("history.galleryDesc")}
                  </CardDescription>
                </div>
                <AnnotationSearch />
              </CardHeader>
              <CardContent>
                {isLoadingGallery ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                ) : galleryData?.data && galleryData.data.length > 0 ? (
                  <ImageGallery
                    images={galleryData.data.map((item: any, idx: number) => ({
                      id: `${item.inspectionId}-${item.pointDefId || idx}`,
                      url: item.imageUrl || '',
                      thumbnailUrl: item.imageUrl || '',
                      title: `${item.serialNumber} - ${item.pointName || item.pointCode || `${t("history.pointLabel")} ${idx + 1}`}`,
                      description: item.remark || '',
                      result: item.result as "OK" | "NG" | "NTF",
                      measurementPointId: item.pointDefId,
                      measurementPointName: item.pointName || item.pointCode || `${t("history.measurementPoint")} ${idx + 1}`,
                      value: item.measuredValue ?? item.measuredValueText,
                      timestamp: new Date(item.inspectionTime),
                    } as GalleryImage)).filter((img: GalleryImage) => img.url)}
                    title={t("history.measurementImages")}
                    showFilters={true}
                    showSearch={true}
                    columns={5}
                  />
                ) : (
                  <EmptyState
                    icon={Image}
                    title={t("history.noImages")}
                    description={t("history.noImagesDesc")}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      
      {/* Barcode Scanner Dialog */}
      <BarcodeScanner
        open={isScannerOpen}
        onOpenChange={setIsScannerOpen}
        onScan={(serialNumber) => {
          setFilters({ ...filters, serialNumber });
          setPage(1);
          toast.success(t("history.searchedFor", { serialNumber: serialNumber }));
        }}
      />
    </DashboardLayout>
  );
}
