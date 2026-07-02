import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/patterns';
import { toast } from 'sonner';
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  Calendar,
  Cpu,
  Package,
  Filter,
  RefreshCw,
  Square,
  Circle,
  ArrowRight,
  Pencil,
  Type,
  Loader2,
  FileText,
  Image,
  LucideIcon
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { format, subDays, subMonths, startOfDay, endOfDay } from 'date-fns';
import { vi } from 'date-fns/locale';

const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#eab308'];

const annotationTypeLabelKeys: Record<string, string> = {
  rectangle: 'reports.annotationType.rectangle',
  circle: 'reports.annotationType.circle',
  arrow: 'reports.annotationType.arrow',
  freehand: 'reports.annotationType.freehand',
  text: 'reports.annotationType.text',
};

const annotationTypeIcons: Record<string, LucideIcon> = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  freehand: Pencil,
  text: Type,
};

const colorLabelKeys: Record<string, string> = {
  '#ef4444': 'reports.colorLabel.red',
  '#f97316': 'reports.colorLabel.orange',
  '#eab308': 'reports.colorLabel.yellow',
  '#22c55e': 'reports.colorLabel.green',
  '#3b82f6': 'reports.colorLabel.blue',
  '#8b5cf6': 'reports.colorLabel.purple',
};

