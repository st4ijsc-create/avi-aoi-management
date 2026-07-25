import { useState } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { ContextDrawer } from "@/components/workspace";
import { CausalGraphEditorPageContent } from "./CausalGraphEditorPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { PageHeader, chartColor, chartTooltipStyle, chartTooltipLabelStyle, chartGridProps, chartAxisTick } from "@/components/patterns";
import { toast } from "sonner";
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
  Zap,
  Pencil,
  Trash2,
  Network
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

export function RootCauseAnalysisPageContent() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("analytics_root_cause", "canEdit");
  const canDelete = hasPermission("analytics_root_cause", "canDelete");
  // doc 69 §B1.3 (T8/E1) — Causal-Graph embed: same permission the standalone
  // /causal-graph route + CausalGraphEditorPageContent itself already gate on.
  const canViewCausal = hasPermission("analytics_root_cause", "canView");
  const [causalOpen, setCausalOpen] = useState(false);
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

  const utils = trpc.useUtils();

  // Mutation
  const analyzeMutation = trpc.rootCause.analyze.useMutation({
    onSuccess: (data) => {
      setSelectedAnalysis(data.id);
    },
  });

  // ── Edit / delete state + mutations ──
  const [editOpen, setEditOpen] = useState(false);
  const [editStatus, setEditStatus] = useState<"COMPLETED" | "IN_PROGRESS" | "FAILED">("COMPLETED");
  const [editConfirmedCause, setEditConfirmedCause] = useState("");
  const [editCorrectiveAction, setEditCorrectiveAction] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const invalidate = () => {
    void utils.rootCause.list.invalidate();
    if (selectedAnalysis) void utils.rootCause.get.invalidate({ id: selectedAnalysis });
  };

  const updateMutation = trpc.rootCause.update.useMutation({
    onSuccess: () => {
      setEditOpen(false);
      invalidate();
      toast.success(t("reports.analysisUpdated", "Đã cập nhật phân tích"));
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.rootCause.delete.useMutation({
    onSuccess: () => {
      setDeleteOpen(false);
      setSelectedAnalysis(null);
      invalidate();
      toast.success(t("reports.analysisDeleted", "Đã xoá phân tích"));
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = () => {
    const review: any = (analysisDetail?.aiInsights as any)?.review ?? {};
    setEditStatus((analysisDetail?.status as any) ?? "COMPLETED");
    setEditConfirmedCause(review.confirmedCause ?? "");
    setEditCorrectiveAction(review.correctiveAction ?? "");
    setEditNotes(review.notes ?? "");
    setEditOpen(true);
  };

  const submitEdit = () => {
    if (!selectedAnalysis) return;
    updateMutation.mutate({
      id: selectedAnalysis,
      status: editStatus,
      confirmedCause: editConfirmedCause,
      correctiveAction: editCorrectiveAction,
      notes: editNotes,
    });
  };

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

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'increasing':
        return <TrendingUp className="h-4 w-4 text-destructive" />;
      case 'decreasing':
        return <TrendingDown className="h-4 w-4 text-success" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Search className="h-6 w-6 text-primary" />}
          title={t('reports.rootCauseAnalysis')}
          description={t('reports.rootCauseAnalysisDesc')}
          badge={<ViewOnlyBadge module="analytics_root_cause" />}
          actions={
            canViewCausal ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCausalOpen(true)}>
                <Network className="h-4 w-4" />
                {t('reports.causalGraphButton', 'Đồ thị nhân quả')}
              </Button>
            ) : undefined
          }
        />

        {/* Analysis Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              {t('reports.analysisConfig')}
            </CardTitle>
            <CardDescription>
              {t('reports.selectAnalysisTypeAndScope')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {/* Analysis Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('reports.analysisType')}</label>
                <Select value={analysisType} onValueChange={(v) => setAnalysisType(v as AnalysisType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEFECT_ANALYSIS">{t('reports.defectAnalysis')}</SelectItem>
                    <SelectItem value="YIELD_ANALYSIS">{t('reports.yieldAnalysis')}</SelectItem>
                    <SelectItem value="QUALITY_ANALYSIS">{t('reports.qualityAnalysis')}</SelectItem>
                    <SelectItem value="MACHINE_ANALYSIS">{t('reports.machineAnalysis')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Factory */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('common.factory')}</label>
                <Select 
                  value={factoryId?.toString() || "all"} 
                  onValueChange={(v) => setFactoryId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {factories?.map((f: any) => (
                      <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Machine */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('common.machine')}</label>
                <Select 
                  value={machineId?.toString() || "all"} 
                  onValueChange={(v) => setMachineId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {machines?.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>{m.code} - {m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Product Model */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('common.product')}</label>
                <Select 
                  value={productModelId?.toString() || "all"} 
                  onValueChange={(v) => setProductModelId(v === "all" ? undefined : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all')}</SelectItem>
                    {productModels?.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.code} - {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Range */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('common.dateRange')}</label>
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
                    {t('reports.analyzing')}
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    {t('reports.runAnalysis')}
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
                {t('reports.analysisHistory')}
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
                        <span className="font-medium">{analysis.dataPointsAnalyzed}</span> {t('reports.dataPoints')}
                      </div>
                      {analysis.machineCode && (
                        <div className="text-xs text-muted-foreground">
                          {t('common.machine')}: {analysis.machineCode}
                        </div>
                      )}
                    </div>
                  ))}
                  {(!analysisHistory || analysisHistory.length === 0) && (
                    <div className="text-center py-8 text-muted-foreground">
                      {t('reports.noAnalysisYet')}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Analysis Results */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {t('reports.analysisResults')}
                </CardTitle>
                {analysisDetail && (
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <Button variant="outline" size="sm" onClick={openEdit}>
                        <Pencil className="mr-1 h-4 w-4" />
                        {t('reports.editAnalysis', 'Sửa')}
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                        <Trash2 className="mr-1 h-4 w-4 text-destructive" />
                        {t('reports.deleteAnalysis', 'Xoá')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {analysisDetail ? (
                <Tabs defaultValue="factors">
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="factors">{t('reports.topFactors', 'Top Factors')}</TabsTrigger>
                    <TabsTrigger value="pareto">{t('reports.pareto', 'Pareto')}</TabsTrigger>
                    <TabsTrigger value="insights">{t('reports.aiInsights', 'AI Insights')}</TabsTrigger>
                    <TabsTrigger value="recommendations">{t('reports.recommendations')}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="factors" className="mt-4">
                    <div className="space-y-4">
                      {analysisDetail.topFactors?.map((factor: any) => (
                        <div key={factor.factor} className="space-y-2">
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
                          <CartesianGrid {...chartGridProps} />
                          <XAxis
                            dataKey="category"
                            angle={-45}
                            textAnchor="end"
                            height={80}
                            tick={chartAxisTick}
                          />
                          <YAxis yAxisId="left" tick={chartAxisTick} />
                          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={chartAxisTick} />
                          <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                          <Legend />
                          <Bar yAxisId="left" dataKey="count" name={t('common.quantity')} fill={chartColor(0)}>
                            {analysisDetail.paretoData?.slice(0, 10).map((_: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={chartColor(index)} />
                            ))}
                          </Bar>
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumulativePercentage"
                            name={t('reports.cumulativePercent')}
                            stroke="var(--destructive)"
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
                          {t('dashboard.overview')}
                        </h4>
                        <p className="text-sm">{analysisDetail.aiInsights?.summary}</p>
                      </div>

                      {/* Root Causes */}
                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <AlertTriangle className="h-4 w-4 text-warning" />
                          {t('reports.rootCauses')}
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.rootCauses?.map((cause: any) => (
                            <div key={cause.cause} className="p-3 rounded-lg border">
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
                          <Lightbulb className="h-4 w-4 text-warning" />
                          {t('reports.actionRecommendations')}
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.recommendations?.map((rec: string, index: number) => (
                            <div key={`rec-${index}`} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                              <Target className="h-4 w-4 mt-0.5 text-primary" />
                              <span className="text-sm">{rec}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Preventive Measures */}
                      <div>
                        <h4 className="font-medium flex items-center gap-2 mb-3">
                          <CheckCircle className="h-4 w-4 text-success" />
                          {t('reports.preventiveMeasures')}
                        </h4>
                        <div className="space-y-2">
                          {analysisDetail.aiInsights?.preventiveMeasures?.map((measure: string, index: number) => (
                            <div key={`measure-${index}`} className="flex items-start gap-3 p-3 rounded-lg border">
                              <CheckCircle className="h-4 w-4 mt-0.5 text-success" />
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
                  <p>{t('reports.selectOrRunAnalysis')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reports.editAnalysis', 'Sửa kết quả phân tích')}</DialogTitle>
            <DialogDescription>{t('reports.rootCauseAnalysisDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t('reports.analysisStatus', 'Trạng thái')}</Label>
              <Select value={editStatus} onValueChange={(v) => setEditStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                  <SelectItem value="IN_PROGRESS">IN_PROGRESS</SelectItem>
                  <SelectItem value="FAILED">FAILED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('reports.confirmedCause', 'Nguyên nhân đã xác nhận')}</Label>
              <Input value={editConfirmedCause} onChange={(e) => setEditConfirmedCause(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reports.correctiveAction', 'Hành động khắc phục')}</Label>
              <Input value={editCorrectiveAction} onChange={(e) => setEditCorrectiveAction(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reports.reviewNotes', 'Ghi chú')}</Label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel', 'Huỷ')}</Button>
            <Button onClick={submitEdit} disabled={updateMutation.isPending}>
              {t('common.save', 'Lưu')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reports.deleteAnalysis', 'Xoá phân tích')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('reports.deleteAnalysisConfirm', 'Bạn có chắc muốn xoá kết quả phân tích này?')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Huỷ')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedAnalysis && deleteMutation.mutate({ id: selectedAnalysis })}
            >
              {t('common.delete', 'Xoá')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* doc 69 §B1.3 (T8/E1) — Causal-Graph embed: same component behind the
          standalone /causal-graph route, reused (not duplicated). Wider than
          the default ContextDrawer width to fit the node-graph canvas. */}
      {canViewCausal && (
        <ContextDrawer
          open={causalOpen}
          onOpenChange={setCausalOpen}
          title={t('reports.causalGraphButton', 'Đồ thị nhân quả')}
          description={t('reports.causalGraphDrawerDesc', 'Đồ thị máy ↔ lỗi ↔ nguyên nhân ↔ hành động dùng cho phân tích nguyên nhân gốc')}
          className="flex w-[95vw] flex-col gap-0 p-0 sm:w-[85vw] sm:max-w-[1100px]"
        >
          <CausalGraphEditorPageContent />
        </ContextDrawer>
      )}
    </>
  );
}

export default function RootCauseAnalysisPage() {
  return (
    <DashboardLayout>
      <RootCauseAnalysisPageContent />
    </DashboardLayout>
  );
}
