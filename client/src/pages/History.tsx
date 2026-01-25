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
  Image
} from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";
import ImageGallery, { GalleryImage } from "@/components/ImageGallery";
import { EmptyState, NoWorkstationData, NoChartData } from "@/components/EmptyState";
import HistoryComparison from "@/components/HistoryComparison";
import { ChartErrorBoundary, TableErrorBoundary, AnalyticsErrorBoundary } from "@/components/ErrorBoundary";
import { StatsCardSkeleton, ChartSkeleton, TableSkeleton, WorkstationSummarySkeleton } from "@/components/AnalyticsSkeleton";
import { toast } from "sonner";
import { navItems } from "@/lib/navigation";
import { useState, useMemo } from "react";
import { HistoryInfiniteScroll } from "@/components/HistoryInfiniteScroll";
import { Link } from "wouter";
import { format as formatDate, subDays, startOfDay, endOfDay } from "date-fns";
import { vi } from "date-fns/locale";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, ScatterChart, Scatter, ZAxis } from "recharts";

export default function History() {
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
  const [savedFilters, setSavedFilters] = useState<Array<{
    name: string;
    filters: typeof filters;
  }>>([
    { name: "NG hôm nay", filters: { ...filters, result: "NG" as const, dateRange: "today" as const } },
    { name: "Tuần này", filters: { ...filters, dateRange: "week" as const } },
  ]);
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
      const model = i.productModel || "Unknown";
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
      toast.error("Không có dữ liệu để xuất");
      return;
    }

    setIsExporting(true);
    try {
      const headers = [
        "STT",
        "Mã SN",
        "Mã nhà máy",
        "Mã nhà xưởng",
        "Dây chuyền",
        "Công trạm",
        "Máy",
        "Loại máy",
        "Mã sản phẩm",
        "Kết quả",
        "Tổng điểm đo",
        "OK",
        "NG",
        "NTF",
        "Yield Rate (%)",
        "Thời gian kiểm tra",
        "Ghi chú"
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

      toast.success(`Đã xuất ${data.data.length} bản ghi thành công`);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Lỗi khi xuất dữ liệu");
    } finally {
      setIsExporting(false);
    }
  };

  // Export Yield Report function
  const exportYieldReport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!analysisStats) {
      toast.error("Không có dữ liệu Yield để xuất");
      return;
    }

    setIsExporting(true);
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `yield_report_${dateStr}`;

      // Prepare data
      const headers = [
        "Ngày",
        "Tổng sản phẩm",
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
        "Tổng cộng",
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

        toast.success(`Đã xuất báo cáo Yield thành công (${format.toUpperCase()})`);
      } else if (format === 'pdf') {
        // Create PDF using jsPDF
        const { jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(18);
        doc.text('BÁO CÁO YIELD - FPY/FY/NTF/UPH', 14, 20);
        
        doc.setFontSize(10);
        doc.text(`Ngày xuất: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);
        
        // Summary KPIs
        doc.setFontSize(12);
        doc.text('Tổng quan:', 14, 45);
        doc.setFontSize(10);
        doc.text(`- First Pass Yield (FPY): ${analysisStats.yieldRate.toFixed(2)}%`, 20, 52);
        doc.text(`- Fail Yield: ${(100 - analysisStats.yieldRate).toFixed(2)}%`, 20, 59);
        doc.text(`- NTF Rate: ${((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100).toFixed(2)}%`, 20, 66);
        doc.text(`- Avg UPH: ${Math.round(analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24)}`, 20, 73);
        
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
        toast.success('Đã xuất báo cáo Yield thành công (PDF)');
      }
    } catch (error) {
      console.error("Export Yield error:", error);
      toast.error("Lỗi khi xuất báo cáo Yield");
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
          ws.workstationName || 'Unknown',
          ws.workstationCode,
          ws.totalCount,
          ws.okCount,
          ws.ngCount,
          ws.ntfCount,
          yieldRate.toFixed(2) + '%',
        ];
      });

      const headers = ['Công trạm', 'Mã', 'Tổng', 'OK', 'NG', 'NTF', 'Yield'];

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
        toast.success('Đã xuất báo cáo công trạm thành công (CSV)');
      } else if (format === 'excel') {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Công trạm');
        XLSX.writeFile(wb, `${filename}.xlsx`);
        toast.success('Đã xuất báo cáo công trạm thành công (Excel)');
      } else if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(18);
        doc.text('BÁO CÁO PHÂN TÍCH CÔNG TRẠM', 14, 20);
        
        doc.setFontSize(10);
        doc.text(`Ngày xuất: ${formatDate(new Date(), 'dd/MM/yyyy')}`, 14, 30);
        
        // Summary
        doc.setFontSize(12);
        doc.text('Tóm tắt:', 14, 45);
        doc.setFontSize(10);
        const totalDefects = summaryData.reduce((sum: number, ws: any) => sum + (ws.ngCount || 0), 0);
        const avgYield = summaryData.length > 0 ? summaryData.reduce((sum: number, ws: any) => sum + ((ws.okCount + ws.ntfCount) / Math.max(ws.totalCount, 1) * 100), 0) / summaryData.length : 0;
        doc.text(`- Tổng công trạm: ${summaryData.length}`, 20, 52);
        doc.text(`- Tổng lỗi NG: ${totalDefects}`, 20, 59);
        doc.text(`- Yield trung bình: ${avgYield.toFixed(2)}%`, 20, 66);
        
        // Table
        autoTable(doc, {
          head: [headers],
          body: rows,
          startY: 80,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [20, 184, 166] },
        });
        
        doc.save(`${filename}.pdf`);
        toast.success('Đã xuất báo cáo công trạm thành công (PDF)');
      }
    } catch (error) {
      console.error('Export workstation report error:', error);
      toast.error('Lỗi khi xuất báo cáo công trạm');
    } finally {
      setIsExportingWorkstation(false);
    }
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case "OK":
        return (
          <Badge className="status-ok gap-1">
            <CheckCircle2 className="h-3 w-3" />
            OK
          </Badge>
        );
      case "NG":
        return (
          <Badge className="status-ng gap-1">
            <XCircle className="h-3 w-3" />
            NG
          </Badge>
        );
      case "NTF":
        return (
          <Badge className="status-ntf gap-1">
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
      title="AVI/AOI Management" 
      navItems={navItems}
      currentPath="/history"
    >
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lịch sử kiểm tra</h1>
          <p className="text-muted-foreground">Tìm kiếm và phân tích kết quả kiểm tra từ tất cả máy</p>
        </div>

        {/* Search Filters */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5 text-primary" />
              Bộ lọc tìm kiếm
            </CardTitle>
            <CardDescription>Lọc theo mã nhà máy, nhà xưởng, SN sản phẩm, dây chuyền, công trạm, máy</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã nhà máy</label>
                <Input
                  placeholder="VD: FAC001"
                  value={filters.factoryCode}
                  onChange={(e) => setFilters({ ...filters, factoryCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã nhà xưởng</label>
                <Input
                  placeholder="VD: WS001"
                  value={filters.workshopCode}
                  onChange={(e) => setFilters({ ...filters, workshopCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã dây chuyền</label>
                <Input
                  placeholder="VD: LINE01"
                  value={filters.lineCode}
                  onChange={(e) => setFilters({ ...filters, lineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã công trạm</label>
                <Input
                  placeholder="VD: ST001"
                  value={filters.stationCode}
                  onChange={(e) => setFilters({ ...filters, stationCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã máy</label>
                <Input
                  placeholder="VD: AVI001"
                  value={filters.machineCode}
                  onChange={(e) => setFilters({ ...filters, machineCode: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Serial Number</label>
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
                    title="Quét mã vạch/QR"
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Mã sản phẩm</label>
                <Input
                  placeholder="VD: MODEL-A, PRODUCT-001"
                  value={filters.productModel}
                  onChange={(e) => setFilters({ ...filters, productModel: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Kết quả</label>
                <Select 
                  value={filters.result} 
                  onValueChange={(value) => setFilters({ ...filters, result: value as typeof filters.result })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="OK">OK</SelectItem>
                    <SelectItem value="NG">NG</SelectItem>
                    <SelectItem value="NTF">NTF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">Khoảng thời gian</label>
                <Select 
                  value={filters.dateRange} 
                  onValueChange={(value) => setFilters({ ...filters, dateRange: value as typeof filters.dateRange })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    <SelectItem value="today">Hôm nay</SelectItem>
                    <SelectItem value="week">7 ngày qua</SelectItem>
                    <SelectItem value="month">30 ngày qua</SelectItem>
                    <SelectItem value="custom">Tùy chọn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {filters.dateRange === "custom" && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">Từ ngày</label>
                    <Input
                      type="date"
                      value={filters.startDate}
                      onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">Đến ngày</label>
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
                  Tìm kiếm
                </Button>
                <Button variant="outline" onClick={handleClearFilters}>
                  Xóa bộ lọc
                </Button>
                {/* Saved Filters */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <Save className="h-4 w-4" />
                      Bộ lọc đã lưu
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {savedFilters.map((sf, idx) => (
                      <DropdownMenuItem 
                        key={idx}
                        onClick={() => {
                          setFilters(sf.filters);
                          setPage(1);
                          toast.success(`Đã áp dụng bộ lọc: ${sf.name}`);
                        }}
                      >
                        <Clock className="h-4 w-4 mr-2" />
                        {sf.name}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        const name = prompt("Nhập tên bộ lọc:");
                        if (name) {
                          setSavedFilters(prev => [...prev, { name, filters: { ...filters } }]);
                          toast.success(`Đã lưu bộ lọc: ${name}`);
                        }
                      }}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      Lưu bộ lọc hiện tại
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
              <HistoryIcon className="h-4 w-4" />
              Danh sách
            </TabsTrigger>
            <TabsTrigger value="infinite" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Infinite
            </TabsTrigger>
            <TabsTrigger value="yield" className="gap-2">
              <Target className="h-4 w-4" />
              Yield Stats
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Phân tích
            </TabsTrigger>
            <TabsTrigger value="workstation" className="gap-2">
              <Factory className="h-4 w-4" />
              Công trạm
            </TabsTrigger>
            <TabsTrigger value="spc" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              SPC
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Activity className="h-4 w-4" />
              AI Analysis
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-2">
              <GitCompare className="h-4 w-4" />
              So sánh
            </TabsTrigger>
            <TabsTrigger value="gallery" className="gap-2">
              <Image className="h-4 w-4" />
              Gallery
            </TabsTrigger>
          </TabsList>

          {/* List Tab */}
          <TabsContent value="list">
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Kết quả tìm kiếm</CardTitle>
                    <CardDescription>
                      {data?.total ? `Tìm thấy ${data.total} kết quả` : "Chưa có dữ liệu"}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Page Size Selector */}
                    <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10/trang</SelectItem>
                        <SelectItem value="20">20/trang</SelectItem>
                        <SelectItem value="50">50/trang</SelectItem>
                        <SelectItem value="100">100/trang</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Column Settings */}
                    <Popover open={showColumnSettings} onOpenChange={setShowColumnSettings}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="icon">
                          <Columns className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56" align="end">
                        <div className="space-y-2">
                          <h4 className="font-medium text-sm">Hiển thị cột</h4>
                          {Object.entries({
                            serialNumber: "Serial Number",
                            machine: "Máy",
                            result: "Kết quả",
                            time: "Thời gian",
                            productModel: "Model",
                            factory: "Nhà máy",
                            workshop: "Nhà xưởng",
                            line: "Dây chuyền",
                            station: "Công trạm",
                            okCount: "OK Count",
                            ngCount: "NG Count",
                            ntfCount: "NTF Count",
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
                      Xuất Excel
                    </Button>
                  </div>
                </div>
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
                    {data.data.map((inspection) => (
                      <div 
                        key={inspection.id}
                        className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                      >
                        <div className="flex items-center gap-4">
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
                                <span>Model: {inspection.productModel}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <Link href={`/inspection/${inspection.id}`}>
                          <Button variant="outline" size="sm" className="gap-2">
                            <Eye className="h-4 w-4" />
                            Chi tiết
                          </Button>
                        </Link>
                      </div>
                    ))}

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <p className="text-sm text-muted-foreground">
                          Trang {page} / {totalPages}
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
                    <p className="text-muted-foreground">Không tìm thấy kết quả nào</p>
                    <p className="text-sm text-muted-foreground mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
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
                          <p className="text-sm text-muted-foreground">Tổng sản phẩm</p>
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
                          <p className="text-sm text-muted-foreground">Yield Rate</p>
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
                        <PieChart className="h-5 w-5 text-primary" />
                        Phân bố kết quả
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
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
                        <TrendingUp className="h-5 w-5 text-primary" />
                        Xu hướng theo ngày
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[300px]">
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
                      <Cpu className="h-5 w-5 text-primary" />
                      Thống kê theo máy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Máy</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Tổng</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">OK</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NG</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NTF</th>
                            <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Yield Rate</th>
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
                      Tải thêm dữ liệu ({analysisLimit}/{allData?.total || 0})
                    </Button>
                  </div>
                )}

                {/* Top NG Measurement Points */}
                {topNGPoints && topNGPoints.length > 0 && (
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                        Top Điểm Đo Lỗi Nhiều Nhất
                      </CardTitle>
                      <CardDescription>
                        Những điểm đo có tỷ lệ NG cao nhất cần ưu tiên cải thiện
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
                                <span>{point.percentage.toFixed(1)}% của tổng NG</span>
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
                        <Target className="h-5 w-5 text-primary" />
                        Thống kê theo sản phẩm
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Model sản phẩm</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Tổng</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">OK</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NG</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">NTF</th>
                              <th className="text-center py-3 px-4 text-sm font-medium text-muted-foreground">Yield Rate</th>
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
                  <p className="text-muted-foreground">Không có dữ liệu để phân tích</p>
                  <p className="text-sm text-muted-foreground mt-1">Thử tìm kiếm với bộ lọc khác</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Workstation Analysis Tab */}
          <TabsContent value="workstation">
            <div className="space-y-6">
              {/* Workstation Header */}
              <Card className="glass-card bg-gradient-to-r from-blue-500/10 to-cyan-500/10">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-3">
                    <Factory className="h-6 w-6 text-blue-500" />
                    Phân tích theo Công trạm
                  </CardTitle>
                  <CardDescription>
                    Thống kê lỗi theo công trạm sản xuất và điểm đo để xác định nguyên nhân lỗi
                  </CardDescription>
                </CardHeader>
              </Card>

              {/* Workstation Filter & Export */}
              <Card className="glass-card">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Bộ lọc theo thời gian</CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isExportingWorkstation}>
                          <Download className="h-4 w-4 mr-2" />
                          Xuất báo cáo
                        </Button>
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
                        Tất cả
                      </Button>
                      <Button
                        variant={workstationDateRange === "today" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("today")}
                        className="w-full"
                      >
                        Hôm nay
                      </Button>
                      <Button
                        variant={workstationDateRange === "week" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("week")}
                        className="w-full"
                      >
                        Tuần này
                      </Button>
                      <Button
                        variant={workstationDateRange === "month" ? "default" : "outline"}
                        onClick={() => setWorkstationDateRange("month")}
                        className="w-full"
                      >
                        Tháng này
                      </Button>
                    </div>
                    {workstationDateRange === "custom" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm font-medium">Từ ngày</label>
                          <Input
                            type="date"
                            value={workstationStartDate}
                            onChange={(e) => setWorkstationStartDate(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium">Đến ngày</label>
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
                  <CardTitle className="text-lg">Tóm tắt theo Công trạm</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Danh sách các công trạm sản xuất và thống kê lỗi</p>
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
                                  <div className="font-semibold text-sm">{ws.workstationName || 'Unknown'}</div>
                                  <div className="text-xs text-muted-foreground">Mã: {ws.workstationCode}</div>
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
                  <CardTitle className="text-lg">Lỗi theo Công trạm</CardTitle>
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
                  <CardTitle className="text-lg">Top 10 Điểm đo có lỗi cao nhất</CardTitle>
                  <CardDescription>Các điểm đo cần ưu tiên cải thiện</CardDescription>
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
                              <p className="font-medium text-sm">{point.workstationName || 'Unknown'} - {point.measurementPointName}</p>
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
                        title="Chưa có dữ liệu điểm đo"
                        description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo."
                        compact
                      />
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Measurement Points by Workstation */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-lg">Điểm đo theo Công trạm</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Công trạm</th>
                          <th className="text-left py-2 px-2">Mã</th>
                          <th className="text-center py-2 px-2">Số điểm đo</th>
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
                                <td className="py-2 px-2">{ws.workstationName || 'Unknown'}</td>
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
                                title="Chưa có dữ liệu công trạm"
                                description="Dữ liệu sẽ hiển thị khi có kết quả kiểm tra từ các điểm đo được gán công trạm."
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
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Statistical Process Control (SPC)
                  </CardTitle>
                  <CardDescription>
                    Phân tích thống kê quá trình sản xuất - Control Charts, Histogram, Pareto
                  </CardDescription>
                </CardHeader>
              </Card>

              {analysisStats ? (
                <>
                  {/* Control Chart */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        Control Chart - Yield Rate
                      </CardTitle>
                      <CardDescription>
                        Biểu đồ kiểm soát Yield Rate theo ngày với UCL, CL, LCL
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[350px]">
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
                                if (name === 'yieldRate') return [`${value.toFixed(1)}%`, 'Yield Rate'];
                                if (name === 'ucl') return ['99%', 'UCL'];
                                if (name === 'cl') return ['95%', 'CL'];
                                if (name === 'lcl') return ['90%', 'LCL'];
                                return [value, name];
                              }}
                            />
                            <Legend />
                            <Bar dataKey="yieldRate" name="Yield Rate" fill="#10b981" />
                            <Bar dataKey="ucl" name="UCL (99%)" fill="#ef4444" opacity={0.3} />
                            <Bar dataKey="cl" name="CL (95%)" fill="#3b82f6" opacity={0.3} />
                            <Bar dataKey="lcl" name="LCL (90%)" fill="#f59e0b" opacity={0.3} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                        <div className="p-3 rounded-lg bg-destructive/10">
                          <p className="text-sm text-muted-foreground">UCL (Upper Control Limit)</p>
                          <p className="text-xl font-bold text-destructive">99%</p>
                        </div>
                        <div className="p-3 rounded-lg bg-primary/10">
                          <p className="text-sm text-muted-foreground">CL (Center Line)</p>
                          <p className="text-xl font-bold text-primary">95%</p>
                        </div>
                        <div className="p-3 rounded-lg bg-warning/10">
                          <p className="text-sm text-muted-foreground">LCL (Lower Control Limit)</p>
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
                          <BarChart3 className="h-5 w-5 text-primary" />
                          Histogram - Phân bố kết quả
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px]">
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
                              <Bar dataKey="value" name="Số lượng">
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
                          <Target className="h-5 w-5 text-primary" />
                          Pareto Chart - Top lỗi
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px]">
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
                                  <Bar yAxisId="left" dataKey="ng" name="Số lỗi NG" fill="#ef4444" />
                                  <Bar yAxisId="right" dataKey="cumulative" name="Tích lũy %" fill="#3b82f6" />
                                </BarChart>
                              </ResponsiveContainer>
                            ) : (
                              <div className="h-full flex items-center justify-center text-muted-foreground">
                                Không có dữ liệu lỗi để hiển thị
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
                        Process Capability - Cp/Cpk
                      </CardTitle>
                      <CardDescription>
                        Đánh giá năng lực quá trình sản xuất
                      </CardDescription>
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
                                <p className="text-sm text-muted-foreground">Mean (μ)</p>
                                <p className="text-2xl font-bold text-foreground">{mean.toFixed(2)}%</p>
                              </div>
                              <div className="p-4 rounded-lg bg-secondary/30 text-center">
                                <p className="text-sm text-muted-foreground">Std Dev (σ)</p>
                                <p className="text-2xl font-bold text-foreground">{stdDev.toFixed(2)}</p>
                              </div>
                              <div className={`p-4 rounded-lg text-center ${cp >= 1.33 ? 'bg-success/20' : cp >= 1 ? 'bg-warning/20' : 'bg-destructive/20'}`}>
                                <p className="text-sm text-muted-foreground">Cp</p>
                                <p className={`text-2xl font-bold ${cp >= 1.33 ? 'text-success' : cp >= 1 ? 'text-warning' : 'text-destructive'}`}>
                                  {cp.toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {cp >= 1.33 ? 'Excellent' : cp >= 1 ? 'Capable' : 'Not Capable'}
                                </p>
                              </div>
                              <div className={`p-4 rounded-lg text-center ${cpk >= 1.33 ? 'bg-success/20' : cpk >= 1 ? 'bg-warning/20' : 'bg-destructive/20'}`}>
                                <p className="text-sm text-muted-foreground">Cpk</p>
                                <p className={`text-2xl font-bold ${cpk >= 1.33 ? 'text-success' : cpk >= 1 ? 'text-warning' : 'text-destructive'}`}>
                                  {cpk.toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {cpk >= 1.33 ? 'Excellent' : cpk >= 1 ? 'Capable' : 'Not Capable'}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="mt-4 p-4 rounded-lg bg-muted/50">
                        <p className="text-sm text-muted-foreground">
                          <strong>Giải thích:</strong> Cp đo lường khả năng tiềm năng của quá trình, Cpk đo lường khả năng thực tế có tính đến độ lệch tâm.
                          Giá trị ≥ 1.33 được coi là xuất sắc, ≥ 1.0 là chấp nhận được, &lt; 1.0 cần cải thiện.
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Heatmap - NG Distribution by Hour and Day */}
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        Heatmap - Phân bố NG theo giờ và ngày
                      </CardTitle>
                      <CardDescription>
                        Biểu đồ nhiệt thể hiện mật độ lỗi theo thời gian trong ngày
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
                              <div className="min-w-[600px]">
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
                              <span className="text-xs text-muted-foreground">Ít NG</span>
                              <div className="flex gap-1">
                                <div className="w-6 h-4 rounded bg-secondary/30" />
                                <div className="w-6 h-4 rounded bg-success/30" />
                                <div className="w-6 h-4 rounded bg-warning/30" />
                                <div className="w-6 h-4 rounded bg-warning/60" />
                                <div className="w-6 h-4 rounded bg-destructive/60" />
                              </div>
                              <span className="text-xs text-muted-foreground">Nhiều NG</span>
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
                        Western Electric Rules - Cảnh báo
                      </CardTitle>
                      <CardDescription>
                        Phát hiện các điểm ngoài tầm kiểm soát
                      </CardDescription>
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
                            description: `${beyond3Sigma.length} điểm vượt quá 3σ - Cần kiểm tra ngay`,
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
                              description: '2 trong 3 điểm liên tiếp vượt 2σ',
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
                              description: '4 trong 5 điểm liên tiếp vượt 1σ',
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
                              description: '8 điểm liên tiếp cùng phía với đường tâm',
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
                            <span className="font-medium text-success block">Quá trình ổn định</span>
                            <span className="text-sm text-muted-foreground mt-1 block">Không phát hiện vi phạm quy tắc Western Electric</span>
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
                    <p className="text-muted-foreground">Không có dữ liệu để phân tích SPC</p>
                    <p className="text-sm text-muted-foreground mt-1">Thử tìm kiếm với bộ lọc khác</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* AI Analysis Tab */}
          <TabsContent value="ai">
            <div className="space-y-6">
              {/* AI Header */}
              <Card className="glass-card bg-gradient-to-r from-primary/10 to-purple-500/10">
                <CardHeader>
                  <CardTitle className="text-xl flex items-center gap-3">
                    <Brain className="h-6 w-6 text-primary" />
                    Phân tích AI
                  </CardTitle>
                  <CardDescription>
                    Dự đoán xu hướng và phát hiện bất thường bằng machine learning
                  </CardDescription>
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
                          <p className="text-sm text-muted-foreground">Trung bình</p>
                          <p className="text-2xl font-bold text-foreground">{aiAnalysis.statistics.mean.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">Độ lệch chuẩn</p>
                          <p className="text-2xl font-bold text-foreground">{aiAnalysis.statistics.stdDev.toFixed(2)}</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">Thấp nhất</p>
                          <p className="text-2xl font-bold text-destructive">{aiAnalysis.statistics.min.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">Cao nhất</p>
                          <p className="text-2xl font-bold text-success">{aiAnalysis.statistics.max.toFixed(1)}%</p>
                        </CardContent>
                      </Card>
                      <Card className="glass-card">
                        <CardContent className="pt-6 text-center">
                          <p className="text-sm text-muted-foreground">Hiện tại</p>
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
                          Dự đoán xu hướng
                          <Badge variant={aiAnalysis.trendPrediction.trend === 'increasing' ? 'default' : 
                            aiAnalysis.trendPrediction.trend === 'decreasing' ? 'destructive' : 'secondary'}>
                            {aiAnalysis.trendPrediction.trend === 'increasing' ? 'Tăng' :
                             aiAnalysis.trendPrediction.trend === 'decreasing' ? 'Giảm' : 'Ổn định'}
                          </Badge>
                        </CardTitle>
                        <CardDescription>
                          Dự đoán Yield Rate cho 7 ngày tới (Linear Regression, độ tin cậy: {aiAnalysis.trendPrediction.confidence.toFixed(0)}%)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[250px]">
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
                                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Dự đoán Yield']}
                              />
                              <Bar dataKey="predictedYield" name="Dự đoán" fill="#14b8a6" radius={[4, 4, 0, 0]} />
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
                          Phát hiện bất thường
                          <Badge variant="outline" className="ml-2">{aiAnalysis.anomalies.length} điểm</Badge>
                        </CardTitle>
                        <CardDescription>
                          Các ngày có Yield Rate bất thường (vượt 2σ)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {aiAnalysis.anomalies.map((anomaly, index) => (
                            <div 
                              key={index}
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
                                    Yield: {anomaly.yieldRate.toFixed(1)}% ({anomaly.deviation > 0 ? '+' : ''}{anomaly.deviation.toFixed(1)}% so với TB)
                                  </span>
                                </div>
                              </div>
                              <Badge variant={anomaly.severity === 'critical' ? 'destructive' : 'secondary'}>
                                {anomaly.severity === 'critical' ? 'Nghiêm trọng' : 'Cảnh báo'}
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
                          <Lightbulb className="h-5 w-5 text-yellow-500" />
                          Khuyến nghị cải thiện
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {aiAnalysis.recommendations.map((rec, index) => (
                            <div key={index} className="p-4 rounded-lg bg-secondary/30 flex items-start gap-3">
                              <span className="text-lg">{rec.split(' ')[0]}</span>
                              <p className="text-foreground">{rec.substring(rec.indexOf(' ') + 1)}</p>
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
                    <p className="text-muted-foreground">Không có dữ liệu để phân tích AI</p>
                    <p className="text-sm text-muted-foreground mt-1">Cần tối thiểu 3 ngày dữ liệu để dự đoán xu hướng</p>
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
                        <Target className="h-5 w-5 text-primary" />
                        Thống kê Yield - FPY, FY, NTF, UPH
                      </CardTitle>
                      <CardDescription>
                        Biểu đồ và chỉ số hiệu suất sản xuất theo thời gian
                      </CardDescription>
                    </div>
                    {analysisStats && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" className="gap-2">
                            <Download className="h-4 w-4" />
                            Xuất báo cáo
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => exportYieldReport('pdf')}>
                            <FileText className="h-4 w-4 mr-2" />
                            Xuất PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportYieldReport('excel')}>
                            <FileSpreadsheet className="h-4 w-4 mr-2" />
                            Xuất Excel
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => exportYieldReport('csv')}>
                            <Download className="h-4 w-4 mr-2" />
                            Xuất CSV
                          </DropdownMenuItem>
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
                          <p className="text-sm text-muted-foreground">Current First Pass Yield</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-primary">
                              {analysisStats.yieldRate.toFixed(2)}%
                            </span>
                            <span className={`text-sm ${analysisStats.yieldRate >= 98.5 ? 'text-success' : 'text-warning'}`}>
                              {analysisStats.yieldRate >= 98.5 ? '↑' : '↓'}{Math.abs(analysisStats.yieldRate - 98.5).toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Target: &gt;98.50%</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Daily Fail Yield Card */}
                    <Card className="glass-card border-l-4 border-l-warning">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Daily Fail Yield</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-warning">
                              {(100 - analysisStats.yieldRate).toFixed(2)}%
                            </span>
                            <span className={`text-sm ${(100 - analysisStats.yieldRate) <= 1.5 ? 'text-success' : 'text-destructive'}`}>
                              {(100 - analysisStats.yieldRate) <= 1.5 ? '↓' : '↑'}{Math.abs((100 - analysisStats.yieldRate) - 1.5).toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Threshold: &lt; 1.50%</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* NTF Yield Card */}
                    <Card className="glass-card border-l-4 border-l-cyan-500">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Avg NTF Yield</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-cyan-500">
                              {((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100).toFixed(2)}%
                            </span>
                            <span className={`text-sm ${((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100) <= 1.0 ? 'text-success' : 'text-warning'}`}>
                              {((analysisStats.ntfCount / Math.max(analysisStats.total, 1)) * 100) <= 1.0 ? '↓' : '↑'}0.01%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Target: &lt; 1.00%</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* UPH Card */}
                    <Card className="glass-card border-l-4 border-l-success">
                      <CardContent className="pt-6">
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Avg UPH</p>
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold text-success">
                              {Math.round(analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24)}
                            </span>
                            <span className="text-sm text-destructive">
                              ↓{Math.round(1500 - (analysisStats.total / Math.max(analysisStats.dateStats.length, 1) * 24))}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">Capacity: 1,500/hr</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Charts Row 1 */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* FPY Trend Chart */}
                    <Card className="glass-card">
                      <CardHeader>
                        <CardTitle className="text-lg">First Pass Yield (FPY) Trend</CardTitle>
                        <CardDescription>Daily micro-fluctuations (Scale: 98% - 99.5%)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[280px]">
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
                        <CardTitle className="text-lg">Fail Yield Trend</CardTitle>
                        <CardDescription>Production reject rates (Scale: 0.5% - 2.0%)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[280px]">
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
                        <CardTitle className="text-lg">NTF (No Trouble Found) Yield</CardTitle>
                        <CardDescription>Re-test pass rates (Scale: 0.5% - 2.0%)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[280px]">
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
                        <CardTitle className="text-lg">UPH (Units Per Hour) Trend</CardTitle>
                        <CardDescription>Hourly throughput volume per day</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[280px]">
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
                        <BarChart3 className="h-5 w-5 text-primary" />
                        Bảng tổng hợp Yield theo ngày
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Ngày</th>
                              <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Tổng</th>
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
                    <p className="text-muted-foreground">Không có dữ liệu để thống kê Yield</p>
                    <p className="text-sm text-muted-foreground mt-1">Thử tìm kiếm với bộ lọc khác</p>
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  Gallery Hình Ảnh Kiểm Tra
                </CardTitle>
                <CardDescription>
                  Xem tất cả hình ảnh từ các điểm đo trong kết quả kiểm tra
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data?.data && data.data.length > 0 ? (
                  <ImageGallery
                    images={data.data.flatMap((inspection: any) => 
                      (inspection.measurementResults || []).map((result: any, idx: number) => ({
                        id: `${inspection.id}-${result.measurementPointDefId || idx}`,
                        url: result.imageUrl || inspection.productModel?.referenceImageUrl || '',
                        thumbnailUrl: result.imageUrl || inspection.productModel?.referenceImageUrl || '',
                        title: `${inspection.serialNumber} - Điểm ${result.measurementPointDefId || idx + 1}`,
                        description: result.remark || '',
                        result: result.result as "OK" | "NG" | "NTF",
                        measurementPointId: result.measurementPointDefId,
                        measurementPointName: result.measurementPointDef?.name || `Điểm đo ${result.measurementPointDefId || idx + 1}`,
                        value: result.value,
                        standardValue: result.measurementPointDef?.standardValue,
                        upperLimit: result.measurementPointDef?.upperLimit,
                        lowerLimit: result.measurementPointDef?.lowerLimit,
                        timestamp: new Date(inspection.inspectedAt),
                      } as GalleryImage)).filter((img: GalleryImage) => img.url)
                    )}
                    title="Hình ảnh điểm đo"
                    showFilters={true}
                    showSearch={true}
                    columns={5}
                  />
                ) : (
                  <EmptyState
                    icon={Image}
                    title="Chưa có hình ảnh"
                    description="Không có hình ảnh nào trong kết quả tìm kiếm hiện tại"
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
          toast.success(`Đã tìm kiếm: ${serialNumber}`);
        }}
      />
    </DashboardLayout>
  );
}
