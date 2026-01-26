import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { format, subDays } from "date-fns";
import { vi } from "date-fns/locale";
import { 
  CalendarIcon, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  Minus,
  AlertTriangle,
  CheckCircle,
  Lightbulb,
  BarChart3,
  PieChart,
  Activity,
  Loader2,
  History,
  Target,
  Zap
} from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ComposedChart,
  Line,
  Cell,
  PieChart as RechartsPieChart,
  Pie,
  Legend
} from "recharts";
import { cn } from "@/lib/utils";

type AnalysisType = "DEFECT_ANALYSIS" | "YIELD_ANALYSIS" | "QUALITY_ANALYSIS" | "MACHINE_ANALYSIS";

export default function RootCauseAnalysisPage() {
  const [analysisType, setAnalysisType] = useState<AnalysisType>("DEFECT_ANALYSIS");
  const [machineId, setMachineId] = useState<number | undefined>();
  const [productModelId, setProductModelId] = useState<number | undefined>();
  const [factoryId, setFactoryId] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [selectedAnalysis, setSelectedAnalysis] = useState<number | null>(null);

  // Queries
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: productModels } = trpc.productModel.list.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: analysisHistory } = trpc.rootCause.list.useQuery({ limit: 20 });
  const { data: analysisDetail } = trpc.rootCause.get.useQuery(
    { id: selectedAnalysis! },
    { enabled: !!selectedAnalysis }
  );

  // Mutation
  const analyzeMutation = trpc.rootCause.analyze.useMutation({
    onSuccess: (data) => {
      setSelectedAnalysis(data.id);
    },
  });

  const handleAnalyze = () => {
    analyzeMutation.mutate({
      analysisType,
      machineId,
      productModelId,
      factoryId,
      startDate: dateRange.from,
      endDate: dateRange.to,
    });
  };

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4'];

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-red-500" />;
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-green-500" />;
      default:
        return <Minus className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Phân tích Nguyên nhân Gốc rễ</h1>
            <p className="text-muted-foreground">
              Sử dụng AI để phân tích và xác định nguyên nhân gốc rễ của defects
            </p>
          </div>
        </div>

        {/* Analysis Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Cấu hình Phân tích
            </CardTitle>
            <CardDescription>
              Chọn loại phân tích và phạm vi dữ liệu
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {/* Analysis Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Loại phân tích</label>
                <Select value={analysisType} onValueChange={(v) => setAnalysisType(v as AnalysisType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFECT_ANALYSIS">Phân tích Defect</SelectItem>
                    <SelectItem value="YIELD_ANALYSIS">Phân tích Yield</SelectItem>
                    <SelectItem value="QUALITY_ANALYSIS">Phân tích Chất lượng</SelectItem>
                    <SelectItem value="MACHINE_ANALYSIS">Phân tích Máy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Factory */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Nhà máy</label>
                <Select 
                  value={factoryId?.toString() || "all"} 
                  onValueChange={(v) => setFactoryId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    {factories?.map((f: any) => (
                      <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Machine */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Máy</label>
                <Select 
                  value={machineId?.toString() || "all"} 
                  onValueChange={(v) => setMachineId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    {machines?.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>{m.code} - {m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Product Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Sản phẩm</label>
                <Select 
                  value={productModelId?.toString() || "all"} 
                  onValueChange={(v) => setProductModelId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả</SelectItem>
                    {productModels?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.code} - {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Khoảng thời gian</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateRange.from, "dd/MM", { locale: vi })} - {format(dateRange.to, "dd/MM", { locale: vi })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      selected={{ from: dateRange.from, to: dateRange.to }}
                      onSelect={(range) => {
                        if (range?.from && range?.to) {
                          setDateRange({ from: range.from, to: range.to });
                        }
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending}>
                {analyzeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Đang phân tích...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Chạy Phân tích
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Analysis History */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Lịch sử Phân tích
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <div className="space-y-2">
                  {analysisHistory?.map((analysis: any) => (
                    <div
                      key={analysis.id}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedAnalysis === analysis.id 
                          ? "border-primary bg-primary/5" 
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedAnalysis(analysis.id)}
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {analysis.analysisType.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(analysis.createdAt), "dd/MM HH:mm")}
                        </span>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className="font-medium">{analysis.dataPointsAnalyzed}</span> điểm dữ liệu
                      </div>
                      {analysis.machineCode && (
                        <div className="text-xs text-muted-foreground">
                          Máy: {analysis.machineCode}
                        </div>
                      )}
                    </div>
                  ))}
                  {(!analysisHistory || analysisHistory.length === 0) && (
                    <div className="text-center py-8 text-muted-foreground">
                      Chưa có phân tích nào
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Analysis Results */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Kết quả Phân tích
              </CardTitle>
            </CardHeader>
            <CardContent>
              {analysisDetail ? (
                <Tabs defaultValue="factors">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="factors">Top Factors</TabsTrigger>
                    <TabsTrigger value="pareto">Pareto</TabsTrigger>
                    <TabsTrigger value="insights">AI Insights</TabsTrigger>
                    <TabsTrigger value="recommendations">Đề xuất</TabsTrigger>
                  </TabsList>

                  <TabsContent value="factors" className="mt-4">
                    <div className="space-y-4">
                      {analysisDetail.topFactors?.map((factor: any, index: number) => (
                        <div key={index} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{factor.factor}</span>
                              {getTrendIcon(factor.trend)}
                            </div>
                            <span className="text-sm font-medium">{factor.contribution}%</span>
                          </div>
                          <Progress value={factor.contribution} className="h-2" />
                          <p className="text-xs text-muted-foreground">{factor.description}</p>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="pareto" className="mt-4">
                    <div className="h-[400px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={analysisDetail.paretoData?.slice(0, 10)}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="category" 
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            fontSize={10}
                          />
                          <YAxis yAxisId="left" />
                          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                          <Tooltip />
                          <Legend />
                          <Bar yAxisId="left" dataKey="count" name="Số lượng" fill="#3b82f6">
                            {analysisDetail.paretoData?.slice(0, 10).map((_: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Bar>
                          <Line 
                            yAxisId="right" 
                            type="monotone" 
                            dataKey="cumulativePercentage" 
                            name="Tích lũy %" 
                            stroke="#ef4444" 
                            strokeWidth={2}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </TabsContent>

                  <TabsContent value="insights" className="mt-4">
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="p-4 rounded-lg bg-muted/50">
                        <h4 className="font-medium flex items-center gap-2 mb-2">
                          <Activity className="h-4 w-4" />
                          Tổng quan
                        </h4>
                        <p className="text-sm">{analysisDetail.aiInsights?.summary}</p>
                      </div>

                      {/* Root Causes */}
                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          Nguyên nhân Gốc rễ
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.rootCauses?.map((cause: any, index: number) => (
                            <div key={index} className="p-3 rounded-lg border">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{cause.cause}</span>
                                <Badge variant={cause.probability > 0.5 ? "destructive" : "secondary"}>
                                  {Math.round(cause.probability * 100)}%
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">{cause.evidence}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="recommendations" className="mt-4">
                    <div className="space-y-4">
                      {/* Recommendations */}
                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <Lightbulb className="h-4 w-4 text-yellow-500" />
                          Đề xuất Hành động
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.recommendations?.map((rec: string, index: number) => (
                            <div key={index} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                              <Target className="h-4 w-4 mt-0.5 text-primary" />
                              <span className="text-sm">{rec}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Preventive Measures */}
                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          Biện pháp Phòng ngừa
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.preventiveMeasures?.map((measure: string, index: number) => (
                            <div key={index} className="flex items-start gap-3 p-3 rounded-lg border">
                              <CheckCircle className="h-4 w-4 mt-0.5 text-green-500" />
                              <span className="text-sm">{measure}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                  <PieChart className="h-12 w-12 mb-4 opacity-50" />
                  <p>Chọn một phân tích từ lịch sử hoặc chạy phân tích mới</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
