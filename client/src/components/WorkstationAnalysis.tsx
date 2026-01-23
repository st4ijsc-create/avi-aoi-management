import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Wrench, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon,
  Lightbulb,
  CheckCircle2,
  Target,
  Zap,
  ChevronRight,
  Crosshair,
  RefreshCw
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
  // Drill-down state
  const [selectedWorkstation, setSelectedWorkstation] = useState<{
    id: number;
    name: string;
    code: string;
  } | null>(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);

  // Fetch workstation NG data
  const { data: workstationData, isLoading } = trpc.spcAnalysis.ngByWorkstation.useQuery({
    startDate,
    endDate,
    machineId,
    factoryCode,
    limit: 20,
  });

  // Fetch measurement points for selected workstation (drill-down)
  const { data: measurementPointsData, isLoading: mpLoading } = trpc.spcAnalysis.ngByMeasurementPointForWorkstation.useQuery(
    {
      workstationId: selectedWorkstation?.id || 0,
      startDate,
      endDate,
      machineId,
      factoryCode,
      limit: 20,
    },
    {
      enabled: !!selectedWorkstation?.id && drilldownOpen,
    }
  );

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

  // Generate AI recommendations based on workstation data
  const recommendations = useMemo(() => {
    if (!workstationData || workstationData.length === 0) return [];
    
    const recs: Array<{
      id: string;
      severity: 'high' | 'medium' | 'low';
      type: 'process' | 'equipment' | 'training' | 'quality';
      title: string;
      description: string;
      workstation?: string;
      impact: string;
    }> = [];
    
    // Analyze each workstation
    workstationData.forEach((ws, index) => {
      const wsName = ws.workstation || `WS-${index + 1}`;
      
      // High NG rate (> 5%)
      if (ws.ngRate > 5) {
        recs.push({
          id: `high-ng-${index}`,
          severity: 'high',
          type: 'process',
          title: `Kiểm tra quy trình tại ${wsName}`,
          description: `Công trạm ${wsName} có tỷ lệ NG ${ws.ngRate.toFixed(2)}%, cao hơn ngưỡng cho phép 5%. Cần rà soát lại quy trình làm việc và kiểm tra thiết bị.`,
          workstation: wsName,
          impact: `Giảm ${Math.round((ws.ngRate - 2) * ws.totalCount / 100)} sản phẩm lỗi nếu đạt mục tiêu 2%`
        });
      }
      
      // Medium NG rate (2-5%)
      else if (ws.ngRate > 2) {
        recs.push({
          id: `medium-ng-${index}`,
          severity: 'medium',
          type: 'equipment',
          title: `Bảo trì thiết bị tại ${wsName}`,
          description: `Công trạm ${wsName} có tỷ lệ NG ${ws.ngRate.toFixed(2)}%. Kiểm tra và bảo trì định kỳ thiết bị để duy trì hiệu suất.`,
          workstation: wsName,
          impact: `Tiết kiệm ${Math.round(ws.ngRate * ws.totalCount / 100 * 0.3)} sản phẩm lỗi/kỳ`
        });
      }
      
      // High volume workstation
      if (ws.totalCount > totals.totalInspections / workstationData.length * 1.5) {
        recs.push({
          id: `high-volume-${index}`,
          severity: 'low',
          type: 'training',
          title: `Tăng cường đào tạo tại ${wsName}`,
          description: `Công trạm ${wsName} có khối lượng kiểm tra cao (${ws.totalCount.toLocaleString()} sản phẩm). Đảm bảo nhân viên được đào tạo đầy đủ.`,
          workstation: wsName,
          impact: `Cải thiện năng suất và chất lượng đồng đều`
        });
      }
    });
    
    // Overall recommendations
    if (totals.avgNGRate > 3) {
      recs.push({
        id: 'overall-quality',
        severity: 'high',
        type: 'quality',
        title: 'Cải thiện chất lượng toàn diện',
        description: `Tỷ lệ NG trung bình ${totals.avgNGRate.toFixed(2)}% cao hơn mục tiêu. Cần triển khai chương trình cải tiến chất lượng toàn diện.`,
        impact: `Giảm ${Math.round((totals.avgNGRate - 2) * totals.totalInspections / 100)} sản phẩm lỗi nếu đạt mục tiêu 2%`
      });
    }
    
    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return recs.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }, [workstationData, totals]);

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

      {/* AI Recommendations */}
      {recommendations.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Lightbulb className="h-5 w-5" />
              Đề xuất cải thiện từ AI
            </CardTitle>
            <CardDescription>
              Các đề xuất dựa trên phân tích dữ liệu công trạm
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recommendations.map((rec) => {
                const severityConfig = {
                  high: { bg: 'bg-red-100 dark:bg-red-950/50', border: 'border-red-300 dark:border-red-800', icon: AlertTriangle, iconColor: 'text-red-500' },
                  medium: { bg: 'bg-yellow-100 dark:bg-yellow-950/50', border: 'border-yellow-300 dark:border-yellow-800', icon: Target, iconColor: 'text-yellow-500' },
                  low: { bg: 'bg-green-100 dark:bg-green-950/50', border: 'border-green-300 dark:border-green-800', icon: CheckCircle2, iconColor: 'text-green-500' },
                }[rec.severity];
                
                const typeConfig = {
                  process: { label: 'Quy trình', color: 'bg-purple-500' },
                  equipment: { label: 'Thiết bị', color: 'bg-blue-500' },
                  training: { label: 'Đào tạo', color: 'bg-green-500' },
                  quality: { label: 'Chất lượng', color: 'bg-orange-500' },
                }[rec.type];
                
                const SeverityIcon = severityConfig.icon;
                
                return (
                  <div 
                    key={rec.id}
                    className={`p-4 rounded-lg border ${severityConfig.bg} ${severityConfig.border}`}
                  >
                    <div className="flex items-start gap-3">
                      <SeverityIcon className={`h-5 w-5 mt-0.5 ${severityConfig.iconColor}`} />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold">{rec.title}</h4>
                          <Badge variant="secondary" className={`${typeConfig.color} text-white text-xs`}>
                            {typeConfig.label}
                          </Badge>
                          <Badge variant={rec.severity === 'high' ? 'destructive' : rec.severity === 'medium' ? 'secondary' : 'outline'}>
                            {rec.severity === 'high' ? 'Cao' : rec.severity === 'medium' ? 'Trung bình' : 'Thấp'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{rec.description}</p>
                        <div className="flex items-center gap-2 text-sm">
                          <Zap className="h-4 w-4 text-yellow-500" />
                          <span className="font-medium">Tác động dự kiến:</span>
                          <span className="text-muted-foreground">{rec.impact}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Chi tiết theo công trạm</CardTitle>
          <CardDescription>
            Bảng thống kê chi tiết số lượng và tỷ lệ NG của từng công trạm. Click vào công trạm để xem chi tiết điểm đo.
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
                <TableHead className="w-[100px]">Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workstationData.map((ws, index) => (
                <TableRow 
                  key={ws.workstation || index}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    if (ws.workstationId) {
                      setSelectedWorkstation({
                        id: ws.workstationId,
                        name: ws.workstation,
                        code: ws.workstationCode || '',
                      });
                      setDrilldownOpen(true);
                    }
                  }}
                >
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
                  <TableCell>
                    {ws.workstationId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWorkstation({
                            id: ws.workstationId!,
                            name: ws.workstation,
                            code: ws.workstationCode || '',
                          });
                          setDrilldownOpen(true);
                        }}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Drill-down Dialog */}
      <Dialog open={drilldownOpen} onOpenChange={setDrilldownOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crosshair className="h-5 w-5" />
              Chi tiết điểm đo - {selectedWorkstation?.name}
            </DialogTitle>
            <DialogDescription>
              Danh sách các điểm đo thuộc công trạm {selectedWorkstation?.code || selectedWorkstation?.name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="mt-4">
            {mpLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : measurementPointsData && measurementPointsData.length > 0 ? (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-sm text-muted-foreground">Điểm đo</div>
                      <div className="text-2xl font-bold">{measurementPointsData.length}</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-sm text-muted-foreground">Tổng NG</div>
                      <div className="text-2xl font-bold text-red-500">
                        {measurementPointsData.reduce((sum, mp) => sum + mp.ngCount, 0).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-sm text-muted-foreground">Tổng kiểm tra</div>
                      <div className="text-2xl font-bold">
                        {measurementPointsData.reduce((sum, mp) => sum + mp.totalCount, 0).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Measurement Points Table */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Mã điểm đo</TableHead>
                      <TableHead>Tên điểm đo</TableHead>
                      <TableHead className="text-right">Số NG</TableHead>
                      <TableHead className="text-right">Tổng</TableHead>
                      <TableHead className="text-right">Tỷ lệ NG</TableHead>
                      <TableHead className="w-[150px]">Biểu đồ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {measurementPointsData.map((mp, index) => (
                      <TableRow key={mp.pointDefId || index}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{mp.pointCode || '-'}</Badge>
                        </TableCell>
                        <TableCell>{mp.pointName || `MP-${index + 1}`}</TableCell>
                        <TableCell className="text-right font-medium text-red-500">
                          {mp.ngCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {mp.totalCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={mp.ngRate > 5 ? "destructive" : mp.ngRate > 2 ? "secondary" : "outline"}>
                            {mp.ngRate.toFixed(2)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress 
                              value={mp.ngRate} 
                              className="h-2 flex-1"
                            />
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {mp.ngRate.toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Bar Chart for Measurement Points */}
                {measurementPointsData.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Phân bố NG theo điểm đo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart 
                            data={measurementPointsData.slice(0, 10).map((mp, i) => ({
                              name: mp.pointCode || `MP-${i + 1}`,
                              ngCount: mp.ngCount,
                              ngRate: mp.ngRate,
                            }))}
                            layout="vertical"
                          >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" />
                            <YAxis 
                              type="category" 
                              dataKey="name" 
                              width={80}
                              tick={{ fontSize: 11 }}
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
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Crosshair className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Không có dữ liệu điểm đo cho công trạm này</p>
                <p className="text-sm">Công trạm chưa được liên kết với điểm đo nào</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default WorkstationAnalysis;
