import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  History,
  ChevronRight,
  Eye,
  Zap,
  Target,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight
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
  Cell,
  BarChart,
  Bar,
  Legend
} from "recharts";

// Types
type DashboardStats = {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
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
};

type InspectionResult = {
  id: number;
  serialNumber: string;
  productModel: string | null;
  overallResult: string;
  createdAt: Date;
  machineName?: string;
};

export default function Dashboard() {
  const { user } = useAuth();
  const [timeRange, setTimeRange] = useState("today");
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedWorkshop, setSelectedWorkshop] = useState<string>("all");
  const [selectedLine, setSelectedLine] = useState<string>("all");
  const [selectedMachine, setSelectedMachine] = useState<MachineStats | null>(null);
  const [machineDetailOpen, setMachineDetailOpen] = useState(false);

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
    refetchInterval: 30000,
  });

  // Fetch all machines stats
  const { data: machinesStats, isLoading: machinesLoading } = trpc.dashboard.getAllMachinesStats.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  }, {
    refetchInterval: 30000,
  });

  // Fetch factories, workshops, lines for filters
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Fetch recent inspections for selected machine
  const { data: recentInspections } = trpc.inspection.list.useQuery({
    machineId: selectedMachine?.id,
    limit: 20,
  }, {
    enabled: !!selectedMachine,
  });

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
      
      const lineKey = machine.lineName || "Chưa phân loại";
      if (!grouped.has(lineKey)) {
        grouped.set(lineKey, []);
      }
      grouped.get(lineKey)!.push(machine);
    });
    
    return grouped;
  }, [machinesStats, selectedFactory, selectedWorkshop, selectedLine]);

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

  const pieData = useMemo(() => {
    if (!stats) return [];
    const s = stats as DashboardStats;
    return [
      { name: "OK", value: s.ok, color: "oklch(0.72 0.17 145)" },
      { name: "NG", value: s.ng, color: "oklch(0.65 0.2 25)" },
      { name: "NTF", value: s.ntf, color: "oklch(0.78 0.15 75)" },
    ].filter(item => item.value > 0);
  }, [stats]);

  const handleRefresh = () => {
    refetchStats();
  };

  const openMachineDetail = (machine: MachineStats) => {
    setSelectedMachine(machine);
    setMachineDetailOpen(true);
  };

  return (
    <DashboardLayout 
      title="Dashboard" 
      navItems={navItems}
      currentPath="/dashboard"
    >
      <div className="space-y-6">
        {/* Header with filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Production Dashboard
            </h1>
            <p className="text-muted-foreground">Theo dõi chất lượng sản xuất theo dây chuyền</p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
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

            <Button variant="outline" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Summary Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="glass-card">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Output</p>
                  <p className="text-2xl font-bold text-foreground mt-1">
                    {statsLoading ? "..." : (stats as DashboardStats | undefined)?.total?.toLocaleString() || 0}
                  </p>
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
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">FPY</p>
                  <p className="text-2xl font-bold text-success mt-1">
                    {statsLoading ? "..." : `${(stats as DashboardStats | undefined)?.yieldRate?.toFixed(1) || 0}%`}
                  </p>
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
                  <p className="text-2xl font-bold text-success mt-1">
                    {statsLoading ? "..." : (stats as DashboardStats | undefined)?.ok?.toLocaleString() || 0}
                  </p>
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
                  <p className="text-2xl font-bold text-destructive mt-1">
                    {statsLoading ? "..." : (stats as DashboardStats | undefined)?.ng?.toLocaleString() || 0}
                  </p>
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
                  <p className="text-2xl font-bold text-warning mt-1">
                    {statsLoading ? "..." : (stats as DashboardStats | undefined)?.ntf?.toLocaleString() || 0}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-warning" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Production Line Layout */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Layout Dây chuyền sản xuất
            </h2>
            <Badge variant="outline" className="text-muted-foreground">
              {machinesByLine.size} dây chuyền • {Array.from(machinesByLine.values()).flat().length} máy
            </Badge>
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
                            <h3 className="font-semibold text-foreground">{lineName}</h3>
                            <p className="text-sm text-muted-foreground">{machines.length} máy hoạt động</p>
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
                          const yields = calculateYields(machine);
                          const status = getStatusIndicator(parseFloat(yields.fpy));
                          const StatusIcon = status.icon;

                          return (
                            <div
                              key={machine.id}
                              onClick={() => openMachineDetail(machine)}
                              className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${getStatusColor(parseFloat(yields.fpy))}`}
                            >
                              {/* Status Indicator */}
                              <div className="absolute top-3 right-3">
                                <StatusIcon className={`h-5 w-5 ${status.color}`} />
                              </div>

                              {/* Machine Info */}
                              <div className="mb-3">
                                <h4 className="font-semibold text-foreground truncate pr-6">{machine.name}</h4>
                                <p className="text-xs text-muted-foreground">{machine.code}</p>
                              </div>

                              {/* Metrics Grid */}
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="bg-background/50 rounded-lg p-2 text-center">
                                  <p className="text-xs text-muted-foreground">FPY</p>
                                  <p className="font-bold text-success">{yields.fpy}%</p>
                                </div>
                                <div className="bg-background/50 rounded-lg p-2 text-center">
                                  <p className="text-xs text-muted-foreground">Output</p>
                                  <p className="font-bold text-foreground">{machine.total}</p>
                                </div>
                                <div className="bg-background/50 rounded-lg p-2 text-center">
                                  <p className="text-xs text-muted-foreground">FY</p>
                                  <p className="font-bold text-destructive">{yields.fy}%</p>
                                </div>
                                <div className="bg-background/50 rounded-lg p-2 text-center">
                                  <p className="text-xs text-muted-foreground">NTFY</p>
                                  <p className="font-bold text-warning">{yields.ntfy}%</p>
                                </div>
                              </div>

                              {/* View Detail Button */}
                              <div className="mt-3 flex items-center justify-center gap-1 text-xs text-primary">
                                <Eye className="h-3 w-3" />
                                <span>Xem chi tiết</span>
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

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Phân bố kết quả</CardTitle>
              <CardDescription>Tỷ lệ OK/NG/NTF tổng hợp</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={100}
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

          {/* Top Machines by Output */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Top máy theo sản lượng</CardTitle>
              <CardDescription>10 máy có output cao nhất</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                {machinesStats && (machinesStats as Array<{ machine: { code: string }; stats: { total: number; ok: number; ng: number; ntf: number } }>).length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(machinesStats as Array<{ machine: { code: string }; stats: { total: number; ok: number; ng: number; ntf: number } }>)
                        .sort((a, b) => b.stats.total - a.stats.total)
                        .slice(0, 10)
                        .map(m => ({
                          name: m.machine.code,
                          OK: m.stats.ok,
                          NG: m.stats.ng,
                          NTF: m.stats.ntf,
                        }))}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 50, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.02 260)" />
                      <XAxis type="number" stroke="oklch(0.6 0.02 260)" />
                      <YAxis type="category" dataKey="name" stroke="oklch(0.6 0.02 260)" width={60} />
                      <Tooltip
                        contentStyle={{ 
                          backgroundColor: 'oklch(0.18 0.015 260)', 
                          border: '1px solid oklch(0.28 0.02 260)',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="OK" stackId="a" fill="oklch(0.72 0.17 145)" />
                      <Bar dataKey="NG" stackId="a" fill="oklch(0.65 0.2 25)" />
                      <Bar dataKey="NTF" stackId="a" fill="oklch(0.78 0.15 75)" />
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
      </div>

      {/* Machine Detail Modal */}
      <Dialog open={machineDetailOpen} onOpenChange={setMachineDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" />
              Chi tiết máy: {selectedMachine?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedMachine?.code} • {selectedMachine?.lineName} • {selectedMachine?.workshopName}
            </DialogDescription>
          </DialogHeader>

          {selectedMachine && (
            <Tabs defaultValue="overview" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="overview">Tổng quan</TabsTrigger>
                <TabsTrigger value="recent">Kết quả gần nhất</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-sm text-muted-foreground">Total Output</p>
                      <p className="text-3xl font-bold text-foreground">{selectedMachine.total}</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-sm text-muted-foreground">FPY</p>
                      <p className="text-3xl font-bold text-success">
                        {calculateYields(selectedMachine).fpy}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-sm text-muted-foreground">FY (Fail)</p>
                      <p className="text-3xl font-bold text-destructive">
                        {calculateYields(selectedMachine).fy}%
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-sm text-muted-foreground">NTFY</p>
                      <p className="text-3xl font-bold text-warning">
                        {calculateYields(selectedMachine).ntfy}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Result Distribution */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Phân bố kết quả</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-12">OK</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-success rounded-full transition-all duration-500"
                            style={{ width: `${selectedMachine.total > 0 ? (selectedMachine.ok / selectedMachine.total) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-16 text-right">{selectedMachine.ok}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-12">NG</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-destructive rounded-full transition-all duration-500"
                            style={{ width: `${selectedMachine.total > 0 ? (selectedMachine.ng / selectedMachine.total) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-16 text-right">{selectedMachine.ng}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground w-12">NTF</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-warning rounded-full transition-all duration-500"
                            style={{ width: `${selectedMachine.total > 0 ? (selectedMachine.ntf / selectedMachine.total) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium w-16 text-right">{selectedMachine.ntf}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="recent" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Top 20 kết quả kiểm tra gần nhất</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      {recentInspections && recentInspections.data?.length > 0 ? (
                        <div className="space-y-2">
                          {recentInspections.data.map((inspection, index) => (
                            <div 
                              key={inspection.id}
                              className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-sm text-muted-foreground w-6">#{index + 1}</span>
                                <div>
                                  <p className="font-medium text-foreground">{inspection.serialNumber}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {inspection.productModel || 'N/A'} • {new Date(inspection.createdAt).toLocaleString('vi-VN')}
                                  </p>
                                </div>
                              </div>
                              <Badge 
                                variant={
                                  inspection.overallResult === 'OK' ? 'default' : 
                                  inspection.overallResult === 'NG' ? 'destructive' : 'secondary'
                                }
                                className={
                                  inspection.overallResult === 'OK' ? 'bg-success text-success-foreground' :
                                  inspection.overallResult === 'NTF' ? 'bg-warning text-warning-foreground' : ''
                                }
                              >
                                {inspection.overallResult}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                          Chưa có dữ liệu kiểm tra
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
