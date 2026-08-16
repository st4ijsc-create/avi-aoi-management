import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader, PageContainer, MetricCard, StatusBadge,
  chartColor, chartTooltipStyle, chartGridProps, chartAxisTick,
} from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { 
  Wifi, WifiOff, Users, MessageSquare, CheckCircle, XCircle, Clock, 
  RefreshCw, Activity, Bell, TrendingUp, Send, AlertTriangle,
  Smartphone, Server, TestTube2, Gauge, Timer, Zap, BarChart3,
  Code2, Copy, ChevronDown, ChevronUp
} from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { alertSoundService } from "@/lib/alertSoundService";
import { Volume2, VolumeX, Radio } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useTranslation } from 'react-i18next';

export function MqttDashboardContent() {
  const { t } = useTranslation();
  const [trendDays, setTrendDays] = useState(7);
  
  // WebSocket real-time state
  const [wsEnabled, setWsEnabled] = useState(() => {
    const saved = localStorage.getItem('mqtt-ws-enabled');
    return saved === 'true'; // Default: off
  });
  const [wsConnected, setWsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  
  // WebSocket connection effect
  useEffect(() => {
    if (!wsEnabled) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setWsConnected(false);
      }
      return;
    }
    
    // Connect to WebSocket
    const socket = io(window.location.origin, {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
    });
    
    socket.on('connect', () => {
      setWsConnected(true);
      toast.success('WebSocket connected');
    });
    
    socket.on('disconnect', () => {
      setWsConnected(false);
    });
    
    socket.on('mqtt:message', (data: any) => {
      // Refresh data on new message
      refetchMessages();
      refetchRealtimeStats();
      
      // Play sound if NG alert
      if (data.type === 'NG_ALERT') {
        alertSoundService.playNGAlert();
      }
    });
    
    socket.on('mqtt:stats', () => {
      refetchStats();
    });
    
    socketRef.current = socket;
    
    return () => {
      socket.disconnect();
    };
  }, [wsEnabled]);
  
  // Save WebSocket preference
  const toggleWebSocket = (enabled: boolean) => {
    setWsEnabled(enabled);
    localStorage.setItem('mqtt-ws-enabled', String(enabled));
    if (!enabled) {
      toast.info('WebSocket disabled, using polling');
    }
  };
  
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.mqttClient.dashboardStats.useQuery();
  const { data: trend, isLoading: trendLoading } = trpc.mqttClient.messageTrend.useQuery({ days: trendDays });
  const { data: recentMessages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.mqttClient.recentMessages.useQuery({ limit: 20 });
  const { data: clients } = trpc.mqttClient.list.useQuery({});
  const { data: mqttStatus } = trpc.mqttClient.status.useQuery();
  const { data: realtimeStats, refetch: refetchRealtimeStats } = trpc.mqttClient.realtimeStats.useQuery(undefined, {
    refetchInterval: 10000, // Auto refresh every 10 seconds
  });
  const { data: throughputHistory, refetch: refetchThroughputHistory } = trpc.mqttClient.throughputHistory.useQuery({ minutes: 60 }, {
    refetchInterval: 60000, // Auto refresh every minute
  });

  const [soundMuted, setSoundMuted] = useState(alertSoundService.isMuted());
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testFactoryId, setTestFactoryId] = useState<string>('');
  const [testWorkshopId, setTestWorkshopId] = useState<string>('');
  const [testLineId, setTestLineId] = useState<string>('');
  const [testStationId, setTestStationId] = useState<string>('');
  const [testMachineId, setTestMachineId] = useState<string>('');
  const [testProductModelId, setTestProductModelId] = useState<string>('');
  const [testMeasurementPoints, setTestMeasurementPoints] = useState<Array<{
    pointDefId: number; pointCode: string; pointName: string; result: 'OK' | 'NG'; value: string;
  }>>([]);
  const [lastTestResult, setLastTestResult] = useState<any>(null);
  const [jsonExpanded, setJsonExpanded] = useState(true);

  // Fetch hierarchy for test dialog
  const { data: factoriesList } = trpc.factory.list.useQuery(undefined, { enabled: showTestDialog });
  const { data: workshopsList } = trpc.workshop.listByFactory.useQuery(
    { factoryId: Number(testFactoryId) },
    { enabled: showTestDialog && !!testFactoryId }
  );
  const { data: linesList } = trpc.line.listByWorkshop.useQuery(
    { workshopId: Number(testWorkshopId) },
    { enabled: showTestDialog && !!testWorkshopId }
  );
  const { data: stationsList } = trpc.station.listByLine.useQuery(
    { lineId: Number(testLineId) },
    { enabled: showTestDialog && !!testLineId }
  );
  const { data: machinesList } = trpc.machine.listByStation.useQuery(
    { stationId: Number(testStationId) },
    { enabled: showTestDialog && !!testStationId }
  );
  // Product models and measurement points
  const { data: productModelsList } = trpc.productModel.list.useQuery(
    { limit: 100 },
    { enabled: showTestDialog }
  );
  const { data: measurementPointsList } = trpc.measurementPoint.listByProductModel.useQuery(
    { productModelId: Number(testProductModelId) },
    { enabled: showTestDialog && !!testProductModelId }
  );

  // Load measurement points when product model changes
  useEffect(() => {
    if (measurementPointsList && measurementPointsList.length > 0) {
      setTestMeasurementPoints(measurementPointsList.map((mp: any) => ({
        pointDefId: mp.id,
        pointCode: mp.code,
        pointName: mp.name,
        result: 'OK' as const,
        value: mp.nominalValue != null ? String(mp.nominalValue) : '',
      })));
    } else {
      setTestMeasurementPoints([]);
    }
  }, [measurementPointsList]);

  const toggleSound = () => {
    const newMuted = !soundMuted;
    setSoundMuted(newMuted);
    alertSoundService.setMuted(newMuted);
    toast.info(newMuted ? t('mqtt.dashboard.alertSoundOff') : t('mqtt.dashboard.alertSoundOn'));
  };

  const testNGAlertMutation = trpc.mqttClient.testNGAlert.useMutation({
    onSuccess: (data) => {
      setLastTestResult({ type: 'success', timestamp: new Date().toISOString(), ...data });
      toast.success(data.message || t('mqtt.dashboard.ngAlertSent', { serial: data.data.serialNumber }));
      alertSoundService.playNGAlert();
      refetchMessages();
      refetchRealtimeStats();
    },
    onError: (error) => {
      // `lastTestResult` là dump JSON kỹ thuật cho engineer debug test-alert (nút Copy +
      // hiển thị `JSON.stringify` thô ở dưới) — CỐ Ý giữ error.message nguyên văn ở đây,
      // khác với toast (câu cho người dùng cuối) đã đổi sang mapTrpcError bên dưới.
      setLastTestResult({ type: 'error', timestamp: new Date().toISOString(), message: error.message, code: error.data?.code });
      toast.error(t('mqtt.dashboard.errorMsg', { message: mapTrpcError(error) }));
    },
  });

  const handleTestNGAlert = () => {
    if (!testFactoryId || !testWorkshopId || !testStationId) {
      toast.error('Vui lòng chọn Factory, Workshop và Station');
      return;
    }
    testNGAlertMutation.mutate({
      factoryId: Number(testFactoryId),
      workshopId: Number(testWorkshopId),
      stationId: Number(testStationId),
      machineId: testMachineId ? Number(testMachineId) : undefined,
      productModelId: testProductModelId ? Number(testProductModelId) : undefined,
      measurementResults: testMeasurementPoints.length > 0
        ? testMeasurementPoints.map(mp => ({
            pointDefId: mp.pointDefId,
            pointCode: mp.pointCode,
            result: mp.result,
            value: mp.value ? Number(mp.value) : undefined,
          }))
        : undefined,
    });
  };

  const handleRefresh = () => {
    refetchStats();
    refetchMessages();
    refetchRealtimeStats();
    refetchThroughputHistory();
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('vi-VN');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.delivered')}</Badge>;
      case 'FAILED':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.failed')}</Badge>;
      case 'PENDING':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.pending')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getMessageTypeBadge = (type: string) => {
    switch (type) {
      case 'NG_ALERT':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><AlertTriangle className="w-3 h-3 mr-1" /> NG Alert</Badge>;
      case 'DAILY_SUMMARY':
        return <Badge className="bg-info/20 text-info border-info/30"><Activity className="w-3 h-3 mr-1" /> Daily</Badge>;
      case 'WEEKLY_SUMMARY':
        return <Badge className="bg-primary/20 text-primary border-primary/30"><TrendingUp className="w-3 h-3 mr-1" /> Weekly</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  // Prepare pie chart data for message breakdown (themed chart tokens)
  const pieData = stats ? [
    { name: 'NG Alerts', value: stats.breakdown.ngAlerts, color: chartColor(2) },
    { name: 'Daily Summary', value: stats.breakdown.dailySummaries, color: chartColor(0) },
    { name: 'Weekly Summary', value: stats.breakdown.weeklySummaries, color: chartColor(4) },
  ].filter(d => d.value > 0) : [];

  return (
    <>
      <PageContainer fluid className="space-y-3 sm:space-y-4 mobile-safe-bottom">
        {/* Header */}
        <PageHeader
          title="MQTT Dashboard"
          description={t('mqtt.dashboard.description')}
          actions={
            <>
              {mqttStatus?.enabled ? (
                <Badge className="bg-success/20 text-success border-success/30 px-3 py-1">
                  <Server className="w-4 h-4 mr-2" />
                  Local: Online
                </Badge>
              ) : (
                <Badge className="bg-destructive/20 text-destructive border-destructive/30 px-3 py-1">
                  <Server className="w-4 h-4 mr-2" />
                  Local: Offline
                </Badge>
              )}
              {mqttStatus?.external?.enabled && (
                mqttStatus.external.connected ? (
                  <Badge className="bg-info/20 text-info border-info/30 px-3 py-1">
                    <Wifi className="w-4 h-4 mr-2" />
                    Cloud: Connected
                  </Badge>
                ) : (
                  <Badge className="bg-warning/20 text-warning border-warning/30 px-3 py-1">
                    <WifiOff className="w-4 h-4 mr-2" />
                    Cloud: Disconnected
                  </Badge>
                )
              )}
              {/* WebSocket Toggle */}
              <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50">
                <Radio className={`w-4 h-4 ${wsConnected ? 'text-success' : 'text-muted-foreground'}`} />
                <Label htmlFor="ws-toggle" className="text-xs cursor-pointer">
                  {wsConnected ? 'WS: On' : 'WS: Off'}
                </Label>
                <Switch
                  id="ws-toggle"
                  checked={wsEnabled}
                  onCheckedChange={toggleWebSocket}
                  className="scale-75"
                />
              </div>
              <Button
                variant={soundMuted ? "outline" : "secondary"}
                size="sm"
                onClick={toggleSound}
                title={soundMuted ? t('mqtt.dashboard.enableAlertSound') : t('mqtt.dashboard.disableAlertSound')}
              >
                {soundMuted ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowTestDialog(true)}
                disabled={testNGAlertMutation.isPending}
              >
                <TestTube2 className="w-4 h-4 mr-2" />
                {testNGAlertMutation.isPending ? t('mqtt.dashboard.sending') : 'Test NG Alert'}
              </Button>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('common.refresh')}
              </Button>
            </>
          }
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <MetricCard
            icon={<Wifi className="w-4 h-4" />}
            tone="success"
            label={t('mqtt.dashboard.clientsOnline', 'Clients Online')}
            value={statsLoading ? '-' : (stats?.clients.online ?? 0)}
            delta={`/ ${stats?.clients.total ?? 0} ${t('mqtt.dashboard.totalClients')}`}
          />
          <MetricCard
            icon={<WifiOff className="w-4 h-4" />}
            tone="warning"
            label={t('mqtt.dashboard.clientsOffline', 'Clients Offline')}
            value={statsLoading ? '-' : (stats?.clients.offline ?? 0)}
            delta={`${stats?.clients.pendingApproval ?? 0} ${t('mqtt.dashboard.pendingApproval')}`}
          />
          <MetricCard
            icon={<MessageSquare className="w-4 h-4" />}
            tone="info"
            label={t('mqtt.dashboard.messagesToday')}
            value={statsLoading ? '-' : (stats?.messages.total ?? 0)}
            delta={`${stats?.breakdown.ngAlerts ?? 0} NG alerts`}
          />
          <MetricCard
            icon={<Send className="w-4 h-4" />}
            label={t('mqtt.dashboard.successRate')}
            value={statsLoading ? '-' : `${stats?.messages.deliveryRate ?? 0}%`}
            delta={`${stats?.messages.delivered ?? 0} / ${stats?.messages.total ?? 0} ${t('mqtt.messages')}`}
          />
        </div>

        {/* Realtime Monitoring Section */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          <MetricCard
            icon={<Zap className="w-4 h-4" />}
            tone="info"
            label={t('mqtt.dashboard.throughput1min')}
            value={realtimeStats?.throughput.lastMinute ?? 0}
            delta={t('mqtt.dashboard.msgPerMin')}
          />
          <MetricCard
            icon={<BarChart3 className="w-4 h-4" />}
            tone="info"
            label={t('mqtt.dashboard.throughput5min')}
            value={realtimeStats?.throughput.last5Minutes ?? 0}
            delta={t('mqtt.dashboard.avgMsgPerMin')}
          />
          <MetricCard
            icon={<Timer className="w-4 h-4" />}
            label={t('mqtt.dashboard.latencyAvg', 'Latency (Avg)')}
            value={realtimeStats?.latency.avgMs ?? 0}
            delta={`ms (P95: ${realtimeStats?.latency.p95Ms ?? 0}ms)`}
          />

          {/* External Broker Status (bespoke — badge + endpoint, not a scalar) */}
          <Card>
            <CardContent className="flex flex-col justify-center gap-1 p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Gauge className="w-4 h-4" />
                {t('mqtt.dashboard.externalBroker', 'External Broker')}
              </div>
              <div className="flex items-center gap-2">
                {realtimeStats?.externalBroker.connected ? (
                  <StatusBadge status="connected" tone="success" label={<><CheckCircle className="w-3 h-3 mr-1" /> Connected</>} className="gap-0" />
                ) : realtimeStats?.externalBroker.enabled ? (
                  <StatusBadge status="connecting" tone="warning" label={<><Clock className="w-3 h-3 mr-1" /> Connecting...</>} className="gap-0" />
                ) : (
                  <StatusBadge status="disabled" tone="default" label={<><XCircle className="w-3 h-3 mr-1" /> Disabled</>} className="gap-0" />
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {realtimeStats?.externalBroker.broker || 'N/A'}
                {realtimeStats?.externalBroker.useTLS && (
                  <Badge variant="outline" className="ml-2 text-xs">TLS</Badge>
                )}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Realtime Throughput Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-cyan-400" />
                  {t('mqtt.dashboard.throughputRealtime')}
                </CardTitle>
                <CardDescription>{t('mqtt.dashboard.messagesLastHour')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-45">
              {!throughputHistory || throughputHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {t('common.noData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={throughputHistory}>
                    <CartesianGrid {...chartGridProps} />
                    <XAxis
                      dataKey="time"
                      tick={chartAxisTick}
                      interval={9}
                    />
                    <YAxis tick={chartAxisTick} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      name={t('common.total')}
                      stroke={chartColor(1)}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="delivered"
                      name={t('mqtt.dashboard.delivered')}
                      stroke={chartColor(0)}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="failed"
                      name={t('mqtt.dashboard.failed')}
                      stroke={chartColor(2)}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ngAlerts"
                      name="NG Alerts"
                      stroke={chartColor(3)}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Message Trend Chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-primary" />
                    {t('mqtt.dashboard.messageTrend')}
                  </CardTitle>
                  <CardDescription>{t('mqtt.dashboard.messagesByDay')}</CardDescription>
                </div>
                <Select value={String(trendDays)} onValueChange={(v) => setTrendDays(Number(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">{t('mqtt.dashboard.7days')}</SelectItem>
                    <SelectItem value="14">{t('mqtt.dashboard.14days')}</SelectItem>
                    <SelectItem value="30">{t('mqtt.dashboard.30days')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-50">
                {trendLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend || []}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis
                        dataKey="date"
                        tick={chartAxisTick}
                        tickFormatter={(value) => new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                      />
                      <YAxis tick={chartAxisTick} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        labelFormatter={(value) => new Date(value).toLocaleDateString('vi-VN')}
                      />
                      <Legend />
                      <Bar dataKey="delivered" name={t('mqtt.dashboard.delivered')} fill={chartColor(0)} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" name={t('mqtt.dashboard.failed')} fill={chartColor(2)} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ngAlerts" name="NG Alerts" fill={chartColor(3)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Message Breakdown Pie Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                {t('mqtt.dashboard.messageClassification')}
              </CardTitle>
              <CardDescription>{t('mqtt.dashboard.today')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-50">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    {t('mqtt.dashboard.noMessages')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for Clients and Messages */}
        <Tabs defaultValue="clients" className="space-y-4">
          <TabsList>
            <TabsTrigger value="clients" className="flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              {t('mqtt.dashboard.connectedClients')} ({clients?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              {t('mqtt.dashboard.recentMessages')}
            </TabsTrigger>
          </TabsList>

          {/* Connected Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.dashboard.clientList')}</CardTitle>
                <CardDescription>{t('mqtt.dashboard.clientListDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.dashboard.device')}</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('mqtt.dashboard.approval')}</TableHead>
                      <TableHead>{t('mqtt.dashboard.station')}</TableHead>
                      <TableHead>{t('mqtt.dashboard.lastConnection')}</TableHead>
                      <TableHead>FCM Token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          {t('mqtt.dashboard.noClients')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      clients?.map((client) => (
                        <TableRow key={client.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Smartphone className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <div className="font-medium">{client.deviceName || 'Unknown'}</div>
                                <div className="text-xs text-muted-foreground">{client.deviceModel}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{client.deviceId}</TableCell>
                          <TableCell>
                            {client.connectionStatus === 'ONLINE' ? (
                              <Badge className="bg-success/20 text-success border-success/30">
                                <Wifi className="w-3 h-3 mr-1" /> Online
                              </Badge>
                            ) : (
                              <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
                                <WifiOff className="w-3 h-3 mr-1" /> Offline
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {client.approvalStatus === 'APPROVED' ? (
                              <Badge className="bg-success/20 text-success border-success/30">
                                <CheckCircle className="w-3 h-3 mr-1" /> Approved
                              </Badge>
                            ) : client.approvalStatus === 'PENDING' ? (
                              <Badge className="bg-warning/20 text-warning border-warning/30">
                                <Clock className="w-3 h-3 mr-1" /> Pending
                              </Badge>
                            ) : (
                              <Badge className="bg-destructive/20 text-destructive border-destructive/30">
                                <XCircle className="w-3 h-3 mr-1" /> Rejected
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{client.stationId || '-'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(client.lastConnectedAt)}
                          </TableCell>
                          <TableCell>
                            {client.fcmToken ? (
                              <Badge className="bg-info/20 text-info border-info/30">
                                <Bell className="w-3 h-3 mr-1" /> {t('common.yes')}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">{t('common.no')}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Recent Messages Tab */}
          <TabsContent value="messages">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.dashboard.recentMessagesTitle')}</CardTitle>
                <CardDescription>{t('mqtt.dashboard.recentMessagesDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.dashboard.type')}</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>Station ID</TableHead>
                      <TableHead>Inspection ID</TableHead>
                      <TableHead>{t('mqtt.dashboard.time')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messagesLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          {t('common.loading')}
                        </TableCell>
                      </TableRow>
                    ) : recentMessages?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          {t('mqtt.dashboard.noMessages')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      recentMessages?.map((msg) => (
                        <TableRow key={msg.id}>
                          <TableCell>{getMessageTypeBadge(msg.messageType)}</TableCell>
                          <TableCell className="font-mono text-xs max-w-50 truncate">
                            {msg.topic}
                          </TableCell>
                          <TableCell>{getStatusBadge(msg.deliveryStatus)}</TableCell>
                          <TableCell>{msg.stationId || '-'}</TableCell>
                          <TableCell>{msg.inspectionId || '-'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(msg.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContainer>

      {/* Test NG Alert Dialog */}
      <Dialog open={showTestDialog} onOpenChange={(open) => { setShowTestDialog(open); if (!open) setLastTestResult(null); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Test NG Alert</DialogTitle>
            <DialogDescription>
              Chọn Factory → Workshop → Station để tạo MQTT topic, chọn sản phẩm và chỉnh sửa kết quả điểm đo trước khi gửi
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Hierarchy selects */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Factory *</Label>
                <Select value={testFactoryId} onValueChange={(v) => { setTestFactoryId(v); setTestWorkshopId(''); setTestLineId(''); setTestStationId(''); setTestMachineId(''); }}>
                  <SelectTrigger><SelectValue placeholder={t("mqttDash.chonFactory", "Chọn Factory...")} /></SelectTrigger>
                  <SelectContent>
                    {factoriesList?.map((f: any) => (
                      <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Workshop *</Label>
                <Select value={testWorkshopId} onValueChange={(v) => { setTestWorkshopId(v); setTestLineId(''); setTestStationId(''); setTestMachineId(''); }} disabled={!testFactoryId}>
                  <SelectTrigger><SelectValue placeholder={t("mqttDash.chonWorkshop", "Chọn Workshop...")} /></SelectTrigger>
                  <SelectContent>
                    {workshopsList?.map((w: any) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Line</Label>
                <Select value={testLineId} onValueChange={(v) => { setTestLineId(v); setTestStationId(''); setTestMachineId(''); }} disabled={!testWorkshopId}>
                  <SelectTrigger><SelectValue placeholder={t("mqttDash.chonLine", "Chọn Line...")} /></SelectTrigger>
                  <SelectContent>
                    {linesList?.map((l: any) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Station *</Label>
                <Select value={testStationId} onValueChange={(v) => { setTestStationId(v); setTestMachineId(''); }} disabled={!testLineId}>
                  <SelectTrigger><SelectValue placeholder={t("mqttDash.chonStation", "Chọn Station...")} /></SelectTrigger>
                  <SelectContent>
                    {stationsList?.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("mqttDash.machineTuyChon", "Machine (tùy chọn)")}</Label>
                <Select value={testMachineId} onValueChange={setTestMachineId} disabled={!testStationId}>
                  <SelectTrigger><SelectValue placeholder={t("mqttDash.tuDongChonMayDau", "Tự động chọn máy đầu tiên")} /></SelectTrigger>
                  <SelectContent>
                    {machinesList?.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} ({m.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Topic preview */}
            {testFactoryId && testWorkshopId && testStationId && (
              <div className="p-2 bg-muted/50 rounded-md border">
                <Label className="text-xs text-muted-foreground">MQTT Topic</Label>
                <p className="font-mono text-sm text-primary">
                  avi/factory/{testFactoryId}/workshop/{testWorkshopId}/station/{testStationId}/errors
                </p>
              </div>
            )}

            {/* Product model select */}
            <div className="space-y-1">
              <Label className="text-xs">{t("mqttDash.sanPhamTuyChon", "Sản phẩm (tùy chọn)")}</Label>
              <Select value={testProductModelId} onValueChange={setTestProductModelId}>
                <SelectTrigger><SelectValue placeholder={t("mqttDash.chonSanPhamDeLoad", "Chọn sản phẩm để load điểm đo...")} /></SelectTrigger>
                <SelectContent>
                  {(productModelsList as any[])?.map((pm: any) => (
                    <SelectItem key={pm.id} value={String(pm.id)}>{pm.code} - {pm.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Measurement points table */}
            {testMeasurementPoints.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Điểm đo ({testMeasurementPoints.length})</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      setTestMeasurementPoints(prev => prev.map(mp => ({ ...mp, result: 'OK' })));
                    }}>{t("mqttDash.tatCaOk", "Tất cả OK")}</Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      setTestMeasurementPoints(prev => prev.map(mp => ({ ...mp, result: 'NG' })));
                    }}>{t("mqttDash.tatCaNg", "Tất cả NG")}</Button>
                  </div>
                </div>
                <div className="border rounded-md max-h-62.5 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-15">#</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>{t("mqttDash.tenDiemDo", "Tên điểm đo")}</TableHead>
                        <TableHead className="w-25">{t("mqttDash.ketQua", "Kết quả")}</TableHead>
                        <TableHead className="w-30">{t("mqttDash.giaTri", "Giá trị")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testMeasurementPoints.map((mp, idx) => (
                        <TableRow key={mp.pointDefId}>
                          <TableCell className="text-xs">{idx + 1}</TableCell>
                          <TableCell className="text-xs font-mono">{mp.pointCode}</TableCell>
                          <TableCell className="text-xs">{mp.pointName}</TableCell>
                          <TableCell>
                            <Select value={mp.result} onValueChange={(v: 'OK' | 'NG') => {
                              setTestMeasurementPoints(prev => prev.map((p, i) => i === idx ? { ...p, result: v } : p));
                            }}>
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="OK"><span className="text-success">OK</span></SelectItem>
                                <SelectItem value="NG"><span className="text-destructive">NG</span></SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              className="h-7 text-xs"
                              value={mp.value}
                              onChange={(e) => {
                                setTestMeasurementPoints(prev => prev.map((p, i) => i === idx ? { ...p, value: e.target.value } : p));
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {/* JSON Response Viewer */}
            {lastTestResult && (
              <div className="space-y-2 border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted/80 transition-colors"
                  onClick={() => setJsonExpanded(!jsonExpanded)}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Code2 className="w-4 h-4" />
                    <span>Response JSON</span>
                    {lastTestResult.type === 'success' ? (
                      <Badge className="bg-success/20 text-success border-success/30 text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" /> Success
                      </Badge>
                    ) : (
                      <Badge className="bg-destructive/20 text-destructive border-destructive/30 text-xs">
                        <XCircle className="w-3 h-3 mr-1" /> Error
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      aria-label={t('common.copy', 'Copy')}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(JSON.stringify(lastTestResult, null, 2));
                        toast.info('Đã copy JSON');
                      }}
                    >
                      <Copy aria-hidden="true" className="w-3 h-3" />
                    </Button>
                    {jsonExpanded ? <ChevronUp aria-hidden="true" className="w-4 h-4" /> : <ChevronDown aria-hidden="true" className="w-4 h-4" />}
                  </div>
                </button>
                {jsonExpanded && (
                  <pre className="px-3 pb-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-75 overflow-y-auto bg-black/30">
                    {JSON.stringify(lastTestResult, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTestDialog(false); setLastTestResult(null); }}>{t("mqttDash.dong", "Đóng")}</Button>
            <Button 
              variant="destructive" 
              onClick={handleTestNGAlert} 
              disabled={!testFactoryId || !testWorkshopId || !testStationId || testNGAlertMutation.isPending}
            >
              <Send className="w-4 h-4 mr-2" />
              {testNGAlertMutation.isPending ? 'Đang gửi...' : 'Gửi Test'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function MqttDashboard() {
  return (
    <DashboardLayout>
      <MqttDashboardContent />
    </DashboardLayout>
  );
}
