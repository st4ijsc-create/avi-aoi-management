import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useLocaleDate, getActiveLocale } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { StatusBadge as PatternStatusBadge, type BadgeVariant, PageHeader, PageContainer, MetricCard } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import GanttChart from "@/components/GanttChart";
import ApsSchedulingPanel from "@/components/ApsSchedulingPanel";
import {
  CalendarDays,
  Play,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Clock,
  Factory,
  TrendingUp,
  Zap,
  ListOrdered,
  Timer,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";

type AlgorithmType = "fifo" | "priority" | "edf";

const CONFLICT_SEVERITY_CONFIG = {
  warning: { color: "bg-warning", textColor: "text-warning", icon: AlertTriangle },
  error: { color: "bg-destructive", textColor: "text-destructive", icon: AlertTriangle },
};

export default function ProductionScheduling() {
  const { t } = useTranslation();
  const formatDate = useLocaleDate();

  const ALGORITHM_INFO = useMemo<
    Record<AlgorithmType, { label: string; desc: string; icon: any }>
  >(
    () => ({
      fifo: {
        label: t("scheduling.fifoLabel", "FIFO (First In First Out)"),
        desc: t(
          "scheduling.fifoDescLong",
          "Schedule by order creation time — earliest orders run first",
        ),
        icon: ListOrdered,
      },
      priority: {
        label: t("scheduling.priorityLabel", "Priority Scheduling"),
        desc: t(
          "scheduling.priorityDescLong",
          "Highest priority first; ties broken by earliest deadline",
        ),
        icon: ArrowUpDown,
      },
      edf: {
        label: t("scheduling.edfLabel", "EDF (Earliest Deadline First)"),
        desc: t(
          "scheduling.edfDescLong",
          "Orders with the nearest deadline are scheduled first",
        ),
        icon: Timer,
      },
    }),
    [t],
  );

  const CONFLICT_TYPE_LABELS = useMemo<Record<string, string>>(
    () => ({
      overlap: t("scheduling.conflictOverlap", "Schedule overlap"),
      dependency: t("scheduling.conflictDependency", "Order dependency"),
      capacity: t("scheduling.conflictCapacity", "Capacity exceeded"),
      deadline: t("scheduling.conflictDeadline", "Deadline missed"),
    }),
    [t],
  );

  const [activeTab, setActiveTab] = useState("gantt");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmType>("priority");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [lastOptimizedAt, setLastOptimizedAt] = useState<Date | null>(null);
  const [lastOptimizedAlgo, setLastOptimizedAlgo] = useState<AlgorithmType | null>(null);

  // Data queries
  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = trpc.productionOrder.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const { data: lines } = trpc.line.list.useQuery();

  // Optimize schedule mutation
  const optimizeMutation = trpc.productionOrder.optimizeSchedule.useMutation({
    onSuccess: (data: any) => {
      setLastOptimizedAt(new Date());
      setLastOptimizedAlgo(selectedAlgorithm);
      toast.success(
        t("scheduling.optimizeSuccess", "Tối ưu thành công: {{count}} gợi ý", {
          count: data?.suggestions?.length || 0,
        })
      );
    },
    onError: (err) => toast.error(err.message),
  });

  // WIP status query
  const { data: wipData, isLoading: wipLoading } = trpc.productionOrder.getWIPStatus.useQuery();

  const handleOptimize = () => {
    (optimizeMutation as any).mutate({ factoryId: 1, algorithm: selectedAlgorithm });
  };

  // WS-4: persistable auto-schedule run (DRAFT) + apply + what-if
  const generateRunMutation = trpc.productionOrder.generateScheduleRun.useMutation({
    onSuccess: (data: any) => {
      toast.success(
        t("scheduling.runGenerated", "Đã tạo lịch (run #{{id}}): {{count}} đơn, {{conflicts}} xung đột", {
          id: data?.runId,
          count: data?.suggestions?.length || 0,
          conflicts: data?.conflicts?.length || 0,
        })
      );
    },
    onError: (err) => toast.error(err.message),
  });

  const applyRunMutation = trpc.productionOrder.applyScheduleRun.useMutation({
    onSuccess: (data: any) => {
      toast.success(t("scheduling.runApplied", "Đã áp dụng {{count}} đơn", { count: data?.applied || 0 }));
      refetchOrders();
    },
    onError: (err) => toast.error(err.message),
  });

  const whatIfMutation = trpc.productionOrder.whatIf.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const handleGenerateRun = () => {
    (generateRunMutation as any).mutate({ factoryId: 1, algorithm: selectedAlgorithm });
  };

  const handleWhatIf = () => {
    const lineId = (lines && lines[0]?.id) || 1;
    (whatIfMutation as any).mutate({ factoryId: 1, lineId, algorithm: selectedAlgorithm, capacityReductionPct: 30 });
  };

  const scheduleRun: any = generateRunMutation.data;
  const whatIfResult: any = whatIfMutation.data;

  const applyMutation = trpc.productionOrder.applyScheduleSuggestion.useMutation({
    onSuccess: () => {
      toast.success(t("scheduling.applySuccess", "Đã áp dụng gợi ý lịch"));
      refetchOrders();
    },
    onError: (err) => toast.error(err.message),
  });

  const rescheduleMutation = trpc.productionOrder.reschedule.useMutation({
    onSuccess: () => {
      refetchOrders();
    },
    onError: (error) => {
      toast.error(error.message);
      throw error;
    },
  });

  const handleOrderReschedule = async (
    orderId: number,
    newStartDate: Date,
    newEndDate: Date,
    newLineId?: number,
  ) => {
    await rescheduleMutation.mutateAsync({
      id: orderId,
      scheduledStartDate: newStartDate,
      scheduledEndDate: newEndDate,
      lineId: newLineId,
    });
  };

  // Calculate stats
  const stats = {
    total: orders?.length || 0,
    inProgress: orders?.filter((o: any) => o.status === "in_progress").length || 0,
    planned: orders?.filter((o: any) => o.status === "planned").length || 0,
    completed: orders?.filter((o: any) => o.status === "completed").length || 0,
    overdue: orders?.filter((o: any) => {
      if (!o.scheduledEndDate) return false;
      return new Date(o.scheduledEndDate) < new Date() && o.status !== "completed";
    }).length || 0,
  };

  // Cast optimization result for flexible data access (return type varies by algorithm)
  const optimizeResult: any = optimizeMutation.data;
  const wipItems: any[] = Array.isArray(wipData) ? wipData : (wipData as any)?.orders ? (wipData as any).orders : [];

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<CalendarDays className="h-6 w-6" />}
          title={t("scheduling.title", "Lập lịch sản xuất")}
          description={t("scheduling.description", "Tối ưu hóa lịch sản xuất với thuật toán Priority/EDF/FIFO")}
          badge={<ViewOnlyBadge module="production_orders" />}
          actions={
            <Button onClick={() => refetchOrders()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("common.refresh", "Làm mới")}
            </Button>
          }
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label={t("scheduling.totalOrders", "Tổng đơn")} value={stats.total} />
          <MetricCard label={t("scheduling.inProgress", "Đang SX")} value={stats.inProgress} tone="info" />
          <MetricCard label={t("scheduling.planned", "Lên kế hoạch")} value={stats.planned} tone="warning" />
          <MetricCard label={t("scheduling.completed", "Hoàn thành")} value={stats.completed} tone="success" />
          <MetricCard label={t("scheduling.overdue", "Trễ hạn")} value={stats.overdue} tone="danger" />
        </div>

        {/* Algorithm Selection + Optimize */}
        <Card className="sticky top-2 z-20 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5" />
              {t("scheduling.algorithmSelection", "Chọn thuật toán tối ưu")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col lg:flex-row items-stretch lg:items-start gap-4 lg:gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
                {(Object.entries(ALGORITHM_INFO) as [AlgorithmType, typeof ALGORITHM_INFO["fifo"]][]).map(
                  ([key, info]) => {
                    const Icon = info.icon;
                    return (
                      <div
                        key={key}
                        className={`border rounded-lg p-4 cursor-pointer transition-all ${
                          selectedAlgorithm === key
                            ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                            : "hover:border-muted-foreground/40"
                        }`}
                        onClick={() => setSelectedAlgorithm(key)}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className="h-5 w-5 text-primary" />
                          <h4 className="font-semibold text-sm">{info.label}</h4>
                        </div>
                        <p className="text-xs text-muted-foreground">{info.desc}</p>
                      </div>
                    );
                  }
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <PermissionGate module="production_orders" action="canEdit">
                  <Button
                    size="lg"
                    onClick={handleOptimize}
                    disabled={optimizeMutation.isPending}
                    className="min-w-[160px]"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {optimizeMutation.isPending
                      ? t("scheduling.optimizing", "Đang tối ưu...")
                      : t("scheduling.optimize", "Tối ưu lịch")}
                  </Button>
                </PermissionGate>
                <div className="flex gap-2">
                  <PermissionGate module="production_orders" action="canEdit">
                    <Button
                      variant="secondary"
                      onClick={handleGenerateRun}
                      disabled={generateRunMutation.isPending}
                    >
                      {generateRunMutation.isPending
                        ? t("scheduling.generating", "Đang tạo...")
                        : t("scheduling.autoScheduleRun", "Auto-schedule (run)")}
                    </Button>
                  </PermissionGate>
                  <Button
                    variant="outline"
                    onClick={handleWhatIf}
                    disabled={whatIfMutation.isPending}
                  >
                    {t("scheduling.whatIf", "What-if (-30% công suất)")}
                  </Button>
                </div>
                {scheduleRun?.runId && (
                  <PermissionGate module="production_orders" action="canEdit">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => (applyRunMutation as any).mutate({ runId: scheduleRun.runId })}
                      disabled={applyRunMutation.isPending}
                    >
                      {t("scheduling.applyRun", "Áp dụng run #{{id}}", { id: scheduleRun.runId })}
                    </Button>
                  </PermissionGate>
                )}
                {lastOptimizedAt && lastOptimizedAlgo && (
                  <div className="text-xs text-muted-foreground">
                    {t("scheduling.lastOptimized", "Last optimized: {{time}} · {{algorithm}}", {
                      time: lastOptimizedAt.toLocaleTimeString(getActiveLocale()),
                      algorithm: ALGORITHM_INFO[lastOptimizedAlgo].label,
                    })}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Optimization Results */}
        {/* WS-4: What-if simulation result */}
        {whatIfResult && (
          <Card className="border-warning">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">
                {t("scheduling.whatIfResult", "Kết quả What-if")} — {t("scheduling.capacityReduced", "giảm công suất {{pct}}%", { pct: whatIfResult.capacityReductionPct })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm">
                {t("scheduling.lateOrdersChange", "Đơn trễ: {{base}} → {{sim}}", {
                  base: whatIfResult.baselineLateCount,
                  sim: whatIfResult.simulatedLateCount,
                })}
              </p>
              {whatIfResult.lateOrders?.length > 0 && (
                <div className="space-y-1">
                  {whatIfResult.lateOrders.map((o: any) => (
                    <div key={o.orderId} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                      <span>{o.orderCode}</span>
                      <span className="text-destructive">{t("scheduling.hoursLate", "trễ {{h}}h", { h: o.hoursLate })}</span>
                    </div>
                  ))}
                </div>
              )}
              {whatIfResult.aiExplanation && (
                <p className="text-xs text-muted-foreground italic">{whatIfResult.aiExplanation}</p>
              )}
            </CardContent>
          </Card>
        )}

        {optimizeResult && (
          <div className="space-y-4">
            {/* Conflicts */}
            {optimizeResult?.conflicts?.length > 0 && (
              <Card className="border-destructive">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    {t("scheduling.conflicts", "Xung đột phát hiện")} ({optimizeResult.conflicts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {optimizeResult.conflicts.map((conflict: any, i: number) => (
                      <Alert key={i} variant={conflict.severity === "error" ? "destructive" : "default"}>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          {CONFLICT_TYPE_LABELS[conflict.type] || conflict.type} - {conflict.orderCode}
                        </AlertTitle>
                        <AlertDescription>{conflict.message}</AlertDescription>
                      </Alert>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Suggestions */}
            {optimizeResult?.suggestions?.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-success" />
                    {t("scheduling.suggestions", "Gợi ý sắp xếp")} ({optimizeResult.suggestions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-[60vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead>{t("scheduling.orderCode", "Mã đơn")}</TableHead>
                        <TableHead>{t("common.line", "Dây chuyền")}</TableHead>
                        <TableHead>{t("scheduling.suggestedStart", "Bắt đầu gợi ý")}</TableHead>
                        <TableHead>{t("scheduling.suggestedEnd", "Kết thúc gợi ý")}</TableHead>
                        <TableHead>{t("scheduling.reason", "Lý do")}</TableHead>
                        <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {optimizeResult.suggestions.map((s: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono font-semibold">{s.orderCode}</TableCell>
                          <TableCell>{s.lineName}</TableCell>
                          <TableCell>{new Date(s.suggestedStartDate).toLocaleString(getActiveLocale())}</TableCell>
                          <TableCell>{new Date(s.suggestedEndDate).toLocaleString(getActiveLocale())}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                          <TableCell className="text-right">
                            <PermissionGate module="production_orders" action="canEdit">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={applyMutation.isPending}
                                >
                                  {t("scheduling.apply", "Áp dụng")}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {t("scheduling.applyConfirmTitle", "Xác nhận áp dụng gợi ý?")}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {t(
                                      "scheduling.applyConfirmDescription",
                                      "Thao tác này sẽ ghi đè lịch hiện tại của đơn hàng. Vui lòng xác nhận trước khi tiếp tục."
                                    )}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() =>
                                      (applyMutation as any).mutate({
                                        orderId: s.orderId,
                                        suggestedLineId: s.suggestedLineId || s.lineId || 1,
                                        suggestedStartDate: new Date(s.suggestedStartDate),
                                        suggestedEndDate: new Date(s.suggestedEndDate),
                                        reason: s.reason || "Schedule optimization",
                                        score: s.score || 0,
                                      })
                                    }
                                  >
                                    {t("scheduling.apply", "Áp dụng")}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                            </PermissionGate>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Tabs: Gantt / WIP / List */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="gantt">
              <BarChart3 className="h-4 w-4 mr-1" />
              {t("scheduling.ganttChart", "Biểu đồ Gantt")}
            </TabsTrigger>
            <TabsTrigger value="wip">
              <Factory className="h-4 w-4 mr-1" />
              {t("scheduling.wipTracking", "WIP Tracking")}
            </TabsTrigger>
            <TabsTrigger value="list">
              <ListOrdered className="h-4 w-4 mr-1" />
              {t("scheduling.orderList", "Danh sách đơn")}
            </TabsTrigger>
            <TabsTrigger value="aps">
              <Zap className="h-4 w-4 mr-1" />
              {t("aps.tabTitle", "APS (CP-SAT)")}
            </TabsTrigger>
          </TabsList>

          {/* Gantt Chart */}
          <TabsContent value="gantt">
            <Card>
              <CardContent className="pt-6">
                {ordersLoading ? (
                  <Skeleton className="h-[500px] w-full" />
                ) : orders?.length ? (
                  <GanttChart
                    orders={(orders || []) as any}
                    lines={(lines || []) as any}
                    workshops={[] as any}
                    factories={[] as any}
                    products={[] as any}
                    onOrderReschedule={handleOrderReschedule}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-16">
                    <CalendarDays className="h-16 w-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t("scheduling.noOrders", "Chưa có đơn sản xuất")}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* WIP Tracking */}
          <TabsContent value="wip">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {wipLoading ? (
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-[200px]" />)
              ) : wipItems.length ? (
                wipItems.map((wip: any, i: number) => (
                  <Card key={i}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Factory className="h-4 w-4" />
                          {wip.lineName}
                        </CardTitle>
                        <Badge variant={(wip.utilizationRate ?? 0) > 80 ? "destructive" : (wip.utilizationRate ?? 0) > 50 ? "default" : "secondary"}>
                          {(wip.utilizationRate ?? 0).toFixed(0)}% {t("scheduling.utilization", "công suất")}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("scheduling.activeOrders", "Đơn đang chạy")}</span>
                        <span className="font-semibold">{wip.inProgressOrders}</span>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-muted-foreground">{t("scheduling.progress", "Tiến độ")}</span>
                          <span className="font-semibold">{(wip.completionPercentage ?? 0).toFixed(1)}%</span>
                        </div>
                        <Progress value={wip.completionPercentage ?? 0} className="h-2" />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{t("scheduling.quantity", "Sản lượng")}</span>
                        <span className="font-mono">
                          {(wip.totalActualQuantity ?? 0).toLocaleString()} / {(wip.totalTargetQuantity ?? 0).toLocaleString()}
                        </span>
                      </div>
                      {wip.estimatedCompletionTime && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {t("scheduling.estimatedEnd", "Dự kiến xong")}:{" "}
                          {new Date(wip.estimatedCompletionTime).toLocaleString(getActiveLocale())}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="col-span-full">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <TrendingUp className="h-16 w-16 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">{t("scheduling.noWIP", "Không có WIP data")}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Order List */}
          <TabsContent value="list">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{t("scheduling.orderList", "Danh sách đơn")}</CardTitle>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                      <SelectItem value="planned">{t("scheduling.planned", "Lên kế hoạch")}</SelectItem>
                      <SelectItem value="in_progress">{t("scheduling.inProgress", "Đang SX")}</SelectItem>
                      <SelectItem value="completed">{t("scheduling.completed", "Hoàn thành")}</SelectItem>
                      <SelectItem value="cancelled">{t("scheduling.cancelled", "Đã hủy")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {ordersLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <div className="max-h-[60vh] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead>{t("scheduling.orderCode", "Mã đơn")}</TableHead>
                        <TableHead>{t("common.line", "Dây chuyền")}</TableHead>
                        <TableHead className="text-center">{t("scheduling.priority", "Ưu tiên")}</TableHead>
                        <TableHead className="text-right">{t("scheduling.quantity", "Sản lượng")}</TableHead>
                        <TableHead>{t("scheduling.startDate", "Bắt đầu")}</TableHead>
                        <TableHead>{t("scheduling.endDate", "Kết thúc")}</TableHead>
                        <TableHead className="text-center">{t("common.status", "Trạng thái")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders?.map((order: any) => (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono font-semibold">{order.orderCode}</TableCell>
                          <TableCell>{order.lineName || `Line #${order.lineId}`}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={order.priority >= 4 ? "destructive" : order.priority >= 2 ? "default" : "secondary"}>
                              P{order.priority || 0}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {(order.actualQuantity || 0).toLocaleString()} / {(order.targetQuantity || 0).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-sm">
                            {order.scheduledStartDate
                              ? formatDate.short(order.scheduledStartDate)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {order.scheduledEndDate
                              ? formatDate.short(order.scheduledEndDate)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge status={order.status} t={t} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* APS (CP-SAT) — DRAFT + KPI compare + station Gantt + HITL apply */}
          <TabsContent value="aps">
            <ApsSchedulingPanel factoryId={1} />
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}

// Schedule status → shared <StatusBadge> (solid shadcn variant, W4). Keeps the
// exact prior variant + i18n label; thin wrapper preserves the `{status,t}` API.
function StatusBadge({ status, t }: { status: string; t: any }) {
  const config: Record<string, { variant: BadgeVariant; label: string }> = {
    planned: { variant: "secondary", label: t("scheduling.planned", "Lên KH") },
    in_progress: { variant: "default", label: t("scheduling.inProgress", "Đang SX") },
    completed: { variant: "outline", label: t("scheduling.completed", "Xong") },
    cancelled: { variant: "destructive", label: t("scheduling.cancelled", "Hủy") },
  };
  const c = config[status] || { variant: "secondary" as BadgeVariant, label: status };
  return <PatternStatusBadge status={status} variant={c.variant} label={c.label} />;
}
