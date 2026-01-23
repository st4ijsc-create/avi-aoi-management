import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, AreaChart, Area } from 'recharts';
import { ArrowLeft, Factory, TrendingUp, TrendingDown, Minus, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

interface MachineAnalyticsViewProps {
  machineId: number;
  machineName?: string;
  factoryCode?: string;
  onBack: () => void;
  startDate: Date;
  endDate: Date;
}

export function MachineAnalyticsView({
  machineId,
  machineName,
  factoryCode,
  onBack,
  startDate,
  endDate,
}: MachineAnalyticsViewProps) {
  const { data: machineStats, isLoading } = trpc.corporateFactoryStats.machineStats.useQuery({
    machineId,
    startDate,
    endDate,
  });

  const { data: machine } = trpc.machine.getById.useQuery({ id: machineId });

  // Calculate trend direction
  const trendDirection = useMemo(() => {
    if (!machineStats?.trend || machineStats.trend.length < 2) return 'stable';
    const recent = machineStats.trend.slice(-3);
    const older = machineStats.trend.slice(-6, -3);
    
    if (recent.length === 0 || older.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((sum, d) => sum + parseFloat(d.yieldRate), 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + parseFloat(d.yieldRate), 0) / older.length;
    
    if (recentAvg > olderAvg + 2) return 'up';
    if (recentAvg < olderAvg - 2) return 'down';
    return 'stable';
  }, [machineStats?.trend]);

  const getTrendIcon = () => {
    switch (trendDirection) {
      case 'up': return <TrendingUp className="h-5 w-5 text-green-500" />;
      case 'down': return <TrendingDown className="h-5 w-5 text-red-500" />;
      default: return <Minus className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getYieldColor = (rate: string) => {
    const num = parseFloat(rate);
    if (num >= 95) return 'text-green-500';
    if (num >= 85) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getResultBadge = (result: string) => {
    switch (result) {
      case 'OK':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">OK</Badge>;
      case 'NG':
        return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">NG</Badge>;
      case 'NTF':
        return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">NTF</Badge>;
      default:
        return <Badge variant="outline">{result}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Quay lại
          </Button>
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Quay lại
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Factory className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">
                {machineName || machine?.name || `Máy #${machineId}`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {factoryCode && `${factoryCode} • `}
                {machine?.code && `Mã: ${machine.code}`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {getTrendIcon()}
          <span className="text-sm text-muted-foreground">
            {trendDirection === 'up' ? 'Đang cải thiện' : 
             trendDirection === 'down' ? 'Cần chú ý' : 'Ổn định'}
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tổng kiểm tra</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{machineStats?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">sản phẩm</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tỷ lệ đạt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getYieldColor(machineStats?.yieldRate || '0')}`}>
              {machineStats?.yieldRate || '0.00'}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">yield rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              OK
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{machineStats?.okCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {machineStats?.total ? ((machineStats.okCount / machineStats.total) * 100).toFixed(1) : 0}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              NG / NTF
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-500">{machineStats?.ngCount || 0}</span>
              <span className="text-lg text-orange-500">/ {machineStats?.ntfCount || 0}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">NG / Not True Fail</p>
          </CardContent>
        </Card>
      </div>

      {/* Yield Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Xu hướng Yield Rate</CardTitle>
          <CardDescription>Tỷ lệ đạt theo ngày</CardDescription>
        </CardHeader>
        <CardContent>
          {machineStats?.trend && machineStats.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={machineStats.trend}>
                <defs>
                  <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis domain={[0, 100]} />
                <Tooltip 
                  formatter={(value: any) => [`${value}%`, 'Yield Rate']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString('vi-VN')}
                />
                <Area 
                  type="monotone" 
                  dataKey="yieldRate" 
                  stroke="#10b981" 
                  fill="url(#yieldGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Không có dữ liệu xu hướng
            </div>
          )}
        </CardContent>
      </Card>

      {/* Daily Production Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sản lượng theo ngày</CardTitle>
          <CardDescription>Phân bố OK/NG/NTF theo ngày</CardDescription>
        </CardHeader>
        <CardContent>
          {machineStats?.trend && machineStats.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={machineStats.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(label) => new Date(label).toLocaleDateString('vi-VN')}
                />
                <Legend />
                <Bar dataKey="ok" name="OK" fill="#10b981" stackId="a" />
                <Bar dataKey="ng" name="NG" fill="#ef4444" stackId="a" />
                <Bar dataKey="ntf" name="NTF" fill="#f59e0b" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              Không có dữ liệu sản lượng
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Inspections */}
      <Card>
        <CardHeader>
          <CardTitle>Kiểm tra gần đây</CardTitle>
          <CardDescription>20 kết quả kiểm tra mới nhất</CardDescription>
        </CardHeader>
        <CardContent>
          {machineStats?.recentInspections && machineStats.recentInspections.length > 0 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-4 text-sm font-medium text-muted-foreground pb-2 border-b">
                <div>Serial Number</div>
                <div>Kết quả</div>
                <div>Thời gian</div>
                <div>ID</div>
              </div>
              {machineStats.recentInspections.map((inspection) => (
                <div 
                  key={inspection.id} 
                  className="grid grid-cols-4 gap-4 text-sm py-2 border-b border-border/50 hover:bg-muted/50 rounded"
                >
                  <div className="font-mono">{inspection.serialNumber}</div>
                  <div>{getResultBadge(inspection.overallResult)}</div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(inspection.inspectionTime).toLocaleString('vi-VN')}
                  </div>
                  <div className="text-muted-foreground">#{inspection.id}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              Chưa có dữ liệu kiểm tra
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
