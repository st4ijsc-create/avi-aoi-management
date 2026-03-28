import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
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

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1'];

export default function MqttDashboard() {
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
  const { data: machinesList } = trpc.machine.list.useQuery(
    { stationId: testStationId ? Number(testStationId) : undefined },
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
      setLastTestResult({ type: 'error', timestamp: new Date().toISOString(), message: error.message, code: error.data?.code });
      toast.error(t('mqtt.dashboard.errorMsg', { message: error.message }));
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
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.delivered')}</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.failed')}</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> {t('mqtt.dashboard.pending')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getMessageTypeBadge = (type: string) => {
    switch (type) {
      case 'NG_ALERT':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><AlertTriangle className="w-3 h-3 mr-1" /> NG Alert</Badge>;
      case 'DAILY_SUMMARY':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Activity className="w-3 h-3 mr-1" /> Daily</Badge>;
      case 'WEEKLY_SUMMARY':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30"><TrendingUp className="w-3 h-3 mr-1" /> Weekly</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };

  // Prepare pie chart data for message breakdown
  const pieData = stats ? [
    { name: 'NG Alerts', value: stats.breakdown.ngAlerts, color: '#ef4444' },
    { name: 'Daily Summary', value: stats.breakdown.dailySummaries, color: '#3b82f6' },
    { name: 'Weekly Summary', value: stats.breakdown.weeklySummaries, color: '#8b5cf6' },
  ].filter(d => d.value > 0) : [];

  return (
    <DashboardLayout>
      <div className="space-y-4 sm:space-y-6 mobile-safe-bottom">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">MQTT Dashboard</h1>
            <p className="text-sm sm:text-base text-muted-foreground">{t('mqtt.dashboard.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {mqttStatus?.enabled ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 px-3 py-1">
                <Server className="w-4 h-4 mr-2" />
                Local: Online
              </Badge>
            ) : (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1">
                <Server className="w-4 h-4 mr-2" />
                Local: Offline
              </Badge>
            )}
            {mqttStatus?.external?.enabled && (
              mqttStatus.external.connected ? (
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30 px-3 py-1">
                  <Wifi className="w-4 h-4 mr-2" />
                  Cloud: Connected
                </Badge>
              ) : (
                <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 px-3 py-1">
                  <WifiOff className="w-4 h-4 mr-2" />
                  Cloud: Disconnected
                </Badge>
              )
            )}
            {/* WebSocket Toggle */}
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/50">
              <Radio className={`w-4 h-4 ${wsConnected ? 'text-green-500' : 'text-muted-foreground'}`} />
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
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          {/* Connected Clients */}
          <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1 sm:gap-2">
                <Wifi className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-400" />
                <span className="hidden sm:inline">Clients Online</span>
                <span className="sm:hidden">Online</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold text-emerald-400">
                {statsLoading ? '-' : stats?.clients.online || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                / {stats?.clients.total || 0} {t('mqtt.dashboard.totalClients')}
              </p>
            </CardContent>
          </Card>

          {/* Offline Clients */}
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1 sm:gap-2">
                <WifiOff className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400" />
                <span className="hidden sm:inline">Clients Offline</span>
                <span className="sm:hidden">Offline</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold text-amber-400">
                {statsLoading ? '-' : stats?.clients.offline || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.clients.pendingApproval || 0} {t('mqtt.dashboard.pendingApproval')}
              </p>
            </CardContent>
          </Card>

          {/* Messages Today */}
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1 sm:gap-2">
                <MessageSquare className="w-3 h-3 sm:w-4 sm:h-4 text-blue-400" />
                <span className="hidden sm:inline">{t('mqtt.dashboard.messagesToday')}</span>
                <span className="sm:hidden">{t('mqtt.messages')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold text-blue-400">
                {statsLoading ? '-' : stats?.messages.total || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.breakdown.ngAlerts || 0} NG alerts
              </p>
            </CardContent>
          </Card>

          {/* Delivery Rate */}
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardHeader className="p-3 sm:p-4 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground flex items-center gap-1 sm:gap-2">
                <Send className="w-3 h-3 sm:w-4 sm:h-4 text-purple-400" />
                <span className="hidden sm:inline">{t('mqtt.dashboard.successRate')}</span>
                <span className="sm:hidden">{t('mqtt.dashboard.rate')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-4 pt-0">
              <div className="text-2xl sm:text-3xl font-bold text-purple-400">
                {statsLoading ? '-' : `${stats?.messages.deliveryRate || 0}%`}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.messages.delivered || 0} / {stats?.messages.total || 0} {t('mqtt.messages')}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Realtime Monitoring Section */}
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
          {/* Throughput - Last Minute */}
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border-cyan-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                {t('mqtt.dashboard.throughput1min')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-400">
                {realtimeStats?.throughput.lastMinute || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('mqtt.dashboard.msgPerMin')}
              </p>
            </CardContent>
          </Card>

          {/* Throughput - Last 5 Minutes */}
          <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border-indigo-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-400" />
                {t('mqtt.dashboard.throughput5min')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-400">
                {realtimeStats?.throughput.last5Minutes || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {t('mqtt.dashboard.avgMsgPerMin')}
              </p>
            </CardContent>
          </Card>

          {/* Average Latency */}
          <Card className="bg-gradient-to-br from-rose-500/10 to-rose-600/5 border-rose-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Timer className="w-4 h-4 text-rose-400" />
                Latency (Avg)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-rose-400">
                {realtimeStats?.latency.avgMs || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ms (P95: {realtimeStats?.latency.p95Ms || 0}ms)
              </p>
            </CardContent>
          </Card>

          {/* External Broker Status */}
          <Card className="bg-gradient-to-br from-teal-500/10 to-teal-600/5 border-teal-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Gauge className="w-4 h-4 text-teal-400" />
                External Broker
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {realtimeStats?.externalBroker.connected ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                ) : realtimeStats?.externalBroker.enabled ? (
                  <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    <Clock className="w-3 h-3 mr-1" /> Connecting...
                  </Badge>
                ) : (
                  <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
                    <XCircle className="w-3 h-3 mr-1" /> Disabled
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-2 truncate">
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
            <div className="h-[250px]">
              {!throughputHistory || throughputHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {t('common.noData')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={throughputHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#888"
                      tick={{ fontSize: 10 }}
                      interval={9}
                    />
                    <YAxis stroke="#888" />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="count" 
                      name={t('common.total')} 
                      stroke="#06b6d4" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="delivered" 
                      name={t('mqtt.dashboard.delivered')} 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="failed" 
                      name={t('mqtt.dashboard.failed')} 
                      stroke="#ef4444" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="ngAlerts" 
                      name="NG Alerts" 
                      stroke="#f59e0b" 
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
              <div className="h-[300px]">
                {trendLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    {t('common.loading')}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trend || []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis 
                        dataKey="date" 
                        stroke="#888"
                        tickFormatter={(value) => new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                      />
                      <YAxis stroke="#888" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                        labelFormatter={(value) => new Date(value).toLocaleDateString('vi-VN')}
                      />
                      <Legend />
                      <Bar dataKey="delivered" name={t('mqtt.dashboard.delivered')} fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" name={t('mqtt.dashboard.failed')} fill="#ef4444" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ngAlerts" name="NG Alerts" fill="#f59e0b" radius={[4, 4, 0, 0]} />
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
              <div className="h-[300px]">
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
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }} />
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
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
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
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                <CheckCircle className="w-3 h-3 mr-1" /> Approved
                              </Badge>
                            ) : client.approvalStatus === 'PENDING' ? (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                                <Clock className="w-3 h-3 mr-1" /> Pending
                              </Badge>
                            ) : (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
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
                              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
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
                          <TableCell className="font-mono text-xs max-w-[200px] truncate">
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
      </div>

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
                  <SelectTrigger><SelectValue placeholder="Chọn Factory..." /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Chọn Workshop..." /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Chọn Line..." /></SelectTrigger>
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
                  <SelectTrigger><SelectValue placeholder="Chọn Station..." /></SelectTrigger>
                  <SelectContent>
                    {stationsList?.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Machine (tùy chọn)</Label>
                <Select value={testMachineId} onValueChange={setTestMachineId} disabled={!testStationId}>
                  <SelectTrigger><SelectValue placeholder="Tự động chọn máy đầu tiên" /></SelectTrigger>
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
              <Label className="text-xs">Sản phẩm (tùy chọn)</Label>
              <Select value={testProductModelId} onValueChange={setTestProductModelId}>
                <SelectTrigger><SelectValue placeholder="Chọn sản phẩm để load điểm đo..." /></SelectTrigger>
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
                    }}>Tất cả OK</Button>
                    <Button variant="outline" size="sm" onClick={() => {
                      setTestMeasurementPoints(prev => prev.map(mp => ({ ...mp, result: 'NG' })));
                    }}>Tất cả NG</Button>
                  </div>
                </div>
                <div className="border rounded-md max-h-[250px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">#</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Tên điểm đo</TableHead>
                        <TableHead className="w-[100px]">Kết quả</TableHead>
                        <TableHead className="w-[120px]">Giá trị</TableHead>
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
                                <SelectItem value="OK"><span className="text-green-500">OK</span></SelectItem>
                                <SelectItem value="NG"><span className="text-red-500">NG</span></SelectItem>
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
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" /> Success
                      </Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                        <XCircle className="w-3 h-3 mr-1" /> Error
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(JSON.stringify(lastTestResult, null, 2));
                        toast.info('Đã copy JSON');
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    {jsonExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {jsonExpanded && (
                  <pre className="px-3 pb-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto bg-black/30">
                    {JSON.stringify(lastTestResult, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowTestDialog(false); setLastTestResult(null); }}>Đóng</Button>
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
    </DashboardLayout>
  );
}
