import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { 
  Wrench, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface WorkstationAnalysisProps {
  startDate: string;
  endDate: string;
  machineId?: number;
  factoryCode?: string;
}

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6366f1", "#84cc16"
];

export function WorkstationAnalysis({ startDate, endDate, machineId, factoryCode }: WorkstationAnalysisProps) {
  // Fetch workstation NG data
  const { data: workstationData, isLoading } = trpc.spcAnalysis.ngByWorkstation.useQuery({
    startDate,
    endDate,
    machineId,
    factoryCode,
    limit: 20,
  });

  // Process data for charts
  const chartData = useMemo(() => {
    if (!workstationData || workstationData.length === 0) return [];
    
    return workstationData.map((ws, index) => ({
      name: ws.workstation || `WS-${index + 1}`,
      ngCount: ws.ngCount,
      totalCount: ws.totalCount,
      ngRate: ws.ngRate,
      fill: COLORS[index % COLORS.length],
    }));
  }, [workstationData]);

  // Calculate totals
  const totals = useMemo(() => {
    if (!workstationData || workstationData.length === 0) {
      return { totalNG: 0, totalInspections: 0, avgNGRate: 0 };
    }
    
    const totalNG = workstationData.reduce((sum, ws) => sum + ws.ngCount, 0);
    const totalInspections = workstationData.reduce((sum, ws) => sum + ws.totalCount, 0);
    const avgNGRate = totalInspections > 0 ? (totalNG / totalInspections) * 100 : 0;
    
    return { totalNG, totalInspections, avgNGRate };
  }, [workstationData]);

  // Top 3 workstations with highest NG
  const topWorkstations = useMemo(() => {
    if (!workstationData || workstationData.length === 0) return [];
    return [...workstationData]
      .sort((a, b) => b.ngCount - a.ngCount)
      .slice(0, 3);
  }, [workstationData]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!workstationData || workstationData.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Không có dữ liệu công trạm</h3>
          <p className="text-muted-foreground">
            Không tìm thấy dữ liệu phân tích công trạm trong khoảng thời gian đã chọn.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Số công trạm
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{workstationData.length}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Tổng NG
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-red-500">{totals.totalNG.toLocaleString()}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Tổng kiểm tra
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.totalInspections.toLocaleString()}</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Tỷ lệ NG trung bình
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals.avgNGRate.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Workstations Alert */}
      {topWorkstations.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Top công trạm cần cải thiện
            </CardTitle>
            <CardDescription>
              Các công trạm có số lượng NG cao nhất cần được ưu tiên kiểm tra và cải thiện
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topWorkstations.map((ws, index) => (
                <div 
                  key={ws.workstation || index}
                  className="p-4 rounded-lg bg-white dark:bg-gray-900 border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{ws.workstation || `WS-${index + 1}`}</span>
                    <Badge variant={index === 0 ? "destructive" : "secondary"}>
                      #{index + 1}
                    </Badge>
                  </div>
                  <p className="text-2xl font-bold text-red-500">{ws.ngCount.toLocaleString()} NG</p>
                  <p className="text-sm text-muted-foreground">
                    Tỷ lệ: {ws.ngRate.toFixed(2)}% ({ws.totalCount.toLocaleString()} kiểm tra)
                  </p>
                  <Progress 
                    value={ws.ngRate} 
                    className="mt-2 h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Phân bố lỗi theo công trạm
            </CardTitle>
            <CardDescription>
              Số lượng NG của từng công trạm
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    width={100}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      if (name === "ngCount") return [value.toLocaleString(), "Số NG"];
                      return [value, name];
                    }}
                  />
                  <Bar 
                    dataKey="ngCount" 
                    fill="#ef4444"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Tỷ lệ NG theo công trạm
            </CardTitle>
            <CardDescription>
              Phần trăm đóng góp NG của từng công trạm
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="ngCount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={120}
                    label={({ name, percent }) => 
                      percent > 0.05 ? `${name}: ${(percent * 100).toFixed(1)}%` : ''
                    }
                    labelLine={false}
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [value.toLocaleString(), "Số NG"]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Chi tiết theo công trạm</CardTitle>
          <CardDescription>
            Bảng thống kê chi tiết số lượng và tỷ lệ NG của từng công trạm
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Công trạm</TableHead>
                <TableHead className="text-right">Số NG</TableHead>
                <TableHead className="text-right">Tổng kiểm tra</TableHead>
                <TableHead className="text-right">Tỷ lệ NG</TableHead>
                <TableHead className="w-[200px]">Biểu đồ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workstationData.map((ws, index) => (
                <TableRow key={ws.workstation || index}>
                  <TableCell className="font-medium">{index + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      {ws.workstation || `WS-${index + 1}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-500">
                    {ws.ngCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {ws.totalCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant={ws.ngRate > 5 ? "destructive" : ws.ngRate > 2 ? "secondary" : "outline"}>
                      {ws.ngRate.toFixed(2)}%
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={ws.ngRate} 
                        className="h-2 flex-1"
                      />
                      <span className="text-xs text-muted-foreground w-12 text-right">
                        {ws.ngRate.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default WorkstationAnalysis;
