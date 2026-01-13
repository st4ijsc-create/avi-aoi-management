import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { 
  Activity, 
  AlertTriangle, 
  Box, 
  CheckCircle2, 
  Cpu, 
  RefreshCw, 
  TrendingUp,
  XCircle,
  Clock,
  LayoutGrid,
  FileText,
  History
} from "lucide-react";
import { navItems } from "@/lib/navigation";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";



export default function Dashboard() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState("today");
  const [selectedFactory, setSelectedFactory] = useState<string>("all");

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

  // Fetch dashboard stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.dashboard.getStats.useQuery({
    factoryId: selectedFactory !== "all" ? parseInt(selectedFactory) : undefined,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch all machines stats
  const { data: machinesStats, isLoading: machinesLoading } = trpc.dashboard.getAllMachinesStats.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: 30000,
  });

  // Fetch factories for filter
  const { data: factories } = trpc.factory.list.useQuery();

  const pieData = useMemo(() => {
    if (!stats) return [];
    return [
      { name: "OK", value: stats.ok, color: "oklch(0.72 0.17 145)" },
      { name: "NG", value: stats.ng, color: "oklch(0.65 0.2 25)" },
      { name: "NTF", value: stats.ntf, color: "oklch(0.78 0.15 75)" },
    ].filter(item => item.value > 0);
  }, [stats]);

  const handleRefresh = () => {
    refetchStats();
  };

  return (
    <DashboardLayout 
      title="Dashboard" 
      navItems={navItems}
      currentPath="/dashboard"
    >
      <div className="space-y-6">
        {/* Header with filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dashboard Realtime</h1>
            <p className="text-muted-foreground">Theo dõi chất lượng sản xuất từ tất cả máy kết nối</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select value={selectedFactory} onValueChange={setSelectedFactory}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tất cả nhà máy" />
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

            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hôm nay</SelectItem>
                <SelectItem value="week">7 ngày</SelectItem>
                <SelectItem value="month">30 ngày</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Main Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Product
              </CardTitle>
              <Box className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {statsLoading ? "..." : stats?.total.toLocaleString() || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Tổng sản phẩm kiểm tra
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card border-success/30">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                OK
              </CardTitle>
              <CheckCircle2 className="h-5 w-5 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">
                {statsLoading ? "..." : stats?.ok.toLocaleString() || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sản phẩm đạt chuẩn
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card border-destructive/30">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                NG
              </CardTitle>
              <XCircle className="h-5 w-5 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">
                {statsLoading ? "..." : stats?.ng.toLocaleString() || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Sản phẩm lỗi
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card border-warning/30">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                NTF
              </CardTitle>
              <AlertTriangle className="h-5 w-5 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-warning">
                {statsLoading ? "..." : stats?.ntf.toLocaleString() || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Not True Fail
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card glow-primary">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Yield Rate
              </CardTitle>
              <TrendingUp className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">
                {statsLoading ? "..." : `${stats?.yieldRate.toFixed(2) || 0}%`}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Tỷ lệ đạt chuẩn
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Pie Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Phân bố kết quả</CardTitle>
              <CardDescription>Tỷ lệ OK/NG/NTF</CardDescription>
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
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'oklch(0.18 0.015 260)', 
                          border: '1px solid oklch(0.28 0.02 260)',
                          borderRadius: '8px'
                        }}
                      />
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

          {/* Machine Stats */}
          <Card className="glass-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Thống kê theo máy</CardTitle>
              <CardDescription>Hiệu suất từng máy trong khoảng thời gian</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-h-[250px] overflow-y-auto pr-2">
                {machinesLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : machinesStats && machinesStats.length > 0 ? (
                  machinesStats.map(({ machine, stats: machineStats }) => (
                    <div 
                      key={machine.id} 
                      className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Cpu className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">{machine.name}</p>
                          <p className="text-xs text-muted-foreground">{machine.code} • {machine.machineType}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-center">
                          <p className="font-semibold text-foreground">{machineStats.total}</p>
                          <p className="text-xs text-muted-foreground">Total</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-success">{machineStats.ok}</p>
                          <p className="text-xs text-muted-foreground">OK</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-destructive">{machineStats.ng}</p>
                          <p className="text-xs text-muted-foreground">NG</p>
                        </div>
                        <div className="text-center">
                          <p className="font-semibold text-primary">{machineStats.yieldRate.toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">Yield</p>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-[200px] flex flex-col items-center justify-center text-muted-foreground">
                    <Cpu className="h-12 w-12 mb-3 opacity-50" />
                    <p>Chưa có máy nào được cấu hình</p>
                    <Link href="/settings">
                      <Button variant="link" size="sm" className="mt-2">
                        Thêm máy mới
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/history">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <History className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Xem lịch sử</h3>
                  <p className="text-sm text-muted-foreground">Tìm kiếm và xem chi tiết kết quả</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/layout">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <LayoutGrid className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Layout nhà xưởng</h3>
                  <p className="text-sm text-muted-foreground">Trực quan hóa vị trí máy</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/api-docs">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">API Documentation</h3>
                  <p className="text-sm text-muted-foreground">Hướng dẫn tích hợp máy</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
