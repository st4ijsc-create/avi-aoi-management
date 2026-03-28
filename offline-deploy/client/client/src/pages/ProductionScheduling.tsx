import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import GanttChart from "@/components/GanttChart";
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

type AlgorithmType = "fifo" | "priority" | "edf";

const ALGORITHM_INFO: Record<AlgorithmType, { label: string; desc: string; icon: any }> = {
  fifo: {
    label: "FIFO (First In First Out)",
    desc: "Xếp lịch theo thứ tự tạo đơn - đơn tạo trước được sản xuất trước",
    icon: ListOrdered,
  },
  priority: {
    label: "Priority Scheduling",
    desc: "Ưu tiên đơn hàng có mức priority cao nhất, cùng priority thì xét deadline",
    icon: ArrowUpDown,
  },
  edf: {
    label: "EDF (Earliest Deadline First)",
    desc: "Đơn hàng có deadline gần nhất được ưu tiên sản xuất trước",
    icon: Timer,
  },
};

const CONFLICT_SEVERITY_CONFIG = {
  warning: { color: "bg-yellow-500", textColor: "text-yellow-500", icon: AlertTriangle },
  error: { color: "bg-red-500", textColor: "text-red-500", icon: AlertTriangle },
};

const CONFLICT_TYPE_LABELS: Record<string, string> = {
  overlap: "Chồng chéo lịch",
  dependency: "Phụ thuộc đơn",
  capacity: "Vượt công suất",
  deadline: "Trễ deadline",
};

export default function ProductionScheduling() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("gantt");
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<AlgorithmType>("priority");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Data queries
  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = trpc.productionOrder.list.useQuery(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const { data: lines } = trpc.line.list.useQuery();

  // Optimize schedule mutation
  const optimizeMutation = trpc.productionOrder.optimizeSchedule.useMutation({
    onSuccess: (data: any) => {
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

  const applyMutation = trpc.productionOrder.applyScheduleSuggestion.useMutation({
    onSuccess: () => {
      toast.success(t("scheduling.applySuccess", "Đã áp dụng gợi ý lịch"));
      refetchOrders();
    },
    onError: (err) => toast.error(err.message),
  });

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
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <CalendarDays className="h-8 w-8 text-primary" />
              {t("scheduling.title", "Lập lịch sản xuất")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("scheduling.description", "Tối ưu hóa lịch sản xuất với thuật toán Priority/EDF/FIFO")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => refetchOrders()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t("common.refresh", "Làm mới")}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">{t("scheduling.totalOrders", "Tổng đơn")}</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">{t("scheduling.inProgress", "Đang SX")}</div>
              <div className="text-2xl font-bold text-blue-500">{stats.inProgress}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">{t("scheduling.planned", "Lên kế hoạch")}</div>
              <div className="text-2xl font-bold text-yellow-500">{stats.planned}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">{t("scheduling.completed", "Hoàn thành")}</div>
              <div className="text-2xl font-bold text-green-500">{stats.completed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-sm text-muted-foreground">{t("scheduling.overdue", "Trễ hạn")}</div>
              <div className="text-2xl font-bold text-red-500">{stats.overdue}</div>
            </CardContent>
          </Card>
        </div>

        {/* Algorithm Selection + Optimize */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5" />
              {t("scheduling.algorithmSelection", "Chọn thuật toán tối ưu")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              <div className="grid grid-cols-3 gap-4 flex-1">
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
            </div>
          </CardContent>
        </Card>

        {/* Optimization Results */}
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
                    <CheckCircle className="h-5 w-5 text-green-500" />
                    {t("scheduling.suggestions", "Gợi ý sắp xếp")} ({optimizeResult.suggestions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
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
                          <TableCell>{new Date(s.suggestedStartDate).toLocaleString("vi-VN")}</TableCell>
                          <TableCell>{new Date(s.suggestedEndDate).toLocaleString("vi-VN")}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{s.reason}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
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
                              disabled={applyMutation.isPending}
                            >
                              {t("scheduling.apply", "Áp dụng")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
                          {new Date(wip.estimatedCompletionTime).toLocaleString("vi-VN")}
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
                  <Table>
                    <TableHeader>
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
                              ? new Date(order.scheduledStartDate).toLocaleDateString("vi-VN")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {order.scheduledEndDate
                              ? new Date(order.scheduledEndDate).toLocaleDateString("vi-VN")
                              : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge status={order.status} t={t} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ status, t }: { status: string; t: any }) {
  const config: Record<string, { variant: any; label: string }> = {
    planned: { variant: "secondary", label: t("scheduling.planned", "Lên KH") },
    in_progress: { variant: "default", label: t("scheduling.inProgress", "Đang SX") },
    completed: { variant: "outline", label: t("scheduling.completed", "Xong") },
    cancelled: { variant: "destructive", label: t("scheduling.cancelled", "Hủy") },
  };
  const c = config[status] || { variant: "secondary", label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
