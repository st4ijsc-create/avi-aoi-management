import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { 
  Wifi, WifiOff, Users, MessageSquare, CheckCircle, XCircle, Clock, 
  RefreshCw, Activity, Bell, TrendingUp, Send, AlertTriangle,
  Smartphone, Server
} from "lucide-react";
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

export default function MqttDashboard() {
  const [trendDays, setTrendDays] = useState(7);
  
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.mqttClient.dashboardStats.useQuery();
  const { data: trend, isLoading: trendLoading } = trpc.mqttClient.messageTrend.useQuery({ days: trendDays });
  const { data: recentMessages, isLoading: messagesLoading, refetch: refetchMessages } = trpc.mqttClient.recentMessages.useQuery({ limit: 20 });
  const { data: clients } = trpc.mqttClient.list.useQuery({});
  const { data: mqttStatus } = trpc.mqttClient.status.useQuery();

  const handleRefresh = () => {
    refetchStats();
    refetchMessages();
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

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">MQTT Dashboard</h1>
            <p className="text-muted-foreground">Giám sát kết nối và tin nhắn MQTT realtime</p>
          </div>
          <div className="flex items-center gap-3">
            {mqttStatus?.enabled ? (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 px-3 py-1">
                <Server className="w-4 h-4 mr-2" />
                MQTT Server: Online
              </Badge>
            ) : (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 px-3 py-1">
                <Server className="w-4 h-4 mr-2" />
                MQTT Server: Offline
              </Badge>
            )}
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
                {statsLoading ? '-' : stats?.clients.online || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                / {stats?.clients.total || 0} tổng clients
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
                {statsLoading ? '-' : stats?.clients.offline || 0}
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
                                <Bell className="w-3 h-3 mr-1" /> Có
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">Không</Badge>
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
                <CardTitle>Tin nhắn gần đây</CardTitle>
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
                    {messagesLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Đang tải...
                        </TableCell>
                      </TableRow>
                    ) : recentMessages?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          Chưa có tin nhắn nào
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
    </DashboardLayout>
  );
}
