import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  History as HistoryIcon,
  Download,
  Loader2,
  BarChart3,
  TrendingUp,
  PieChart,
  Target,
  Activity
} from "lucide-react";
import { toast } from "sonner";
import { navItems } from "@/lib/navigation";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function History() {
  const [filters, setFilters] = useState({
    factoryCode: "",
    workshopCode: "",
    lineCode: "",
    stationCode: "",
    machineCode: "",
    serialNumber: "",
    result: "all" as "all" | "OK" | "NG" | "NTF",
  });
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("list");
  const [analysisLimit, setAnalysisLimit] = useState(100);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const limit = 20;

  const { data, isLoading, refetch } = trpc.inspection.search.useQuery({
    factoryCode: filters.factoryCode || undefined,
    workshopCode: filters.workshopCode || undefined,
    lineCode: filters.lineCode || undefined,
    stationCode: filters.stationCode || undefined,
    machineCode: filters.machineCode || undefined,
    serialNumber: filters.serialNumber || undefined,
    result: filters.result !== "all" ? filters.result : undefined,
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
    result: filters.result !== "all" ? filters.result : undefined,
    limit: analysisLimit, // Progressive loading for analysis
    offset: 0,
  });

  const { data: machines } = trpc.machine.list.useQuery();

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
      const date = format(new Date(i.inspectionTime), "dd/MM");
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
      result: "all",
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
          format(new Date(inspection.inspectedAt), "dd/MM/yyyy HH:mm:ss"),
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
      link.download = `inspection_history_${format(new Date(), "yyyyMMdd_HHmmss")}.csv`;
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
                <Input
                  placeholder="VD: SN123456789"
                  value={filters.serialNumber}
                  onChange={(e) => setFilters({ ...filters, serialNumber: e.target.value })}
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
              <div className="flex items-end gap-2">
                <Button onClick={handleSearch} className="gap-2">
                  <Search className="h-4 w-4" />
                  Tìm kiếm
                </Button>
                <Button variant="outline" onClick={handleClearFilters}>
                  Xóa bộ lọc
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs: List and Analysis */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="list" className="gap-2">
              <HistoryIcon className="h-4 w-4" />
              Danh sách
            </TabsTrigger>
            <TabsTrigger value="analysis" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Phân tích
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
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-20 bg-muted/50 animate-pulse rounded-lg" />
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
                                {format(new Date(inspection.inspectionTime), "dd/MM/yyyy HH:mm:ss")}
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
