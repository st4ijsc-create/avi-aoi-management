import { useState, useMemo, useRef } from "react";
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
      const headers = ["Ngày", "Tổng SP", "OK", "NG", "NTF", "Yield Rate (%)"];
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
      toast.success("Đã xuất báo cáo CSV thành công");
    } catch (error) {
      toast.error("Lỗi khi xuất báo cáo CSV");
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
        "Ngày": d.fullDate,
        "Tổng SP": d.total,
        "OK": d.ok,
        "NG": d.ng,
        "NTF": d.ntf,
        "Yield Rate (%)": d.yieldRate,
      }));
      const ws1 = XLSX.utils.json_to_sheet(dailyData);
      XLSX.utils.book_append_sheet(wb, ws1, "Thống kê theo ngày");
      
      // Sheet 2: Summary
      const summaryData = [
        { "Chỉ số": "Tổng sản phẩm", "Giá trị": aggregatedStats.totalProducts },
        { "Chỉ số": "Sản phẩm OK", "Giá trị": aggregatedStats.okCount },
        { "Chỉ số": "Sản phẩm NG", "Giá trị": aggregatedStats.ngCount },
        { "Chỉ số": "Sản phẩm NTF", "Giá trị": aggregatedStats.ntfCount },
        { "Chỉ số": "Yield Rate (%)", "Giá trị": aggregatedStats.yieldRate.toFixed(2) },
        { "Chỉ số": "Xu hướng (%)", "Giá trị": aggregatedStats.trend.toFixed(2) },
      ];
      const ws2 = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, ws2, "Tổng hợp");
      
      // Sheet 3: Machine Stats
      if (machineComparisonData.length > 0) {
        const machineData = machineComparisonData.map((m) => ({
          "Tên máy": m.name,
          "Mã máy": m.code,
          "Tổng SP": m.total,
          "Yield Rate (%)": m.yieldRate.toFixed(2),
          "NG Rate (%)": m.ngRate.toFixed(2),
        }));
        const ws3 = XLSX.utils.json_to_sheet(machineData);
        XLSX.utils.book_append_sheet(wb, ws3, "Thống kê theo máy");
      }
      
      // Sheet 4: Factory Stats
      if (factoryComparisonData.length > 0) {
        const factoryData = factoryComparisonData.map((f) => ({
          "Tên nhà máy": f.name,
          "Mã nhà máy": f.code,
          "Tổng SP": f.total,
          "Yield Rate (%)": f.yieldRate.toFixed(2),
          "Số máy": f.machines,
        }));
        const ws4 = XLSX.utils.json_to_sheet(factoryData);
        XLSX.utils.book_append_sheet(wb, ws4, "Thống kê theo nhà máy");
      }
      
      // Save file
      XLSX.writeFile(wb, `bao-cao-yield-${new Date().toISOString().split("T")[0]}.xlsx`);
      toast.success("Đã xuất báo cáo Excel thành công");
    } catch (error) {
      console.error("Excel export error:", error);
      toast.error("Lỗi khi xuất báo cáo Excel");
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
      doc.text("BÁO CÁO YIELD RATE", pageWidth / 2, 20, { align: "center" });
      
      doc.setFontSize(10);
      doc.text(`Thời gian: ${timeRange === "7d" ? "7 ngày" : timeRange === "30d" ? "30 ngày" : timeRange === "90d" ? "90 ngày" : "1 năm"} qua`, pageWidth / 2, 28, { align: "center" });
      doc.text(`Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}`, pageWidth / 2, 34, { align: "center" });
      
      // Summary section
      doc.setFontSize(14);
      doc.text("TỔNG HỢP", 14, 48);
      
      const summaryData = [
        ["Tổng sản phẩm", aggregatedStats.totalProducts.toLocaleString()],
        ["Sản phẩm OK", aggregatedStats.okCount.toLocaleString()],
        ["Sản phẩm NG", aggregatedStats.ngCount.toLocaleString()],
        ["Sản phẩm NTF", aggregatedStats.ntfCount.toLocaleString()],
        ["Yield Rate", `${aggregatedStats.yieldRate.toFixed(2)}%`],
        ["Xu hướng", `${aggregatedStats.trend >= 0 ? "+" : ""}${aggregatedStats.trend.toFixed(2)}%`],
      ];
      
      autoTable(doc, {
        startY: 52,
        head: [["Chỉ số", "Giá trị"]],
        body: summaryData,
        theme: "grid",
        headStyles: { fillColor: [6, 182, 212] },
        styles: { fontSize: 10 },
      });
      
      // Daily stats table
      doc.setFontSize(14);
      const dailyStartY = (doc as any).lastAutoTable.finalY + 15;
      doc.text("THỐNG KÊ THEO NGÀY", 14, dailyStartY);
      
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
        head: [["Ngày", "Tổng SP", "OK", "NG", "NTF", "Yield Rate"]],
        body: dailyData,
        theme: "grid",
        headStyles: { fillColor: [6, 182, 212] },
        styles: { fontSize: 9 },
      });
      
      // Machine stats on new page
      if (machineComparisonData.length > 0) {
        doc.addPage();
        doc.setFontSize(14);
        doc.text("THỐNG KÊ THEO MÁY", 14, 20);
        
        const machineData = machineComparisonData.map((m) => [
          m.name,
          m.code,
          m.total.toLocaleString(),
          `${m.yieldRate.toFixed(2)}%`,
          `${m.ngRate.toFixed(2)}%`,
        ]);
        
        autoTable(doc, {
          startY: 24,
          head: [["Tên máy", "Mã máy", "Tổng SP", "Yield Rate", "NG Rate"]],
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
        doc.text("THỐNG KÊ THEO NHÀ MÁY", 14, factoryStartY);
        
        const factoryData = factoryComparisonData.map((f) => [
          f.name,
          f.code,
          f.total.toLocaleString(),
          `${f.yieldRate.toFixed(2)}%`,
          f.machines.toString(),
        ]);
        
        autoTable(doc, {
          startY: factoryStartY + 4,
          head: [["Tên nhà máy", "Mã", "Tổng SP", "Yield Rate", "Số máy"]],
          body: factoryData,
          theme: "grid",
          headStyles: { fillColor: [6, 182, 212] },
          styles: { fontSize: 9 },
        });
      }
      
      // Save
      doc.save(`bao-cao-yield-${new Date().toISOString().split("T")[0]}.pdf`);
      toast.success("Đã xuất báo cáo PDF thành công");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Lỗi khi xuất báo cáo PDF");
    } finally {
      setIsExporting(false);
    }
  };

  if (authLoading) {
    return (
      <DashboardLayout title="Báo cáo & Thống kê" navItems={navItems} currentPath="/reports">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="Báo cáo & Thống kê" navItems={navItems} currentPath="/reports">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Factory className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedFactory} onValueChange={setSelectedFactory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Chọn nhà máy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nhà máy</SelectItem>
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
              <SelectItem value="7d">7 ngày qua</SelectItem>
              <SelectItem value="30d">30 ngày qua</SelectItem>
              <SelectItem value="90d">90 ngày qua</SelectItem>
              <SelectItem value="365d">1 năm qua</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => refetchStats()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Làm mới
        </Button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" disabled={isExporting}>
              {isExporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Xuất báo cáo
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Chọn định dạng</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportPDF} className="cursor-pointer">
              <FileText className="h-4 w-4 mr-2 text-red-500" />
              Xuất PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer">
              <FileSpreadsheet className="h-4 w-4 mr-2 text-green-500" />
              Xuất Excel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer">
              <File className="h-4 w-4 mr-2 text-blue-500" />
              Xuất CSV
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
                <p className="text-sm text-muted-foreground">Tổng sản phẩm</p>
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
                <p className="text-sm text-muted-foreground">Sản phẩm OK</p>
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
                <p className="text-sm text-muted-foreground">Sản phẩm NG</p>
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
                <p className="text-sm text-muted-foreground">Sản phẩm NTF</p>
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
          <TabsTrigger value="executive">Tổng quan</TabsTrigger>
          <TabsTrigger value="overview">Biểu đồ</TabsTrigger>
          <TabsTrigger value="trend">Xu hướng</TabsTrigger>
          <TabsTrigger value="machines">Theo máy</TabsTrigger>
          <TabsTrigger value="factories">Theo nhà máy</TabsTrigger>
        </TabsList>

        <TabsContent value="executive" className="space-y-4">
          {/* Executive Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Tóm Tắt Điều Hành
              </CardTitle>
              <CardDescription>Tổng quan hiệu suất sản xuất trong kỳ báo cáo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">Hiệu suất tổng thể</h4>
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
                    {aggregatedStats.yieldRate >= 95 ? "Đạt mục tiêu" : aggregatedStats.yieldRate >= 90 ? "Gần đạt mục tiêu" : "Cần cải thiện"}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">So với kỳ trước</h4>
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
                    {aggregatedStats.trend >= 0 ? "Xu hướng tăng" : "Xu hướng giảm"}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-muted-foreground">Phân bố kết quả</h4>
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
              <CardTitle className="text-lg">Hiệu Suất Máy</CardTitle>
              <CardDescription>Top máy có hiệu suất cao nhất và thấp nhất</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Máy</TableHead>
                    <TableHead>Mã máy</TableHead>
                    <TableHead className="text-right">Tổng SP</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                    <TableHead>Đánh giá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineComparisonData.slice(0, 5).map((machine: { name: string; code: string; total: number; yieldRate: number }, index: number) => {
                    return (
                      <TableRow key={index}>
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
                            <Badge className="bg-green-500">Xuất sắc</Badge>
                          ) : machine.yieldRate >= 90 ? (
                            <Badge className="bg-amber-500">Đạt</Badge>
                          ) : (
                            <Badge variant="destructive">Cần cải thiện</Badge>
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
              <CardTitle className="text-lg">Khuyến Nghị Cải Thiện</CardTitle>
              <CardDescription>Dựa trên phân tích dữ liệu hiện tại</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {aggregatedStats.yieldRate < 95 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-600">Yield Rate dưới mục tiêu 95%</p>
                      <p className="text-sm text-muted-foreground">Kiểm tra các máy có tỷ lệ NG cao và ưu tiên bảo trì, hiệu chuẩn lại.</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.trend < 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <TrendingDown className="h-5 w-5 text-red-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-red-600">Xu hướng giảm so với kỳ trước</p>
                      <p className="text-sm text-muted-foreground">Phân tích nguyên nhân gốc rễ và thực hiện các biện pháp khắc phục ngay.</p>
                    </div>
                  </div>
                )}
                {aggregatedStats.yieldRate >= 95 && aggregatedStats.trend >= 0 && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-600">Hiệu suất tốt</p>
                      <p className="text-sm text-muted-foreground">Tiếp tục duy trì và tìm cách cải thiện thêm để đạt mục tiêu cao hơn.</p>
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
                      <Bar yAxisId="left" dataKey="total" name="Tổng SP" fill={COLORS.primary} opacity={0.5} />
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
                <CardTitle className="text-lg">Phân bố kết quả</CardTitle>
                <CardDescription>Tỷ lệ OK/NG/NTF trong kỳ</CardDescription>
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
              <CardTitle className="text-lg">Sản lượng theo ngày</CardTitle>
              <CardDescription>Biểu đồ sản lượng OK/NG/NTF theo ngày</CardDescription>
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
              <CardTitle className="text-lg">Xu hướng Yield Rate chi tiết</CardTitle>
              <CardDescription>Biểu đồ Yield Rate với đường xu hướng</CardDescription>
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
                      name="Mục tiêu (95%)"
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
              <CardTitle className="text-lg">Chi tiết theo ngày</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ngày</TableHead>
                    <TableHead className="text-right">Tổng SP</TableHead>
                    <TableHead className="text-right">OK</TableHead>
                    <TableHead className="text-right">NG</TableHead>
                    <TableHead className="text-right">NTF</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yieldTrendData.slice(-14).reverse().map((row: { fullDate: string; total: number; ok: number; ng: number; ntf: number; yieldRate: number }, index: number) => (
                    <TableRow key={index}>
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
              <CardTitle className="text-lg">So sánh hiệu suất máy</CardTitle>
              <CardDescription>Yield Rate của từng máy trong kỳ</CardDescription>
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
              <CardTitle className="text-lg">Chi tiết theo máy</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Máy</TableHead>
                    <TableHead>Mã máy</TableHead>
                    <TableHead className="text-right">Tổng SP</TableHead>
                    <TableHead className="text-right">Yield Rate</TableHead>
                    <TableHead className="text-right">NG Rate</TableHead>
                    <TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {machineComparisonData.map((machine: { name: string; code: string; total: number; yieldRate: number; ngRate: number }, index: number) => (
                    <TableRow key={index}>
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
                          <Badge variant="outline" className="text-green-500 border-green-500">Tốt</Badge>
                        ) : machine.yieldRate >= 90 ? (
                          <Badge variant="outline" className="text-amber-500 border-amber-500">Cần cải thiện</Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-500 border-red-500">Cảnh báo</Badge>
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
              <CardTitle className="text-lg">So sánh hiệu suất nhà máy</CardTitle>
              <CardDescription>Yield Rate của từng nhà máy trong kỳ</CardDescription>
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
            {factoryComparisonData.map((factory: { name: string; code: string; total: number; yieldRate: number; machines: number }, index: number) => (
              <Card key={index}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{factory.name}</CardTitle>
                  <CardDescription>{factory.code}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Tổng sản phẩm</span>
                      <span className="font-medium">{factory.total.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Yield Rate</span>
                      <Badge variant={factory.yieldRate >= 95 ? "default" : factory.yieldRate >= 90 ? "secondary" : "destructive"}>
                        {factory.yieldRate.toFixed(2)}%
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Số máy</span>
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
