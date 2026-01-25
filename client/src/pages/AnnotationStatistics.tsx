import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

const annotationTypeLabels: Record<string, string> = {
  rectangle: 'Hình chữ nhật',
  circle: 'Hình tròn',
  arrow: 'Mũi tên',
  freehand: 'Vẽ tay',
  text: 'Văn bản',
};

const annotationTypeIcons: Record<string, LucideIcon> = {
  rectangle: Square,
  circle: Circle,
  arrow: ArrowRight,
  freehand: Pencil,
  text: Type,
};

const colorLabels: Record<string, string> = {
  '#ef4444': 'Đỏ (Lỗi nghiêm trọng)',
  '#f97316': 'Cam (Cảnh báo)',
  '#eab308': 'Vàng (Chú ý)',
  '#22c55e': 'Xanh lá (OK)',
  '#3b82f6': 'Xanh dương (Đo lường)',
  '#8b5cf6': 'Tím (Ghi chú)',
};

export default function AnnotationStatistics() {
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
      name: annotationTypeLabels[item.type] || item.type,
      value: item.count,
      type: item.type,
    }));
  }, [stats]);

  const colorChartData = useMemo(() => {
    if (!stats?.byColor) return [];
    return stats.byColor.map(item => ({
      name: colorLabels[item.color] || item.color,
      value: item.count,
      color: item.color,
    }));
  }, [stats]);

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
      ['Thống kê Annotation', ''],
      ['Tổng số annotation', stats.totalAnnotations.toString()],
      ['Tổng số hình ảnh', stats.totalImages.toString()],
      [''],
      ['Theo loại annotation', ''],
      ...stats.byType.map(item => [annotationTypeLabels[item.type] || item.type, item.count.toString()]),
      [''],
      ['Theo màu sắc', ''],
      ...stats.byColor.map(item => [colorLabels[item.color] || item.color, item.count.toString()]),
      [''],
      ['Theo máy', ''],
      ...stats.byMachine.map(item => [item.name, item.count.toString()]),
      [''],
      ['Theo sản phẩm', ''],
      ...stats.byProduct.map(item => [item.name, item.count.toString()]),
      [''],
      ['Theo ngày', ''],
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
    toast.success('Đã xuất file CSV');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Thống Kê Annotation
            </h1>
            <p className="text-muted-foreground">
              Phân tích xu hướng và phân bố annotation theo thời gian, máy, sản phẩm
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Làm mới
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!stats}>
              <Download className="h-4 w-4 mr-2" />
              Xuất CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Khoảng thời gian</label>
                <Select value={dateRange} onValueChange={(v: any) => setDateRange(v)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">7 ngày qua</SelectItem>
                    <SelectItem value="30d">30 ngày qua</SelectItem>
                    <SelectItem value="90d">90 ngày qua</SelectItem>
                    <SelectItem value="all">Tất cả</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Máy</label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Tất cả máy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả máy</SelectItem>
                    {machines?.map((m: any) => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.code} - {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Sản phẩm</label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Tất cả sản phẩm" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả sản phẩm</SelectItem>
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
                      <p className="text-xs text-muted-foreground">Tổng annotation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <Image className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.totalImages.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">Hình ảnh có annotation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-500/10">
                      <Cpu className="h-5 w-5 text-orange-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.byMachine.length}</p>
                      <p className="text-xs text-muted-foreground">Máy có annotation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-green-500/10">
                      <Package className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats.byProduct.length}</p>
                      <p className="text-xs text-muted-foreground">Sản phẩm có annotation</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList>
                <TabsTrigger value="overview">Tổng quan</TabsTrigger>
                <TabsTrigger value="trend">Xu hướng</TabsTrigger>
                <TabsTrigger value="machine">Theo máy</TabsTrigger>
                <TabsTrigger value="product">Theo sản phẩm</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* By Type */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <PieChartIcon className="h-4 w-4" />
                        Phân bố theo loại Annotation
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
                          Chưa có dữ liệu
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
                        Phân bố theo màu sắc (Mức độ)
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
                          Chưa có dữ liệu
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
                      Xu hướng Annotation theo thời gian
                    </CardTitle>
                    <CardDescription>
                      Số lượng annotation được tạo mỗi ngày
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
                              name="Số annotation"
                              stroke="#3b82f6"
                              fill="#3b82f6"
                              fillOpacity={0.2}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        Chưa có dữ liệu
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
                      Top 10 Máy có nhiều Annotation nhất
                    </CardTitle>
                    <CardDescription>
                      Máy có nhiều annotation thường có nhiều vấn đề cần kiểm tra
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
                            <Bar dataKey="count" name="Số annotation" fill="#f97316" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        Chưa có dữ liệu
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
                      Top 10 Sản phẩm có nhiều Annotation nhất
                    </CardTitle>
                    <CardDescription>
                      Sản phẩm có nhiều annotation có thể cần cải thiện quy trình sản xuất
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
                            <Bar dataKey="count" name="Số annotation" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                        Chưa có dữ liệu
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
