import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeader,
  MetricCard,
  EmptyState,
  chartColor,
  chartTooltipStyle,
  chartGridProps,
  chartAxisTick,
} from "@/components/patterns";
import { PieChart, BarChart3, TrendingUp, Package, RefreshCw, Download, Calendar } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { vi } from "date-fns/locale";
import {
  ResponsiveContainer,
  PieChart as RechartsPie,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";

export default function CategoryAnalytics() {
  const { t } = useTranslation();
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'quarter'>('week');
  const [selectedFactory, setSelectedFactory] = useState<string>('all');
  
  // Calculate date range
  const dateRange = useMemo(() => {
    const end = endOfDay(new Date());
    let start: Date;
    switch (timeRange) {
      case 'today':
        start = startOfDay(new Date());
        break;
      case 'week':
        start = startOfDay(subDays(new Date(), 7));
        break;
      case 'month':
        start = startOfDay(subDays(new Date(), 30));
        break;
      case 'quarter':
        start = startOfDay(subDays(new Date(), 90));
        break;
    }
    return { start, end };
  }, [timeRange]);

  // Fetch data
  const { data: categories, isLoading: loadingCategories } = trpc.productCategory.list.useQuery({});
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: inspectionsData, isLoading: loadingInspections, refetch } = trpc.inspection.list.useQuery({
    startDate: dateRange.start,
    endDate: dateRange.end,
    limit: 1000,
  });
  const inspections = inspectionsData?.data || [];
  const { data: productModels } = trpc.productModel.list.useQuery({ limit: 100 });

  // Process data for charts
  const analyticsData = useMemo(() => {
    if (!inspections || inspections.length === 0 || !categories || !productModels) return null;

    // Create product to category mapping
    const productCategoryMap = new Map<number, number>();
    productModels.forEach(pm => {
      if (pm.categoryId) {
        productCategoryMap.set(pm.id, pm.categoryId);
      }
    });

    // Aggregate by category
    const categoryStats = new Map<number, { total: number; ok: number; ng: number; ntf: number }>();
    
    inspections.forEach((insp: any) => {
      const categoryId = productCategoryMap.get(insp.productModelId || 0);
      if (!categoryId) return;

      if (!categoryStats.has(categoryId)) {
        categoryStats.set(categoryId, { total: 0, ok: 0, ng: 0, ntf: 0 });
      }
      const stats = categoryStats.get(categoryId)!;
      stats.total++;
      if (insp.result === 'OK') stats.ok++;
      else if (insp.result === 'NG') stats.ng++;
      else if (insp.result === 'NTF') stats.ntf++;
    });

    // Convert to chart data
    const categoryData = categories.map(cat => {
      const stats = categoryStats.get(cat.id) || { total: 0, ok: 0, ng: 0, ntf: 0 };
      const yieldRate = stats.total > 0 ? ((stats.ok + stats.ntf) / stats.total * 100) : 0;
      return {
        id: cat.id,
        name: cat.name,
        code: cat.code,
        color: cat.color || 'var(--chart-1)',
        total: stats.total,
        ok: stats.ok,
        ng: stats.ng,
        ntf: stats.ntf,
        yieldRate: Math.round(yieldRate * 100) / 100,
      };
    }).filter(d => d.total > 0);

    // Pie chart data for production distribution
    const productionPieData = categoryData.map(d => ({
      name: d.name,
      value: d.total,
      color: d.color,
    }));

    // Pie chart data for yield comparison
    const yieldPieData = categoryData.map(d => ({
      name: d.name,
      value: d.yieldRate,
      color: d.color,
    }));

    // Bar chart data
    const barChartData = categoryData.map(d => ({
      name: d.code,
      fullName: d.name,
      OK: d.ok,
      NG: d.ng,
      NTF: d.ntf,
      'Yield (%)': d.yieldRate,
    }));

    // Calculate totals
    const totals = categoryData.reduce((acc, d) => ({
      total: acc.total + d.total,
      ok: acc.ok + d.ok,
      ng: acc.ng + d.ng,
      ntf: acc.ntf + d.ntf,
    }), { total: 0, ok: 0, ng: 0, ntf: 0 });

    const overallYield = totals.total > 0 ? ((totals.ok + totals.ntf) / totals.total * 100) : 0;

    return {
      categoryData,
      productionPieData,
      yieldPieData,
      barChartData,
      totals: {
        ...totals,
        yieldRate: Math.round(overallYield * 100) / 100,
      },
    };
  }, [inspections, categories, productModels]);

  const isLoading = loadingCategories || loadingInspections;

  // Export to CSV
  const handleExport = () => {
    if (!analyticsData) return;

    const headers = ['Category Code', 'Category Name', 'Total', 'OK', 'NG', 'NTF', 'Yield Rate (%)'];
    const rows = analyticsData.categoryData.map(d => [
      d.code,
      d.name,
      d.total,
      d.ok,
      d.ng,
      d.ntf,
      d.yieldRate,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `category-analytics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout title={t('dashboard.aviAoiManagement')} currentPath="/category-analytics">
      <div className="p-6 space-y-6">
        {/* Header */}
        <PageHeader
          icon={<PieChart className="h-6 w-6 text-primary" />}
          title={t('reports.categoryAnalytics')}
          description={t('reports.categoryAnalyticsDesc')}
          actions={
            <>
              {/* Time Range */}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Select value={timeRange} onValueChange={(v: any) => setTimeRange(v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">{t('common.today')}</SelectItem>
                    <SelectItem value="week">{t('common.sevenDays')}</SelectItem>
                    <SelectItem value="month">{t('common.thirtyDays')}</SelectItem>
                    <SelectItem value="quarter">{t('common.ninetyDays')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Factory Filter */}
              <Select value={selectedFactory} onValueChange={setSelectedFactory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('common.allFactories')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.allFactories')}</SelectItem>
                  {factories?.map(f => (
                    <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button variant="outline" size="icon" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>

              <Button variant="outline" onClick={handleExport} disabled={!analyticsData}>
                <Download className="h-4 w-4 mr-2" />
                {t('common.exportCSV')}
              </Button>
            </>
          }
        />

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Skeleton className="h-[380px] w-full" />
              <Skeleton className="h-[380px] w-full" />
            </div>
            <Skeleton className="h-[480px] w-full" />
          </div>
        ) : !analyticsData || analyticsData.categoryData.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <EmptyState
                icon={Package}
                title={t('reports.noDataInTimeRange')}
                description={t('reports.ensureCategoryAssigned')}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <MetricCard
                label={t('dashboard.totalProduction')}
                value={analyticsData.totals.total.toLocaleString()}
              />
              <MetricCard
                label={t('common.ok', 'OK')}
                value={analyticsData.totals.ok.toLocaleString()}
                tone="success"
              />
              <MetricCard
                label={t('common.ng', 'NG')}
                value={analyticsData.totals.ng.toLocaleString()}
                tone="danger"
              />
              <MetricCard
                label={t('common.ntf', 'NTF')}
                value={analyticsData.totals.ntf.toLocaleString()}
                tone="warning"
              />
              <MetricCard
                label={t('reports.yieldRate', 'Yield Rate')}
                value={`${analyticsData.totals.yieldRate}%`}
                tone="info"
              />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Production Distribution Pie Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PieChart className="h-5 w-5" />
                    {t('reports.productionDistByCategory')}
                  </CardTitle>
                  <CardDescription>{t('reports.productionRatioByCategory')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPie>
                        <Pie
                          data={analyticsData.productionPieData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          outerRadius={100}
                          fill={chartColor(0)}
                          dataKey="value"
                        >
                          {analyticsData.productionPieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color || chartColor(index)} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => value.toLocaleString()} />
                      </RechartsPie>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Yield Rate Comparison */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    {t('reports.yieldRateByCategory')}
                  </CardTitle>
                  <CardDescription>{t('reports.yieldRatioByCategory')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analyticsData.categoryData} layout="vertical">
                        <CartesianGrid {...chartGridProps} />
                        <XAxis type="number" domain={[0, 100]} unit="%" tick={chartAxisTick} />
                        <YAxis dataKey="code" type="category" width={80} tick={chartAxisTick} />
                        <Tooltip
                          contentStyle={chartTooltipStyle}
                          formatter={(value: number) => `${value}%`}
                          labelFormatter={(label) => analyticsData.categoryData.find(d => d.code === label)?.name || label}
                        />
                        <Bar dataKey="yieldRate" name={t('reports.yieldRate', 'Yield Rate')}>
                          {analyticsData.categoryData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.yieldRate >= 95 ? 'var(--success)' : entry.yieldRate >= 90 ? 'var(--warning)' : 'var(--destructive)'}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Stacked Bar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {t('reports.resultDetailByCategory')}
                </CardTitle>
                <CardDescription>{t('reports.okNgNtfDistByCategory')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analyticsData.barChartData}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="name" tick={chartAxisTick} />
                      <YAxis tick={chartAxisTick} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelFormatter={(label) => analyticsData.barChartData.find(d => d.name === label)?.fullName || label}
                      />
                      <Legend />
                      <Bar dataKey="OK" stackId="a" fill="var(--success)" name="OK" />
                      <Bar dataKey="NG" stackId="a" fill="var(--destructive)" name="NG" />
                      <Bar dataKey="NTF" stackId="a" fill="var(--warning)" name="NTF" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Category Details Table */}
            <Card>
              <CardHeader>
                <CardTitle>{t('reports.detailByCategory')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.category', 'Category')}</TableHead>
                        <TableHead className="text-right">{t('common.total')}</TableHead>
                        <TableHead className="text-right">{t('common.ok', 'OK')}</TableHead>
                        <TableHead className="text-right">{t('common.ng', 'NG')}</TableHead>
                        <TableHead className="text-right">{t('common.ntf', 'NTF')}</TableHead>
                        <TableHead className="text-right">{t('reports.yieldRate', 'Yield Rate')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analyticsData.categoryData.map(cat => (
                        <TableRow key={cat.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: cat.color }}
                              />
                              <span className="font-medium">{cat.name}</span>
                              <Badge variant="outline" className="text-xs">{cat.code}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">{cat.total.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-success">{cat.ok.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-destructive">{cat.ng.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-warning">{cat.ntf.toLocaleString()}</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={cat.yieldRate >= 95 ? 'default' : cat.yieldRate >= 90 ? 'secondary' : 'destructive'}
                            >
                              {cat.yieldRate}%
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
