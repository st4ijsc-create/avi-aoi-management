import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Gauge, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  RefreshCw,
  Calculator,
  BarChart3,
  Timer,
  Zap,
  Target,
  Play,
  Pause,
  StopCircle,
  Wrench,
  Settings2,
  Download,
  FileSpreadsheet
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
  RadialBarChart,
  RadialBar,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie
} from "recharts";
import { toast } from "sonner";

interface OEEMetrics {
  machineId: number;
  machineCode: string;
  timestamp: Date;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  details: {
    plannedTime: number;
    runTime: number;
    downtime: number;
    idealCycleTime: number;
    totalCount: number;
    goodCount: number;
    rejectCount: number;
  };
}

interface DowntimeEvent {
  id: string;
  machineId: number;
  machineCode: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  category: 'planned' | 'unplanned' | 'breakdown' | 'changeover' | 'maintenance' | 'other';
  reason?: string;
  notes?: string;
  reportedBy?: string;
}

// OEE Gauge Component
function OEEGauge({ value, label, color }: { value: number; label: string; color: string }) {
  const data = [{ name: label, value, fill: color }];
  
  return (
    <div className="relative h-32 w-32">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="100%"
          barSize={10}
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar
            background
            dataKey="value"
            cornerRadius={5}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{value.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

// Downtime Category Badge
function DowntimeCategoryBadge({ category }: { category: DowntimeEvent['category'] }) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    planned: { label: "Kế hoạch", variant: "secondary" },
    unplanned: { label: "Ngoài kế hoạch", variant: "destructive" },
    breakdown: { label: "Hỏng hóc", variant: "destructive" },
    changeover: { label: "Đổi sản phẩm", variant: "outline" },
    maintenance: { label: "Bảo trì", variant: "default" },
    other: { label: "Khác", variant: "outline" },
  };
  
  const { label, variant } = config[category] || config.other;
  return <Badge variant={variant}>{label}</Badge>;
}

export default function OEEDashboard() {
  const [selectedMachine, setSelectedMachine] = useState<number | null>(null);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showDowntimeDialog, setShowDowntimeDialog] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    machineId: 0,
    machineCode: "",
    plannedTime: 480,
    runTime: 420,
    idealCycleTime: 30,
    totalCount: 800,
    goodCount: 760,
  });
  const [downtimeData, setDowntimeData] = useState({
    machineId: 0,
    machineCode: "",
    category: "unplanned" as DowntimeEvent['category'],
    reason: "",
  });

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: allOEE, refetch: refetchOEE } = trpc.mqttClient.getAllOEE.useQuery();
  const { data: machineOEE } = trpc.mqttClient.getMachineOEE.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const { data: activeDowntime } = trpc.mqttClient.getActiveDowntime.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );
  const { data: downtimeHistory } = trpc.mqttClient.getDowntimeHistory.useQuery({});
  const { data: machineHealth } = trpc.mqttClient.getMachineHealth.useQuery(
    { machineId: selectedMachine! },
    { enabled: !!selectedMachine }
  );

  // Mutations
  const calculateOEEMutation = trpc.mqttClient.calculateOEE.useMutation({
    onSuccess: () => {
      toast.success("Đã tính toán OEE");
      refetchOEE();
      setShowCalculator(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const startDowntimeMutation = trpc.mqttClient.startDowntime.useMutation({
    onSuccess: () => {
      toast.success("Đã bắt đầu ghi nhận downtime");
      setShowDowntimeDialog(false);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const endDowntimeMutation = trpc.mqttClient.endDowntime.useMutation({
    onSuccess: () => {
      toast.success("Đã kết thúc downtime");
    },
  });

  const calculateHealthMutation = trpc.mqttClient.calculateMachineHealth.useMutation({
    onSuccess: () => {
      toast.success("Đã tính toán health score");
    },
  });

  // Calculate average OEE
  const avgOEE = allOEE && allOEE.length > 0
    ? allOEE.reduce((sum, m) => sum + m.oee, 0) / allOEE.length
    : 0;

  // Downtime by category
  const downtimeByCategory = downtimeHistory?.reduce((acc, d) => {
    acc[d.category] = (acc[d.category] || 0) + (d.duration || 0);
    return acc;
  }, {} as Record<string, number>) || {};

  const downtimePieData = Object.entries(downtimeByCategory).map(([category, duration]) => ({
    name: category === 'planned' ? 'Kế hoạch' :
          category === 'unplanned' ? 'Ngoài KH' :
          category === 'breakdown' ? 'Hỏng hóc' :
          category === 'changeover' ? 'Đổi SP' :
          category === 'maintenance' ? 'Bảo trì' : 'Khác',
    value: duration,
  }));

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

  // Export OEE data to CSV
  const exportToCSV = () => {
    if (!allOEE || allOEE.length === 0) {
      toast.error("Không có dữ liệu để xuất");
      return;
    }

    const headers = [
      'Máy',
      'Mã máy',
      'Thời gian',
      'Availability (%)',
      'Performance (%)',
      'Quality (%)',
      'OEE (%)',
      'Thời gian kế hoạch (phút)',
      'Thời gian chạy (phút)',
      'Downtime (phút)',
      'Tổng sản lượng',
      'Sản lượng OK',
      'Sản lượng NG'
    ];

    const rows = allOEE.map(oee => [
      machines?.find(m => m.id === oee.machineId)?.name || `Machine ${oee.machineId}`,
      oee.machineCode,
      new Date(oee.timestamp).toLocaleString('vi-VN'),
      oee.availability.toFixed(2),
      oee.performance.toFixed(2),
      oee.quality.toFixed(2),
      oee.oee.toFixed(2),
      oee.details?.plannedTime || 0,
      oee.details?.runTime || 0,
      oee.details?.downtime || 0,
      oee.details?.totalCount || 0,
      oee.details?.goodCount || 0,
      oee.details?.rejectCount || 0
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OEE_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất báo cáo OEE ra CSV");
  };

  // Export OEE data to Excel (XLSX format via CSV)
  const exportToExcel = () => {
    if (!allOEE || allOEE.length === 0) {
      toast.error("Không có dữ liệu để xuất");
      return;
    }

    // Create workbook content
    const headers = [
      'Máy',
      'Mã máy',
      'Thời gian',
      'Availability (%)',
      'Performance (%)',
      'Quality (%)',
      'OEE (%)',
      'Thời gian kế hoạch (phút)',
      'Thời gian chạy (phút)',
      'Downtime (phút)',
      'Tổng sản lượng',
      'Sản lượng OK',
      'Sản lượng NG'
    ];

    const oeeRows = allOEE.map(oee => [
      machines?.find(m => m.id === oee.machineId)?.name || `Machine ${oee.machineId}`,
      oee.machineCode,
      new Date(oee.timestamp).toLocaleString('vi-VN'),
      oee.availability.toFixed(2),
      oee.performance.toFixed(2),
      oee.quality.toFixed(2),
      oee.oee.toFixed(2),
      oee.details?.plannedTime || 0,
      oee.details?.runTime || 0,
      oee.details?.downtime || 0,
      oee.details?.totalCount || 0,
      oee.details?.goodCount || 0,
      oee.details?.rejectCount || 0
    ]);

    // Add summary section
    const summaryRows = [
      [],
      ['TỔNG HỢP'],
      ['OEE Trung bình', `${avgOEE.toFixed(2)}%`],
      ['Số máy', allOEE.length],
      ['Thời gian xuất báo cáo', new Date().toLocaleString('vi-VN')],
    ];

    // Add downtime summary if available
    if (downtimeHistory && downtimeHistory.length > 0) {
      summaryRows.push(
        [],
        ['THỐNG KÊ DOWNTIME'],
        ['Loại', 'Thời gian (phút)']
      );
      Object.entries(downtimeByCategory).forEach(([category, duration]) => {
        const categoryName = category === 'planned' ? 'Kế hoạch' :
              category === 'unplanned' ? 'Ngoài kế hoạch' :
              category === 'breakdown' ? 'Hỏng hóc' :
              category === 'changeover' ? 'Đổi sản phẩm' :
              category === 'maintenance' ? 'Bảo trì' : 'Khác';
        summaryRows.push([categoryName, duration]);
      });
    }

    const allRows = [headers, ...oeeRows, ...summaryRows];
    const csvContent = allRows
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OEE_Report_${new Date().toISOString().split('T')[0]}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất báo cáo OEE ra Excel");
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 mobile-safe-bottom">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">OEE Dashboard</h1>
            <p className="text-sm sm:text-base text-muted-foreground">
              Theo dõi hiệu suất thiết bị tổng thể (Overall Equipment Effectiveness)
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Xuất CSV
            </Button>
            <Button variant="outline" onClick={exportToExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Xuất Excel
            </Button>
            <Button variant="outline" onClick={() => refetchOEE()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            <Dialog open={showCalculator} onOpenChange={setShowCalculator}>
              <DialogTrigger asChild>
                <Button>
                  <Calculator className="h-4 w-4 mr-2" />
                  Tính OEE
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Tính toán OEE</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Máy</Label>
                    <Select
                      value={calculatorData.machineId.toString()}
                      onValueChange={(v) => {
                        const machine = machines?.find(m => m.id === parseInt(v));
                        setCalculatorData({
                          ...calculatorData,
                          machineId: parseInt(v),
                          machineCode: machine?.code || "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn máy" />
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Thời gian kế hoạch (phút)</Label>
                      <Input
                        type="number"
                        value={calculatorData.plannedTime}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          plannedTime: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                    <div>
                      <Label>Thời gian chạy (phút)</Label>
                      <Input
                        type="number"
                        value={calculatorData.runTime}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          runTime: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Cycle Time lý tưởng (giây/sản phẩm)</Label>
                    <Input
                      type="number"
                      value={calculatorData.idealCycleTime}
                      onChange={(e) => setCalculatorData({
                        ...calculatorData,
                        idealCycleTime: parseInt(e.target.value) || 0,
                      })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Tổng sản lượng</Label>
                      <Input
                        type="number"
                        value={calculatorData.totalCount}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          totalCount: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                    <div>
                      <Label>Sản phẩm đạt</Label>
                      <Input
                        type="number"
                        value={calculatorData.goodCount}
                        onChange={(e) => setCalculatorData({
                          ...calculatorData,
                          goodCount: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCalculator(false)}>
                    Hủy
                  </Button>
                  <Button
                    onClick={() => calculateOEEMutation.mutate(calculatorData)}
                    disabled={!calculatorData.machineId || calculateOEEMutation.isPending}
                  >
                    Tính toán
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4">
          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Gauge className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500" />
                <span className="hidden sm:inline">OEE Trung bình</span>
                <span className="sm:hidden">OEE TB</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">{avgOEE.toFixed(1)}%</div>
              <Progress value={avgOEE} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {avgOEE >= 85 ? "World Class" : avgOEE >= 60 ? "Typical" : "Cần cải thiện"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Activity className="h-3 w-3 sm:h-4 sm:w-4 text-green-500" />
                <span className="hidden sm:inline">Máy đang theo dõi</span>
                <span className="sm:hidden">Máy</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">{allOEE?.length || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                / {machines?.length || 0} tổng số máy
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500" />
                <span className="hidden sm:inline">Downtime hôm nay</span>
                <span className="sm:hidden">Downtime</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {Object.values(downtimeByCategory).reduce((a, b) => a + b, 0)} phút
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {Object.keys(downtimeByCategory).length} sự kiện
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-1 sm:gap-2">
                <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-red-500" />
                Cảnh báo
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold">
                {allOEE?.filter(m => m.oee < 60).length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Máy có OEE thấp
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="oee" className="space-y-4">
          <TabsList>
            <TabsTrigger value="oee">OEE Machines</TabsTrigger>
            <TabsTrigger value="downtime">Downtime</TabsTrigger>
            <TabsTrigger value="health">Machine Health</TabsTrigger>
          </TabsList>

          {/* OEE Tab */}
          <TabsContent value="oee" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Machine List */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg">Danh sách máy</CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto space-y-2">
                  {allOEE?.map((m) => (
                    <div
                      key={m.machineId}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedMachine === m.machineId
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => setSelectedMachine(m.machineId)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.machineCode}</span>
                        <Badge
                          variant={m.oee >= 85 ? "default" : m.oee >= 60 ? "secondary" : "destructive"}
                        >
                          {m.oee.toFixed(1)}%
                        </Badge>
                      </div>
                      <Progress value={m.oee} className="mt-2 h-1" />
                    </div>
                  ))}
                  {(!allOEE || allOEE.length === 0) && (
                    <p className="text-center text-muted-foreground py-4">
                      Chưa có dữ liệu OEE. Sử dụng nút "Tính OEE" để bắt đầu.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* OEE Details */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {machineOEE ? `Chi tiết OEE - ${machineOEE.machineCode}` : "Chọn máy để xem chi tiết"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {machineOEE ? (
                    <div className="space-y-6">
                      {/* OEE Gauges */}
                      <div className="flex justify-around">
                        <OEEGauge
                          value={machineOEE.availability}
                          label="Availability"
                          color="#22c55e"
                        />
                        <OEEGauge
                          value={machineOEE.performance}
                          label="Performance"
                          color="#3b82f6"
                        />
                        <OEEGauge
                          value={machineOEE.quality}
                          label="Quality"
                          color="#f59e0b"
                        />
                        <OEEGauge
                          value={machineOEE.oee}
                          label="OEE"
                          color="#8b5cf6"
                        />
                      </div>

                      {/* Details Table */}
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Thời gian kế hoạch:</span>
                            <span className="font-medium">{machineOEE.details.plannedTime} phút</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Thời gian chạy:</span>
                            <span className="font-medium">{machineOEE.details.runTime} phút</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Downtime:</span>
                            <span className="font-medium text-red-500">{machineOEE.details.downtime} phút</span>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Tổng sản lượng:</span>
                            <span className="font-medium">{machineOEE.details.totalCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Sản phẩm đạt:</span>
                            <span className="font-medium text-green-500">{machineOEE.details.goodCount}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Phế phẩm:</span>
                            <span className="font-medium text-red-500">{machineOEE.details.rejectCount}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDowntimeData({
                              machineId: machineOEE.machineId,
                              machineCode: machineOEE.machineCode,
                              category: "unplanned",
                              reason: "",
                            });
                            setShowDowntimeDialog(true);
                          }}
                        >
                          <Pause className="h-4 w-4 mr-2" />
                          Ghi nhận Downtime
                        </Button>
                        {activeDowntime && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => endDowntimeMutation.mutate({ machineId: machineOEE.machineId })}
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Kết thúc Downtime
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                      <Gauge className="h-12 w-12 mb-4" />
                      <p>Chọn một máy từ danh sách để xem chi tiết OEE</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* OEE Comparison Chart */}
            {allOEE && allOEE.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">So sánh OEE giữa các máy</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={allOEE}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="machineCode" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="availability" name="Availability" fill="#22c55e" />
                        <Bar dataKey="performance" name="Performance" fill="#3b82f6" />
                        <Bar dataKey="quality" name="Quality" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Downtime Tab */}
          <TabsContent value="downtime" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Downtime by Category */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Downtime theo loại</CardTitle>
                </CardHeader>
                <CardContent>
                  {downtimePieData.length > 0 ? (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={downtimePieData}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, value }) => `${name}: ${value}m`}
                            outerRadius={80}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {downtimePieData.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-64 text-muted-foreground">
                      Chưa có dữ liệu downtime
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Downtime Events */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Sự kiện Downtime gần đây</CardTitle>
                </CardHeader>
                <CardContent className="max-h-80 overflow-y-auto">
                  <div className="space-y-3">
                    {downtimeHistory?.slice(-10).reverse().map((event) => (
                      <div key={event.id} className="p-3 border rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium">{event.machineCode}</span>
                          <DowntimeCategoryBadge category={event.category} />
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <div>Bắt đầu: {new Date(event.startTime).toLocaleString('vi-VN')}</div>
                          {event.endTime && (
                            <div>Kết thúc: {new Date(event.endTime).toLocaleString('vi-VN')}</div>
                          )}
                          {event.duration && <div>Thời gian: {event.duration} phút</div>}
                          {event.reason && <div>Lý do: {event.reason}</div>}
                        </div>
                      </div>
                    ))}
                    {(!downtimeHistory || downtimeHistory.length === 0) && (
                      <p className="text-center text-muted-foreground py-4">
                        Chưa có sự kiện downtime nào
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Start Downtime Dialog */}
            <Dialog open={showDowntimeDialog} onOpenChange={setShowDowntimeDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ghi nhận Downtime</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Máy</Label>
                    <Select
                      value={downtimeData.machineId.toString()}
                      onValueChange={(v) => {
                        const machine = machines?.find(m => m.id === parseInt(v));
                        setDowntimeData({
                          ...downtimeData,
                          machineId: parseInt(v),
                          machineCode: machine?.code || "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn máy" />
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
                    <Label>Loại Downtime</Label>
                    <Select
                      value={downtimeData.category}
                      onValueChange={(v) => setDowntimeData({
                        ...downtimeData,
                        category: v as DowntimeEvent['category'],
                      })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planned">Kế hoạch</SelectItem>
                        <SelectItem value="unplanned">Ngoài kế hoạch</SelectItem>
                        <SelectItem value="breakdown">Hỏng hóc</SelectItem>
                        <SelectItem value="changeover">Đổi sản phẩm</SelectItem>
                        <SelectItem value="maintenance">Bảo trì</SelectItem>
                        <SelectItem value="other">Khác</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Lý do</Label>
                    <Input
                      value={downtimeData.reason}
                      onChange={(e) => setDowntimeData({
                        ...downtimeData,
                        reason: e.target.value,
                      })}
                      placeholder="Nhập lý do downtime..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowDowntimeDialog(false)}>
                    Hủy
                  </Button>
                  <Button
                    onClick={() => startDowntimeMutation.mutate(downtimeData)}
                    disabled={!downtimeData.machineId || startDowntimeMutation.isPending}
                  >
                    Bắt đầu
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Machine Health Tab */}
          <TabsContent value="health" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  Machine Health & Predictive Maintenance
                </CardTitle>
                <CardDescription>
                  Theo dõi sức khỏe máy và cảnh báo bảo trì dự phòng
                </CardDescription>
              </CardHeader>
              <CardContent>
                {machineHealth && selectedMachine ? (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="relative h-32 w-32">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadialBarChart
                            cx="50%"
                            cy="50%"
                            innerRadius="60%"
                            outerRadius="100%"
                            barSize={10}
                            data={[{ value: machineHealth.score, fill: 
                              machineHealth.score >= 80 ? '#22c55e' :
                              machineHealth.score >= 50 ? '#f59e0b' : '#ef4444'
                            }]}
                            startAngle={180}
                            endAngle={0}
                          >
                            <RadialBar background dataKey="value" cornerRadius={5} />
                          </RadialBarChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-bold">{machineHealth.score.toFixed(0)}</span>
                          <span className="text-xs text-muted-foreground">Health Score</span>
                        </div>
                      </div>
                      <div className="flex-1 space-y-2">
                        {machineHealth.factors.map((factor) => (
                          <div key={factor.name} className="flex items-center gap-2">
                            <span className="w-32 text-sm">{factor.name}</span>
                            <Progress value={factor.score} className="flex-1" />
                            <span className="w-12 text-right text-sm">{factor.score.toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Cập nhật lần cuối: {new Date(machineHealth.lastUpdated).toLocaleString('vi-VN')}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Settings2 className="h-12 w-12 mb-4" />
                    <p>Chọn một máy từ tab OEE để xem thông tin sức khỏe</p>
                    <p className="text-sm mt-2">
                      Hoặc tính toán health score bằng cách cung cấp các metrics
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