export function AnnotationStatisticsContent() {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [selectedMachine, setSelectedMachine] = useState<string>('all');
  const [selectedProduct, setSelectedProduct] = useState<string>('all');

  // Calculate date filters
  const dateFilters = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case '7d':
        return { dateFrom: subDays(now, 7), dateTo: now };
      case '30d':
        return { dateFrom: subDays(now, 30), dateTo: now };
      case '90d':
        return { dateFrom: subDays(now, 90), dateTo: now };
      default:
        return {};
    }
  }, [dateRange]);

  // Fetch statistics
  const { data: stats, isLoading, refetch } = trpc.annotation.statistics.useQuery({
    ...dateFilters,
    machineId: selectedMachine !== 'all' ? parseInt(selectedMachine) : undefined,
    productModelId: selectedProduct !== 'all' ? parseInt(selectedProduct) : undefined,
  });

  // Fetch machines and products for filters
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: products } = trpc.productModel.list.useQuery();

  // Prepare chart data
  const typeChartData = useMemo(() => {
    if (!stats?.byType) return [];
    return stats.byType.map(item => ({
      name: t(annotationTypeLabelKeys[item.type]) || item.type,
      value: item.count,
      type: item.type,
    }));
  }, [stats, t]);

  const colorChartData = useMemo(() => {
    if (!stats?.byColor) return [];
    return stats.byColor.map(item => ({
      name: t(colorLabelKeys[item.color]) || item.color,
      value: item.count,
      color: item.color,
    }));
  }, [stats, t]);

  const machineChartData = useMemo(() => {
    if (!stats?.byMachine) return [];
    return stats.byMachine
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(item => ({
        name: item.code,
        fullName: item.name,
        count: item.count,
      }));
  }, [stats]);

  const productChartData = useMemo(() => {
    if (!stats?.byProduct) return [];
    return stats.byProduct
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(item => ({
        name: item.code,
        fullName: item.name,
        count: item.count,
      }));
  }, [stats]);

  const trendChartData = useMemo(() => {
    if (!stats?.byDate) return [];
    return stats.byDate.map(item => ({
      date: format(new Date(item.date), 'dd/MM', { locale: vi }),
      fullDate: item.date,
      count: item.count,
    }));
  }, [stats]);

  // Export to CSV
  const handleExportCSV = () => {
    if (!stats) return;

    const rows = [
      [t('reports.annotationStatistics'), ''],
      [t('reports.totalAnnotations'), stats.totalAnnotations.toString()],
      [t('reports.totalImages'), stats.totalImages.toString()],
      [''],
      [t('reports.byAnnotationType'), ''],
      ...stats.byType.map(item => [t(annotationTypeLabelKeys[item.type]) || item.type, item.count.toString()]),
      [''],
      [t('reports.byColor'), ''],
      ...stats.byColor.map(item => [t(colorLabelKeys[item.color]) || item.color, item.count.toString()]),
      [''],
      [t('reports.byMachine'), ''],
      ...stats.byMachine.map(item => [item.name, item.count.toString()]),
      [''],
      [t('reports.byProduct'), ''],
      ...stats.byProduct.map(item => [item.name, item.count.toString()]),
      [''],
      [t('reports.byDate'), ''],
      ...stats.byDate.map(item => [item.date, item.count.toString()]),
    ];

    const csvContent = rows.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `annotation-statistics-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('common.csvExported'));
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<BarChart3 className="h-6 w-6 text-primary" />}
          title={t('reports.annotationStatistics')}
          description={t('reports.annotationStatsDesc')}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('common.refresh')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!stats}>
                <Download className="h-4 w-4 mr-2" />
                {t('common.exportCSV')}
              </Button>
            </>
          }
        />

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('common.dateRange')}</label>
                <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">{t('common.last7Days')}</SelectItem>
                    <SelectItem value="30d">{t('common.last30Days')}</SelectItem>
                    <SelectItem value="90d">{t('common.last90Days')}</SelectItem>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('common.machine')}</label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('common.allMachines')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.allMachines')}</SelectItem>
                    {machines?.map((m: any) => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('common.product')}</label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t('common.allProducts')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.allProducts')}</SelectItem>
                    {products?.map((p: any) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {/* Stats Overview */}
        {stats && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.totalAnnotations.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{t('reports.totalAnnotations')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-info/10">
                      <Image className="h-5 w-5 text-info" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.totalImages.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{t('reports.imagesWithAnnotation')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-warning/10">
                      <Cpu className="h-5 w-5 text-warning" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.byMachine.length}</p>
                      <p className="text-xs text-muted-foreground">{t('reports.machinesWithAnnotation')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-success/10">
                      <Package className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.byProduct.length}</p>
                      <p className="text-xs text-muted-foreground">{t('reports.productsWithAnnotation')}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">{t('dashboard.overview')}</TabsTrigger>
                <TabsTrigger value="trend">{t('reports.trend')}</TabsTrigger>
                <TabsTrigger value="machine">{t('reports.byMachine')}</TabsTrigger>
                <TabsTrigger value="product">{t('reports.byProduct')}</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* By Type */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <PieChartIcon className="h-4 w-4" />
                        {t('reports.distByAnnotationType')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {typeChartData.length > 0 ? (
                        <div className="h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={typeChartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                outerRadius={100}
                                fill="#8884d8"
                                dataKey="value"
                              >
                                {typeChartData.map((_, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                          {t('common.noData')}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {typeChartData.map((item, index) => {
                          const IconComp = annotationTypeIcons[item.type] || Square;
                          return (
                            <Badge key={item.type} variant="outline" className="gap-1">
                              <IconComp className="h-3 w-3" style={{ color: COLORS[index % COLORS.length] }} />
                              {item.name}: {item.value}
                            </Badge>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* By Color */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <PieChartIcon className="h-4 w-4" />
                        {t('reports.distByColorSeverity')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {colorChartData.length > 0 ? (
                        <div className="h-[300px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={colorChartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                                outerRadius={100}
                                fill="#8884d8"
                                dataKey="value"
                              >
                                {colorChartData.map((entry) => (
                                  <Cell key={entry.color} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                          {t('common.noData')}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {colorChartData.map((item) => (
                          <Badge key={item.color} variant="outline" className="gap-1">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                            {item.name}: {item.value}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="trend">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      {t('reports.annotationTrendOverTime')}
                    </CardTitle>
                    <CardDescription>
                      {t('reports.annotationsCreatedPerDay')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {trendChartData.length > 0 ? (
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis dataKey="date" className="text-xs" />
                            <YAxis className="text-xs" />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                              }}
                            />
                            <Area
                              type="monotone"
                              dataKey="count"
                              name={t('reports.annotationCount')}
                              stroke="#3b82f6"
                              fill="#3b82f6"
                              fillOpacity={0.2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        {t('common.noData')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="machine">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      {t('reports.top10MachinesAnnotations')}
                    </CardTitle>
                    <CardDescription>
                      {t('reports.machinesAnnotationDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {machineChartData.length > 0 ? (
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={machineChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis type="number" className="text-xs" />
                            <YAxis type="category" dataKey="name" className="text-xs" width={80} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                              }}
                              formatter={(value: any, name: any, props: any) => [
                                value,
                                props.payload.fullName || name
                              ]}
                            />
                            <Bar dataKey="count" name={t('reports.annotationCount')} fill="#f97316" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        {t('common.noData')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="product">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      {t('reports.top10ProductsAnnotations')}
                    </CardTitle>
                    <CardDescription>
                      {t('reports.productsAnnotationDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {productChartData.length > 0 ? (
                      <div className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={productChartData} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                            <XAxis type="number" className="text-xs" />
                            <YAxis type="category" dataKey="name" className="text-xs" width={80} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--popover))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '8px',
                              }}
                              formatter={(value: any, name: any, props: any) => [
                                value,
                                props.payload.fullName || name
                              ]}
                            />
                            <Bar dataKey="count" name={t('reports.annotationCount')} fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        {t('common.noData')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </>
  );
}

export default function AnnotationStatistics() {
  return (
    <DashboardLayout>
      <AnnotationStatisticsContent />
    </DashboardLayout>
  );
}
