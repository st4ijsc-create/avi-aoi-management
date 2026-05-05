import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/lib/trpc';
import { 
  ArrowUp, 
  ArrowDown, 
  Minus, 
  TrendingUp, 
  TrendingDown,
  Calendar,
  BarChart3,
  RefreshCw,
  Download,
  FileText
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { subDays, subWeeks, subMonths, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { toast } from 'sonner';
import { exportComparisonPDF } from '@/lib/pdfExport';

type ComparePreset = 'week' | 'month' | 'quarter' | 'custom';

interface ComparisonStats {
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  yieldRate: number;
}

const COLORS = ['#22c55e', '#ef4444', '#f59e0b'];

export default function HistoryComparison() {
  const { t } = useTranslation();
  const [comparePreset, setComparePreset] = useState<ComparePreset>('week');
  const [period1Start, setPeriod1Start] = useState('');
  const [period1End, setPeriod1End] = useState('');
  const [period2Start, setPeriod2Start] = useState('');
  const [period2End, setPeriod2End] = useState('');

  // Calculate date ranges based on preset
  const dateRanges = useMemo(() => {
    const now = new Date();
    
    if (comparePreset === 'custom') {
      return {
        period1: {
          start: period1Start ? new Date(period1Start) : subWeeks(now, 1),
          end: period1End ? endOfDay(new Date(period1End)) : now,
          label: period1Start && period1End ? `${format(new Date(period1Start), 'dd/MM', { locale: vi })} - ${format(new Date(period1End), 'dd/MM', { locale: vi })}` : t('history.comparison.period1')
        },
        period2: {
          start: period2Start ? new Date(period2Start) : subWeeks(now, 2),
          end: period2End ? endOfDay(new Date(period2End)) : subWeeks(now, 1),
          label: period2Start && period2End ? `${format(new Date(period2Start), 'dd/MM', { locale: vi })} - ${format(new Date(period2End), 'dd/MM', { locale: vi })}` : t('history.comparison.period2')
        }
      };
    }

    switch (comparePreset) {
      case 'week':
        return {
          period1: {
            start: startOfWeek(now, { weekStartsOn: 1 }),
            end: endOfDay(now),
            label: t('history.comparison.thisWeek')
          },
          period2: {
            start: startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }),
            end: endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }),
            label: t('history.comparison.lastWeek')
          }
        };
      case 'month':
        return {
          period1: {
            start: startOfMonth(now),
            end: endOfDay(now),
            label: t('history.comparison.thisMonth')
          },
          period2: {
            start: startOfMonth(subMonths(now, 1)),
            end: endOfMonth(subMonths(now, 1)),
            label: t('history.comparison.lastMonth')
          }
        };
      case 'quarter':
        return {
          period1: {
            start: subDays(now, 90),
            end: endOfDay(now),
            label: t('history.comparison.last90Days')
          },
          period2: {
            start: subDays(now, 180),
            end: subDays(now, 91),
            label: t('history.comparison.previous90Days')
          }
        };
      default:
        return {
          period1: { start: subWeeks(now, 1), end: now, label: t('history.comparison.thisWeek') },
          period2: { start: subWeeks(now, 2), end: subWeeks(now, 1), label: t('history.comparison.lastWeek') }
        };
    }
  }, [comparePreset, period1Start, period1End, period2Start, period2End]);

  // Fetch data for period 1
  const { data: period1Data, isLoading: loading1 } = trpc.inspection.search.useQuery({
    startDate: dateRanges.period1.start,
    endDate: dateRanges.period1.end,
    limit: 1000,
    offset: 0,
  });

  // Fetch data for period 2
  const { data: period2Data, isLoading: loading2 } = trpc.inspection.search.useQuery({
    startDate: dateRanges.period2.start,
    endDate: dateRanges.period2.end,
    limit: 1000,
    offset: 0,
  });

  // Calculate stats for each period
  const stats1: ComparisonStats = useMemo(() => {
    if (!period1Data?.data) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };
    const inspections = period1Data.data;
    const total = inspections.length;
    const ok = inspections.filter((i: { overallResult: string }) => i.overallResult === 'OK').length;
    const ng = inspections.filter((i: { overallResult: string }) => i.overallResult === 'NG').length;
    const ntf = inspections.filter((i: { overallResult: string }) => i.overallResult === 'NTF').length;
    const yieldRate = total > 0 ? ((ok + ntf) / total * 100) : 0;
    return { total, ok, ng, ntf, yieldRate };
  }, [period1Data]);

  const stats2: ComparisonStats = useMemo(() => {
    if (!period2Data?.data) return { total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 };
    const inspections = period2Data.data;
    const total = inspections.length;
    const ok = inspections.filter((i: { overallResult: string }) => i.overallResult === 'OK').length;
    const ng = inspections.filter((i: { overallResult: string }) => i.overallResult === 'NG').length;
    const ntf = inspections.filter((i: { overallResult: string }) => i.overallResult === 'NTF').length;
    const yieldRate = total > 0 ? ((ok + ntf) / total * 100) : 0;
    return { total, ok, ng, ntf, yieldRate };
  }, [period2Data]);

  // Calculate changes
  const changes = useMemo(() => {
    const calcChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100);
    };

    return {
      total: calcChange(stats1.total, stats2.total),
      ok: calcChange(stats1.ok, stats2.ok),
      ng: calcChange(stats1.ng, stats2.ng),
      ntf: calcChange(stats1.ntf, stats2.ntf),
      yieldRate: stats1.yieldRate - stats2.yieldRate,
    };
  }, [stats1, stats2]);

  // Chart data
  const barChartData = [
    { name: t('common.total'), period1: stats1.total, period2: stats2.total },
    { name: 'OK', period1: stats1.ok, period2: stats2.ok },
    { name: 'NG', period1: stats1.ng, period2: stats2.ng },
    { name: 'NTF', period1: stats1.ntf, period2: stats2.ntf },
  ];

  const yieldChartData = [
    { name: dateRanges.period2.label, yield: stats2.yieldRate },
    { name: dateRanges.period1.label, yield: stats1.yieldRate },
  ];

  const pieData1 = [
    { name: 'OK', value: stats1.ok },
    { name: 'NG', value: stats1.ng },
    { name: 'NTF', value: stats1.ntf },
  ];

  const pieData2 = [
    { name: 'OK', value: stats2.ok },
    { name: 'NG', value: stats2.ng },
    { name: 'NTF', value: stats2.ntf },
  ];

  const isLoading = loading1 || loading2;

  const ChangeIndicator = ({ value, inverse = false }: { value: number; inverse?: boolean }) => {
    const isPositive = inverse ? value < 0 : value > 0;
    const isNegative = inverse ? value > 0 : value < 0;
    
    if (Math.abs(value) < 0.01) {
      return <span className="text-muted-foreground flex items-center gap-1"><Minus className="h-4 w-4" /> 0%</span>;
    }
    
    return (
      <span className={`flex items-center gap-1 ${isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-muted-foreground'}`}>
        {value > 0 ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
        {Math.abs(value).toFixed(1)}%
      </span>
    );
  };

  const handleExportPDF = async () => {
    toast.info(t('history.comparison.generatingPdf'));
    try {
      await exportComparisonPDF(
        stats1,
        stats2,
        dateRanges.period1.label,
        dateRanges.period2.label,
        ['comparison-bar-chart', 'comparison-yield-chart', 'comparison-pie-1', 'comparison-pie-2']
      );
      toast.success(t('history.comparison.pdfSuccess'));
    } catch (error) {
      toast.error(t('history.comparison.pdfError'));
      console.error(error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Period Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t('history.comparison.selectPeriod')}
          </CardTitle>
          <CardDescription>
            {t('history.comparison.compareQuality')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>{t('history.comparison.compareType')}</Label>
              <Select value={comparePreset} onValueChange={(v) => setComparePreset(v as ComparePreset)}>
                <SelectTrigger className="w-50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">{t('history.comparison.weekVsWeek')}</SelectItem>
                  <SelectItem value="month">{t('history.comparison.monthVsMonth')}</SelectItem>
                  <SelectItem value="quarter">{t('history.comparison.quarterVsQuarter')}</SelectItem>
                  <SelectItem value="custom">{t('history.comparison.custom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {comparePreset === 'custom' && (
              <>
                <div className="space-y-2">
                  <Label>{t('history.comparison.period1Current')}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={period1Start}
                      onChange={(e) => setPeriod1Start(e.target.value)}
                      className="w-35"
                    />
                    <span className="self-center">-</span>
                    <Input
                      type="date"
                      value={period1End}
                      onChange={(e) => setPeriod1End(e.target.value)}
                      className="w-35"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('history.comparison.period2Compare')}</Label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={period2Start}
                      onChange={(e) => setPeriod2Start(e.target.value)}
                      className="w-35"
                    />
                    <span className="self-center">-</span>
                    <Input
                      type="date"
                      value={period2End}
                      onChange={(e) => setPeriod2End(e.target.value)}
                      className="w-35"
                    />
                  </div>
                </div>
              </>
            )}

            <Button variant="outline" onClick={handleExportPDF}>
              <FileText className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
          </div>

          <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Badge variant="default">{dateRanges.period1.label}</Badge>
              {format(dateRanges.period1.start, 'dd/MM/yyyy', { locale: vi })} - {format(dateRanges.period1.end, 'dd/MM/yyyy', { locale: vi })}
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="secondary">{dateRanges.period2.label}</Badge>
              {format(dateRanges.period2.start, 'dd/MM/yyyy', { locale: vi })} - {format(dateRanges.period2.end, 'dd/MM/yyyy', { locale: vi })}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('history.comparison.totalProducts')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats1.total.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">vs {stats2.total.toLocaleString()}</div>
            <ChangeIndicator value={changes.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('history.comparison.okProducts')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{stats1.ok.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">vs {stats2.ok.toLocaleString()}</div>
            <ChangeIndicator value={changes.ok} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('history.comparison.ngProducts')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{stats1.ng.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">vs {stats2.ng.toLocaleString()}</div>
            <ChangeIndicator value={changes.ng} inverse />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t('history.comparison.ntfProducts')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{stats1.ntf.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">vs {stats2.ntf.toLocaleString()}</div>
            <ChangeIndicator value={changes.ntf} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Yield Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats1.yieldRate.toFixed(2)}%</div>
            <div className="text-sm text-muted-foreground">vs {stats2.yieldRate.toFixed(2)}%</div>
            <ChangeIndicator value={changes.yieldRate} />
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart Comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('history.comparison.quantityComparison')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div id="comparison-bar-chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="period1" name={dateRanges.period1.label} fill="#3b82f6" />
                <Bar dataKey="period2" name={dateRanges.period2.label} fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Yield Rate Comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t('history.comparison.yieldComparison')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div id="comparison-yield-chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={yieldChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis type="category" dataKey="name" width={100} />
                <Tooltip formatter={(value: number) => `${value.toFixed(2)}%`} />
                <Bar dataKey="yield" name="Yield Rate" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie Chart Period 1 */}
        <Card>
          <CardHeader>
            <CardTitle>{dateRanges.period1.label} - {t('history.comparison.resultDistribution')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div id="comparison-pie-1">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData1}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData1.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Pie Chart Period 2 */}
        <Card>
          <CardHeader>
            <CardTitle>{dateRanges.period2.label} - {t('history.comparison.resultDistribution')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div id="comparison-pie-2">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData2}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData2.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>{t('history.comparison.summaryAnalysis')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {changes.yieldRate > 0 && (
              <div className="flex items-center gap-2 text-green-500">
                <TrendingUp className="h-5 w-5" />
                <span>{t('history.comparison.yieldIncreased', { value: changes.yieldRate.toFixed(2) })}</span>
              </div>
            )}
            {changes.yieldRate < 0 && (
              <div className="flex items-center gap-2 text-red-500">
                <TrendingDown className="h-5 w-5" />
                <span>{t('history.comparison.yieldDecreased', { value: Math.abs(changes.yieldRate).toFixed(2) })}</span>
              </div>
            )}
            {changes.ng < 0 && (
              <div className="flex items-center gap-2 text-green-500">
                <TrendingDown className="h-5 w-5" />
                <span>{t('history.comparison.ngDecreased', { value: Math.abs(changes.ng).toFixed(1) })}</span>
              </div>
            )}
            {changes.ng > 0 && (
              <div className="flex items-center gap-2 text-red-500">
                <TrendingUp className="h-5 w-5" />
                <span>{t('history.comparison.ngIncreased', { value: changes.ng.toFixed(1) })}</span>
              </div>
            )}
            {changes.total > 10 && (
              <div className="flex items-center gap-2 text-blue-500">
                <TrendingUp className="h-5 w-5" />
                <span>{t('history.comparison.outputIncreased', { value: changes.total.toFixed(1) })}</span>
              </div>
            )}
            {changes.total < -10 && (
              <div className="flex items-center gap-2 text-orange-500">
                <TrendingDown className="h-5 w-5" />
                <span>{t('history.comparison.outputDecreased', { value: Math.abs(changes.total).toFixed(1) })}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
