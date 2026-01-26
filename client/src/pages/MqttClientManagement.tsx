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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Smartphone, Plus, Trash2, Edit, CheckCircle, XCircle, 
  Clock, Activity, Wifi, WifiOff, RefreshCw, History, Settings,
  AlertTriangle, Heart, TrendingUp, Server, MessageSquare
} from "lucide-react";

export default function MqttClientManagement() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    deviceId: '',
    deviceName: '',
    deviceType: 'ANDROID',
    stationId: null as number | null,
    processId: null as number | null,
    mappingType: 'MANUAL' as 'AUTO' | 'MANUAL',
    receiveNGAlerts: true,
    receiveDailySummary: true,
    receiveWeeklySummary: true,
  });

  const { data: clients, refetch: refetchClients } = trpc.mqttClient.list.useQuery({});
  const { data: stations } = trpc.station.list.useQuery();
  const { data: processes } = trpc.process.list.useQuery({});
  const { data: clientsHealth } = trpc.mqttClient.allClientsHealth.useQuery();
  const { data: connectionHistory } = trpc.mqttClient.connectionHistory.useQuery(
    { clientId: selectedClient || 0, limit: 20 },
    { enabled: !!selectedClient }
  );
  const { data: clientHealth } = trpc.mqttClient.clientHealth.useQuery(
    { clientId: selectedClient || 0 },
    { enabled: !!selectedClient }
  );

  const createMutation = trpc.mqttClient.create.useMutation({
    onSuccess: () => {
      toast.success('Đã tạo MQTT client');
      setIsCreateDialogOpen(false);
      resetForm();
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.mqttClient.updateSettings.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật client');
      setEditingClient(null);
      resetForm();
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.mqttClient.delete.useMutation({
    onSuccess: () => {
      toast.success('Đã xóa client');
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const resetForm = () => {
    setFormData({
      deviceId: '',
      deviceName: '',
      deviceType: 'ANDROID',
      stationId: null,
      processId: null,
      mappingType: 'MANUAL',
      receiveNGAlerts: true,
      receiveDailySummary: true,
      receiveWeeklySummary: true,
    });
  };

  const handleCreate = () => {
    if (!formData.deviceId || !formData.deviceName) {
      toast.error('Vui lòng nhập Device ID và Device Name');
      return;
    }
    createMutation.mutate({
      deviceId: formData.deviceId,
      deviceName: formData.deviceName,
      deviceType: formData.deviceType,
      stationId: formData.stationId || undefined,
      processId: formData.processId || undefined,
      mappingType: formData.mappingType,
      receiveNGAlerts: formData.receiveNGAlerts,
      receiveDailySummary: formData.receiveDailySummary,
      receiveWeeklySummary: formData.receiveWeeklySummary,
    });
  };

  const handleUpdate = () => {
    if (!editingClient) return;
    updateMutation.mutate({
      id: editingClient.id,
      deviceName: formData.deviceName,
      receiveNGAlerts: formData.receiveNGAlerts,
      receiveDailySummary: formData.receiveDailySummary,
      receiveWeeklySummary: formData.receiveWeeklySummary,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Wifi className="w-3 h-3 mr-1" /> Online</Badge>;
      case 'OFFLINE':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><WifiOff className="w-3 h-3 mr-1" /> Offline</Badge>;
      case 'DISCONNECTED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Disconnected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getHealthBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-green-500/20 text-green-400">{score}%</Badge>;
    if (score >= 50) return <Badge className="bg-yellow-500/20 text-yellow-400">{score}%</Badge>;
    return <Badge className="bg-red-500/20 text-red-400">{score}%</Badge>;
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('vi-VN');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Quản lý MQTT Clients</h1>
            <p className="text-muted-foreground">Quản lý thiết bị MQTT và theo dõi trạng thái kết nối</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetchClients()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Làm mới
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Thêm Client
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Thêm MQTT Client</DialogTitle>
                  <DialogDescription>Tạo client thủ công để kết nối với hệ thống</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Device ID *</Label>
                    <Input
                      value={formData.deviceId}
                      onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                      placeholder="Nhập Device ID (unique)"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Device Name *</Label>
                    <Input
                      value={formData.deviceName}
                      onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                      placeholder="Tên hiển thị của thiết bị"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Device Type</Label>
                    <Select
                      value={formData.deviceType}
                      onValueChange={(value) => setFormData({ ...formData, deviceType: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ANDROID">Android</SelectItem>
                        <SelectItem value="IOS">iOS</SelectItem>
                        <SelectItem value="WEB">Web</SelectItem>
                        <SelectItem value="DESKTOP">Desktop</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Công trạm</Label>
                    <Select
                      value={formData.stationId?.toString() || "none"}
                      onValueChange={(value) => setFormData({ ...formData, stationId: value === "none" ? null : parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Chọn công trạm" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Không chọn</SelectItem>
                        {stations?.map((station) => (
                          <SelectItem key={station.id} value={station.id.toString()}>
                            {station.name} ({station.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Nhận NG Alerts</Label>
                    <Switch
                      checked={formData.receiveNGAlerts}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveNGAlerts: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Nhận Daily Summary</Label>
                    <Switch
                      checked={formData.receiveDailySummary}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveDailySummary: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Nhận Weekly Summary</Label>
                    <Switch
                      checked={formData.receiveWeeklySummary}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveWeeklySummary: checked })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Hủy</Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Đang tạo...' : 'Tạo Client'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="clients" className="space-y-4">
          <TabsList>
            <TabsTrigger value="clients" className="gap-2">
              <Smartphone className="w-4 h-4" />
              Danh sách Clients ({clients?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-2">
              <Heart className="w-4 h-4" />
              Sức khỏe Clients
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              Lịch sử kết nối
            </TabsTrigger>
          </TabsList>

          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <CardTitle>Danh sách MQTT Clients</CardTitle>
                <CardDescription>Tất cả thiết bị đã đăng ký với hệ thống</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Device</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Công trạm</TableHead>
                      <TableHead>Thông báo</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients?.map((client) => (
                      <TableRow 
                        key={client.id}
                        className={selectedClient === client.id ? 'bg-muted/50' : ''}
                        onClick={() => setSelectedClient(client.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{client.deviceName}</div>
                              <div className="text-xs text-muted-foreground">{client.deviceId}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(client.connectionStatus)}</TableCell>
                        <TableCell>
                          {client.stationId ? (
                            <Badge variant="outline">
                              Station #{client.stationId}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {client.receiveNGAlerts && (
                              <Badge variant="outline" className="text-xs">NG</Badge>
                            )}
                            {client.receiveDailySummary && (
                              <Badge variant="outline" className="text-xs">Daily</Badge>
                            )}
                            {client.receiveWeeklySummary && (
                              <Badge variant="outline" className="text-xs">Weekly</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(client.lastHeartbeat)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingClient(client);
                                setFormData({
                                  deviceId: client.deviceId,
                                  deviceName: client.deviceName || '',
                                  deviceType: client.deviceModel || 'ANDROID',
                                  stationId: client.stationId,
                                  processId: client.processId,
                                  mappingType: client.mappingType as 'AUTO' | 'MANUAL',
                                  receiveNGAlerts: client.receiveNGAlerts,
                                  receiveDailySummary: client.receiveDailySummary,
                                  receiveWeeklySummary: client.receiveWeeklySummary,
                                });
                              }}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Xác nhận xóa client này?')) {
                                  deleteMutation.mutate({ id: client.id });
                                }
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!clients || clients.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Chưa có MQTT client nào
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="health">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {clientsHealth?.map((health) => (
                <Card key={health?.clientId}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{health?.deviceName}</CardTitle>
                      {getHealthBadge(health?.healthScore || 0)}
                    </div>
                    <CardDescription>{getStatusBadge(health?.connectionStatus || 'OFFLINE')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span>Health Score</span>
                          <span>{health?.healthScore}%</span>
                        </div>
                        <Progress value={health?.healthScore} className="h-2" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-muted-foreground" />
                          <span>Total: {health?.messageStats.total}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-green-500" />
                          <span>Success: {health?.messageStats.successRate}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-red-500" />
                          <span>Failed: {health?.messageStats.failed}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-yellow-500" />
                          <span>Pending: {health?.messageStats.pending}</span>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Last seen: {formatDate(health?.lastSeen)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {(!clientsHealth || clientsHealth.length === 0) && (
                <Card className="col-span-full">
                  <CardContent className="py-8 text-center text-muted-foreground">
                    Chưa có dữ liệu sức khỏe clients
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">Chọn Client</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {clients?.map((client) => (
                      <div
                        key={client.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedClient === client.id ? 'bg-primary/10 border-primary' : 'hover:bg-muted'
                        }`}
                        onClick={() => setSelectedClient(client.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4" />
                            <span className="font-medium">{client.deviceName}</span>
                          </div>
                          {getStatusBadge(client.connectionStatus)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Lịch sử kết nối</CardTitle>
                  <CardDescription>
                    {selectedClient ? `Client ID: ${selectedClient}` : 'Chọn client để xem lịch sử'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {selectedClient && clientHealth && (
                    <div className="mb-4 p-4 rounded-lg bg-muted/50">
                      <div className="grid grid-cols-4 gap-4 text-center">
                        <div>
                          <div className="text-2xl font-bold">{clientHealth.messageStats.total}</div>
                          <div className="text-xs text-muted-foreground">Total Messages</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-green-500">{clientHealth.messageStats.delivered}</div>
                          <div className="text-xs text-muted-foreground">Delivered</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-red-500">{clientHealth.messageStats.failed}</div>
                          <div className="text-xs text-muted-foreground">Failed</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold">{clientHealth.messageStats.successRate}%</div>
                          <div className="text-xs text-muted-foreground">Success Rate</div>
                        </div>
                      </div>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Thời gian</TableHead>
                        <TableHead>Loại</TableHead>
                        <TableHead>Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {connectionHistory?.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="text-sm">{formatDate(log.createdAt)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{log.messageType}</Badge>
                          </TableCell>
                          <TableCell>
                            {log.status === 'DELIVERED' && <Badge className="bg-green-500/20 text-green-400">Delivered</Badge>}
                            {log.status === 'FAILED' && <Badge className="bg-red-500/20 text-red-400">Failed</Badge>}
                            {log.status === 'PENDING' && <Badge className="bg-yellow-500/20 text-yellow-400">Pending</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!connectionHistory || connectionHistory.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                            {selectedClient ? 'Chưa có lịch sử' : 'Chọn client để xem lịch sử'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Chỉnh sửa Client</DialogTitle>
              <DialogDescription>Cập nhật cài đặt cho {editingClient?.deviceName}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Device Name</Label>
                <Input
                  value={formData.deviceName}
                  onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Nhận NG Alerts</Label>
                <Switch
                  checked={formData.receiveNGAlerts}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveNGAlerts: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Nhận Daily Summary</Label>
                <Switch
                  checked={formData.receiveDailySummary}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveDailySummary: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Nhận Weekly Summary</Label>
                <Switch
                  checked={formData.receiveWeeklySummary}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveWeeklySummary: checked })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingClient(null)}>Hủy</Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
