import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  AlertTriangle, Bell, Plus, Trash2, Edit, CheckCircle, XCircle,
  Clock, Activity, Settings, BarChart3, TrendingUp, RefreshCw, History,
  Target, Gauge, Percent, Send, Radio, Zap
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/patterns";
import AIThresholdSuggestButton from "@/components/AIThresholdSuggestButton";

interface ThresholdFormData {
  stationId: number | null;
  machineId: number | null;
  measurementPointId: number | null;
  productModelId: number | null;
  name: string;
  description: string;
  warningThreshold: number;
  criticalThreshold: number;
  minSampleSize: number;
  cooldownMinutes: number;
  sendMqttLocal: boolean;
  sendMqttExternal: boolean;
  sendFcm: boolean;
  isEnabled: boolean;
}

const defaultFormData: ThresholdFormData = {
  stationId: null,
  machineId: null,
  measurementPointId: null,
  productModelId: null,
  name: "",
  description: "",
  warningThreshold: 5,
  criticalThreshold: 10,
  minSampleSize: 10,
  cooldownMinutes: 30,
  sendMqttLocal: true,
  sendMqttExternal: true,
  sendFcm: true,
  isEnabled: true,
};

export function MqttNgRateThresholdContent() {
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<ThresholdFormData>({ ...defaultFormData });
  const [filterStationId, setFilterStationId] = useState<number | null>(null);
  const [resolveAlertId, setResolveAlertId] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [testStationId, setTestStationId] = useState<number | null>(null);
  const [testSeverity, setTestSeverity] = useState<"warning" | "critical">("warning");
  const [testSendExternal, setTestSendExternal] = useState(true);
  const [testSendFcm, setTestSendFcm] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // ─── Data Queries ──────────────────────────────────────────────────────
  const { data: stations } = trpc.station.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();
  const { data: measurementPoints } = trpc.measurementPoint.list.useQuery();
  const { data: productModels } = trpc.productModel.list.useQuery();

  const { data: thresholds, refetch: refetchThresholds } = trpc.ngRateThreshold.list.useQuery(
    filterStationId ? { stationId: filterStationId } : undefined
  );

  const { data: alertHistoryData, refetch: refetchHistory } = trpc.ngRateThreshold.alertHistory.useQuery({
    stationId: filterStationId || undefined,
    limit: 100,
  });

  const { data: currentNgRates, refetch: refetchNgRates } = trpc.ngRateThreshold.currentNgRates.useQuery(
    { stationId: filterStationId! },
    { enabled: !!filterStationId }
  );

  // ─── Mutations ─────────────────────────────────────────────────────────
  const createMutation = trpc.ngRateThreshold.create.useMutation({
    onSuccess: () => {
      toast.success(t("mqttNgRateThreshold.toastCreateSuccess"));
      setIsCreateDialogOpen(false);
      resetForm();
      refetchThresholds();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.ngRateThreshold.update.useMutation({
    onSuccess: () => {
      toast.success(t("mqttNgRateThreshold.toastUpdateSuccess"));
      setIsCreateDialogOpen(false);
      setEditingId(null);
      resetForm();
      refetchThresholds();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.ngRateThreshold.delete.useMutation({
    onSuccess: () => {
      toast.success(t("mqttNgRateThreshold.toastDeleteSuccess"));
      refetchThresholds();
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleMutation = trpc.ngRateThreshold.toggle.useMutation({
    onSuccess: () => refetchThresholds(),
    onError: (error) => toast.error(error.message),
  });

  const resolveAlertMutation = trpc.ngRateThreshold.resolveAlert.useMutation({
    onSuccess: () => {
      toast.success(t("mqttNgRateThreshold.toastResolveSuccess"));
      setResolveAlertId(null);
      setResolutionNote("");
      refetchHistory();
    },
    onError: (error) => toast.error(error.message),
  });

  const sendTestAlertMutation = trpc.ngRateThreshold.sendTestAlert.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
      setTestResult(data);
      refetchHistory();
    },
    onError: (error) => toast.error(error.message),
  });

  // ─── Helpers ───────────────────────────────────────────────────────────
  const resetForm = () => {
    setFormData({ ...defaultFormData });
    setEditingId(null);
  };

  const handleEdit = (threshold: any) => {
    setEditingId(threshold.id);
    setFormData({
      stationId: threshold.stationId,
      machineId: threshold.machineId || null,
      measurementPointId: threshold.measurementPointId || null,
      productModelId: threshold.productModelId || null,
      name: threshold.name,
      description: threshold.description || "",
      warningThreshold: Number(threshold.warningThreshold),
      criticalThreshold: Number(threshold.criticalThreshold),
      minSampleSize: threshold.minSampleSize,
      cooldownMinutes: threshold.cooldownMinutes,
      sendMqttLocal: threshold.sendMqttLocal,
      sendMqttExternal: threshold.sendMqttExternal,
      sendFcm: threshold.sendFcm,
      isEnabled: threshold.isEnabled,
    });
    setIsCreateDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.stationId) {
      toast.error(t("mqttNgRateThreshold.validationSelectStation"));
      return;
    }
    if (!formData.name.trim()) {
      toast.error(t("mqttNgRateThreshold.validationEnterName"));
      return;
    }
    if (formData.criticalThreshold < formData.warningThreshold) {
      toast.error(t("mqttNgRateThreshold.validationCriticalGteWarning"));
      return;
    }

    if (editingId) {
      const { stationId: _sid, ...updatePayload } = formData;
      updateMutation.mutate({
        id: editingId,
        ...updatePayload,
      });
    } else {
      createMutation.mutate({
        ...formData,
        stationId: formData.stationId!,
      });
    }
  };

  const getSeverityBadge = (severity: string) => {
    if (severity === "critical") {
      return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="w-3 h-3 mr-1" /> {t("mqttNgRateThreshold.critical")}</Badge>;
    }
    return <Badge className="bg-warning/20 text-warning border-warning/30"><AlertTriangle className="w-3 h-3 mr-1" /> {t("mqttNgRateThreshold.warning")}</Badge>;
  };

  const getNgRateColor = (rate: number, warning: number, critical: number) => {
    if (rate >= critical) return "text-destructive";
    if (rate >= warning) return "text-warning";
    return "text-success";
  };

  const filteredMachines = machines?.filter((m: any) => !formData.stationId || m.stationId === formData.stationId);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Gauge className="w-6 h-6" />}
          title={t("mqttNgRateThreshold.pageTitle")}
          description={t("mqttNgRateThreshold.pageDescription")}
          actions={
            <>
              {/* Station filter */}
              <Select
                value={filterStationId?.toString() || "all"}
                onValueChange={(v) => setFilterStationId(v === "all" ? null : Number(v))}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder={t("mqttNgRateThreshold.filterByStation")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("mqttNgRateThreshold.allStations")}</SelectItem>
                  {stations?.map((s: any) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  resetForm();
                  setIsCreateDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t("mqttNgRateThreshold.addThreshold")}
              </Button>
            </>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-info/20">
                  <Settings className="w-5 h-5 text-info" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{thresholds?.length || 0}</p>
                  <p className="text-sm text-muted-foreground">{t("mqttNgRateThreshold.configuredThresholds")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/20">
                  <CheckCircle className="w-5 h-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{thresholds?.filter((t: any) => t.isEnabled).length || 0}</p>
                  <p className="text-sm text-muted-foreground">{t("mqttNgRateThreshold.active")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-warning/20">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {alertHistoryData?.data?.filter((a: any) => !a.isResolved && a.severity === "warning").length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("mqttNgRateThreshold.unresolvedWarnings")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/20">
                  <XCircle className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {alertHistoryData?.data?.filter((a: any) => !a.isResolved && a.severity === "critical").length || 0}
                  </p>
                  <p className="text-sm text-muted-foreground">{t("mqttNgRateThreshold.unresolvedCritical")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tab Content */}
        <Tabs defaultValue="config" className="space-y-4">
          <TabsList>
            <TabsTrigger value="config" className="gap-2">
              <Settings className="w-4 h-4" /> {t("mqttNgRateThreshold.tabConfig")}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" /> {t("mqttNgRateThreshold.tabHistory")}
            </TabsTrigger>
            {filterStationId && (
              <TabsTrigger value="realtime" className="gap-2">
                <BarChart3 className="w-4 h-4" /> {t("mqttNgRateThreshold.tabRealtime")}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ═══ TAB: Cấu hình ngưỡng ═══ */}
          <TabsContent value="config">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="w-5 h-5" />
                  {t("mqttNgRateThreshold.thresholdList")}
                </CardTitle>
                <CardDescription>
                  {t("mqttNgRateThreshold.thresholdListDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!thresholds || thresholds.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Gauge className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>{t("mqttNgRateThreshold.noThresholds")}</p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => { resetForm(); setIsCreateDialogOpen(true); }}
                    >
                      <Plus className="w-4 h-4 mr-2" /> {t("mqttNgRateThreshold.createFirst")}
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("mqttNgRateThreshold.colName")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colStation")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colMachine")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colPoint")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colProductModel")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colWarning")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colCritical")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colMinSample")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colChannel")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colStatus")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colActions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {thresholds.map((threshold: any) => (
                        <TableRow key={threshold.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{threshold.name}</p>
                              {threshold.description && (
                                <p className="text-xs text-muted-foreground">{threshold.description}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{threshold.stationName || "-"}</TableCell>
                          <TableCell>{threshold.machineName || <span className="text-muted-foreground">{t("mqttNgRateThreshold.all")}</span>}</TableCell>
                          <TableCell>
                            {threshold.pointCode ? (
                              <span title={threshold.pointName}>{threshold.pointCode}</span>
                            ) : (
                              <span className="text-muted-foreground">{t("mqttNgRateThreshold.overall")}</span>
                            )}
                          </TableCell>
                          <TableCell>{threshold.productModelName || <span className="text-muted-foreground">{t("mqttNgRateThreshold.all")}</span>}</TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-warning/20 text-warning border-warning/30">
                              {Number(threshold.warningThreshold)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className="bg-destructive/20 text-destructive border-destructive/30">
                              {Number(threshold.criticalThreshold)}%
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">{threshold.minSampleSize}</TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              {threshold.sendMqttLocal && <Badge variant="outline" className="text-xs">Local</Badge>}
                              {threshold.sendMqttExternal && <Badge variant="outline" className="text-xs">Ext</Badge>}
                              {threshold.sendFcm && <Badge variant="outline" className="text-xs">FCM</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={threshold.isEnabled}
                              onCheckedChange={(checked) =>
                                toggleMutation.mutate({ id: threshold.id, isEnabled: checked })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(threshold)}>
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  if (confirm(t("mqttNgRateThreshold.confirmDelete"))) {
                                    deleteMutation.mutate({ id: threshold.id });
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ TAB: Lịch sử cảnh báo ═══ */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <History className="w-5 h-5" />
                      {t("mqttNgRateThreshold.alertHistory")}
                    </CardTitle>
                    <CardDescription>
                      {t("mqttNgRateThreshold.totalAlerts", { count: alertHistoryData?.total || 0 })}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchHistory()}>
                    <RefreshCw className="w-4 h-4 mr-2" /> {t("mqttNgRateThreshold.refresh")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!alertHistoryData?.data?.length ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Bell className="w-12 h-12 mx-auto mb-4 opacity-30" />
                    <p>{t("mqttNgRateThreshold.noAlerts")}</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("mqttNgRateThreshold.colTime")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colSeverity")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colPoint")}</TableHead>
                        <TableHead>NG Rate</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colThreshold")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colSample")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colContent")}</TableHead>
                        <TableHead>{t("mqttNgRateThreshold.colChannel")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colStatus")}</TableHead>
                        <TableHead className="text-center">{t("mqttNgRateThreshold.colActions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alertHistoryData.data.map((alert: any) => (
                        <TableRow key={alert.id} className={!alert.isResolved ? "bg-destructive/5" : ""}>
                          <TableCell className="text-sm">
                            {new Date(alert.triggeredAt).toLocaleString("vi-VN")}
                          </TableCell>
                          <TableCell>{getSeverityBadge(alert.severity)}</TableCell>
                          <TableCell>
                            {alert.pointCode ? (
                              <span title={alert.pointName}>
                                <Badge variant="outline">{alert.pointCode}</Badge>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{t("mqttNgRateThreshold.overall")}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={alert.severity === "critical" ? "text-destructive font-bold" : "text-warning font-semibold"}>
                              {Number(alert.currentNgRate).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>{Number(alert.thresholdValue).toFixed(1)}%</TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {alert.ngCount}/{alert.totalInspections}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[250px] truncate text-sm" title={alert.message}>
                            {alert.message}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {alert.sentMqttLocal && <Badge variant="outline" className="text-xs">L</Badge>}
                              {alert.sentMqttExternal && <Badge variant="outline" className="text-xs">E</Badge>}
                              {alert.sentFcm && <Badge variant="outline" className="text-xs">F</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {alert.isResolved ? (
                              <Badge className="bg-success/20 text-success border-success/30">
                                <CheckCircle className="w-3 h-3 mr-1" /> {t("mqttNgRateThreshold.resolved")}
                              </Badge>
                            ) : (
                              <Badge className="bg-warning/20 text-warning border-warning/30">
                                <Clock className="w-3 h-3 mr-1" /> {t("mqttNgRateThreshold.unresolved")}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {!alert.isResolved && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setResolveAlertId(alert.id)}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" /> {t("mqttNgRateThreshold.resolve")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ TAB: NG Rate hiện tại ═══ */}
          {filterStationId && (
            <TabsContent value="realtime">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        {t("mqttNgRateThreshold.realtimeTitle")}
                      </CardTitle>
                      <CardDescription>
                        {t("mqttNgRateThreshold.realtimeDesc")}
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => refetchNgRates()}>
                      <RefreshCw className="w-4 h-4 mr-2" /> {t("mqttNgRateThreshold.refresh")}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {!currentNgRates?.length ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
                      <p>{t("mqttNgRateThreshold.noData")}</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Overall stats */}
                      {(() => {
                        const totalInspections = currentNgRates.reduce((s: number, p: any) => s + p.totalInspections, 0);
                        const totalNg = currentNgRates.reduce((s: number, p: any) => s + p.ngCount, 0);
                        const overallRate = totalInspections > 0 ? (totalNg / totalInspections * 100) : 0;
                        return (
                          <div className="p-4 rounded-lg border bg-muted/30">
                            <div className="flex items-center gap-4">
                              <TrendingUp className="w-5 h-5 text-info" />
                              <div>
                                <span className="font-semibold">{t("mqttNgRateThreshold.stationOverall")}</span>{" "}
                                <span className="text-lg font-bold">
                                  {overallRate.toFixed(1)}%
                                </span>
                                <span className="text-sm text-muted-foreground ml-2">
                                  ({totalNg}/{totalInspections} NG)
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Per-point table */}
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("mqttNgRateThreshold.colPointCode")}</TableHead>
                            <TableHead>{t("mqttNgRateThreshold.colPointName")}</TableHead>
                            <TableHead className="text-center">{t("mqttNgRateThreshold.colTotalInspections")}</TableHead>
                            <TableHead className="text-center">{t("mqttNgRateThreshold.colNgCount")}</TableHead>
                            <TableHead className="text-center">NG Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentNgRates.map((point: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell>
                                <Badge variant="outline">{point.pointCode}</Badge>
                              </TableCell>
                              <TableCell>{point.pointName}</TableCell>
                              <TableCell className="text-center">{point.totalInspections}</TableCell>
                              <TableCell className="text-center">{point.ngCount}</TableCell>
                              <TableCell className="text-center">
                                <span className={`font-bold ${Number(point.ngRate) >= 10 ? "text-destructive" : Number(point.ngRate) >= 5 ? "text-warning" : "text-success"}`}>
                                  {Number(point.ngRate).toFixed(1)}%
                                </span>
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
          )}
        </Tabs>

        {/* ═══ Dialog: Tạo/Sửa ngưỡng ═══ */}
        <Dialog open={isCreateDialogOpen} onOpenChange={(open) => { if (!open) { setIsCreateDialogOpen(false); resetForm(); } }}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gauge className="w-5 h-5" />
                {editingId ? t("mqttNgRateThreshold.editTitle") : t("mqttNgRateThreshold.createTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("mqttNgRateThreshold.dialogDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Name */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.nameLabel")}</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t("mqttNgRateThreshold.namePlaceholder")}
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.descriptionLabel")}</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t("mqttNgRateThreshold.descriptionPlaceholder")}
                  rows={2}
                />
              </div>

              {/* Scope selectors */}
              <div className="grid grid-cols-2 gap-4">
                {/* Station (required) */}
                <div className="space-y-2">
                  <Label>{t("mqttNgRateThreshold.stationLabel")}</Label>
                  <Select
                    value={formData.stationId?.toString() || ""}
                    onValueChange={(v) => setFormData({ ...formData, stationId: Number(v), machineId: null })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mqttNgRateThreshold.stationPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {stations?.map((s: any) => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Machine (optional) */}
                <div className="space-y-2">
                  <Label>{t("mqttNgRateThreshold.machineLabel")}</Label>
                  <Select
                    value={formData.machineId?.toString() || "none"}
                    onValueChange={(v) => setFormData({ ...formData, machineId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mqttNgRateThreshold.allMachines")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("mqttNgRateThreshold.allMachinesInStation")}</SelectItem>
                      {filteredMachines?.map((m: any) => (
                        <SelectItem key={m.id} value={m.id.toString()}>{m.name || m.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Measurement Point (optional) */}
                <div className="space-y-2">
                  <Label>{t("mqttNgRateThreshold.pointLabel")}</Label>
                  <Select
                    value={formData.measurementPointId?.toString() || "none"}
                    onValueChange={(v) => setFormData({ ...formData, measurementPointId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mqttNgRateThreshold.overall")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("mqttNgRateThreshold.overallAllPoints")}</SelectItem>
                      {measurementPoints?.map((mp: any) => (
                        <SelectItem key={mp.id} value={mp.id.toString()}>
                          {mp.code} - {mp.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Product Model (optional) */}
                <div className="space-y-2">
                  <Label>{t("mqttNgRateThreshold.productModelLabel")}</Label>
                  <Select
                    value={formData.productModelId?.toString() || "none"}
                    onValueChange={(v) => setFormData({ ...formData, productModelId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("mqttNgRateThreshold.allModels")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("mqttNgRateThreshold.allModels")}</SelectItem>
                      {productModels?.map((pm: any) => (
                        <SelectItem key={pm.id} value={pm.id.toString()}>{pm.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* AI Threshold Advisor — only when editing an existing record (needs an id) */}
              {editingId ? (
                <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground">
                    {t("mqttNgRateThreshold.aiAdvisorHint", "Để AI tính ngưỡng cảnh báo/nghiêm trọng từ dữ liệu NG gần đây")}
                  </span>
                  <AIThresholdSuggestButton
                    target={{ kind: "ng", ngThresholdId: editingId }}
                    onApplied={() => { refetchThresholds(); setIsCreateDialogOpen(false); resetForm(); }}
                  />
                </div>
              ) : null}

              {/* Thresholds */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-warning" /> {t("mqttNgRateThreshold.warningThresholdLabel")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={formData.warningThreshold}
                    onChange={(e) => setFormData({ ...formData, warningThreshold: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.warningThresholdHelp")}</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <XCircle className="w-3 h-3 text-destructive" /> {t("mqttNgRateThreshold.criticalThresholdLabel")}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={formData.criticalThreshold}
                    onChange={(e) => setFormData({ ...formData, criticalThreshold: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.criticalThresholdHelp")}</p>
                </div>
              </div>

              {/* Min sample & cooldown */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("mqttNgRateThreshold.minSampleLabel")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={formData.minSampleSize}
                    onChange={(e) => setFormData({ ...formData, minSampleSize: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.minSampleHelp")}</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {t("mqttNgRateThreshold.cooldownLabel")}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={formData.cooldownMinutes}
                    onChange={(e) => setFormData({ ...formData, cooldownMinutes: Number(e.target.value) })}
                  />
                  <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.cooldownHelp")}</p>
                </div>
              </div>

              {/* Channels */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t("mqttNgRateThreshold.channelLabel")}</Label>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="text-sm font-medium">MQTT Local</p>
                      <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.mqttLocalDesc")}</p>
                    </div>
                    <Switch
                      checked={formData.sendMqttLocal}
                      onCheckedChange={(v) => setFormData({ ...formData, sendMqttLocal: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="text-sm font-medium">MQTT External</p>
                      <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.mqttExternalDesc")}</p>
                    </div>
                    <Switch
                      checked={formData.sendMqttExternal}
                      onCheckedChange={(v) => setFormData({ ...formData, sendMqttExternal: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <p className="text-sm font-medium">Push (FCM)</p>
                      <p className="text-xs text-muted-foreground">{t("mqttNgRateThreshold.pushFcmDesc")}</p>
                    </div>
                    <Switch
                      checked={formData.sendFcm}
                      onCheckedChange={(v) => setFormData({ ...formData, sendFcm: v })}
                    />
                  </div>
                </div>
              </div>

              {/* Enabled */}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div>
                  <p className="font-medium">{t("mqttNgRateThreshold.enableNow")}</p>
                  <p className="text-sm text-muted-foreground">{t("mqttNgRateThreshold.enableNowDesc")}</p>
                </div>
                <Switch
                  checked={formData.isEnabled}
                  onCheckedChange={(v) => setFormData({ ...formData, isEnabled: v })}
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setIsCreateDialogOpen(false); resetForm(); }}>
                {t("mqttNgRateThreshold.cancel")}
              </Button>
              <Button onClick={handleSubmit} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingId ? t("mqttNgRateThreshold.update") : t("mqttNgRateThreshold.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ═══ Dialog: Xử lý cảnh báo ═══ */}
        <Dialog open={!!resolveAlertId} onOpenChange={(open) => { if (!open) { setResolveAlertId(null); setResolutionNote(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("mqttNgRateThreshold.resolveTitle")}</DialogTitle>
              <DialogDescription>{t("mqttNgRateThreshold.resolveDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.resolveNoteLabel")}</Label>
                <Textarea
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder={t("mqttNgRateThreshold.resolveNotePlaceholder")}
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setResolveAlertId(null); setResolutionNote(""); }}>
                {t("mqttNgRateThreshold.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (resolveAlertId) {
                    resolveAlertMutation.mutate({
                      id: resolveAlertId,
                      resolutionNote: resolutionNote || undefined,
                    });
                  }
                }}
                disabled={resolveAlertMutation.isPending}
              >
                <CheckCircle className="w-4 h-4 mr-2" /> {t("mqttNgRateThreshold.confirmResolve")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ══════════════ Test NG Rate Alert ══════════════ */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-warning" />
              {t("mqttNgRateThreshold.testAlertTitle")}
            </CardTitle>
            <CardDescription>{t("mqttNgRateThreshold.testAlertDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Station Select */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.station")}</Label>
                <Select
                  value={testStationId?.toString() || ""}
                  onValueChange={(v) => setTestStationId(Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("mqttNgRateThreshold.selectStation")} />
                  </SelectTrigger>
                  <SelectContent>
                    {stations?.map((s: any) => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Severity Select */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.testSeverity")}</Label>
                <Select
                  value={testSeverity}
                  onValueChange={(v) => setTestSeverity(v as "warning" | "critical")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">
                      🟡 Warning
                    </SelectItem>
                    <SelectItem value="critical">
                      🔴 Critical
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* External MQTT Toggle */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.testSendExternal")}</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={testSendExternal} onCheckedChange={setTestSendExternal} />
                  <span className="text-sm text-muted-foreground">
                    {testSendExternal ? t("mqttNgRateThreshold.on") : t("mqttNgRateThreshold.off")}
                  </span>
                </div>
              </div>

              {/* FCM Toggle */}
              <div className="space-y-2">
                <Label>{t("mqttNgRateThreshold.testSendFcm")}</Label>
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={testSendFcm} onCheckedChange={setTestSendFcm} />
                  <span className="text-sm text-muted-foreground">
                    {testSendFcm ? t("mqttNgRateThreshold.on") : t("mqttNgRateThreshold.off")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <Button
                onClick={() => {
                  if (!testStationId) {
                    toast.error(t("mqttNgRateThreshold.selectStationFirst"));
                    return;
                  }
                  setTestResult(null);
                  sendTestAlertMutation.mutate({
                    stationId: testStationId,
                    severity: testSeverity,
                    sendToExternal: testSendExternal,
                    sendFcm: testSendFcm,
                  });
                }}
                disabled={sendTestAlertMutation.isPending || !testStationId}
                className="bg-warning hover:bg-warning/90"
              >
                {sendTestAlertMutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> {t("mqttNgRateThreshold.sending")}</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> {t("mqttNgRateThreshold.sendTestAlert")}</>
                )}
              </Button>

              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Radio className="w-3 h-3" />
                {t("mqttNgRateThreshold.testAlertInfo")}
              </div>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`rounded-lg border p-4 ${testResult.success ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {testResult.success ? (
                    <CheckCircle className="w-4 h-4 text-success" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive" />
                  )}
                  <span className={`text-sm font-medium ${testResult.success ? 'text-success' : 'text-destructive'}`}>
                    {testResult.message}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Local MQTT: {testResult.sentLocal ? '✅' : '❌'}</span>
                  <span>External MQTT: {testResult.sentExternal ? '✅' : '❌'}</span>
                  <span>FCM: {testResult.sentFcm ? '✅' : '❌'}</span>
                </div>
                {testResult.payload && (
                  <details className="mt-2">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      {t("mqttNgRateThreshold.viewPayload")}
                    </summary>
                    <pre className="mt-2 text-xs bg-black/50 p-3 rounded overflow-auto max-h-[300px]">
                      {JSON.stringify(testResult.payload, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export default function MqttNgRateThreshold() {
  return (
    <DashboardLayout>
      <MqttNgRateThresholdContent />
    </DashboardLayout>
  );
}
