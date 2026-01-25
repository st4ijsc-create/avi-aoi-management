import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Heart,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Gauge,
  Clock,
  Zap,
  Settings2,
  BarChart3,
  Download,
  ArrowUpRight,
  ArrowDownRight
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  Cell
} from "recharts";
import { toast } from "sonner";

interface HealthScore {
  score: number;
  factors: { name: string; score: number; weight: number }[];
  lastUpdated: Date;
}

// Health Status Badge
function HealthStatusBadge({ status }: { status: 'healthy' | 'warning' | 'critical' }) {
  const config = {
    healthy: { label: "Khỏe mạnh", variant: "default" as const, icon: CheckCircle2, color: "text-green-500" },
    warning: { label: "Cảnh báo", variant: "secondary" as const, icon: AlertTriangle, color: "text-yellow-500" },
    critical: { label: "Nguy hiểm", variant: "destructive" as const, icon: XCircle, color: "text-red-500" },
  };
  
  const { label, variant, icon: Icon, color } = config[status];
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      <Icon className={`h-3 w-3 ${color}`} />
      {label}
    </Badge>
  );
}

// Health Score Gauge
function HealthGauge({ score, size = "lg" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const getColor = (score: number) => {
    if (score >= 80) return "#22c55e"; // green
    if (score >= 60) return "#eab308"; // yellow
    if (score >= 40) return "#f97316"; // orange
    return "#ef4444"; // red
  };

  const sizeClasses = {
    sm: "h-20 w-20",
    md: "h-32 w-32",
    lg: "h-40 w-40"
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl"
  };

  return (
    <div className={`relative ${sizeClasses[size]}`}>
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-muted"
        />
        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={getColor(score)}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${score * 2.83} 283`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold ${textSizes[size]}`} style={{ color: getColor(score) }}>
          {score.toFixed(0)}
        </span>
        <span className="text-xs text-muted-foreground">Health Score</span>
      </div>
    </div>
  );
}

