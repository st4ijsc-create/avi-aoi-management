import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { 
  Bell, 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle, 
  XCircle,
  TrendingUp,
  Activity,
  Zap,
  Eye,
  Check,
  X,
  Loader2,
  RefreshCw,
  Settings,
  Clock,
  Target,
  Lightbulb
} from "lucide-react";
import { toast } from "sonner";

type AlertStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED" | "EXPIRED";
type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type AlertType = "DEFECT_SPIKE" | "YIELD_DROP" | "MACHINE_FAILURE" | "QUALITY_DEGRADATION" | "PATTERN_ANOMALY";

export default function PredictiveAlertsPage() {
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "all">("all");
  const [typeFilter, setTypeFilter] = useState<AlertType | "all">("all");
  const [selectedAlert, setSelectedAlert] = useState<number | null>(null);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const utils = trpc.useUtils();

  // Queries
  const { data: alerts, isLoading } = trpc.predictiveAlert.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    severity: severityFilter === "all" ? undefined : severityFilter,
    alertType: typeFilter === "all" ? undefined : typeFilter,
    limit: 100,
  });

  const { data: alertDetail } = trpc.predictiveAlert.get.useQuery(
    { id: selectedAlert! },
    { enabled: !!selectedAlert }
  );

  const { data: stats } = trpc.predictiveAlert.stats.useQuery();

  // Mutations
  const acknowledgeMutation = trpc.predictiveAlert.acknowledge.useMutation({
    onSuccess: () => {
      toast.success("Đã xác nhận alert");
      utils.predictiveAlert.list.invalidate();
      utils.predictiveAlert.stats.invalidate();
    },
  });

  const resolveMutation = trpc.predictiveAlert.resolve.useMutation({
    onSuccess: () => {
      toast.success("Đã giải quyết alert");
      setResolveDialogOpen(false);
      setResolutionNotes("");
      utils.predictiveAlert.list.invalidate();
      utils.predictiveAlert.stats.invalidate();
    },
  });

  const dismissMutation = trpc.predictiveAlert.dismiss.useMutation({
    onSuccess: () => {
      toast.success("Đã bỏ qua alert");
      utils.predictiveAlert.list.invalidate();
      utils.predictiveAlert.stats.invalidate();
    },
  });

  const generateMutation = trpc.predictiveAlert.generatePredictions.useMutation({
    onSuccess: (data) => {
      toast.success(`Đã tạo ${data.alertsCreated} alerts mới`);
      utils.predictiveAlert.list.invalidate();
      utils.predictiveAlert.stats.invalidate();
    },
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-500';
      case 'HIGH': return 'bg-orange-500';
      case 'MEDIUM': return 'bg-yellow-500';
      case 'LOW': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getSeverityBadge = (severity: string) => {
    const variants: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
      'CRITICAL': 'destructive',
      'HIGH': 'destructive',
      'MEDIUM': 'default',
      'LOW': 'secondary',
    };
    return <Badge variant={variants[severity] || 'secondary'}>{severity}</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
      'ACTIVE': { variant: 'destructive', icon: <AlertCircle className="h-3 w-3" /> },
      'ACKNOWLEDGED': { variant: 'default', icon: <Eye className="h-3 w-3" /> },
      'RESOLVED': { variant: 'secondary', icon: <CheckCircle className="h-3 w-3" /> },
      'DISMISSED': { variant: 'outline', icon: <XCircle className="h-3 w-3" /> },
      'EXPIRED': { variant: 'outline', icon: <Clock className="h-3 w-3" /> },
    };
    const { variant, icon } = config[status] || { variant: 'secondary' as const, icon: null };
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        {icon}
        {status}
      </Badge>
    );
  };

  const getAlertTypeIcon = (type: string) => {
    switch (type) {
      case 'DEFECT_SPIKE': return <TrendingUp className="h-5 w-5 text-red-500" />;
      case 'YIELD_DROP': return <Activity className="h-5 w-5 text-orange-500" />;
      case 'MACHINE_FAILURE': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'QUALITY_DEGRADATION': return <AlertCircle className="h-5 w-5 text-blue-500" />;
      case 'PATTERN_ANOMALY': return <Zap className="h-5 w-5 text-purple-500" />;
      default: return <Bell className="h-5 w-5" />;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Cảnh báo Dự đoán</h1>
            <p className="text-muted-foreground">
              AI tự động phát hiện và cảnh báo các vấn đề tiềm ẩn
            </p>
          </div>
          <Button onClick={() => generateMutation.mutate({})} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Chạy Dự đoán
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Tổng Alerts</p>
                  <p className="text-2xl font-bold">{stats?.total || 0}</p>
                </div>
                <Bell className="h-8 w-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-500/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Đang Hoạt động</p>
                  <p className="text-2xl font-bold text-red-500">{stats?.active || 0}</p>
                </div>
                <AlertCircle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-orange-500/50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Critical</p>
                  <p className="text-2xl font-bold text-orange-500">{stats?.critical || 0}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Đã Giải quyết</p>
                  <p className="text-2xl font-bold text-green-500">{stats?.byStatus?.RESOLVED || 0}</p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AlertStatus | "all")}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="ACTIVE">Đang hoạt động</SelectItem>
                  <SelectItem value="ACKNOWLEDGED">Đã xác nhận</SelectItem>
                  <SelectItem value="RESOLVED">Đã giải quyết</SelectItem>
                  <SelectItem value="DISMISSED">Đã bỏ qua</SelectItem>
                </SelectContent>
              </Select>

              <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as AlertSeverity | "all")}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Mức độ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>

              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as AlertType | "all")}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Loại alert" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả</SelectItem>
                  <SelectItem value="DEFECT_SPIKE">Defect Spike</SelectItem>
                  <SelectItem value="YIELD_DROP">Yield Drop</SelectItem>
                  <SelectItem value="MACHINE_FAILURE">Machine Failure</SelectItem>
                  <SelectItem value="QUALITY_DEGRADATION">Quality Degradation</SelectItem>
                  <SelectItem value="PATTERN_ANOMALY">Pattern Anomaly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Alerts Grid */}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Alert List */}
          <Card>
            <CardHeader>
              <CardTitle>Danh sách Cảnh báo</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : alerts?.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Bell className="h-12 w-12 mb-4 opacity-50" />
                    <p>Không có cảnh báo nào</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alerts?.map((alert: any) => (
                      <div
                        key={alert.id}
                        className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                          selectedAlert === alert.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedAlert(alert.id)}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-1 h-full rounded-full ${getSeverityColor(alert.severity)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {getAlertTypeIcon(alert.alertType)}
                              <span className="font-medium truncate">{alert.title}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {alert.description}
                            </p>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {getSeverityBadge(alert.severity)}
                              {getStatusBadge(alert.status)}
                              {alert.machineCode && (
                                <Badge variant="outline">{alert.machineCode}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span>{format(new Date(alert.createdAt), "dd/MM HH:mm", { locale: vi })}</span>
                              {alert.confidenceScore && (
                                <span>Độ tin cậy: {alert.confidenceScore}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Alert Detail */}
          <Card>
            <CardHeader>
              <CardTitle>Chi tiết Cảnh báo</CardTitle>
            </CardHeader>
            <CardContent>
              {alertDetail ? (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    {getAlertTypeIcon(alertDetail.alertType)}
                    <div>
                      <h3 className="font-semibold">{alertDetail.title}</h3>
                      <p className="text-sm text-muted-foreground">{alertDetail.description}</p>
                    </div>
                  </div>

                  {/* Metrics */}
                  {(alertDetail.currentValue !== null || alertDetail.predictedValue !== null) && (
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Hiện tại</p>
                        <p className="text-lg font-bold">{alertDetail.currentValue?.toFixed(1)}%</p>
                      </div>
                      <div className="p-3 rounded-lg bg-red-500/10 text-center">
                        <p className="text-xs text-muted-foreground">Dự đoán</p>
                        <p className="text-lg font-bold text-red-500">{alertDetail.predictedValue?.toFixed(1)}%</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50 text-center">
                        <p className="text-xs text-muted-foreground">Ngưỡng</p>
                        <p className="text-lg font-bold">{alertDetail.threshold?.toFixed(1)}%</p>
                      </div>
                    </div>
                  )}

                  {/* Confidence */}
                  {alertDetail.confidenceScore && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Độ tin cậy</span>
                        <span className="font-medium">{alertDetail.confidenceScore}%</span>
                      </div>
                      <Progress value={alertDetail.confidenceScore} />
                    </div>
                  )}

                  {/* Timeframe */}
                  {alertDetail.predictedTimeframe && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Dự kiến xảy ra trong: <strong>{alertDetail.predictedTimeframe}</strong></span>
                    </div>
                  )}

                  {/* AI Analysis */}
                  {alertDetail.aiAnalysis && (
                    <div className="space-y-3">
                      <h4 className="font-medium flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-yellow-500" />
                        Phân tích AI
                      </h4>
                      
                      {/* Factors */}
                      {alertDetail.aiAnalysis.factors?.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Yếu tố ảnh hưởng:</p>
                          {alertDetail.aiAnalysis.factors.map((factor: any, index: number) => (
                            <div key={index} className="p-2 rounded bg-muted/50">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">{factor.name}</span>
                                <Badge variant="outline">{factor.contribution}%</Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{factor.description}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Recommendations */}
                      {alertDetail.aiAnalysis.recommendations?.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Đề xuất:</p>
                          {alertDetail.aiAnalysis.recommendations.map((rec: string, index: number) => (
                            <div key={index} className="flex items-start gap-2 p-2 rounded bg-muted/50">
                              <Target className="h-4 w-4 mt-0.5 text-primary" />
                              <span className="text-sm">{rec}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  {alertDetail.status === 'ACTIVE' && (
                    <div className="flex gap-2 pt-4 border-t">
                      <Button 
                        onClick={() => acknowledgeMutation.mutate({ id: alertDetail.id })}
                        disabled={acknowledgeMutation.isPending}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Xác nhận
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={() => setResolveDialogOpen(true)}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Giải quyết
                      </Button>
                      <Button 
                        variant="ghost"
                        onClick={() => dismissMutation.mutate({ id: alertDetail.id })}
                        disabled={dismissMutation.isPending}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Bỏ qua
                      </Button>
                    </div>
                  )}

                  {alertDetail.status === 'ACKNOWLEDGED' && (
                    <div className="flex gap-2 pt-4 border-t">
                      <Button 
                        onClick={() => setResolveDialogOpen(true)}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Giải quyết
                      </Button>
                    </div>
                  )}

                  {/* Resolution Notes */}
                  {alertDetail.resolutionNotes && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                      <p className="text-sm font-medium text-green-600">Ghi chú giải quyết:</p>
                      <p className="text-sm mt-1">{alertDetail.resolutionNotes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
                  <Bell className="h-12 w-12 mb-4 opacity-50" />
                  <p>Chọn một cảnh báo để xem chi tiết</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Resolve Dialog */}
        <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Giải quyết Cảnh báo</DialogTitle>
              <DialogDescription>
                Thêm ghi chú về cách bạn đã giải quyết vấn đề này
              </DialogDescription>
            </DialogHeader>
            <Textarea
              placeholder="Nhập ghi chú giải quyết..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={4}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>
                Hủy
              </Button>
              <Button 
                onClick={() => {
                  if (selectedAlert) {
                    resolveMutation.mutate({ id: selectedAlert, resolutionNotes });
                  }
                }}
                disabled={resolveMutation.isPending}
              >
                {resolveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Xác nhận Giải quyết
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
