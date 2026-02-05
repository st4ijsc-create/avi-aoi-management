import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  Info,
  Calendar,
  Target,
  BarChart3,
  Brain,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { vi } from 'date-fns/locale';

export function DefectTrendPrediction() {
  const [machineId, setMachineId] = useState<number | undefined>();
  const [productModelId, setProductModelId] = useState<number | undefined>();
  const [days, setDays] = useState(30);
  const [predictionDays, setPredictionDays] = useState(7);

  // Fetch prediction data
  const { data, isLoading, refetch } = trpc.annotation.trendPrediction.useQuery({
    machineId,
    productModelId,
    days,
    predictionDays,
  });

  // Fetch machines for filter
  const { data: machines } = trpc.machine.list.useQuery();
  
  // Fetch product models for filter
  const { data: productModels } = trpc.productModel.list.useQuery();

  // Combine historical and prediction data for chart
  const chartData = useMemo(() => {
    if (!data) return [];
    
    const combined = [
      ...data.historical.map(h => ({
        date: h.date,
        actual: h.actual,
        predicted: null as number | null,
        lower: null as number | null,
        upper: null as number | null,
        isPrediction: false,
      })),
      ...data.predictions.map(p => ({
        date: p.date,
        actual: null as number | null,
        predicted: p.predicted,
        lower: p.lower,
        upper: p.upper,
        isPrediction: true,
      })),
    ];
    
    return combined;
  }, [data]);

  const getTrendIcon = () => {
    if (!data) return <Minus className="h-5 w-5" />;
    switch (data.statistics.trendDirection) {
      case 'increasing':
        return <TrendingUp className="h-5 w-5 text-red-500" />;
      case 'decreasing':
        return <TrendingDown className="h-5 w-5 text-green-500" />;
      default:
        return <Minus className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getTrendColor = () => {
    if (!data) return 'text-muted-foreground';
    switch (data.statistics.trendDirection) {
      case 'increasing':
        return 'text-red-500';
      case 'decreasing':
        return 'text-green-500';
      default:
        return 'text-yellow-500';
    }
  };

  const getConfidenceBadge = () => {
    if (!data) return null;
    const colors: Record<string, string> = {
      high: 'bg-green-500/10 text-green-500',
      medium: 'bg-yellow-500/10 text-yellow-500',
      low: 'bg-red-500/10 text-red-500',
    };
    return (
      <Badge variant="outline" className={cn('ml-2', colors[data.statistics.confidence])}>
        Độ tin cậy: {data.statistics.confidence === 'high' ? 'Cao' : data.statistics.confidence === 'medium' ? 'Trung bình' : 'Thấp'}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Dự đoán xu hướng Defects
          </CardTitle>
          <CardDescription>
            Phân tích dữ liệu lịch sử và dự đoán xu hướng defects trong tương lai
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label>Máy</Label>
              <Select
                value={machineId?.toString() || 'all'}
                onValueChange={(v) => setMachineId(v && v !== 'all' ? parseInt(v) : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tất cả máy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  {machines?.map((m: any) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model sản phẩm</Label>
              <Select
                value={productModelId?.toString() || 'all'}
                onValueChange={(v) => setProductModelId(v && v !== 'all' ? parseInt(v) : undefined)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Tất cả model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  {productModels?.map((pm: any) => (
                    <SelectItem key={pm.id} value={pm.id.toString()}>
                      {pm.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Dữ liệu lịch sử (ngày)</Label>
              <Input
                type="number"
                min={7}
                max={365}
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value) || 30)}
              />
            </div>

            <div className="space-y-2">
              <Label>Dự đoán (ngày)</Label>
              <Input
                type="number"
                min={1}
                max={30}
                value={predictionDays}
                onChange={(e) => setPredictionDays(parseInt(e.target.value) || 7)}
              />
            </div>

            <div className="space-y-2">
              <Label>&nbsp;</Label>
              <Button onClick={() => refetch()} className="w-full gap-2">
                <RefreshCw className="h-4 w-4" />
                Phân tích
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Tổng defects</p>
                {isLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <p className="text-2xl font-bold">
                    {data?.statistics.totalDefects || 0}
                  </p>
                )}
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Trung bình/ngày</p>
                <div className="text-2xl font-bold">
                  {isLoading ? <Skeleton className="h-8 w-16" /> : data?.statistics.avgDaily || 0}
                </div>
              </div>
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Xu hướng</p>
                <div className="flex items-center gap-2">
                  <div className={cn('text-2xl font-bold capitalize', getTrendColor())}>
                    {isLoading ? (
                      <Skeleton className="h-8 w-20" />
                    ) : data?.statistics.trendDirection === 'increasing' ? (
                      'Tăng'
                    ) : data?.statistics.trendDirection === 'decreasing' ? (
                      'Giảm'
                    ) : (
                      'Ổn định'
                    )}
                  </div>
                  {!isLoading && getTrendIcon()}
                </div>
              </div>
              <Target className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Độ dốc (slope)</p>
                <div className="text-2xl font-bold">
                  {isLoading ? <Skeleton className="h-8 w-16" /> : data?.statistics.slope || 0}
                </div>
              </div>
              {getConfidenceBadge()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Biểu đồ xu hướng và dự đoán
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="w-full h-[400px]" />
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
              <Info className="h-12 w-12 mb-4" />
              <p>Không có dữ liệu để hiển thị</p>
              <p className="text-sm">Thử thay đổi bộ lọc hoặc tăng số ngày lịch sử</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => format(parseISO(value), 'dd/MM', { locale: vi })}
                  className="text-xs"
                />
                <YAxis className="text-xs" />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-lg p-3 shadow-lg">
                        <p className="font-medium mb-2">
                          {format(parseISO(label), 'dd/MM/yyyy', { locale: vi })}
                        </p>
                        {data.actual !== null && (
                          <p className="text-sm text-blue-500">
                            Thực tế: {data.actual} defects
                          </p>
                        )}
                        {data.predicted !== null && (
                          <>
                            <p className="text-sm text-orange-500">
                              Dự đoán: {data.predicted} defects
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Khoảng tin cậy: {data.lower} - {data.upper}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend />
                
                {/* Confidence interval area */}
                <Area
                  type="monotone"
                  dataKey="upper"
                  stroke="none"
                  fill="hsl(var(--warning))"
                  fillOpacity={0.1}
                  name="Khoảng tin cậy (trên)"
                />
                <Area
                  type="monotone"
                  dataKey="lower"
                  stroke="none"
                  fill="hsl(var(--background))"
                  fillOpacity={1}
                  name="Khoảng tin cậy (dưới)"
                />
                
                {/* Historical line */}
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ fill: 'hsl(var(--primary))' }}
                  name="Thực tế"
                  connectNulls={false}
                />
                
                {/* Prediction line */}
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="hsl(var(--warning))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ fill: 'hsl(var(--warning))' }}
                  name="Dự đoán"
                  connectNulls={false}
                />
                
                {/* Average reference line */}
                {data && (
                  <ReferenceLine
                    y={data.statistics.avgDaily}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="3 3"
                    label={{
                      value: `Trung bình: ${data.statistics.avgDaily}`,
                      position: 'right',
                      className: 'text-xs fill-muted-foreground',
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* AI Insights */}
      {data && data.insights && data.insights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              Phân tích AI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.insights.map((insight, idx) => (
              <Alert key={idx} variant={idx === 0 && data.statistics.trendDirection === 'increasing' ? 'destructive' : 'default'}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Insight #{idx + 1}</AlertTitle>
                <AlertDescription>{insight}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Prediction Table */}
      {data && data.predictions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Chi tiết dự đoán</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-4">Ngày</th>
                    <th className="text-right py-2 px-4">Dự đoán</th>
                    <th className="text-right py-2 px-4">Khoảng tin cậy</th>
                    <th className="text-right py-2 px-4">So với trung bình</th>
                  </tr>
                </thead>
                <tbody>
                  {data.predictions.map((p) => {
                    const diff = p.predicted - data.statistics.avgDaily;
                    const diffPercent = data.statistics.avgDaily > 0 
                      ? Math.round((diff / data.statistics.avgDaily) * 100) 
                      : 0;
                    return (
                      <tr key={p.date} className="border-b">
                        <td className="py-2 px-4">
                          {format(parseISO(p.date), 'EEEE, dd/MM/yyyy', { locale: vi })}
                        </td>
                        <td className="text-right py-2 px-4 font-medium">
                          {p.predicted}
                        </td>
                        <td className="text-right py-2 px-4 text-muted-foreground">
                          {p.lower} - {p.upper}
                        </td>
                        <td className={cn(
                          'text-right py-2 px-4',
                          diff > 0 ? 'text-red-500' : diff < 0 ? 'text-green-500' : 'text-muted-foreground'
                        )}>
                          {diff > 0 ? '+' : ''}{diff} ({diffPercent > 0 ? '+' : ''}{diffPercent}%)
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DefectTrendPrediction;
