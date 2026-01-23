import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Calendar } from 'lucide-react';

export function CorporateFactoryStats() {
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedCorporate, setSelectedCorporate] = useState<string | undefined>();

  const startDate = new Date();
  if (dateRange === '7d') startDate.setDate(startDate.getDate() - 7);
  else if (dateRange === '30d') startDate.setDate(startDate.getDate() - 30);
  else startDate.setDate(startDate.getDate() - 90);

  const { data: yieldByCorporate, isLoading: loadingCorporate } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
    startDate,
    endDate: new Date(),
  });

  const { data: yieldByFactory, isLoading: loadingFactory } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
    corporateCode: selectedCorporate,
    startDate,
    endDate: new Date(),
  });

  const { data: throughputByCorporate, isLoading: loadingThroughput } = trpc.corporateFactoryStats.throughputByCorporate.useQuery({
    startDate,
    endDate: new Date(),
    interval: 'day',
  });

  // Transform throughput data for chart
  const throughputChartData = throughputByCorporate?.reduce((acc, item) => {
    const existing = acc.find(x => x.date === item.timeInterval);
    if (existing) {
      existing[item.corporateCode] = item.count;
    } else {
      acc.push({
        date: item.timeInterval,
        [item.corporateCode]: item.count,
      });
    }
    return acc;
  }, [] as any[]) || [];

  // Get unique corporate codes for legend
  const corporateCodes = Array.from(new Set(throughputByCorporate?.map(x => x.corporateCode) || []));

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as any)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">7 ngày qua</SelectItem>
              <SelectItem value="30d">30 ngày qua</SelectItem>
              <SelectItem value="90d">90 ngày qua</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {yieldByCorporate && yieldByCorporate.length > 0 && (
          <Select value={selectedCorporate} onValueChange={setSelectedCorporate}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Chọn công ty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả công ty</SelectItem>
              {yieldByCorporate.map(item => (
                <SelectItem key={item.corporateCode} value={item.corporateCode}>
                  {item.corporateCode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Yield Rate by Corporate */}
      <Card>
        <CardHeader>
          <CardTitle>Tỷ lệ đạt theo Công ty</CardTitle>
          <CardDescription>So sánh yield rate giữa các công ty</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCorporate ? (
            <div className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">Đang tải...</p>
            </div>
          ) : yieldByCorporate && yieldByCorporate.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={yieldByCorporate}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="corporateCode" />
                <YAxis label={{ value: 'Yield Rate (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  formatter={(value: any) => `${value}%`}
                  labelFormatter={(label) => `Công ty: ${label}`}
                />
                <Legend />
                <Bar dataKey="yieldRate" fill="#3b82f6" name="Tỷ lệ đạt (%)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center">
              <p className="text-muted-foreground">Không có dữ liệu</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Yield Rate by Factory */}
      {selectedCorporate && selectedCorporate !== 'all' && (
        <Card>
          <CardHeader>
            <CardTitle>Tỷ lệ đạt theo Nhà máy</CardTitle>
            <CardDescription>Chi tiết yield rate của {selectedCorporate}</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingFactory ? (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-muted-foreground">Đang tải...</p>
              </div>
            ) : yieldByFactory && yieldByFactory.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={yieldByFactory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="factoryCode" />
                  <YAxis label={{ value: 'Yield Rate (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    formatter={(value: any) => `${value}%`}
                    labelFormatter={(label) => `Nhà máy: ${label}`}
                  />
                  <Legend />
                  <Bar dataKey="yieldRate" fill="#10b981" name="Tỷ lệ đạt (%)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center">
                <p className="text-muted-foreground">Không có dữ liệu</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Throughput Trends by Corporate */}
      <Card>
        <CardHeader>
          <CardTitle>Xu hướng Throughput theo Công ty</CardTitle>
          <CardDescription>Số lượng sản phẩm kiểm tra theo thời gian</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingThroughput ? (
            <div className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">Đang tải...</p>
            </div>
          ) : throughputChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={throughputChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis label={{ value: 'Số lượng', angle: -90, position: 'insideLeft' }} />
                <Tooltip 
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleDateString('vi-VN');
                  }}
                />
                <Legend />
                {corporateCodes.map((code, index) => (
                  <Line 
                    key={code}
                    type="monotone" 
                    dataKey={code} 
                    stroke={colors[index % colors.length]} 
                    name={code}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[400px] flex items-center justify-center">
              <p className="text-muted-foreground">Không có dữ liệu</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {yieldByCorporate?.map(item => (
          <Card key={item.corporateCode}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{item.corporateCode}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{item.yieldRate}%</div>
              <p className="text-xs text-muted-foreground mt-1">
                {item.totalInspections} kiểm tra | {item.okCount} OK | {item.ngCount} NG
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
