import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart3,
  RefreshCw,
  Download,
  TrendingUp,
  AlertTriangle,
  Target,
  Filter,
} from "lucide-react";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Cell,
  ReferenceLine,
} from "recharts";

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

const COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#14b8a6",
  "#a855f7", "#64748b", "#d946ef", "#0ea5e9", "#84cc16",
];

export default function ParetoAnalysis() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("byType");
  const [dateRange, setDateRange] = useState(getDefaultDateRange);
  const [selectedFactory, setSelectedFactory] = useState<string>("all");
  const [selectedLine, setSelectedLine] = useState<string>("all");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [timePeriod, setTimePeriod] = useState<"hour" | "shift" | "day" | "week">("day");

  const { data: factories } = trpc.factory.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();

  const commonFilter = {
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    factoryId: selectedFactory !== "all" ? Number(selectedFactory) : undefined,
    lineId: selectedLine !== "all" ? Number(selectedLine) : undefined,
    machineId: selectedMachine !== "all" ? Number(selectedMachine) : undefined,
  };

  const { data: byTypeData, isLoading: byTypeLoading, refetch: refetchByType } =
    trpc.paretoAnalysis.byDefectType.useQuery(commonFilter);

  const { data: byMachineData, isLoading: byMachineLoading, refetch: refetchByMachine } =
    trpc.paretoAnalysis.byMachine.useQuery(commonFilter);

  const { data: byLineData, isLoading: byLineLoading, refetch: refetchByLine } =
    trpc.paretoAnalysis.byLine.useQuery(commonFilter);

  const { data: byTimeData, isLoading: byTimeLoading, refetch: refetchByTime } =
    trpc.paretoAnalysis.byTimePeriod.useQuery({ ...commonFilter, groupBy: timePeriod });

  const handleRefresh = () => {
    refetchByType();
    refetchByMachine();
    refetchByLine();
    refetchByTime();
  };

  const handleExportCSV = (data: any, filename: string) => {
    if (!data?.items?.length) return;
    const headers = ["Category", "Count", "Percentage", "Cumulative %"];
    const rows = data.items.map((item: any) => [
      item.category, item.count, item.percentage.toFixed(2), item.cumulativePercentage.toFixed(2),
    ]);
    const csv = [headers.join(","), ...rows.map((r: string[]) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${dateRange.startDate}_${dateRange.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <BarChart3 className="h-8 w-8 text-primary" />
              {t("pareto.title", "Phân tích Pareto")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("pareto.description", "Phân tích 80/20 - xác định nguyên nhân chính gây lỗi")}
            </p>
          </div>
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.refresh", "Làm mới")}
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Filter className="h-4 w-4" />
              {t("pareto.filters", "Bộ lọc")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <Label>{t("common.startDate", "Từ ngày")}</Label>
                <Input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t("common.endDate", "Đến ngày")}</Label>
                <Input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>{t("common.factory", "Nhà máy")}</Label>
                <Select value={selectedFactory} onValueChange={setSelectedFactory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                    {factories?.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("common.line", "Dây chuyền")}</Label>
                <Select value={selectedLine} onValueChange={setSelectedLine}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                    {lines?.map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("common.machine", "Máy")}</Label>
                <Select value={selectedMachine} onValueChange={setSelectedMachine}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                    {machines?.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name || m.machineCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="byType">
              <AlertTriangle className="h-4 w-4 mr-1" />
              {t("pareto.byDefectType", "Theo loại lỗi")}
            </TabsTrigger>
            <TabsTrigger value="byMachine">
              <Target className="h-4 w-4 mr-1" />
              {t("pareto.byMachine", "Theo máy")}
            </TabsTrigger>
            <TabsTrigger value="byLine">
              <TrendingUp className="h-4 w-4 mr-1" />
              {t("pareto.byLine", "Theo dây chuyền")}
            </TabsTrigger>
            <TabsTrigger value="byTime">
              <BarChart3 className="h-4 w-4 mr-1" />
              {t("pareto.byTimePeriod", "Theo thời gian")}
            </TabsTrigger>
          </TabsList>

          {/* By Defect Type */}
          <TabsContent value="byType">
            <ParetoTabContent
              data={byTypeData}
              isLoading={byTypeLoading}
              title={t("pareto.defectTypeTitle", "Phân tích Pareto theo loại lỗi")}
              onExport={() => handleExportCSV(byTypeData, "pareto_by_type")}
              t={t}
            />
          </TabsContent>

          {/* By Machine */}
          <TabsContent value="byMachine">
            <ParetoTabContent
              data={byMachineData}
              isLoading={byMachineLoading}
              title={t("pareto.machineTitle", "Phân tích Pareto theo máy")}
              onExport={() => handleExportCSV(byMachineData, "pareto_by_machine")}
              t={t}
            />
          </TabsContent>

          {/* By Line */}
          <TabsContent value="byLine">
            <ParetoTabContent
              data={byLineData}
              isLoading={byLineLoading}
              title={t("pareto.lineTitle", "Phân tích Pareto theo dây chuyền")}
              onExport={() => handleExportCSV(byLineData, "pareto_by_line")}
              t={t}
            />
          </TabsContent>

          {/* By Time Period */}
          <TabsContent value="byTime">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Label>{t("pareto.timePeriod", "Chu kỳ thời gian")}</Label>
                <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as any)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">{t("pareto.hourly", "Theo giờ")}</SelectItem>
                    <SelectItem value="shift">{t("pareto.shift", "Theo ca")}</SelectItem>
                    <SelectItem value="day">{t("pareto.daily", "Theo ngày")}</SelectItem>
                    <SelectItem value="week">{t("pareto.weekly", "Theo tuần")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ParetoTabContent
                data={byTimeData}
                isLoading={byTimeLoading}
                title={t("pareto.timeTitle", "Phân tích Pareto theo thời gian")}
                onExport={() => handleExportCSV(byTimeData, "pareto_by_time")}
                t={t}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ParetoTabContent({
  data,
  isLoading,
  title,
  onExport,
  t,
}: {
  data: any;
  isLoading: boolean;
  title: string;
  onExport: () => void;
  t: any;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[400px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="h-16 w-16 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            {t("pareto.noData", "Không có dữ liệu trong khoảng thời gian đã chọn")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.items.map((item: any, index: number) => ({
    name: item.category,
    count: item.count,
    percentage: item.percentage,
    cumulative: item.cumulativePercentage,
    fill: COLORS[index % COLORS.length],
  }));

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">
              {t("pareto.totalDefects", "Tổng lỗi")}
            </div>
            <div className="text-2xl font-bold">{data.totalDefects?.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">
              {t("pareto.totalCategories", "Tổng danh mục")}
            </div>
            <div className="text-2xl font-bold">{data.items?.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">
              {t("pareto.pareto80Count", "Danh mục chiếm 80%")}
            </div>
            <div className="text-2xl font-bold text-destructive">{data.pareto80Count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">
              {t("pareto.pareto80Categories", "Top 80% danh mục")}
            </div>
            <div className="text-2xl font-bold text-orange-500">
              {data.pareto80Categories?.join(", ") || "-"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="h-4 w-4 mr-2" />
            {t("common.exportCSV", "Xuất CSV")}
          </Button>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
                tick={{ fontSize: 11 }}
              />
              <YAxis yAxisId="left" label={{ value: t("pareto.count", "Số lượng"), angle: -90, position: "insideLeft" }} />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 100]}
                label={{ value: t("pareto.cumulativePercent", "% Tích lũy"), angle: 90, position: "insideRight" }}
              />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === "count") return [value, t("pareto.count", "Số lượng")];
                  if (name === "cumulative") return [`${value.toFixed(1)}%`, t("pareto.cumulative", "Tích lũy")];
                  return [value, name];
                }}
              />
              <Legend />
              <ReferenceLine yAxisId="right" y={80} stroke="#ef4444" strokeDasharray="5 5" label="80%" />
              <Bar yAxisId="left" dataKey="count" name={t("pareto.count", "Số lượng")} radius={[4, 4, 0, 0]}>
                {chartData.map((entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.cumulative <= 80 ? "#ef4444" : "#94a3b8"} />
                ))}
              </Bar>
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                name={t("pareto.cumulative", "% Tích lũy")}
                stroke="#f97316"
                strokeWidth={2}
                dot={{ fill: "#f97316", r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("pareto.detailTable", "Bảng chi tiết")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>{t("pareto.category", "Danh mục")}</TableHead>
                <TableHead className="text-right">{t("pareto.count", "Số lượng")}</TableHead>
                <TableHead className="text-right">{t("pareto.percentage", "Tỷ lệ %")}</TableHead>
                <TableHead className="text-right">{t("pareto.cumulativePercent", "% Tích lũy")}</TableHead>
                <TableHead className="text-center">{t("pareto.paretoZone", "Vùng Pareto")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item: any, index: number) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{index + 1}</TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell className="text-right font-mono">{item.count.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{item.percentage.toFixed(2)}%</TableCell>
                  <TableCell className="text-right font-mono">{item.cumulativePercentage.toFixed(2)}%</TableCell>
                  <TableCell className="text-center">
                    {item.cumulativePercentage <= 80 ? (
                      <Badge variant="destructive">80%</Badge>
                    ) : (
                      <Badge variant="secondary">20%</Badge>
                    )}
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
