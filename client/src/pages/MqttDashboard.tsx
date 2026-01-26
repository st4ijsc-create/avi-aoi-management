import { useState, useEffect, useRef, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { 
  Wifi, WifiOff, Users, MessageSquare, CheckCircle, XCircle, Clock, 
  RefreshCw, Activity, Bell, TrendingUp, Send, AlertTriangle,
  Smartphone, Server, TestTube2, Gauge, Timer, Zap, BarChart3,
  Radio, Pause, Play
} from "lucide-react";
import { toast } from "sonner";
import { alertSoundService } from "@/lib/alertSoundService";
import { Volume2, VolumeX } from "lucide-react";
import { io, Socket } from "socket.io-client";
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

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#6366f1'];

// WebSocket message types
interface MqttRealtimeStats {
  throughput: {
    lastMinute: number;
    last5Minutes: number;
  };
  latency: {
    avgMs: number;
    p95Ms: number;
  };
  externalBroker: {
    enabled: boolean;
    connected: boolean;
    broker: string;
    useTLS: boolean;
  };
}

interface MqttMessage {
  id: number;
  messageType: string;
  topic: string;
  deliveryStatus: string;
  stationId: number | null;
  inspectionId: number | null;
  createdAt: Date | string;
}

export default function MqttDashboard() {
  const [trendDays, setTrendDays] = useState(7);
  const [wsConnected, setWsConnected] = useState(false);
  const [useWebSocket, setUseWebSocket] = useState(() => {
    const saved = localStorage.getItem('mqtt_dashboard_use_websocket');
    return saved === 'true';
  });
  const [isPaused, setIsPaused] = useState(false);
  
  // WebSocket state
  const socketRef = useRef<Socket | null>(null);
  const [wsRealtimeStats, setWsRealtimeStats] = useState<MqttRealtimeStats | null>(null);
  const [wsRecentMessages, setWsRecentMessages] = useState<MqttMessage[]>([]);
  const [wsOnlineClients, setWsOnlineClients] = useState<Set<string>>(new Set());
  const [wsThroughputHistory, setWsThroughputHistory] = useState<any[]>([]);
  
  // Save WebSocket preference
  useEffect(() => {
    localStorage.setItem('mqtt_dashboard_use_websocket', String(useWebSocket));
  }, [useWebSocket]);

  // tRPC queries (used when WebSocket is disabled)
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.mqttClient.dashboardStats.useQuery(undefined, {
    enabled: !useWebSocket,
    refetchInterval: useWebSocket ? false : 30000,
  });
  const { data: trend, isLoading: trendLoading } = trpc.mqttClient.messageTrend.useQuery({ days: trendDays });
  const { data: recentMessages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.mqttClient.recentMessages.useQuery({ limit: 20 }, {
    enabled: !useWebSocket,
    refetchInterval: useWebSocket ? false : 10000,
  });
  const { data: clients, refetch: refetchClients } = trpc.mqttClient.list.useQuery({});
  const { data: mqttStatus } = trpc.mqttClient.status.useQuery();
  const { data: realtimeStats, refetch: refetchRealtimeStats } = trpc.mqttClient.realtimeStats.useQuery(undefined, {
    enabled: !useWebSocket,
    refetchInterval: useWebSocket ? false : 10000,
  });
  const { data: throughputHistory, refetch: refetchThroughputHistory } = trpc.mqttClient.throughputHistory.useQuery({ minutes: 60 }, {
    enabled: !useWebSocket,
    refetchInterval: useWebSocket ? false : 60000,
  });

  // WebSocket connection
  useEffect(() => {
    if (!useWebSocket) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setWsConnected(false);
      }
      return;
    }

    const socket = io(window.location.origin, {
      path: '/api/socket.io',
      transports: ['polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[MqttDashboard] WebSocket connected');
      setWsConnected(true);
      toast.success('WebSocket đã kết nối');
      
      // Subscribe to MQTT updates
      socket.emit('mqtt:subscribe');
    });

    socket.on('disconnect', () => {
      console.log('[MqttDashboard] WebSocket disconnected');
      setWsConnected(false);
    });

    // Handle realtime stats updates
    socket.on('mqtt:stats', (data: MqttRealtimeStats) => {
      if (!isPaused) {
        setWsRealtimeStats(data);
      }
    });

    // Handle new messages
    socket.on('mqtt:new_message', (message: MqttMessage) => {
      if (!isPaused) {
        setWsRecentMessages(prev => {
          const updated = [message, ...prev].slice(0, 20);
          return updated;
        });
        
        // Play sound for NG alerts
        if (message.messageType === 'NG_ALERT') {
          alertSoundService.playNGAlert();
        }
      }
    });

    // Handle client status changes
    socket.on('mqtt:client_status', (data: { clientId: string; status: 'online' | 'offline' }) => {
      if (!isPaused) {
        setWsOnlineClients(prev => {
          const newSet = new Set(prev);
          if (data.status === 'online') {
            newSet.add(data.clientId);
          } else {
            newSet.delete(data.clientId);
          }
          return newSet;
        });
        refetchClients();
      }
    });

    // Handle throughput history updates
    socket.on('mqtt:throughput_update', (data: any) => {
      if (!isPaused) {
        setWsThroughputHistory(prev => {
          const updated = [...prev, data].slice(-60);
          return updated;
        });
      }
    });

    return () => {
      socket.emit('mqtt:unsubscribe');
      socket.disconnect();
    };
  }, [useWebSocket, isPaused, refetchClients]);

  const [soundMuted, setSoundMuted] = useState(alertSoundService.isMuted());

  const toggleSound = () => {
    const newMuted = !soundMuted;
    setSoundMuted(newMuted);
    alertSoundService.setMuted(newMuted);
    toast.info(newMuted ? 'Đã tắt âm thanh cảnh báo' : 'Đã bật âm thanh cảnh báo');
  };

  const testNGAlertMutation = trpc.mqttClient.testNGAlert.useMutation({
    onSuccess: (data) => {
      toast.success(`NG Alert đã gửi: ${data.data.serialNumber}`);
      alertSoundService.playNGAlert();
      if (!useWebSocket) {
        refetchMessages();
        refetchRealtimeStats();
      }
    },
    onError: (error) => {
      toast.error(`Lỗi: ${error.message}`);
    },
  });

  const handleTestNGAlert = () => {
    testNGAlertMutation.mutate({
      machineName: 'Test Machine ' + Math.floor(Math.random() * 100),
      serialNumber: `SN-TEST-${Date.now()}`,
      ngPointName: 'Test Point',
      ngValue: Math.random() * 10,
    });
  };

  const handleRefresh = () => {
    refetchStats();
    refetchMessages();
    refetchRealtimeStats();
    refetchThroughputHistory();
    refetchClients();
    toast.success('Đã làm mới dữ liệu');
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('vi-VN');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'DELIVERED':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Đã gửi</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Thất bại</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Đang chờ</Badge>;
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

  // Use WebSocket data or tRPC data based on preference
  const displayRealtimeStats = useWebSocket ? wsRealtimeStats : realtimeStats;
  const displayRecentMessages = useWebSocket ? wsRecentMessages : recentMessages;
  const displayThroughputHistory = useWebSocket && wsThroughputHistory.length > 0 ? wsThroughputHistory : throughputHistory;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              MQTT Dashboard
              {useWebSocket && (
                <Badge className={wsConnected ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}>
                  <Radio className="w-3 h-3 mr-1" />
                  {wsConnected ? 'Live' : 'Disconnected'}
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground">Giám sát kết nối và tin nhắn MQTT realtime</p>
          </div>
          <div className="flex items-center gap-3">
            {/* WebSocket Toggle */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
              <Switch
                id="websocket-mode"
                checked={useWebSocket}
                onCheckedChange={setUseWebSocket}
              />
              <Label htmlFor="websocket-mode" className="text-sm cursor-pointer">
                WebSocket {useWebSocket ? 'ON' : 'OFF'}
              </Label>
            </div>
            
            {/* Pause/Resume for WebSocket */}
            {useWebSocket && (
              <Button
                variant={isPaused ? "default" : "outline"}
                size="sm"
                onClick={() => setIsPaused(!isPaused)}
              >
                {isPaused ? (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4 mr-2" />
                    Pause
                  </>
                )}
              </Button>
            )}
            
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
            <Button
              variant={soundMuted ? "outline" : "secondary"}
              size="sm"
              onClick={toggleSound}
              title={soundMuted ? 'Bật âm thanh cảnh báo' : 'Tắt âm thanh cảnh báo'}
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
              onClick={handleTestNGAlert}
              disabled={testNGAlertMutation.isPending}
            >
              <TestTube2 className="w-4 h-4 mr-2" />
              {testNGAlertMutation.isPending ? 'Đang gửi...' : 'Test NG Alert'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Làm mới
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Connected Clients */}
          <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-400" />
                Clients Online
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-400">
                {useWebSocket ? wsOnlineClients.size : (statsLoading ? '-' : stats?.clients.online || 0)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                / {stats?.clients.total || clients?.length || 0} tổng clients
              </p>
            </CardContent>
          </Card>

          {/* Offline Clients */}
          <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-amber-400" />
                Clients Offline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-400">
                {useWebSocket 
                  ? Math.max(0, (clients?.length || 0) - wsOnlineClients.size)
                  : (statsLoading ? '-' : stats?.clients.offline || 0)
                }
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.clients.pendingApproval || 0} chờ phê duyệt
              </p>
            </CardContent>
          </Card>

          {/* Messages Today */}
          <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                Tin nhắn hôm nay
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-400">
                {statsLoading ? '-' : stats?.messages.total || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.breakdown.ngAlerts || 0} NG alerts
              </p>
            </CardContent>
          </Card>

          {/* Delivery Rate */}
          <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Send className="w-4 h-4 text-purple-400" />
                Tỷ lệ gửi thành công
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-400">
                {statsLoading ? '-' : `${stats?.messages.deliveryRate || 0}%`}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {stats?.messages.delivered || 0} / {stats?.messages.total || 0} tin nhắn
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Realtime Monitoring Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Throughput - Last Minute */}
          <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 border-cyan-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                Throughput (1 phút)
                {useWebSocket && wsConnected && !isPaused && (
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-cyan-400">
                {displayRealtimeStats?.throughput.lastMinute || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                msg/phút
              </p>
            </CardContent>
          </Card>

          {/* Throughput - Last 5 Minutes */}
          <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 border-indigo-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-400" />
                Throughput (5 phút)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-indigo-400">
                {displayRealtimeStats?.throughput.last5Minutes || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                avg msg/phút
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
                {displayRealtimeStats?.latency.avgMs || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                ms (P95: {displayRealtimeStats?.latency.p95Ms || 0}ms)
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
                {displayRealtimeStats?.externalBroker.connected ? (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    <CheckCircle className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                ) : displayRealtimeStats?.externalBroker.enabled ? (
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
                {displayRealtimeStats?.externalBroker.broker || 'N/A'}
                {displayRealtimeStats?.externalBroker.useTLS && (
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
                  Throughput Realtime
                  {useWebSocket && wsConnected && !isPaused && (
                    <Badge variant="outline" className="text-xs">
                      <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-1" />
                      Live
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>Số lượng message trong 1 giờ qua (theo phút)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              {!displayThroughputHistory || displayThroughputHistory.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Chưa có dữ liệu
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={displayThroughputHistory}>
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
                      name="Tổng" 
                      stroke="#06b6d4" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="delivered" 
                      name="Đã gửi" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="failed" 
                      name="Thất bại" 
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
                    Xu hướng tin nhắn
                  </CardTitle>
                  <CardDescription>Số lượng tin nhắn theo ngày</CardDescription>
                </div>
                <Select value={String(trendDays)} onValueChange={(v) => setTrendDays(Number(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 ngày</SelectItem>
                    <SelectItem value="14">14 ngày</SelectItem>
                    <SelectItem value="30">30 ngày</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {trendLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Đang tải...
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
                      <Bar dataKey="delivered" name="Đã gửi" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="failed" name="Thất bại" fill="#ef4444" radius={[4, 4, 0, 0]} />
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
                Phân loại tin nhắn
              </CardTitle>
              <CardDescription>Hôm nay</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {pieData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground">
                    Chưa có tin nhắn
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
              Connected Clients ({clients?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Recent Messages
              {useWebSocket && wsConnected && !isPaused && (
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* Connected Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <CardTitle>Danh sách Clients</CardTitle>
                <CardDescription>Các thiết bị đã kết nối qua MQTT</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Thiết bị</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Phê duyệt</TableHead>
                      <TableHead>Trạm</TableHead>
                      <TableHead>Kết nối lần cuối</TableHead>
                      <TableHead>FCM Token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          Chưa có client nào kết nối
                        </TableCell>
                      </TableRow>
                    ) : (
                      clients?.map((client) => {
                        const isOnline = useWebSocket 
                          ? wsOnlineClients.has(client.deviceId)
                          : client.connectionStatus === 'ONLINE';
                        return (
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
                              {isOnline ? (
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
                                  <Bell className="w-3 h-3 mr-1" /> Có
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-muted-foreground">Không</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
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
                <CardTitle className="flex items-center gap-2">
                  Tin nhắn gần đây
                  {useWebSocket && wsConnected && !isPaused && (
                    <Badge variant="outline" className="text-xs">
                      <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-1" />
                      Live Updates
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>20 tin nhắn mới nhất</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loại</TableHead>
                      <TableHead>Topic</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Station ID</TableHead>
                      <TableHead>Inspection ID</TableHead>
                      <TableHead>Thời gian</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {messagesLoading && !useWebSocket ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Đang tải...
                        </TableCell>
                      </TableRow>
                    ) : (!displayRecentMessages || displayRecentMessages.length === 0) ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Chưa có tin nhắn nào
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayRecentMessages?.map((msg) => (
                        <TableRow key={msg.id} className="animate-in fade-in duration-300">
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
    </DashboardLayout>
  );
}
