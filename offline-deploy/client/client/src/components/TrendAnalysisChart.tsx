import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  BarChart3,
  LineChart,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, subDays, subWeeks, subMonths } from 'date-fns';
import { vi } from 'date-fns/locale';

interface TrendAnalysisChartProps {
  machineId?: number;
  productModelId?: number;
  className?: string;
}

export function TrendAnalysisChart({ machineId, productModelId, className }: TrendAnalysisChartProps) {
  const { t } = useTranslation();
  const [selectedMachineId, setSelectedMachineId] = useState<number | undefined>(machineId);
  const [selectedProductModelId, setSelectedProductModelId] = useState<number | undefined>(productModelId);
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  // Calculate date range
  const { dateFrom, dateTo } = useMemo(() => {
    const now = new Date();
    let from: Date;
    
    switch (dateRange) {
      case '7d':
        from = subDays(now, 7);
        break;
      case '30d':
        from = subDays(now, 30);
        break;
      case '90d':
        from = subDays(now, 90);
        break;
      case '1y':
        from = subDays(now, 365);
        break;
      default:
        from = subDays(now, 30);
    }
    
    return {
      dateFrom: format(from, 'yyyy-MM-dd'),
      dateTo: format(now, 'yyyy-MM-dd'),
    };
  }, [dateRange]);

  // Fetch trend data
  const { data: trendData, isLoading, refetch } = trpc.annotationComparison.getTrendData.useQuery({
    machineId: selectedMachineId,
    productModelId: selectedProductModelId,
    dateFrom,
    dateTo,
    groupBy,
  });

  // Fetch machines and product models for filters
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: productModels } = trpc.productModel.list.useQuery();

  // Calculate trend direction
  const trendDirection = useMemo(() => {
    if (!trendData?.trends || trendData.trends.length < 2) return 'stable';
    
    const recent = trendData.trends.slice(-3);
    const older = trendData.trends.slice(-6, -3);
    
    if (recent.length === 0 || older.length === 0) return 'stable';
    
    const recentAvg = recent.reduce((sum, t) => sum + parseFloat(t.defectRate), 0) / recent.length;
    const olderAvg = older.reduce((sum, t) => sum + parseFloat(t.defectRate), 0) / older.length;
    
    const diff = recentAvg - olderAvg;
    
    if (diff > 1) return 'up';
    if (diff < -1) return 'down';
    return 'stable';
  }, [trendData]);

  // Find max value for chart scaling
  const maxValue = useMemo(() => {
    if (!trendData?.trends) return 100;
    return Math.max(...trendData.trends.map(t => t.totalInspections), 100);
  }, [trendData]);

  // Detect patterns in trend data
  const patterns = useMemo(() => {
    if (!trendData?.trends || trendData.trends.length < 5) return [];
    
    const detected: Array<{ type: string; description: string; severity: 'warning' | 'critical' | 'info' }> = [];
    
    // Check for increasing defect rate
    const recentDefectRates = trendData.trends.slice(-5).map(t => parseFloat(t.defectRate));
    const isIncreasing = recentDefectRates.every((rate, i) => 
      i === 0 || rate >= recentDefectRates[i - 1]
    );
    
    if (isIncreasing && recentDefectRates[recentDefectRates.length - 1] > 5) {
      detected.push({
        type: 'Increasing Defect Rate',
        description: t('dashboard.defectRateIncreasing'),
        severity: 'warning',
      });
    }
    
    // Check for high defect rate
    const avgDefectRate = trendData.summary.avgDefectRate;
    if (avgDefectRate > 10) {
      detected.push({
        type: 'High Defect Rate',
        description: t('dashboard.highDefectRate', { rate: avgDefectRate.toFixed(1) }),
        severity: 'critical',
      });
    }
    
    // Check for sudden spike
    const defectRates = trendData.trends.map(t => parseFloat(t.defectRate));
    const avgRate = defectRates.reduce((a, b) => a + b, 0) / defectRates.length;
    const hasSpike = defectRates.some(rate => rate > avgRate * 2);
    
    if (hasSpike) {
      detected.push({
        type: 'Defect Spike Detected',
        description: t('dashboard.defectSpikeDetected'),
        severity: 'warning',
      });
    }
    
    return detected;
  }, [trendData]);

  const TrendIcon = trendDirection === 'up' ? TrendingUp : trendDirection === 'down' ? TrendingDown : Minus;
  const trendColor = trendDirection === 'up' ? 'text-red-500' : trendDirection === 'down' ? 'text-green-500' : 'text-muted-foreground';

  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('dashboard.defectTrendAnalysis')}
            </CardTitle>
            <CardDescription>
              {t('dashboard.defectTrendDescription')}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="space-y-2">
            <Label>{t('machines.machine')}</Label>
            <Select
              value={selectedMachineId?.toString() || 'all'}
              onValueChange={(v) => setSelectedMachineId(v === 'all' ? undefined : parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('machines.allMachines')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('machines.allMachines')}</SelectItem>
                {machines?.map((machine) => (
                  <SelectItem key={machine.id} value={machine.id.toString()}>
                    {machine.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('products.product')}</Label>
            <Select
              value={selectedProductModelId?.toString() || 'all'}
              onValueChange={(v) => setSelectedProductModelId(v === 'all' ? undefined : parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('products.allProducts')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('products.allProducts')}</SelectItem>
                {productModels?.map((model) => (
                  <SelectItem key={model.id} value={model.id.toString()}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('dashboard.groupBy')}</Label>
            <Select value={groupBy} onValueChange={(v: 'day' | 'week' | 'month') => setGroupBy(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">{t('common.day')}</SelectItem>
                <SelectItem value="week">{t('common.week')}</SelectItem>
                <SelectItem value="month">{t('common.month')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('dashboard.timeRange')}</Label>
            <Select value={dateRange} onValueChange={(v: '7d' | '30d' | '90d' | '1y') => setDateRange(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">7 {t('common.days')}</SelectItem>
                <SelectItem value="30d">30 {t('common.days')}</SelectItem>
                <SelectItem value="90d">90 {t('common.days')}</SelectItem>
                <SelectItem value="1y">1 {t('common.year')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{t('dashboard.chartType')}</Label>
            <Select value={chartType} onValueChange={(v: 'bar' | 'line') => setChartType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bar">{t('dashboard.barChart')}</SelectItem>
                <SelectItem value="line">{t('dashboard.lineChart')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Stats */}
        {trendData && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{trendData.summary.totalInspections.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">{t('dashboard.totalInspections')}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-red-500">{trendData.summary.totalDefects.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">{t('dashboard.totalNG')}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold">{trendData.summary.avgDefectRate.toFixed(2)}%</div>
                <div className="text-sm text-muted-foreground">{t('dashboard.avgNGRate')}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className={cn("text-2xl font-bold flex items-center gap-2", trendColor)}>
                  <TrendIcon className="h-5 w-5" />
                  {trendDirection === 'up' ? t('dashboard.increasing') : trendDirection === 'down' ? t('dashboard.decreasing') : t('dashboard.stable')}
                </div>
                <div className="text-sm text-muted-foreground">{t('dashboard.trend')}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Pattern Alerts */}
        {patterns.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              {t('dashboard.alertsDetected')}
            </h4>
            <div className="space-y-2">
              {patterns.map((pattern, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "p-3 rounded-lg border",
                    pattern.severity === 'critical' && "bg-red-500/10 border-red-500/30",
                    pattern.severity === 'warning' && "bg-yellow-500/10 border-yellow-500/30",
                    pattern.severity === 'info' && "bg-blue-500/10 border-blue-500/30"
                  )}
                >
                  <div className="font-medium">{pattern.type}</div>
                  <div className="text-sm text-muted-foreground">{pattern.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : trendData?.trends && trendData.trends.length > 0 ? (
          <div className="space-y-4">
            <div className="h-[300px] relative">
              {/* Y-axis labels */}
              <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-xs text-muted-foreground">
                <span>{maxValue}</span>
                <span>{Math.round(maxValue * 0.75)}</span>
                <span>{Math.round(maxValue * 0.5)}</span>
                <span>{Math.round(maxValue * 0.25)}</span>
                <span>0</span>
              </div>
              
              {/* Chart area */}
              <div className="ml-14 h-full flex items-end gap-1 overflow-x-auto pb-8">
                {trendData.trends.map((item, idx) => {
                  const okHeight = (item.okCount / maxValue) * 100;
                  const ngHeight = (item.ngCount / maxValue) * 100;
                  const ntfHeight = (item.ntfCount / maxValue) * 100;
                  
                  return (
                    <div key={idx} className="flex-1 min-w-[30px] max-w-[60px] flex flex-col items-center group">
                      {chartType === 'bar' ? (
                        <div className="w-full flex flex-col-reverse h-[260px]">
                          <div
                            className="bg-green-500 rounded-t transition-all hover:bg-green-400"
                            style={{ height: `${okHeight}%` }}
                            title={`OK: ${item.okCount}`}
                          />
                          <div
                            className="bg-orange-500 transition-all hover:bg-orange-400"
                            style={{ height: `${ntfHeight}%` }}
                            title={`NTF: ${item.ntfCount}`}
                          />
                          <div
                            className="bg-red-500 rounded-t transition-all hover:bg-red-400"
                            style={{ height: `${ngHeight}%` }}
                            title={`NG: ${item.ngCount}`}
                          />
                        </div>
                      ) : (
                        <div className="w-full h-[260px] relative">
                          <div
                            className="absolute bottom-0 left-1/2 w-2 h-2 rounded-full bg-red-500 transform -translate-x-1/2"
                            style={{ bottom: `${(parseFloat(item.defectRate) / 100) * 260}px` }}
                          />
                          {idx > 0 && (
                            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
                              <line
                                x1="0"
                                y1={260 - (parseFloat(trendData.trends[idx - 1].defectRate) / 100) * 260}
                                x2="100%"
                                y2={260 - (parseFloat(item.defectRate) / 100) * 260}
                                stroke="rgb(239 68 68)"
                                strokeWidth="2"
                              />
                            </svg>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-2 transform -rotate-45 origin-top-left whitespace-nowrap">
                        {item.period}
                      </div>
                      
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:block bg-popover border rounded-lg p-2 shadow-lg z-10 text-sm min-w-[150px]">
                        <div className="font-medium mb-1">{item.period}</div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          <span>OK: {item.okCount}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <XCircle className="h-3 w-3 text-red-500" />
                          <span>NG: {item.ngCount}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-orange-500" />
                          <span>NTF: {item.ntfCount}</span>
                        </div>
                        <div className="mt-1 pt-1 border-t">
                          <span>{t('dashboard.ngRate')}: {item.defectRate}%</span>
                        </div>
                        <div>
                          <span>Yield: {item.yieldRate}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-500" />
                <span>OK</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-orange-500" />
                <span>NTF</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-red-500" />
                <span>NG</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>{t('dashboard.noDataInRange')}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TrendAnalysisChart;
