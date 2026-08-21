import { useState, useMemo, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, chartGridProps, chartAxisProps, chartTooltipStyle, chartTooltipLabelStyle } from "@/components/patterns";
import { EmptyState } from "@/components/EmptyState";
import { ScopeEmptyNotice } from "@/components/ScopeEmptyNotice";
import { scopeEmptyReasonOf } from "@/lib/scopeEmpty";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Factory, 
  Calendar,
  Download,
  RefreshCw,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Percent,
  FileText,
  FileSpreadsheet,
  File,
  ChevronDown,
  Printer
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Area,
} from "recharts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { buildMachineComparison, buildFactoryComparison } from "@/lib/reportsData";

// Result colours map to semantic tokens (success/destructive/warning) so charts
// follow the theme; series colours use the DS chart palette.
const COLORS = {
  ok: "var(--success)",
  ng: "var(--destructive)",
  ntf: "var(--warning)",
  primary: "var(--chart-1)",
  secondary: "var(--chart-4)",
};

type TimeRange = "7d" | "30d" | "90d" | "365d";

// doc 60 G — body without DashboardLayout so it embeds as the Reporting Studio
// "Tổng quan/Phân tích" tab. NB: this is the quality-analytics dashboard (yield/trends/
// COPQ), NOT the saved-reports list (that's the Build tab). Default export below keeps
// the standalone /reports route.
export function ReportsContent() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [activeTab, setActiveTab] = useState("executive");
  const [isExporting, setIsExporting] = useState(false);
  const [reworkCostNG, setReworkCostNG] = useState<number>(() => {
    const saved = localStorage.getItem('copq_rework_cost_ng');
    return saved ? parseFloat(saved) : 50000;
  });
  const [reworkCostNTF, setReworkCostNTF] = useState<number>(() => {
    const saved = localStorage.getItem('copq_rework_cost_ntf');
    return saved ? parseFloat(saved) : 20000;
  });
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: dailyStats, refetch: refetchStats } = trpc.dashboard.getDailyStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    days: timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : 365,
  });
  const { data: weeklyCOPQ } = trpc.corporateFactoryStats.weeklyCOPQ.useQuery({
    weeks: timeRange === "7d" ? 4 : timeRange === "30d" ? 12 : timeRange === "90d" ? 13 : 52,
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
  });

  // Report window mirroring the yield window — feeds the real per-machine /
  // per-factory aggregates below (doc 32 P0 #2: these were hardcoded []).
  const reportWindow = useMemo(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : 365;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return { startDate, endDate };
  }, [timeRange]);

  // Top + bottom machines (name/code/total/finalYield/ng) for the machine tab.
  const { data: topBottomMachines } = trpc.dashboard.getTopBottomMachines.useQuery({
    startDate: reportWindow.startDate,
    endDate: reportWindow.endDate,
    limit: 10,
  });
  /**
   * ★ 2026-08-17 — Lý do rỗng của CẢ TRANG báo cáo, gom một lần.
   * "getTopBottomMachines" là truy vấn duy nhất trên màn này mang nhãn phạm vi; các bảng/biểu
   * đồ khác ("corporateFactoryStats.*", "getDailyStats") lấy lý do từ đây (nhóm b).
   */
  const scopeEmptyReason = scopeEmptyReasonOf(topBottomMachines);

  // Per-factory yield rollup (final yield, decision #4) for the factory tab.
  const { data: factoryYield } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
    startDate: reportWindow.startDate,
    endDate: reportWindow.endDate,
  });

  // Define type for daily stats
  type DailyStat = {
    date: string;
    totalProducts: number;
    okCount: number;
    ngCount: number;
    ntfCount: number;
  };

  // Calculate aggregated statistics
  const aggregatedStats = useMemo(() => {
    if (!dailyStats || (dailyStats as DailyStat[]).length === 0) {
      return {
        totalProducts: 0,
        okCount: 0,
        ngCount: 0,
        ntfCount: 0,
        yieldRate: 0,
        avgYieldRate: 0,
        trend: 0,
      };
    }

    const stats = dailyStats as DailyStat[];
    const total = stats.reduce((sum: number, d: DailyStat) => sum + d.totalProducts, 0);
    const ok = stats.reduce((sum: number, d: DailyStat) => sum + d.okCount, 0);
    const ng = stats.reduce((sum: number, d: DailyStat) => sum + d.ngCount, 0);
    const ntf = stats.reduce((sum: number, d: DailyStat) => sum + d.ntfCount, 0);
    const yieldRate = total > 0 ? ((ok + ntf) / total) * 100 : 0;

    // Calculate trend (compare last 7 days vs previous 7 days)
    const recentDays = stats.slice(0, 7);
    const previousDays = stats.slice(7, 14);
    
    const recentYield = recentDays.length > 0 
      ? recentDays.reduce((sum: number, d: DailyStat) => {
          const dayTotal = d.totalProducts;
          return sum + (dayTotal > 0 ? ((d.okCount + d.ntfCount) / dayTotal) * 100 : 0);
        }, 0) / recentDays.length
      : 0;
    
    const previousYield = previousDays.length > 0
      ? previousDays.reduce((sum: number, d: DailyStat) => {
          const dayTotal = d.totalProducts;
          return sum + (dayTotal > 0 ? ((d.okCount + d.ntfCount) / dayTotal) * 100 : 0);
        }, 0) / previousDays.length
      : 0;

    const trend = previousYield > 0 ? recentYield - previousYield : 0;

    return {
      totalProducts: total,
      okCount: ok,
      ngCount: ng,
      ntfCount: ntf,
      yieldRate,
      avgYieldRate: yieldRate,
      trend,
    };
  }, [dailyStats]);

  // Prepare chart data
  const yieldTrendData = useMemo(() => {
    if (!dailyStats) return [];
    
    return (dailyStats as DailyStat[])
      .slice()
      .reverse()
      .map((d: DailyStat) => {
        const total = d.totalProducts;
        const yieldRate = total > 0 ? ((d.okCount + d.ntfCount) / total) * 100 : 0;
        return {
          date: new Date(d.date).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
          fullDate: d.date,
          total: d.totalProducts,
          ok: d.okCount,
          ng: d.ngCount,
          ntf: d.ntfCount,
          yieldRate: parseFloat(yieldRate.toFixed(2)),
        };
      });
  }, [dailyStats]);

  // Machine comparison data — real per-machine rollup from getTopBottomMachines
  // (top + bottom performers, deduped). See lib/reportsData.buildMachineComparison.
  const machineComparisonData = useMemo(
    () => buildMachineComparison(topBottomMachines as any, machines as any, selectedFactory),
    [topBottomMachines, machines, selectedFactory],
  );

  // Result distribution data
  const resultDistributionData = useMemo(() => {
    return [
      { name: "OK", value: aggregatedStats.okCount, color: COLORS.ok },
      { name: "NG", value: aggregatedStats.ngCount, color: COLORS.ng },
      { name: "NTF", value: aggregatedStats.ntfCount, color: COLORS.ntf },
    ];
  }, [aggregatedStats]);

  // Factory comparison data — real per-factory yield rollup (final yield). See
  // lib/reportsData.buildFactoryComparison.
  const factoryComparisonData = useMemo(
    () => buildFactoryComparison(factoryYield as any, factories as any, machines as any, selectedFactory),
    [factoryYield, factories, machines, selectedFactory],
  );

  // Export to CSV
  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const headers = [t('reports.date'), t('reports.totalProducts'), "OK", "NG", "NTF", "Yield Rate (%)"];
      const rows = yieldTrendData.map((d) => [
        d.fullDate,
        d.total,
        d.ok,
        d.ng,
        d.ntf,
        d.yieldRate,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((r) => r.join(",")),
      ].join("\n");

      const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `bao-cao-yield-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      toast.success(t('reports.csvExportSuccess'));
    } catch (error) {
      toast.error(t('reports.csvExportError'));
    } finally {
      setIsExporting(false);
    }
  };

  // Export to Excel
  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      // Create workbook
      const wb = XLSX.utils.book_new();
      
      // Sheet 1: Daily Stats
      const dailyData = yieldTrendData.map((d) => ({
        [t('reports.date')]: d.fullDate,
        [t('reports.totalProducts')]: d.total,
        "OK": d.ok,
        "NG": d.ng,
        "NTF": d.ntf,
        "Yield Rate (%)": d.yieldRate,
      }));
      const ws1 = XLSX.utils.json_to_sheet(dailyData);
      XLSX.utils.book_append_sheet(wb, ws1, t('reports.dailyStatsSheet'));
      
      // Sheet 2: Summary
      const summaryData = [
        { [t('reports.metric')]: t('reports.totalProductsLabel'), [t('reports.value')]: aggregatedStats.totalProducts },
        { [t('reports.metric')]: t('reports.okProducts'), [t('reports.value')]: aggregatedStats.okCount },
        { [t('reports.metric')]: t('reports.ngProducts'), [t('reports.value')]: aggregatedStats.ngCount },
        { [t('reports.metric')]: t('reports.ntfProducts'), [t('reports.value')]: aggregatedStats.ntfCount },
        { [t('reports.metric')]: "Yield Rate (%)", [t('reports.value')]: aggregatedStats.yieldRate.toFixed(2) },
        { [t('reports.metric')]: t('reports.trendPercent'), [t('reports.value')]: aggregatedStats.trend.toFixed(2) },
      ];
      const ws2 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws2, t('reports.summarySheet'));
      
      // Sheet 3: Machine Stats
      if (machineComparisonData.length > 0) {
        const machineData = machineComparisonData.map((m) => ({
          [t('reports.machineName')]: m.name,
          [t('reports.machineCode')]: m.code,
          [t('reports.totalProducts')]: m.total,
          "Yield Rate (%)": m.yieldRate.toFixed(2),
          "NG Rate (%)": m.ngRate.toFixed(2),
        }));
        const ws3 = XLSX.utils.json_to_sheet(machineData);
        XLSX.utils.book_append_sheet(wb, ws3, t('reports.machineStatsSheet'));
      }
      
      // Sheet 4: Factory Stats
      if (factoryComparisonData.length > 0) {
        const factoryData = factoryComparisonData.map((f) => ({
          [t('reports.factoryName')]: f.name,
          [t('reports.factoryCode')]: f.code,
          [t('reports.totalProducts')]: f.total,
          "Yield Rate (%)": f.yieldRate.toFixed(2),
          [t('reports.machineCount')]: f.machines,
        }));
        const ws4 = XLSX.utils.json_to_sheet(factoryData);
        XLSX.utils.book_append_sheet(wb, ws4, t('reports.factoryStatsSheet'));
      }
      
      // Save file
      XLSX.writeFile(wb, `bao-cao-yield-${new Date().toISOString().split("T")[0]}.xlsx`);
      toast.success(t('reports.excelExportSuccess'));
    } catch (error) {
      console.error("Excel export error:", error);
      toast.error(t('reports.excelExportError'));
    } finally {
      setIsExporting(false);
    }
  };

  // Export to PDF
  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const autoTable = (await import("jspdf-autotable")).default;
      
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      
      // Title
      doc.setFontSize(18);
      doc.text(t('reports.pdfTitle'), pageWidth / 2, 20, { align: "center" });
      
      doc.setFontSize(10);
      doc.text(`${t('reports.timePeriod')}: ${timeRange === "7d" ? t('reports.7days') : timeRange === "30d" ? t('reports.30days') : timeRange === "90d" ? t('reports.90days') : t('reports.1year')}`, pageWidth / 2, 28, { align: "center" });
      doc.text(`${t('reports.exportDate')}: ${new Date().toLocaleDateString("vi-VN")}`, pageWidth / 2, 34, { align: "center" });
      
      // Summary section
      doc.setFontSize(14);
      doc.text(t('reports.summarySection'), 14, 48);
      
      const summaryData = [
        [t('reports.totalProductsLabel'), aggregatedStats.totalProducts.toLocaleString()],
        [t('reports.okProducts'), aggregatedStats.okCount.toLocaleString()],
        [t('reports.ngProducts'), aggregatedStats.ngCount.toLocaleString()],
        [t('reports.ntfProducts'), aggregatedStats.ntfCount.toLocaleString()],
        ["Yield Rate", `${aggregatedStats.yieldRate.toFixed(2)}%`],
        [t('reports.trend'), `${aggregatedStats.trend >= 0 ? "+" : ""}${aggregatedStats.trend.toFixed(2)}%`],
      ];
      
      autoTable(doc, {
        startY: 52,
        head: [[t('reports.metric'), t('reports.value')]],
        body: summaryData,
        theme: "grid",
        headStyles: { fillColor: [6, 182, 212] },
        styles: { fontSize: 10 },
      });
      
      // Daily stats table
      doc.setFontSize(14);
      const dailyStartY = (doc as any).lastAutoTable.finalY + 15;
      doc.text(t('reports.dailyStatsSection'), 14, dailyStartY);
      
      const dailyData = yieldTrendData.slice(-14).map((d) => [
        d.fullDate,
        d.total.toLocaleString(),
        d.ok.toLocaleString(),
        d.ng.toLocaleString(),
        d.ntf.toLocaleString(),
        `${d.yieldRate}%`,
      ]);
      
      autoTable(doc, {
        startY: dailyStartY + 4,
        head: [[t('reports.date'), t('reports.totalProducts'), "OK", "NG", "NTF", "Yield Rate"]],
        body: dailyData,
        theme: "grid",
        headStyles: { fillColor: [6, 182, 212] },
        styles: { fontSize: 9 },
      });
      
      // Machine stats on new page
      if (machineComparisonData.length > 0) {
        doc.addPage();
        doc.setFontSize(14);
        doc.text(t('reports.machineStatsSection'), 14, 20);
        
        const machineData = machineComparisonData.map((m) => [
          m.name,
          m.code,
          m.total.toLocaleString(),
          `${m.yieldRate.toFixed(2)}%`,
          `${m.ngRate.toFixed(2)}%`,
        ]);
        
        autoTable(doc, {
          startY: 24,
          head: [[t('reports.machineName'), t('reports.machineCode'), t('reports.totalProducts'), "Yield Rate", "NG Rate"]],
          body: machineData,
          theme: "grid",
          headStyles: { fillColor: [6, 182, 212] },
          styles: { fontSize: 9 },
        });
      }
      
      // Factory stats
      if (factoryComparisonData.length > 0) {
        const factoryStartY = (doc as any).lastAutoTable.finalY + 15;
        doc.setFontSize(14);
        doc.text(t('reports.factoryStatsSection'), 14, factoryStartY);
        
        const factoryData = factoryComparisonData.map((f) => [
          f.name,
          f.code,
          f.total.toLocaleString(),
          `${f.yieldRate.toFixed(2)}%`,
          f.machines.toString(),
        ]);
        
        autoTable(doc, {
          startY: factoryStartY + 4,
          head: [[t('reports.factoryName'), t('reports.factoryCode'), t('reports.totalProducts'), "Yield Rate", t('reports.machineCount')]],
          body: factoryData,
          theme: "grid",
          headStyles: { fillColor: [6, 182, 212] },
          styles: { fontSize: 9 },
        });
      }
      
      // Save
      doc.save(`bao-cao-yield-${new Date().toISOString().split("T")[0]}.pdf`);
      toast.success(t('reports.pdfExportSuccess'));
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error(t('reports.pdfExportError'));
    } finally {
      setIsExporting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        icon={<BarChart3 className="h-6 w-6" />}
        title={t('reports.title')}
        description={t('reports.subtitle', 'Quality yield, defect trends and cost-of-poor-quality analytics')}
      />
      {/*
        ⚠ 2026-08-17 — LÝ DO CỦA MỘT BÁO CÁO TOÀN SỐ 0. Với tài khoản CHƯA ĐƯỢC GÁN NHÀ MÁY, so
        sánh máy / xu hướng / pareto đều trống một cách hợp lệ; không nói ra thì người đọc hiểu
        thành "nhà máy không sản xuất gì". `getTopBottomMachines` mang `scopeEmptyReason`.
      */}
      <ScopeEmptyNotice reason={scopeEmptyReason} className="mt-4" />
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6 mt-4">
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedFactory} onValueChange={setSelectedFactory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t('reports.selectFactory')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.allFactories')}</SelectItem>
              {factories?.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">{t('reports.last7days')}</SelectItem>
              <SelectItem value="30d">{t('reports.last30days')}</SelectItem>
              <SelectItem value="90d">{t('reports.last90days')}</SelectItem>
              <SelectItem value="365d">{t('reports.last1year')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => refetchStats()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>

        {/* F12 (doc 27 Đợt 5 / W5-E) — browser print of the visible report area
            (@media print rules in index.css hide the app chrome). */}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          {t('reports.print')}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={isExporting}>
              {isExporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {t('reports.exportReport')}
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{t('reports.selectFormat')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportPDF} className="cursor-pointer">
              <FileText className="h-4 w-4 mr-2 text-destructive" />
              {t('reports.exportPDF')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer">
              <FileSpreadsheet className="h-4 w-4 mr-2 text-success" />
              {t('reports.exportExcel')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
              <File className="h-4 w-4 mr-2 text-info" />
              {t('reports.exportCSV')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* F12 — print-area wraps the report output (summary + active tab) */}
      <div className="print-area">
      {/* Summary Cards */}
      <div ref={reportRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.totalProductsLabel')}</p>
                <p className="text-2xl font-bold">{aggregatedStats.totalProducts.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <Target className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.okProducts')}</p>
                <p className="text-2xl font-bold text-success">{aggregatedStats.okCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-success/10">
                <CheckCircle2 className="h-6 w-6 text-success" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.ngProducts')}</p>
                <p className="text-2xl font-bold text-destructive">{aggregatedStats.ngCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-destructive/10">
                <XCircle className="h-6 w-6 text-destructive" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.ntfProducts')}</p>
                <p className="text-2xl font-bold text-warning">{aggregatedStats.ntfCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-warning/10">
                <AlertTriangle className="h-6 w-6 text-warning" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Yield Rate</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{aggregatedStats.yieldRate.toFixed(2)}%</p>
                  {aggregatedStats.trend !== 0 && (
                    <Badge variant={aggregatedStats.trend > 0 ? "default" : "destructive"} className="text-xs">
                      {aggregatedStats.trend > 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
                      {aggregatedStats.trend > 0 ? "+" : ""}{aggregatedStats.trend.toFixed(1)}%
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <Percent className="h-6 w-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="executive">{t('reports.tabOverview')}</TabsTrigger>
          <TabsTrigger value="overview">{t('reports.tabCharts')}</TabsTrigger>
          <TabsTrigger value="trend">{t('reports.tabTrend')}</TabsTrigger>
          <TabsTrigger value="machines">{t('reports.tabByMachine')}</TabsTrigger>
          <TabsTrigger value="factories">{t('reports.tabByFactory')}</TabsTrigger>
          <TabsTrigger value="quality-cost">{t('reports.tabQualityCost', 'Chi phí chất lượng')}</TabsTrigger>
        </TabsList>

        <TabsContent value="executive" className="space-y-4">
          {/* Executive Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                {t('reports.executiveSummary')}
              </CardTitle>
              <CardDescription>{t('reports.executiveSummaryDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">{t('reports.overallPerformance')}</h4>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-success to-success rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(aggregatedStats.yieldRate, 100)}%` }}
                      />
                    </div>
                    <span className="font-bold">{aggregatedStats.yieldRate.toFixed(1)}%</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {aggregatedStats.yieldRate >= 95 ? t('reports.targetMet') : aggregatedStats.yieldRate >= 90 ? t('reports.nearTarget') : t('reports.needsImprovement')}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">{t('reports.vsPreviousPeriod')}</h4>
                  <div className="flex items-center gap-2">
                    {aggregatedStats.trend >= 0 ? (
                      <TrendingUp className="h-6 w-6 text-success" />
                    ) : (
                      <TrendingDown className="h-6 w-6 text-destructive" />
                    )}
                    <span className={`text-2xl font-bold ${aggregatedStats.trend >= 0 ? "text-success" : "text-destructive"}`}>
                      {aggregatedStats.trend >= 0 ? "+" : ""}{aggregatedStats.trend.toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {aggregatedStats.trend >= 0 ? t('reports.upTrend') : t('reports.downTrend')}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">{t('reports.resultDistribution')}</h4>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-success">OK</span>
                      <span>{aggregatedStats.totalProducts > 0 ? ((aggregatedStats.okCount / aggregatedStats.totalProducts) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-destructive">NG</span>
                      <span>{aggregatedStats.totalProducts > 0 ? ((aggregatedStats.ngCount / aggregatedStats.totalProducts) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-warning">NTF</span>
                      <span>{aggregatedStats.totalProducts > 0 ? ((aggregatedStats.ntfCount / aggregatedStats.totalProducts) * 100).toFixed(1) : 0}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top/Bottom Performers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.machinePerformance')}</CardTitle>
              <CardDescription>{t('reports.machinePerformanceDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {machineComparisonData.length === 0 ? (
                <EmptyState scopeEmptyReason={scopeEmptyReason} variant="no-analytics" compact title={t('reports.machineStatsEmpty', 'Per-machine statistics are not available yet.')} />
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.machine')}</TableHead>
                    <TableHead>{t('reports.machineCode')}</TableHead>
                    <TableHead className="text-right">{t('reports.totalProducts')}</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                    <TableHead>{t('reports.evaluation')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineComparisonData.slice(0, 5).map((machine: { name: string; code: string; total: number; yieldRate: number }) => {
                    return (
                      <TableRow key={machine.code}>
                        <TableCell className="font-medium">{machine.name}</TableCell>
                        <TableCell className="text-muted-foreground">{machine.code}</TableCell>
                        <TableCell className="text-right">{machine.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={machine.yieldRate >= 95 ? "default" : machine.yieldRate >= 90 ? "secondary" : "destructive"}>
                            {machine.yieldRate.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {machine.yieldRate >= 95 ? (
                            <Badge className="bg-success">{t('reports.excellent')}</Badge>
                          ) : machine.yieldRate >= 90 ? (
                            <Badge className="bg-warning">{t('reports.pass')}</Badge>
                          ) : (
                            <Badge variant="destructive">{t('reports.needsImprovement')}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.recommendations')}</CardTitle>
              <CardDescription>{t('reports.recommendationsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {aggregatedStats.yieldRate < 95 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-warning/10 border border-warning/20">
                    <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                    <div>
                      <p className="font-medium text-warning">{t('reports.yieldBelowTarget')}</p>
                      <p className="text-sm text-muted-foreground">{t('reports.yieldBelowTargetDesc')}</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.trend < 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <TrendingDown className="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                      <p className="font-medium text-destructive">{t('reports.downTrendVsPrevious')}</p>
                      <p className="text-sm text-muted-foreground">{t('reports.downTrendVsPreviousDesc')}</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.yieldRate >= 95 && aggregatedStats.trend >= 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-success/10 border border-success/20">
                    <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
                    <div>
                      <p className="font-medium text-success">{t('reports.goodPerformance')}</p>
                      <p className="text-sm text-muted-foreground">{t('reports.goodPerformanceDesc')}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Yield Rate Trend */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('reports.yieldTrendTitle', 'Xu hướng Yield Rate')}</CardTitle>
                <CardDescription>{t('reports.yieldTrendDesc', 'Biểu đồ Yield Rate theo thời gian')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={yieldTrendData}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="date" {...chartAxisProps} fontSize={12} />
                      <YAxis yAxisId="left" {...chartAxisProps} fontSize={12} />
                      <YAxis yAxisId="right" orientation="right" {...chartAxisProps} fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="total" name={t('reports.totalProducts')} fill={COLORS.primary} opacity={0.5} />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="yieldRate"
                        name="Yield Rate (%)"
                        stroke={COLORS.ok}
                        strokeWidth={2}
                        dot={{ fill: COLORS.ok }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Result Distribution */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('reports.resultDistribution')}</CardTitle>
                <CardDescription>{t('reports.resultDistributionDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={resultDistributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                      >
                        {resultDistributionData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelStyle={chartTooltipLabelStyle}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Production Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.dailyProduction')}</CardTitle>
              <CardDescription>{t('reports.dailyProductionDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yieldTrendData}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="date" {...chartAxisProps} fontSize={12} />
                    <YAxis {...chartAxisProps} fontSize={12} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                    />
                    <Legend />
                    <Bar dataKey="ok" name="OK" stackId="a" fill={COLORS.ok} />
                    <Bar dataKey="ng" name="NG" stackId="a" fill={COLORS.ng} />
                    <Bar dataKey="ntf" name="NTF" stackId="a" fill={COLORS.ntf} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trend" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.detailedYieldTrend')}</CardTitle>
              <CardDescription>{t('reports.detailedYieldTrendDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={yieldTrendData}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="date" {...chartAxisProps} fontSize={12} />
                    <YAxis domain={[0, 100]} {...chartAxisProps} fontSize={12} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="yieldRate"
                      name="Yield Rate (%)"
                      fill={COLORS.ok}
                      fillOpacity={0.3}
                      stroke={COLORS.ok}
                      strokeWidth={2}
                    />
                    {/* Target line at 95% */}
                    <Line
                      type="monotone"
                      dataKey={() => 95}
                      name={t('reports.target95')}
                      stroke={COLORS.ntf}
                      strokeDasharray="5 5"
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Statistics Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.dailyDetail')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.date')}</TableHead>
                    <TableHead className="text-right">{t('reports.totalProducts')}</TableHead>
                    <TableHead className="text-right">OK</TableHead>
                    <TableHead className="text-right">NG</TableHead>
                    <TableHead className="text-right">NTF</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yieldTrendData.slice(-14).reverse().map((row: { fullDate: string; total: number; ok: number; ng: number; ntf: number; yieldRate: number }) => (
                    <TableRow key={row.fullDate}>
                      <TableCell>{row.fullDate}</TableCell>
                      <TableCell className="text-right">{row.total.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-success">{row.ok.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-destructive">{row.ng.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-warning">{row.ntf.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={row.yieldRate >= 95 ? "default" : row.yieldRate >= 90 ? "secondary" : "destructive"}>
                          {row.yieldRate}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="machines" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.machineComparison')}</CardTitle>
              <CardDescription>{t('reports.machineComparisonDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {machineComparisonData.length === 0 ? (
                <EmptyState scopeEmptyReason={scopeEmptyReason} variant="no-analytics" title={t('reports.machineStatsEmpty', 'Per-machine statistics are not available yet.')} />
              ) : (
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={machineComparisonData} layout="vertical">
                    <CartesianGrid {...chartGridProps} />
                    <XAxis type="number" domain={[0, 100]} {...chartAxisProps} fontSize={12} />
                    <YAxis type="category" dataKey="name" {...chartAxisProps} fontSize={12} width={120} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      formatter={(value: number) => [`${value.toFixed(2)}%`, "Yield Rate"]}
                    />
                    <Bar dataKey="yieldRate" name="Yield Rate" fill={COLORS.primary}>
                      {machineComparisonData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.yieldRate >= 95 ? COLORS.ok : entry.yieldRate >= 90 ? COLORS.ntf : COLORS.ng}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )}
            </CardContent>
          </Card>

          {/* Machine Details Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.machineDetail')}</CardTitle>
            </CardHeader>
            <CardContent>
              {machineComparisonData.length === 0 ? (
                <EmptyState scopeEmptyReason={scopeEmptyReason} variant="no-analytics" compact title={t('reports.machineStatsEmpty', 'Per-machine statistics are not available yet.')} />
              ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('reports.machine')}</TableHead>
                    <TableHead>{t('reports.machineCode')}</TableHead>
                    <TableHead className="text-right">{t('reports.totalProducts')}</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                    <TableHead className="text-right">NG Rate</TableHead>
                    <TableHead>{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineComparisonData.map((machine: { name: string; code: string; total: number; yieldRate: number; ngRate: number }) => (
                    <TableRow key={machine.code}>
                      <TableCell className="font-medium">{machine.name}</TableCell>
                      <TableCell className="text-muted-foreground">{machine.code}</TableCell>
                      <TableCell className="text-right">{machine.total.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={machine.yieldRate >= 95 ? "default" : machine.yieldRate >= 90 ? "secondary" : "destructive"}>
                          {machine.yieldRate.toFixed(2)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-destructive">{machine.ngRate.toFixed(2)}%</TableCell>
                      <TableCell>
                        {machine.yieldRate >= 95 ? (
                          <Badge variant="outline" className="text-success border-success">{t('reports.good')}</Badge>
                        ) : machine.yieldRate >= 90 ? (
                          <Badge variant="outline" className="text-warning border-warning">{t('reports.needsImprovement')}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive">{t('reports.warning')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="factories" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.factoryComparison')}</CardTitle>
              <CardDescription>{t('reports.factoryComparisonDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {factoryComparisonData.length === 0 ? (
                <EmptyState scopeEmptyReason={scopeEmptyReason} variant="no-analytics" title={t('reports.factoryStatsEmpty', 'Per-factory statistics are not available yet.')} />
              ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={factoryComparisonData}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis dataKey="name" {...chartAxisProps} fontSize={12} />
                    <YAxis domain={[0, 100]} {...chartAxisProps} fontSize={12} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                    />
                    <Legend />
                    <Bar dataKey="yieldRate" name="Yield Rate (%)" fill={COLORS.primary}>
                      {factoryComparisonData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.yieldRate >= 95 ? COLORS.ok : entry.yieldRate >= 90 ? COLORS.ntf : COLORS.ng}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              )}
            </CardContent>
          </Card>

          {/* Factory Details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {factoryComparisonData.map((factory: { name: string; code: string; total: number; yieldRate: number; machines: number }) => (
              <Card key={factory.code}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{factory.name}</CardTitle>
                  <CardDescription>{factory.code}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{t('reports.totalProductsLabel')}</span>
                      <span className="font-medium">{factory.total.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Yield Rate</span>
                      <Badge variant={factory.yieldRate >= 95 ? "default" : factory.yieldRate >= 90 ? "secondary" : "destructive"}>
                        {factory.yieldRate.toFixed(2)}%
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{t('reports.machineCount')}</span>
                      <span className="font-medium">{factory.machines}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="quality-cost" className="space-y-4">
          {/* Rework Cost Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                {t('reports.reworkCostConfig', 'Cấu hình chi phí tái chế')}
              </CardTitle>
              <CardDescription>{t('reports.reworkCostConfigDesc', 'Thiết lập chi phí rework cho từng loại lỗi để tính COPQ')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('reports.reworkCostNg', 'Chi phí rework / NG (VNĐ)')}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={reworkCostNG}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setReworkCostNG(v);
                      localStorage.setItem('copq_rework_cost_ng', String(v));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('reports.reworkCostNtf', 'Chi phí rework / NTF (VNĐ)')}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                    value={reworkCostNTF}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      setReworkCostNTF(v);
                      localStorage.setItem('copq_rework_cost_ntf', String(v));
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Weekly COPQ Trend Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                {t('reports.copqTrendTitle', 'Xu hướng COPQ theo tuần')}
              </CardTitle>
              <CardDescription>{t('reports.copqTrendDesc', 'Chi phí chất lượng kém (Cost of Poor Quality) = NG × đơn giá NG + NTF × đơn giá NTF')}</CardDescription>
            </CardHeader>
            <CardContent>
              {weeklyCOPQ && (weeklyCOPQ as any[]).length > 0 ? (() => {
                const chartData = (weeklyCOPQ as any[]).map((w: any) => {
                  const ng = Number(w.ngCount) || 0;
                  const ntf = Number(w.ntfCount) || 0;
                  const total = Number(w.totalCount) || 0;
                  const copqNG = ng * reworkCostNG;
                  const copqNTF = ntf * reworkCostNTF;
                  return {
                    week: w.week,
                    ngCount: ng,
                    ntfCount: ntf,
                    totalCount: total,
                    copqNG,
                    copqNTF,
                    copqTotal: copqNG + copqNTF,
                    defectRate: total > 0 ? ((ng / total) * 100) : 0,
                  };
                });
                const totalCOPQ = chartData.reduce((s, d) => s + d.copqTotal, 0);
                const totalNG = chartData.reduce((s, d) => s + d.ngCount, 0);
                const totalNTF = chartData.reduce((s, d) => s + d.ntfCount, 0);
                return (
                  <div className="space-y-4">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="text-sm text-destructive">{t('reports.copqTotal', 'Tổng COPQ')}</div>
                        <div className="text-xl font-bold text-destructive">{totalCOPQ.toLocaleString()} đ</div>
                      </div>
                      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                        <div className="text-sm text-destructive">{t('reports.copqNgCost', 'Chi phí NG')}</div>
                        <div className="text-xl font-bold text-destructive">{(totalNG * reworkCostNG).toLocaleString()} đ</div>
                      </div>
                      <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                        <div className="text-sm text-warning">{t('reports.copqNtfCost', 'Chi phí NTF')}</div>
                        <div className="text-xl font-bold text-warning">{(totalNTF * reworkCostNTF).toLocaleString()} đ</div>
                      </div>
                      <div className="p-4 rounded-lg bg-info/10 border border-info/20">
                        <div className="text-sm text-info">{t('reports.copqDefectTotal', 'Tổng sản phẩm lỗi')}</div>
                        <div className="text-xl font-bold text-info">{(totalNG + totalNTF).toLocaleString()}</div>
                      </div>
                    </div>

                    {/* Chart */}
                    <ResponsiveContainer width="100%" height={400}>
                      <ComposedChart data={chartData}>
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="week" {...chartAxisProps} />
                        <YAxis yAxisId="left" {...chartAxisProps} />
                        <YAxis yAxisId="right" orientation="right" {...chartAxisProps} unit="%" />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          labelStyle={chartTooltipLabelStyle}
                          formatter={(value: any, name: string) => {
                            if (name === 'copqNG') return [t("reports.tienDong", { value: Number(value).toLocaleString() }), "COPQ (NG)"];
                            if (name === 'copqNTF') return [t("reports.tienDong", { value: Number(value).toLocaleString() }), "COPQ (NTF)"];
                            if (name === 'defectRate') return [`${Number(value).toFixed(2)}%`, t('reports.ngRateShort', 'Tỷ lệ NG')];
                            return [value, name];
                          }}
                        />
                        <Legend />
                        <Bar yAxisId="left" dataKey="copqNG" stackId="copq" fill={COLORS.ng} name="COPQ (NG)" />
                        <Bar yAxisId="left" dataKey="copqNTF" stackId="copq" fill={COLORS.ntf} name="COPQ (NTF)" />
                        <Line yAxisId="right" type="monotone" dataKey="defectRate" stroke={COLORS.secondary} strokeWidth={2} name={t('reports.ngRatePercent', 'Tỷ lệ NG (%)')} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>

                    {/* Detail Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('reports.week', 'Tuần')}</TableHead>
                          <TableHead className="text-right">{t('reports.totalProductsShort', 'Tổng SP')}</TableHead>
                          <TableHead className="text-right">NG</TableHead>
                          <TableHead className="text-right">NTF</TableHead>
                          <TableHead className="text-right">COPQ (NG)</TableHead>
                          <TableHead className="text-right">COPQ (NTF)</TableHead>
                          <TableHead className="text-right">{t('reports.copqTotal', 'Tổng COPQ')}</TableHead>
                          <TableHead className="text-right">{t('reports.ngRateShort', 'Tỷ lệ NG')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {chartData.map((row) => (
                          <TableRow key={row.week}>
                            <TableCell>{row.week}</TableCell>
                            <TableCell className="text-right">{row.totalCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-destructive">{row.ngCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right text-warning">{row.ntfCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.copqNG.toLocaleString()} đ</TableCell>
                            <TableCell className="text-right">{row.copqNTF.toLocaleString()} đ</TableCell>
                            <TableCell className="text-right font-medium">{row.copqTotal.toLocaleString()} đ</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={row.defectRate > 5 ? "destructive" : row.defectRate > 2 ? "secondary" : "default"}>
                                {row.defectRate.toFixed(2)}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })() : (
                <EmptyState
                  scopeEmptyReason={scopeEmptyReason}
                  variant="no-data"
                  title={t('reports.copqEmpty', 'Không có dữ liệu COPQ cho khoảng thời gian đã chọn')}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </>
  );
}

// Standalone /reports route — frames the analytics body in the app shell.
export default function Reports() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t('reports.title')} navItems={navItems} currentPath="/reports">
      <ReportsContent />
    </DashboardLayout>
  );
}
