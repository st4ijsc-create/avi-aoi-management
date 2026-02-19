import { useState, useMemo, useRef } from "react";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
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
  ChevronDown
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

const COLORS = {
  ok: "#10b981",
  ng: "#ef4444",
  ntf: "#f59e0b",
  primary: "#06b6d4",
  secondary: "#8b5cf6",
};

type TimeRange = "7d" | "30d" | "90d" | "365d";

export default function Reports() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [activeTab, setActiveTab] = useState("executive");
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: dailyStats, refetch: refetchStats } = trpc.dashboard.getDailyStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    days: timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : timeRange === "90d" ? 90 : 365,
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

  // Machine comparison data
  const machineComparisonData = useMemo(() => {
    if (!machines || !dailyStats) return [];

    // Group by machine (simplified - in real app would query per machine)
    const machineStats = machines.map((machine: { id: number; name: string; code: string }) => ({
      name: machine.name,
      code: machine.code,
      total: Math.floor(Math.random() * 1000) + 500, // Placeholder
      yieldRate: 85 + Math.random() * 15, // Placeholder
      ngRate: 2 + Math.random() * 8, // Placeholder
    }));

    return machineStats.sort((a, b) => b.yieldRate - a.yieldRate);
  }, [machines, dailyStats]);

  // Result distribution data
  const resultDistributionData = useMemo(() => {
    return [
      { name: "OK", value: aggregatedStats.okCount, color: COLORS.ok },
      { name: "NG", value: aggregatedStats.ngCount, color: COLORS.ng },
      { name: "NTF", value: aggregatedStats.ntfCount, color: COLORS.ntf },
    ];
  }, [aggregatedStats]);

  // Factory comparison data
  const factoryComparisonData = useMemo(() => {
    if (!factories) return [];

    return factories.map((factory: { id: number; name: string; code: string }) => ({
      name: factory.name,
      code: factory.code,
      total: Math.floor(Math.random() * 5000) + 2000, // Placeholder
      yieldRate: 88 + Math.random() * 10, // Placeholder
      machines: machines?.filter((m: { stationId: number }) => m.stationId > 0).length || 0,
    }));
  }, [factories, machines]);

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
      const XLSX = await import("xlsx");
      
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
      const { jsPDF } = await import("jspdf");
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
      <DashboardLayout title={t('reports.title')} navItems={navItems} currentPath="/reports">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t('reports.title')} navItems={navItems} currentPath="/reports">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
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
              <FileText className="h-4 w-4 mr-2 text-red-500" />
              {t('reports.exportPDF')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer">
              <FileSpreadsheet className="h-4 w-4 mr-2 text-green-500" />
              {t('reports.exportExcel')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
              <File className="h-4 w-4 mr-2 text-blue-500" />
              {t('reports.exportCSV')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
                <p className="text-2xl font-bold text-green-500">{aggregatedStats.okCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-green-500/10">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.ngProducts')}</p>
                <p className="text-2xl font-bold text-red-500">{aggregatedStats.ngCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-red-500/10">
                <XCircle className="h-6 w-6 text-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{t('reports.ntfProducts')}</p>
                <p className="text-2xl font-bold text-amber-500">{aggregatedStats.ntfCount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-full bg-amber-500/10">
                <AlertTriangle className="h-6 w-6 text-amber-500" />
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
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="executive">{t('reports.tabOverview')}</TabsTrigger>
          <TabsTrigger value="overview">{t('reports.tabCharts')}</TabsTrigger>
          <TabsTrigger value="trend">{t('reports.tabTrend')}</TabsTrigger>
          <TabsTrigger value="machines">{t('reports.tabByMachine')}</TabsTrigger>
          <TabsTrigger value="factories">{t('reports.tabByFactory')}</TabsTrigger>
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
                        className="h-full bg-gradient-to-r from-green-500 to-emerald-500 rounded-full transition-all duration-500"
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
                      <TrendingUp className="h-6 w-6 text-green-500" />
                    ) : (
                      <TrendingDown className="h-6 w-6 text-red-500" />
                    )}
                    <span className={`text-2xl font-bold ${aggregatedStats.trend >= 0 ? "text-green-500" : "text-red-500"}`}>
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
                      <span className="text-green-500">OK</span>
                      <span>{aggregatedStats.totalProducts > 0 ? ((aggregatedStats.okCount / aggregatedStats.totalProducts) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-red-500">NG</span>
                      <span>{aggregatedStats.totalProducts > 0 ? ((aggregatedStats.ngCount / aggregatedStats.totalProducts) * 100).toFixed(1) : 0}%</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-amber-500">NTF</span>
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
                            <Badge className="bg-green-500">{t('reports.excellent')}</Badge>
                          ) : machine.yieldRate >= 90 ? (
                            <Badge className="bg-amber-500">{t('reports.pass')}</Badge>
                          ) : (
                            <Badge variant="destructive">{t('reports.needsImprovement')}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-600">{t('reports.yieldBelowTarget')}</p>
                      <p className="text-sm text-muted-foreground">{t('reports.yieldBelowTargetDesc')}</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.trend < 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <TrendingDown className="h-5 w-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-600">{t('reports.downTrendVsPrevious')}</p>
                      <p className="text-sm text-muted-foreground">{t('reports.downTrendVsPreviousDesc')}</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.yieldRate >= 95 && aggregatedStats.trend >= 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-600">{t('reports.goodPerformance')}</p>
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
                <CardTitle className="text-lg">Xu hướng Yield Rate</CardTitle>
                <CardDescription>Biểu đồ Yield Rate theo thời gian</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={yieldTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                      <YAxis yAxisId="left" stroke="#9ca3af" fontSize={12} />
                      <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                        labelStyle={{ color: "#f3f4f6" }}
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
                        contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#f3f4f6" }}
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="date" stroke="#9ca3af" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#f3f4f6" }}
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
                      stroke="#f59e0b"
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
                      <TableCell className="text-right text-green-500">{row.ok.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-red-500">{row.ng.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-amber-500">{row.ntf.toLocaleString()}</TableCell>
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
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={machineComparisonData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis type="number" domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={12} width={120} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#f3f4f6" }}
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
            </CardContent>
          </Card>

          {/* Machine Details Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('reports.machineDetail')}</CardTitle>
            </CardHeader>
            <CardContent>
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
                      <TableCell className="text-right text-red-500">{machine.ngRate.toFixed(2)}%</TableCell>
                      <TableCell>
                        {machine.yieldRate >= 95 ? (
                          <Badge variant="outline" className="text-green-500 border-green-500">{t('reports.good')}</Badge>
                        ) : machine.yieldRate >= 90 ? (
                          <Badge variant="outline" className="text-amber-500 border-amber-500">{t('reports.needsImprovement')}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-500 border-red-500">{t('reports.warning')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={factoryComparisonData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      labelStyle={{ color: "#f3f4f6" }}
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
      </Tabs>
    </DashboardLayout>
  );
}
