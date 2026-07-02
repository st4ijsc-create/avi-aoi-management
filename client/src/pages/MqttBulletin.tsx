/**
 * MQTT Bulletin Page - Quản lý bản tin tổng hợp OK/NG/NTF theo chu kỳ
 * 
 * Features:
 * - Cấu hình bulletin cho từng station (chu kỳ, giờ gửi, bao gồm ảnh...)
 * - Xem lịch sử bulletin đã gửi
 * - Trigger gửi thủ công
 * - Dashboard tổng quan
 */

import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Newspaper,
  Settings,
  History,
  BarChart3,
  Play,
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Image,
  Send,
  Eye,
  TrendingUp,
  AlertTriangle,
  Search,
  ListChecks,
  FlaskConical,
  Bell,
  Wifi,
} from "lucide-react";
import { useTranslation } from 'react-i18next';

export default function MqttBulletin() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedBulletin, setSelectedBulletin] = useState<any>(null);
  const [historyStation, setHistoryStation] = useState<number | undefined>();
  const [historyPage, setHistoryPage] = useState(0);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testStationId, setTestStationId] = useState<number>(0);
  const [testSendExternal, setTestSendExternal] = useState(true);
  const [testSendFcm, setTestSendFcm] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // NG Alert Settings state
  const [showNgAlertDialog, setShowNgAlertDialog] = useState(false);
  const [ngAlertDialogMode, setNgAlertDialogMode] = useState<"add" | "edit">("add");
  const [editingNgAlertStationId, setEditingNgAlertStationId] = useState<number | null>(null);
  const [ngFormStationId, setNgFormStationId] = useState<number>(0);
  const [ngFormEnabled, setNgFormEnabled] = useState(true);
  const [ngFormTopicPattern, setNgFormTopicPattern] = useState("avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors");
  const [ngFormExternalTopicPattern, setNgFormExternalTopicPattern] = useState("");
  const [ngFormSendToLocal, setNgFormSendToLocal] = useState(true);
  const [ngFormSendToExternal, setNgFormSendToExternal] = useState(true);
  const [ngFormSendFcm, setNgFormSendFcm] = useState(true);
  const [ngFormIncludeImages, setNgFormIncludeImages] = useState(true);
  const [ngFormIncludeRefImages, setNgFormIncludeRefImages] = useState(true);
  const [ngFormIncludePointImages, setNgFormIncludePointImages] = useState(true);
  const [ngFormIncludeOverallResult, setNgFormIncludeOverallResult] = useState(true);
  const [ngFormQos, setNgFormQos] = useState(1);
  const [ngFormRetain, setNgFormRetain] = useState(false);
  const [ngFormCooldownSeconds, setNgFormCooldownSeconds] = useState(0);

  // Dialog mode: "add" for multi-station, "edit" for single station
  const [dialogMode, setDialogMode] = useState<"add" | "edit">("add");
  const [editingStationId, setEditingStationId] = useState<number | null>(null);

  // Multi-station selection state (for add mode)
  const [selectedStationIds, setSelectedStationIds] = useState<number[]>([]);
  const [stationSearchQuery, setStationSearchQuery] = useState("");

  // Form state for add/edit
  const [formStation, setFormStation] = useState<number>(0);
  const [formInterval, setFormInterval] = useState(60);
  const [formStartHour, setFormStartHour] = useState(6);
  const [formEndHour, setFormEndHour] = useState(22);
  const [formIncludeImages, setFormIncludeImages] = useState(true);
  const [formMaxFailPoints, setFormMaxFailPoints] = useState(20);
  const [formSendExternal, setFormSendExternal] = useState(true);
  const [formSendFcm, setFormSendFcm] = useState(true);

  // Queries
  const { data: dashboardStats, isLoading: loadingStats, refetch: refetchStats } =
    trpc.mqttBulletin.getDashboardStats.useQuery({ days: 7 });

  const { data: settings, isLoading: loadingSettings, refetch: refetchSettings } =
    trpc.mqttBulletin.listSettings.useQuery({});

  const { data: historyData, isLoading: loadingHistory, refetch: refetchHistory } =
    trpc.mqttBulletin.getHistory.useQuery({
      stationId: historyStation,
      limit: 20,
      offset: historyPage * 20,
    });

  const { data: schedulerStatus } = trpc.mqttBulletin.getSchedulerStatus.useQuery();

  // Get stations list from existing station router
  const { data: stationsData } = trpc.station.list.useQuery();

  // NG Alert Settings queries & mutations
  const { data: ngAlertSettings, isLoading: loadingNgAlert, refetch: refetchNgAlert } =
    trpc.mqttNgAlertSettings.listSettings.useQuery({});

  const ngAlertUpsertMutation = trpc.mqttNgAlertSettings.upsertSetting.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.ngAlert.settingSaved', 'Đã lưu cấu hình NG Alert'));
      refetchNgAlert();
      setShowNgAlertDialog(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const ngAlertToggleMutation = trpc.mqttNgAlertSettings.toggleEnabled.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.ngAlert.statusUpdated', 'Đã cập nhật trạng thái'));
      refetchNgAlert();
    },
    onError: (err) => toast.error(err.message),
  });

  const ngAlertDeleteMutation = trpc.mqttNgAlertSettings.deleteSetting.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.ngAlert.deleted', 'Đã xóa cấu hình'));
      refetchNgAlert();
    },
    onError: (err) => toast.error(err.message),
  });

  // Mutations
  const upsertMutation = trpc.mqttBulletin.upsertSetting.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.bulletinPage.settingsSaved'));
      refetchSettings();
      setShowAddDialog(false);
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message })),
  });

  const quickSetupMutation = trpc.mqttBulletin.quickSetup.useMutation({
    onSuccess: (result) => {
      toast.success(t('mqtt.bulletinPage.stationsConfigured', { total: result.total, created: result.created, updated: result.updated }));
      refetchSettings();
      setShowAddDialog(false);
      setSelectedStationIds([]);
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message })),
  });

  const toggleMutation = trpc.mqttBulletin.toggleEnabled.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.bulletinPage.statusUpdated'));
      refetchSettings();
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message })),
  });

  const deleteMutation = trpc.mqttBulletin.deleteSetting.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.bulletinPage.settingsDeleted'));
      refetchSettings();
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message })),
  });

  const triggerMutation = trpc.mqttBulletin.triggerNow.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.bulletinPage.bulletinSent'));
      refetchHistory();
      refetchStats();
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.errorMsg', { message: err.message })),
  });

  const testBulletinMutation = trpc.mqttBulletin.sendTestBulletin.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      refetchHistory();
      refetchStats();
    },
    onError: (err) => toast.error(t('mqtt.bulletinPage.testSendError', { message: err.message })),
  });

  const handleSendTest = () => {
    if (!testStationId) {
      toast.error(t('mqtt.bulletinPage.pleaseSelectStation'));
      return;
    }
    setTestResult(null);
    testBulletinMutation.mutate({
      stationId: testStationId,
      sendToExternal: testSendExternal,
      sendFcm: testSendFcm,
    });
  };

  const handleSave = () => {
    if (dialogMode === "edit") {
      // Single station edit
      if (!editingStationId) {
        toast.error(t('mqtt.bulletinPage.stationNotFound'));
        return;
      }
      upsertMutation.mutate({
        stationId: editingStationId,
        enabled: true,
        intervalMinutes: formInterval,
        startHour: formStartHour,
        endHour: formEndHour,
        includeImages: formIncludeImages,
        maxFailPoints: formMaxFailPoints,
        sendToExternal: formSendExternal,
        sendFcm: formSendFcm,
      });
    } else {
      // Multi-station add
      if (selectedStationIds.length === 0) {
        toast.error(t('mqtt.bulletinPage.selectAtLeast1'));
        return;
      }
      quickSetupMutation.mutate({
        stationIds: selectedStationIds,
        intervalMinutes: formInterval,
        startHour: formStartHour,
        endHour: formEndHour,
        includeImages: formIncludeImages,
        maxFailPoints: formMaxFailPoints,
        sendToExternal: formSendExternal,
        sendFcm: formSendFcm,
      });
    }
  };

  const openEditDialog = (setting: any) => {
    setDialogMode("edit");
    setEditingStationId(setting.stationId);
    setFormStation(setting.stationId);
    setFormInterval(setting.intervalMinutes);
    setFormStartHour(setting.startHour);
    setFormEndHour(setting.endHour);
    setFormIncludeImages(setting.includeImages);
    setFormMaxFailPoints(setting.maxFailPoints);
    setFormSendExternal(setting.sendToExternal);
    setFormSendFcm(setting.sendFcm);
    setShowAddDialog(true);
  };

  const openNewDialog = () => {
    setDialogMode("add");
    setEditingStationId(null);
    setSelectedStationIds([]);
    setStationSearchQuery("");
    setFormStation(0);
    setFormInterval(60);
    setFormStartHour(6);
    setFormEndHour(22);
    setFormIncludeImages(true);
    setFormMaxFailPoints(20);
    setFormSendExternal(true);
    setFormSendFcm(true);
    setShowAddDialog(true);
  };

  // NG Alert Settings handlers
  const handleNgAlertSave = () => {
    const stationId = ngAlertDialogMode === "edit" ? editingNgAlertStationId : ngFormStationId;
    if (!stationId) {
      toast.error(t('mqtt.bulletinPage.stationNotFound'));
      return;
    }
    ngAlertUpsertMutation.mutate({
      stationId,
      enabled: ngFormEnabled,
      topicPattern: ngFormTopicPattern,
      externalTopicPattern: ngFormExternalTopicPattern || undefined,
      sendToLocal: ngFormSendToLocal,
      sendToExternal: ngFormSendToExternal,
      sendFcm: ngFormSendFcm,
      includeImages: ngFormIncludeImages,
      includeReferenceImages: ngFormIncludeRefImages,
      includePointImages: ngFormIncludePointImages,
      includeOverallResult: ngFormIncludeOverallResult,
      qos: ngFormQos,
      retain: ngFormRetain,
      cooldownSeconds: ngFormCooldownSeconds,
    });
  };

  const openNgAlertEditDialog = (setting: any) => {
    setNgAlertDialogMode("edit");
    setEditingNgAlertStationId(setting.stationId);
    setNgFormStationId(setting.stationId);
    setNgFormEnabled(setting.enabled);
    setNgFormTopicPattern(setting.topicPattern || "avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors");
    setNgFormExternalTopicPattern(setting.externalTopicPattern || "");
    setNgFormSendToLocal(setting.sendToLocal ?? true);
    setNgFormSendToExternal(setting.sendToExternal ?? true);
    setNgFormSendFcm(setting.sendFcm ?? true);
    setNgFormIncludeImages(setting.includeImages ?? true);
    setNgFormIncludeRefImages(setting.includeReferenceImages ?? true);
    setNgFormIncludePointImages(setting.includePointImages ?? true);
    setNgFormIncludeOverallResult(setting.includeOverallResult ?? true);
    setNgFormQos(setting.qos ?? 1);
    setNgFormRetain(setting.retain ?? false);
    setNgFormCooldownSeconds(setting.cooldownSeconds ?? 0);
    setShowNgAlertDialog(true);
  };

  const openNgAlertNewDialog = () => {
    setNgAlertDialogMode("add");
    setEditingNgAlertStationId(null);
    setNgFormStationId(0);
    setNgFormEnabled(true);
    setNgFormTopicPattern("avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors");
    setNgFormExternalTopicPattern("");
    setNgFormSendToLocal(true);
    setNgFormSendToExternal(true);
    setNgFormSendFcm(true);
    setNgFormIncludeImages(true);
    setNgFormIncludeRefImages(true);
    setNgFormIncludePointImages(true);
    setNgFormIncludeOverallResult(true);
    setNgFormQos(1);
    setNgFormRetain(false);
    setNgFormCooldownSeconds(0);
    setShowNgAlertDialog(true);
  };

  // Compute stations already configured for NG Alert
  const configuredNgAlertStationIds = useMemo(
    () => new Set((ngAlertSettings || []).map((s: any) => s.stationId)),
    [ngAlertSettings]
  );

  const availableNgAlertStations = useMemo(() => {
    if (!stationsData) return [];
    return stationsData.filter((st: any) => !configuredNgAlertStationIds.has(st.id));
  }, [stationsData, configuredNgAlertStationIds]);

  // Compute available stations (exclude already configured in add mode)
  const configuredStationIds = useMemo(
    () => new Set((settings || []).map((s: any) => s.stationId)),
    [settings]
  );

  const availableStations = useMemo(() => {
    if (!stationsData) return [];
    return stationsData
      .filter((st: any) => !configuredStationIds.has(st.id))
      .filter((st: any) =>
        !stationSearchQuery ||
        st.name?.toLowerCase().includes(stationSearchQuery.toLowerCase()) ||
        st.id.toString().includes(stationSearchQuery)
      );
  }, [stationsData, configuredStationIds, stationSearchQuery]);

  const toggleStationSelection = (stationId: number) => {
    setSelectedStationIds((prev) =>
      prev.includes(stationId)
        ? prev.filter((id) => id !== stationId)
        : [...prev, stationId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedStationIds.length === availableStations.length) {
      setSelectedStationIds([]);
    } else {
      setSelectedStationIds(availableStations.map((st: any) => st.id));
    }
  };

  const formatDate = (d: string | Date | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Newspaper className="h-6 w-6" />}
          title={t('mqtt.bulletinPage.title')}
          description={t('mqtt.bulletinPage.description')}
          actions={
            <>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 border-warning text-warning hover:bg-warning/10"
              onClick={() => {
                setTestStationId(0);
                setTestSendExternal(true);
                setTestSendFcm(false);
                setTestResult(null);
                setShowTestDialog(true);
              }}
            >
              <FlaskConical className="h-4 w-4" />
              {t('mqtt.bulletinPage.sendTestBulletin')}
            </Button>
            <Badge variant={schedulerStatus?.isRunning ? "default" : "secondary"}>
              {schedulerStatus?.isRunning ? t('mqtt.bulletinPage.running') : t('mqtt.bulletinPage.off')}
            </Badge>
            <Badge variant="outline">
              {schedulerStatus?.activeIntervals ?? 0} {t('mqtt.bulletinPage.stationSending')}
            </Badge>
            </>
          }
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t('mqtt.bulletinPage.overview')}
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t('mqtt.bulletinPage.configuration')}
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              {t('mqtt.bulletinPage.historyTab')}
            </TabsTrigger>
            <TabsTrigger value="ngAlertSettings" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              {t('mqtt.ngAlert.tabTitle', 'NG Alert')}
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('mqtt.bulletinPage.bulletinCount7d')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{dashboardStats?.summary.totalBulletins ?? 0}</div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Send className="h-3 w-3" />
                    {dashboardStats?.summary.deliveredCount ?? 0} {t('mqtt.bulletinPage.successful')}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('mqtt.bulletinPage.totalInspections')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-info">
                    {(dashboardStats?.summary.totalInspections ?? 0).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-success mt-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {(dashboardStats?.summary.totalOK ?? 0).toLocaleString()} OK
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t('mqtt.bulletinPage.totalNG')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">
                    {(dashboardStats?.summary.totalNG ?? 0).toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-warning mt-1">
                    <AlertTriangle className="h-3 w-3" />
                    {(dashboardStats?.summary.totalNTF ?? 0).toLocaleString()} NTF
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Yield Rate TB</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-success">
                    {dashboardStats?.summary.avgYieldRate ?? 0}%
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <TrendingUp className="h-3 w-3" />
                    {dashboardStats?.summary.activeStations ?? 0} station
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Station breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('mqtt.bulletinPage.stationStats')}</CardTitle>
                <CardDescription>{t('mqtt.bulletinPage.summary7d')}</CardDescription>
              </CardHeader>
              <CardContent>
                {!dashboardStats?.byStation?.length ? (
                  <p className="text-muted-foreground text-center py-8">
                    {t('mqtt.bulletinPage.noDataHint')}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Station</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.bulletinCount')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.avgNGPerBulletin')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.lastSent')}</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboardStats.byStation.map((s: any) => (
                        <TableRow key={s.stationId}>
                          <TableCell className="font-medium">{s.stationName}</TableCell>
                          <TableCell className="text-center">{s.bulletinCount}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={s.avgNG > 5 ? "destructive" : "secondary"}>
                              {s.avgNG}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">
                            {formatDate(s.lastSent)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setHistoryStation(s.stationId);
                                setActiveTab("history");
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('mqtt.bulletinPage.settingsTitle')}</h3>
              <Button onClick={openNewDialog} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t('mqtt.bulletinPage.addStations')}
              </Button>
            </div>

            <Card>
              <CardContent className="pt-6">
                {loadingSettings ? (
                  <p className="text-center py-8 text-muted-foreground">{t('common.loading')}</p>
                ) : !settings?.length ? (
                  <div className="text-center py-8">
                    <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">{t('mqtt.bulletinPage.noSettings')}</p>
                    <Button variant="outline" className="mt-3" onClick={openNewDialog}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t('mqtt.bulletinPage.addFirstConfig')}
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Station</TableHead>
                        <TableHead className="text-center">{t('common.status')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.cycle')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.activeHours')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.image')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.bulletinPage.lastSent')}</TableHead>
                        <TableHead className="text-center">{t('common.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settings.map((s: any) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.stationName}</TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={s.enabled}
                              onCheckedChange={(checked) =>
                                toggleMutation.mutate({ stationId: s.stationId, enabled: checked })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">{s.intervalMinutes} {t('mqtt.bulletinPage.minutes')}</Badge>
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {s.startHour}:00 - {s.endHour}:00
                          </TableCell>
                          <TableCell className="text-center">
                            {s.includeImages ? (
                              <Image className="h-4 w-4 text-success mx-auto" />
                            ) : (
                              <span className="text-muted-foreground text-xs">{t('mqtt.bulletinPage.off')}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">
                            {formatDate(s.lastSentAt)}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('mqtt.bulletinPage.sendNow')}
                                onClick={() => triggerMutation.mutate({ stationId: s.stationId })}
                                disabled={triggerMutation.isPending}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.edit')}
                                onClick={() => openEditDialog(s)}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.delete')}
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => {
                                  if (confirm(t('mqtt.bulletinPage.confirmDeleteConfig'))) {
                                    deleteMutation.mutate({ stationId: s.stationId });
                                  }
                                }}
                              >
                                <XCircle className="h-4 w-4" />
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

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t('mqtt.bulletinPage.bulletinHistory')}</h3>
              <div className="flex items-center gap-2">
                <Select
                  value={historyStation?.toString() || "all"}
                  onValueChange={(v) => {
                    setHistoryStation(v === "all" ? undefined : parseInt(v));
                    setHistoryPage(0);
                  }}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder={t('mqtt.bulletinPage.allStations')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('mqtt.bulletinPage.allStations')}</SelectItem>
                    {stationsData?.map((st: any) => (
                      <SelectItem key={st.id} value={st.id.toString()}>
                        {st.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={() => refetchHistory()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Card>
              <CardContent className="pt-6">
                {loadingHistory ? (
                  <p className="text-center py-8 text-muted-foreground">{t('common.loading')}</p>
                ) : !historyData?.items?.length ? (
                  <p className="text-center py-8 text-muted-foreground">
                    {t('mqtt.bulletinPage.noHistory')}
                  </p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Station</TableHead>
                          <TableHead className="text-center">{t('mqtt.bulletinPage.timestamp')}</TableHead>
                          <TableHead className="text-center">TOTAL</TableHead>
                          <TableHead className="text-center">OK</TableHead>
                          <TableHead className="text-center">NG</TableHead>
                          <TableHead className="text-center">NTF</TableHead>
                          <TableHead className="text-center">Yield</TableHead>
                          <TableHead className="text-center">Fail Points</TableHead>
                          <TableHead className="text-center">{t('common.status')}</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {historyData.items.map((b: any) => (
                          <TableRow key={b.id}>
                            <TableCell className="font-medium">{b.stationName}</TableCell>
                            <TableCell className="text-center text-sm">
                              {formatDate(b.createdAt)}
                            </TableCell>
                            <TableCell className="text-center font-semibold">
                              {b.totalCount}
                            </TableCell>
                            <TableCell className="text-center text-success">
                              {b.okCount}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant={b.ngCount > 0 ? "destructive" : "secondary"}>
                                {b.ngCount}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center text-warning">
                              {b.ntfCount}
                            </TableCell>
                            <TableCell className="text-center">
                              {b.yieldRate ? `${b.yieldRate}%` : "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline">
                                {(b.failPoints as any[])?.length ?? 0} {t('mqtt.bulletinPage.points')}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center">
                              {b.deliveryStatus === "DELIVERED" ? (
                                <CheckCircle2 className="h-4 w-4 text-success mx-auto" />
                              ) : b.deliveryStatus === "FAILED" ? (
                                <XCircle className="h-4 w-4 text-destructive mx-auto" />
                              ) : (
                                <Clock className="h-4 w-4 text-warning mx-auto" />
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedBulletin(b);
                                  setShowDetailDialog(true);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* Pagination */}
                    <div className="flex items-center justify-between mt-4">
                      <span className="text-sm text-muted-foreground">
                        {t('mqtt.bulletinPage.showing')} {historyData.items.length} / {historyData.total} {t('mqtt.bulletinPage.bulletins')}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={historyPage === 0}
                          onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                        >
                          {t('common.previous')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={(historyPage + 1) * 20 >= (historyData.total || 0)}
                          onClick={() => setHistoryPage((p) => p + 1)}
                        >
                          {t('common.next')}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* NG Alert Settings Tab */}
          <TabsContent value="ngAlertSettings" className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Bell className="h-5 w-5 text-destructive" />
                {t('mqtt.ngAlert.configTitle', 'Cấu hình NG Alert theo Station')}
              </h3>
              <Button onClick={openNgAlertNewDialog} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                {t('mqtt.ngAlert.addConfig', 'Thêm cấu hình')}
              </Button>
            </div>

            <Card>
              <CardContent className="pt-6">
                {loadingNgAlert ? (
                  <p className="text-center py-8 text-muted-foreground">{t('common.loading')}</p>
                ) : !ngAlertSettings?.length ? (
                  <div className="text-center py-8">
                    <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">{t('mqtt.ngAlert.noSettings', 'Chưa có cấu hình NG Alert nào')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('mqtt.ngAlert.noSettingsDesc', 'Thêm cấu hình để tùy chỉnh topic, kênh gửi và cooldown cho từng trạm')}
                    </p>
                    <Button variant="outline" className="mt-3" onClick={openNgAlertNewDialog}>
                      <Plus className="h-4 w-4 mr-2" />
                      {t('mqtt.ngAlert.addFirstConfig', 'Thêm cấu hình đầu tiên')}
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Station</TableHead>
                        <TableHead className="text-center">{t('common.status')}</TableHead>
                        <TableHead>{t('mqtt.ngAlert.topic', 'Topic')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.ngAlert.channels', 'Kênh gửi')}</TableHead>
                        <TableHead className="text-center">QoS</TableHead>
                        <TableHead className="text-center">{t('mqtt.ngAlert.cooldown', 'Cooldown')}</TableHead>
                        <TableHead className="text-center">{t('mqtt.ngAlert.lastTriggered', 'Lần cuối')}</TableHead>
                        <TableHead className="text-center">{t('common.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ngAlertSettings.map((s: any) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.stationName}</TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={s.enabled}
                              onCheckedChange={(checked) =>
                                ngAlertToggleMutation.mutate({ stationId: s.stationId, enabled: checked })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">
                              {s.topicPattern}
                            </code>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              {s.sendToLocal && <Badge variant="outline" className="text-xs">Local</Badge>}
                              {s.sendToExternal && <Badge variant="outline" className="text-xs">External</Badge>}
                              {s.sendFcm && <Badge variant="outline" className="text-xs">FCM</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{s.qos}</Badge>
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {s.cooldownSeconds > 0 ? `${s.cooldownSeconds}s` : '—'}
                          </TableCell>
                          <TableCell className="text-center text-sm text-muted-foreground">
                            {formatDate(s.lastTriggeredAt)}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.edit')}
                                onClick={() => openNgAlertEditDialog(s)}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('common.delete')}
                                className="text-destructive hover:text-destructive/80"
                                onClick={() => {
                                  if (confirm(t('mqtt.ngAlert.confirmDelete', 'Xóa cấu hình NG Alert cho station này?'))) {
                                    ngAlertDeleteMutation.mutate({ stationId: s.stationId });
                                  }
                                }}
                              >
                                <XCircle className="h-4 w-4" />
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
        </Tabs>

        {/* Add/Edit Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "edit"
                  ? t('mqtt.bulletinPage.editConfig')
                  : t('mqtt.bulletinPage.addConfigMultiStation')}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === "edit"
                  ? t('mqtt.bulletinPage.updateConfigDesc')
                  : t('mqtt.bulletinPage.multiStationConfigDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Station selection */}
              {dialogMode === "edit" ? (
                <div className="space-y-2">
                  <Label>Station</Label>
                  <div className="px-3 py-2 bg-muted rounded-md text-sm font-medium">
                    {stationsData?.find((st: any) => st.id === editingStationId)?.name ||
                      `Station ${editingStationId}`}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4" />
                      {t('mqtt.bulletinPage.selectStation')} ({selectedStationIds.length} {t('mqtt.bulletinPage.selected')})
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSelectAll}
                      className="text-xs"
                    >
                      {selectedStationIds.length === availableStations.length && availableStations.length > 0
                        ? t('common.deselectAll')
                        : t('common.selectAll')}
                    </Button>
                  </div>

                  {/* Search box */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('mqtt.bulletinPage.searchStation')}
                      value={stationSearchQuery}
                      onChange={(e) => setStationSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Station list with checkboxes */}
                  <div className="border rounded-md max-h-[200px] overflow-y-auto">
                    {availableStations.length === 0 ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        {stationSearchQuery
                          ? t('mqtt.bulletinPage.noMatchingStations')
                          : t('mqtt.bulletinPage.allStationsConfigured')}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {availableStations.map((st: any) => (
                          <label
                            key={st.id}
                            className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 cursor-pointer transition-colors"
                          >
                            <Checkbox
                              checked={selectedStationIds.includes(st.id)}
                              onCheckedChange={() => toggleStationSelection(st.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{st.name}</div>
                            </div>
                            <Badge variant="outline" className="text-xs shrink-0">
                              ID: {st.id}
                            </Badge>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected summary chips */}
                  {selectedStationIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedStationIds.slice(0, 10).map((id) => {
                        const st = stationsData?.find((s: any) => s.id === id);
                        return (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive/20"
                            onClick={() => toggleStationSelection(id)}
                          >
                            {st?.name || `Station ${id}`}
                            <XCircle className="h-3 w-3 ml-1" />
                          </Badge>
                        );
                      })}
                      {selectedStationIds.length > 10 && (
                        <Badge variant="outline">
                          +{selectedStationIds.length - 10} {t('mqtt.bulletinPage.moreStations')}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Interval */}
              <div className="space-y-2">
                <Label>{t('mqtt.bulletinPage.intervalMinutes')}</Label>
                <Select
                  value={formInterval.toString()}
                  onValueChange={(v) => setFormInterval(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">{t('mqtt.bulletinPage.15min')}</SelectItem>
                    <SelectItem value="30">{t('mqtt.bulletinPage.30min')}</SelectItem>
                    <SelectItem value="60">{t('mqtt.bulletinPage.1hour')}</SelectItem>
                    <SelectItem value="120">{t('mqtt.bulletinPage.2hours')}</SelectItem>
                    <SelectItem value="240">{t('mqtt.bulletinPage.4hours')}</SelectItem>
                    <SelectItem value="480">{t('mqtt.bulletinPage.8hours')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Working hours */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('mqtt.bulletinPage.startHour')}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={formStartHour}
                    onChange={(e) => setFormStartHour(parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('mqtt.bulletinPage.endHour')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={formEndHour}
                    onChange={(e) => setFormEndHour(parseInt(e.target.value) || 24)}
                  />
                </div>
              </div>

              {/* Max fail points */}
              <div className="space-y-2">
                <Label>{t('mqtt.bulletinPage.maxFailPoints')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={formMaxFailPoints}
                  onChange={(e) => setFormMaxFailPoints(parseInt(e.target.value) || 20)}
                />
              </div>

              {/* Toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('mqtt.bulletinPage.includeFailImages')}</Label>
                  <Switch checked={formIncludeImages} onCheckedChange={setFormIncludeImages} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t('mqtt.bulletinPage.sendExternal')}</Label>
                  <Switch checked={formSendExternal} onCheckedChange={setFormSendExternal} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t('mqtt.bulletinPage.sendFcm')}</Label>
                  <Switch checked={formSendFcm} onCheckedChange={setFormSendFcm} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={upsertMutation.isPending || quickSetupMutation.isPending}
              >
                {upsertMutation.isPending || quickSetupMutation.isPending
                  ? t('mqtt.bulletinPage.saving')
                  : dialogMode === "edit"
                    ? t('mqtt.bulletinPage.saveSettings')
                    : t('mqtt.bulletinPage.applyToStations', { count: selectedStationIds.length })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Bulletin Detail Dialog */}
        <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('mqtt.bulletinPage.detailTitle')}</DialogTitle>
              <DialogDescription>
                {selectedBulletin?.stationName} — {formatDate(selectedBulletin?.createdAt)}
              </DialogDescription>
            </DialogHeader>

            {selectedBulletin && (
              <div className="space-y-4">
                {/* Stats summary */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-info/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold">{selectedBulletin.totalCount}</div>
                    <div className="text-xs text-muted-foreground">TOTAL</div>
                  </div>
                  <div className="bg-success/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-success">{selectedBulletin.okCount}</div>
                    <div className="text-xs text-muted-foreground">OK</div>
                  </div>
                  <div className="bg-destructive/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-destructive">{selectedBulletin.ngCount}</div>
                    <div className="text-xs text-muted-foreground">NG</div>
                  </div>
                  <div className="bg-warning/10 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-warning">{selectedBulletin.ntfCount}</div>
                    <div className="text-xs text-muted-foreground">NTF</div>
                  </div>
                </div>

                {/* Yield rate */}
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <span className="text-sm font-medium">Yield Rate</span>
                  <Badge variant={Number(selectedBulletin.yieldRate) >= 95 ? "default" : "destructive"}>
                    {selectedBulletin.yieldRate}%
                  </Badge>
                </div>

                {/* Period */}
                <div className="text-sm text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-1" />
                  {t('mqtt.bulletinPage.cycle')}: {formatDate(selectedBulletin.periodStart)} → {formatDate(selectedBulletin.periodEnd)}
                </div>

                {/* Fail Points */}
                {selectedBulletin.failPoints && (selectedBulletin.failPoints as any[]).length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      {t('mqtt.bulletinPage.failPointList')} ({(selectedBulletin.failPoints as any[]).length})
                    </h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('mqtt.bulletinPage.pointCode')}</TableHead>
                          <TableHead>{t('mqtt.bulletinPage.pointName')}</TableHead>
                          <TableHead className="text-center">{t('mqtt.bulletinPage.ngCountHeader')}</TableHead>
                          <TableHead className="text-center">{t('mqtt.bulletinPage.rateHeader')}</TableHead>
                          <TableHead className="text-center">{t('mqtt.bulletinPage.image')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedBulletin.failPoints as any[]).map((fp: any, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono text-sm">{fp.pointCode}</TableCell>
                            <TableCell>{fp.pointName}</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="destructive">{fp.ngCount}</Badge>
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {fp.percentage?.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-center">
                              {fp.imageUrl ? (
                                <a
                                  href={fp.imageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-info hover:underline"
                                >
                                  <Image className="h-4 w-4 mx-auto" />
                                </a>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Delivery info */}
                <div className="flex items-center gap-4 text-sm text-muted-foreground border-t pt-3">
                  <span className="flex items-center gap-1">
                    {selectedBulletin.sentViaLocal && <CheckCircle2 className="h-3 w-3 text-success" />}
                    Local
                  </span>
                  <span className="flex items-center gap-1">
                    {selectedBulletin.sentViaExternal && <CheckCircle2 className="h-3 w-3 text-success" />}
                    External
                  </span>
                  <span className="flex items-center gap-1">
                    {selectedBulletin.sentViaFcm && <CheckCircle2 className="h-3 w-3 text-success" />}
                    FCM Push
                  </span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* NG Alert Add/Edit Dialog */}
        <Dialog open={showNgAlertDialog} onOpenChange={setShowNgAlertDialog}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-destructive" />
                {ngAlertDialogMode === "edit"
                  ? t('mqtt.ngAlert.editConfig', 'Chỉnh sửa cấu hình NG Alert')
                  : t('mqtt.ngAlert.addConfig', 'Thêm cấu hình NG Alert')}
              </DialogTitle>
              <DialogDescription>
                {t('mqtt.ngAlert.configDesc', 'Tùy chỉnh topic MQTT, kênh gửi, QoS và cooldown cho NG Alert')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Station selection */}
              {ngAlertDialogMode === "edit" ? (
                <div className="space-y-2">
                  <Label>Station</Label>
                  <div className="px-3 py-2 bg-muted rounded-md text-sm font-medium">
                    {stationsData?.find((st: any) => st.id === editingNgAlertStationId)?.name ||
                      `Station ${editingNgAlertStationId}`}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{t('mqtt.ngAlert.selectStation', 'Chọn Station')}</Label>
                  <Select
                    value={ngFormStationId?.toString() || "0"}
                    onValueChange={(v) => setNgFormStationId(parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('mqtt.ngAlert.selectStation', 'Chọn Station')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableNgAlertStations.map((st: any) => (
                        <SelectItem key={st.id} value={st.id.toString()}>
                          {st.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Enabled */}
              <div className="flex items-center justify-between">
                <Label>{t('mqtt.ngAlert.enabled', 'Bật NG Alert')}</Label>
                <Switch checked={ngFormEnabled} onCheckedChange={setNgFormEnabled} />
              </div>

              {/* Topic pattern */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Wifi className="h-4 w-4" />
                  {t('mqtt.ngAlert.topicPattern', 'Topic Pattern (Local)')}
                </Label>
                <Input
                  value={ngFormTopicPattern}
                  onChange={(e) => setNgFormTopicPattern(e.target.value)}
                  placeholder="avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors"
                />
                <p className="text-xs text-muted-foreground">
                  {t('mqtt.ngAlert.topicHelp', 'Hỗ trợ: {factoryId}, {workshopId}, {stationId}')}
                </p>
              </div>

              {/* External Topic pattern */}
              <div className="space-y-2">
                <Label>{t('mqtt.ngAlert.externalTopicPattern', 'Topic Pattern (External)')}</Label>
                <Input
                  value={ngFormExternalTopicPattern}
                  onChange={(e) => setNgFormExternalTopicPattern(e.target.value)}
                  placeholder={t('mqtt.ngAlert.externalTopicPlaceholder', 'Để trống = dùng topic local')}
                />
              </div>

              {/* Channels */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">{t('mqtt.ngAlert.deliveryChannels', 'Kênh gửi')}</Label>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">Local Broker (Aedes)</Label>
                  <Switch checked={ngFormSendToLocal} onCheckedChange={setNgFormSendToLocal} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">External Broker (HiveMQ)</Label>
                  <Switch checked={ngFormSendToExternal} onCheckedChange={setNgFormSendToExternal} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">FCM Push Notification</Label>
                  <Switch checked={ngFormSendFcm} onCheckedChange={setNgFormSendFcm} />
                </div>
              </div>

              {/* Images */}
              <div className="space-y-3">
                <Label className="text-sm font-semibold">{t('mqtt.ngAlert.imageOptions', 'Ảnh đính kèm')}</Label>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t('mqtt.ngAlert.includeErrorImages', 'Ảnh lỗi')}</Label>
                  <Switch checked={ngFormIncludeImages} onCheckedChange={setNgFormIncludeImages} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t('mqtt.ngAlert.includeRefImages', 'Ảnh tham chiếu')}</Label>
                  <Switch checked={ngFormIncludeRefImages} onCheckedChange={setNgFormIncludeRefImages} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t('mqtt.ngAlert.includePointImages', 'Ảnh từng điểm đo')}</Label>
                  <Switch checked={ngFormIncludePointImages} onCheckedChange={setNgFormIncludePointImages} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="font-normal">{t('mqtt.ngAlert.includeOverallResult', 'Kết quả đo tổng thể')}</Label>
                  <Switch checked={ngFormIncludeOverallResult} onCheckedChange={setNgFormIncludeOverallResult} />
                </div>
              </div>

              {/* QoS & Retain */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>QoS</Label>
                  <Select
                    value={ngFormQos.toString()}
                    onValueChange={(v) => setNgFormQos(parseInt(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0 - At most once</SelectItem>
                      <SelectItem value="1">1 - At least once</SelectItem>
                      <SelectItem value="2">2 - Exactly once</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Retain</Label>
                  <div className="flex items-center gap-2 h-10">
                    <Switch checked={ngFormRetain} onCheckedChange={setNgFormRetain} />
                    <span className="text-sm text-muted-foreground">
                      {ngFormRetain ? 'ON' : 'OFF'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cooldown */}
              <div className="space-y-2">
                <Label>{t('mqtt.ngAlert.cooldownSeconds', 'Cooldown (giây)')}</Label>
                <Input
                  type="number"
                  min={0}
                  max={86400}
                  value={ngFormCooldownSeconds}
                  onChange={(e) => setNgFormCooldownSeconds(parseInt(e.target.value) || 0)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('mqtt.ngAlert.cooldownHelp', 'Thời gian chờ giữa 2 lần gửi NG Alert. 0 = không giới hạn.')}
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNgAlertDialog(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleNgAlertSave}
                disabled={ngAlertUpsertMutation.isPending || (!editingNgAlertStationId && !ngFormStationId)}
              >
                {ngAlertUpsertMutation.isPending
                  ? t('mqtt.bulletinPage.saving')
                  : t('mqtt.ngAlert.saveConfig', 'Lưu cấu hình')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Test Bulletin Dialog */}
        <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5 text-warning" />
                {t('mqtt.bulletinPage.sendTestBulletin')}
              </DialogTitle>
              <DialogDescription>
                {t('mqtt.bulletinPage.testBulletinDesc')}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Station select */}
              <div className="space-y-2">
                <Label>{t('mqtt.bulletinPage.selectTestStation')}</Label>
                <Select
                  value={testStationId?.toString() || "0"}
                  onValueChange={(v) => setTestStationId(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('mqtt.bulletinPage.selectStation')} />
                  </SelectTrigger>
                  <SelectContent>
                    {stationsData?.map((st: any) => (
                      <SelectItem key={st.id} value={st.id.toString()}>
                        {st.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Send options */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('mqtt.bulletinPage.sendExternalHiveMQ')}</Label>
                  <Switch checked={testSendExternal} onCheckedChange={setTestSendExternal} />
                </div>
                <div className="flex items-center justify-between">
                  <Label>{t('mqtt.bulletinPage.sendFcm')}</Label>
                  <Switch checked={testSendFcm} onCheckedChange={setTestSendFcm} />
                </div>
              </div>

              {/* Info box */}
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                <p className="text-sm text-warning">
                  <AlertTriangle className="h-4 w-4 inline mr-1" />
                  {t('mqtt.bulletinPage.testInfoLine1')}<strong>{t('mqtt.bulletinPage.random')}</strong> (OK/NG/NTF/TOTAL, fail points, machines) 
                  {t('mqtt.bulletinPage.testInfoLine2')}</p>
              </div>

              {/* Send button */}
              <Button
                onClick={handleSendTest}
                disabled={testBulletinMutation.isPending || !testStationId}
                className="w-full flex items-center justify-center gap-2"
              >
                {testBulletinMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    {t('mqtt.bulletinPage.sending')}
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {t('mqtt.bulletinPage.sendTestBulletin')}
                  </>
                )}
              </Button>

              {/* Test result */}
              {testResult && (
                <div className="space-y-3">
                  <div className={`flex items-center gap-2 p-3 rounded-lg ${
                    testResult.success
                      ? "bg-success/10 border border-success/30"
                      : "bg-destructive/10 border border-destructive/30"
                  }`}>
                    {testResult.success ? (
                      <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <div>
                      <p className={`text-sm font-medium ${testResult.success ? "text-success" : "text-destructive"}`}>
                        {testResult.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Bulletin ID: <code className="bg-muted px-1 rounded">{testResult.bulletinId}</code>
                      </p>
                    </div>
                  </div>

                  {/* Payload preview */}
                  {testResult.payload && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">{t('mqtt.bulletinPage.jsonPayloadSent')}:</Label>
                      {/* Stats summary */}
                      <div className="grid grid-cols-4 gap-2">
                        <div className="bg-info/10 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold">{testResult.payload.statistics.totalCount}</div>
                          <div className="text-xs text-muted-foreground">TOTAL</div>
                        </div>
                        <div className="bg-success/10 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-success">{testResult.payload.statistics.okCount}</div>
                          <div className="text-xs text-muted-foreground">OK</div>
                        </div>
                        <div className="bg-destructive/10 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-destructive">{testResult.payload.statistics.ngCount}</div>
                          <div className="text-xs text-muted-foreground">NG</div>
                        </div>
                        <div className="bg-warning/10 rounded-lg p-2 text-center">
                          <div className="text-lg font-bold text-warning">{testResult.payload.statistics.ntfCount}</div>
                          <div className="text-xs text-muted-foreground">NTF</div>
                        </div>
                      </div>
                      {/* JSON raw */}
                      <details className="group">
                        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                          {t('mqtt.bulletinPage.viewFullJson')} ▸
                        </summary>
                        <pre className="mt-2 bg-muted rounded-lg p-3 text-xs overflow-x-auto max-h-[300px] overflow-y-auto">
                          {JSON.stringify(testResult.payload, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