// Factor Card
function FactorCard({ 
  title, 
  value, 
  icon: Icon, 
  description, 
  trend 
}: { 
  title: string; 
  value: number; 
  icon: React.ComponentType<{ className?: string }>; 
  description: string;
  trend?: number;
}) {
  const getColor = (value: number) => {
    if (value >= 80) return "text-green-500";
    if (value >= 60) return "text-yellow-500";
    if (value >= 40) return "text-orange-500";
    return "text-red-500";
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-muted ${getColor(value)}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{title}</p>
              <p className={`text-2xl font-bold ${getColor(value)}`}>{value.toFixed(1)}%</p>
            </div>
          </div>
          {trend !== undefined && (
            <div className={`flex items-center ${trend >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {trend >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
              <span className="text-sm">{Math.abs(trend).toFixed(1)}%</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">{description}</p>
        <Progress value={value} className="mt-2 h-2" />
      </CardContent>
    </Card>
  );
}

export default function MachineHealthMonitoring() {
  const [selectedMachine, setSelectedMachine] = useState<number | null>(null);
  const [timeRange, setTimeRange] = useState<"day" | "week" | "month">("week");

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: allOEE, refetch: refetchOEE } = trpc.mqttClient.getAllOEE.useQuery();
  const { data: machineHealth, refetch: refetchHealth } = trpc.mqttClient.getMachineHealth.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );

  // Calculate health for all machines
  const calculateHealthMutation = trpc.mqttClient.calculateMachineHealth.useMutation({
    onSuccess: () => {
      toast.success("Đã tính toán health score");
      refetchHealth();
    },
  });

  // Generate mock health history data for chart
  const healthHistoryData = useMemo(() => {
    const days = timeRange === "day" ? 24 : timeRange === "week" ? 7 : 30;
    const data = [];
    const baseScore = machineHealth?.score || 75;
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      if (timeRange === "day") {
        date.setHours(date.getHours() - i);
      } else {
        date.setDate(date.getDate() - i);
      }
      
      // Add some variation
      const variation = (Math.random() - 0.5) * 20;
      const score = Math.max(0, Math.min(100, baseScore + variation));
      
      data.push({
        time: timeRange === "day" 
          ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
          : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        healthScore: Math.round(score),
        oee: Math.round(score * 0.9 + Math.random() * 10),
        uptime: Math.round(score * 0.95 + Math.random() * 5),
        errorRate: Math.round(100 - score + Math.random() * 10),
      });
    }
    return data;
  }, [machineHealth, timeRange]);

  // Radar chart data for factors
  const radarData = useMemo(() => {
    if (!machineHealth?.factors) return [];
    return machineHealth.factors.map(f => ({
      factor: f.name,
      value: f.score,
      fullMark: 100
    }));
  }, [machineHealth]);

  // Machine comparison data
  const machineComparisonData = useMemo(() => {
    if (!allOEE) return [];
    return allOEE.map(oee => ({
      name: oee.machineCode,
      machineId: oee.machineId,
      oee: oee.oee,
      availability: oee.availability,
      performance: oee.performance,
      quality: oee.quality,
      // Estimate health score from OEE
      healthScore: Math.round(oee.oee * 0.8 + oee.availability * 0.1 + oee.quality * 0.1),
    }));
  }, [allOEE]);

  // Get health status color
  const getHealthColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#eab308";
    if (score >= 40) return "#f97316";
    return "#ef4444";
  };

  // Export health report
  const exportHealthReport = () => {
    if (!machineComparisonData.length) {
      toast.error("Không có dữ liệu để xuất");
      return;
    }

    const headers = ['Máy', 'Health Score', 'OEE (%)', 'Availability (%)', 'Performance (%)', 'Quality (%)'];
    const rows = machineComparisonData.map(m => [
      m.name,
      m.healthScore,
      m.oee.toFixed(2),
      m.availability.toFixed(2),
      m.performance.toFixed(2),
      m.quality.toFixed(2)
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Machine_Health_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất báo cáo Machine Health");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Heart className="h-6 w-6 text-red-500" />
              Machine Health Monitoring
            </h1>
            <p className="text-muted-foreground">
              Theo dõi sức khỏe máy móc và dự đoán bảo trì
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportHealthReport}>
              <Download className="h-4 w-4 mr-2" />
              Xuất báo cáo
            </Button>
            <Button variant="outline" onClick={() => { refetchOEE(); refetchHealth(); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
          </div>
        </div>

        {/* Machine Selection */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium">Chọn máy để xem chi tiết</label>
                <Select
                  value={selectedMachine?.toString() || ""}
                  onValueChange={(v) => setSelectedMachine(parseInt(v))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Chọn máy..." />
                  </SelectTrigger>
                  <SelectContent>
                    {machines?.map(m => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Khoảng thời gian</label>
                <Select value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
                  <SelectTrigger className="mt-1 w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">24 giờ</SelectItem>
                    <SelectItem value="week">7 ngày</SelectItem>
                    <SelectItem value="month">30 ngày</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Tổng quan</TabsTrigger>
            <TabsTrigger value="details">Chi tiết máy</TabsTrigger>
            <TabsTrigger value="comparison">So sánh máy</TabsTrigger>
            <TabsTrigger value="alerts">Cảnh báo & Khuyến nghị</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-green-500/10">
                      <CheckCircle2 className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Máy khỏe mạnh</p>
                      <p className="text-2xl font-bold text-green-500">
                        {machineComparisonData.filter(m => m.healthScore >= 80).length}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-yellow-500/10">
                      <AlertTriangle className="h-6 w-6 text-yellow-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Cần chú ý</p>
                      <p className="text-2xl font-bold text-yellow-500">
                        {machineComparisonData.filter(m => m.healthScore >= 60 && m.healthScore < 80).length}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-red-500/10">
                      <XCircle className="h-6 w-6 text-red-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Cần bảo trì</p>
                      <p className="text-2xl font-bold text-red-500">
                        {machineComparisonData.filter(m => m.healthScore < 60).length}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-blue-500/10">
                      <Activity className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Health TB</p>
                      <p className="text-2xl font-bold text-blue-500">
                        {machineComparisonData.length > 0 
                          ? (machineComparisonData.reduce((sum, m) => sum + m.healthScore, 0) / machineComparisonData.length).toFixed(0)
                          : 0}%
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Machine Health Overview Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Health Score theo máy</CardTitle>
                <CardDescription>So sánh health score giữa các máy</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={machineComparisonData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, 'Health Score']}
                      />
                      <Bar dataKey="healthScore" name="Health Score">
                        {machineComparisonData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getHealthColor(entry.healthScore)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Machine List Table */}
            <Card>
              <CardHeader>
                <CardTitle>Danh sách máy</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Máy</TableHead>
                      <TableHead>Health Score</TableHead>
                      <TableHead>OEE</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Performance</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machineComparisonData.map((machine) => (
                      <TableRow 
                        key={machine.machineId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedMachine(machine.machineId)}
                      >
                        <TableCell className="font-medium">{machine.name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={machine.healthScore} className="w-20 h-2" />
                            <span className="font-medium" style={{ color: getHealthColor(machine.healthScore) }}>
                              {machine.healthScore}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{machine.oee.toFixed(1)}%</TableCell>
                        <TableCell>{machine.availability.toFixed(1)}%</TableCell>
                        <TableCell>{machine.performance.toFixed(1)}%</TableCell>
                        <TableCell>{machine.quality.toFixed(1)}%</TableCell>
                        <TableCell>
                          <HealthStatusBadge 
                            status={
                              machine.healthScore >= 80 ? 'healthy' :
                              machine.healthScore >= 60 ? 'warning' : 'critical'
                            } 
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Details Tab */}
          <TabsContent value="details" className="space-y-4">
            {selectedMachine ? (
              <>
                {/* Health Score Display */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="md:col-span-1">
                    <CardHeader>
                      <CardTitle>Health Score</CardTitle>
                      <CardDescription>
                        {machines?.find(m => m.id === selectedMachine)?.name || 'N/A'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center">
                      <HealthGauge score={machineHealth?.score || 0} />
                      <div className="mt-4">
                        <HealthStatusBadge 
                          status={
                            (machineHealth?.score || 0) >= 80 ? 'healthy' :
                            (machineHealth?.score || 0) >= 60 ? 'warning' : 'critical'
                          } 
                        />
                      </div>
                      <Button 
                        className="mt-4"
                        onClick={() => {
                          const machine = machines?.find(m => m.id === selectedMachine);
                          if (machine) {
                            calculateHealthMutation.mutate({
                              machineId: machine.id,
                              machineCode: machine.code,
                            });
                          }
                        }}
                      >
                        Tính lại Health Score
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Radar Chart */}
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle>Phân tích các yếu tố</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={radarData}>
                            <PolarGrid />
                            <PolarAngleAxis dataKey="factor" />
                            <PolarRadiusAxis angle={30} domain={[0, 100]} />
                            <Radar
                              name="Health Factors"
                              dataKey="value"
                              stroke="#8884d8"
                              fill="#8884d8"
                              fillOpacity={0.6}
                            />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Factor Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {machineHealth?.factors?.slice(0, 4).map((factor, index) => {
                    const icons = [Gauge, Clock, AlertTriangle, Zap];
                    const descriptions = [
                      'Hiệu suất thiết bị tổng thể',
                      'Thời gian hoạt động',
                      'Tỷ lệ không lỗi',
                      'Ổn định chu kỳ'
                    ];
                    return (
                      <FactorCard
                        key={factor.name}
                        title={factor.name}
                        value={factor.score}
                        icon={icons[index] || Activity}
                        description={descriptions[index] || ''}
                      />
                    );
                  })}
                </div>

                {/* Health History Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle>Lịch sử Health Score</CardTitle>
                    <CardDescription>Xu hướng health score theo thời gian</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={healthHistoryData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="time" />
                          <YAxis domain={[0, 100]} />
                          <Tooltip />
                          <Legend />
                          <Area
                            type="monotone"
                            dataKey="healthScore"
                            name="Health Score"
                            stroke="#8884d8"
                            fill="#8884d8"
                            fillOpacity={0.3}
                          />
                          <Line
                            type="monotone"
                            dataKey="oee"
                            name="OEE"
                            stroke="#82ca9d"
                            strokeDasharray="5 5"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Heart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Chọn một máy để xem chi tiết health monitoring</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>So sánh hiệu suất máy</CardTitle>
                <CardDescription>So sánh các chỉ số giữa các máy</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-96">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={machineComparisonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis type="category" dataKey="name" width={80} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="healthScore" name="Health Score" fill="#8884d8" />
                      <Bar dataKey="oee" name="OEE" fill="#82ca9d" />
                      <Bar dataKey="availability" name="Availability" fill="#ffc658" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Cảnh báo & Khuyến nghị</CardTitle>
                <CardDescription>Các máy cần được chú ý</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {machineComparisonData
                    .filter(m => m.healthScore < 80)
                    .sort((a, b) => a.healthScore - b.healthScore)
                    .map((machine) => (
                      <div 
                        key={machine.machineId}
                        className={`p-4 rounded-lg border ${
                          machine.healthScore < 60 ? 'border-red-500 bg-red-500/10' :
                          'border-yellow-500 bg-yellow-500/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {machine.healthScore < 60 ? (
                              <XCircle className="h-6 w-6 text-red-500" />
                            ) : (
                              <AlertTriangle className="h-6 w-6 text-yellow-500" />
                            )}
                            <div>
                              <p className="font-medium">{machine.name}</p>
                              <p className="text-sm text-muted-foreground">
                                Health Score: {machine.healthScore}%
                              </p>
                            </div>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setSelectedMachine(machine.machineId)}
                          >
                            Xem chi tiết
                          </Button>
                        </div>
                        <div className="mt-3 text-sm">
                          <p className="font-medium">Khuyến nghị:</p>
                          <ul className="list-disc list-inside text-muted-foreground">
                            {machine.healthScore < 60 && (
                              <li>Cần kiểm tra và bảo trì ngay lập tức</li>
                            )}
                            {machine.oee < 70 && (
                              <li>OEE thấp ({machine.oee.toFixed(1)}%) - Kiểm tra hiệu suất sản xuất</li>
                            )}
                            {machine.availability < 85 && (
                              <li>Availability thấp ({machine.availability.toFixed(1)}%) - Giảm thời gian dừng máy</li>
                            )}
                            {machine.quality < 95 && (
                              <li>Quality thấp ({machine.quality.toFixed(1)}%) - Kiểm tra chất lượng sản phẩm</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    ))}
                  {machineComparisonData.filter(m => m.healthScore < 80).length === 0 && (
                    <div className="text-center py-8">
                      <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-4" />
                      <p className="text-muted-foreground">Tất cả máy đều hoạt động tốt!</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
