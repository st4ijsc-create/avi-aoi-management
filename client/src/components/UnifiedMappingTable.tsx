import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  Smartphone, 
  Server, 
  Wifi, 
  WifiOff, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Settings, 
  Trash2, 
  Link2, 
  Link2Off,
  RefreshCw,
  Plus,
  Search,
  Filter
} from 'lucide-react';

type MappingType = 'all' | 'mqtt' | 'manual';
type ConnectionStatus = 'all' | 'ONLINE' | 'OFFLINE' | 'DISCONNECTED' | 'connected' | 'disconnected' | 'error' | 'pending';

export function UnifiedMappingTable() {
  const [activeTab, setActiveTab] = useState<MappingType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ConnectionStatus>('all');
  
  // MQTT Clients
  const { data: mqttClients = [], isLoading: loadingMqtt, refetch: refetchMqtt } = trpc.mqttClient.list.useQuery({});
  
  // Manual Connections
  const { data: manualConnections = [], isLoading: loadingManual, refetch: refetchManual } = trpc.manualMapping.list.useQuery();
  
  // Stations for mapping
  const { data: stations = [] } = trpc.station.list.useQuery();
  
  // Machines for manual mapping
  const { data: machines = [] } = trpc.machine.list.useQuery();
  
  // Dialogs
  const [editMqttDialog, setEditMqttDialog] = useState<{ open: boolean; client: typeof mqttClients[0] | null }>({ open: false, client: null });
  const [editManualDialog, setEditManualDialog] = useState<{ open: boolean; connection: typeof manualConnections[0] | null }>({ open: false, connection: null });
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; client: typeof mqttClients[0] | null }>({ open: false, client: null });
  const [createManualDialog, setCreateManualDialog] = useState(false);
  
  // Form states
  const [approveForm, setApproveForm] = useState({ stationId: '', mappingType: 'MANUAL' as 'AUTO' | 'MANUAL' });
  const [manualForm, setManualForm] = useState({
    machineId: '',
    ipAddress: '',
    port: '8080',
    protocol: 'websocket' as 'websocket' | 'tcp' | 'http',
  });
  
  // Mutations
  const approveMutation = trpc.mqttClient.approve.useMutation({
    onSuccess: () => {
      toast.success('Đã phê duyệt thiết bị');
      refetchMqtt();
      setApproveDialog({ open: false, client: null });
    },
    onError: (error) => toast.error(error.message),
  });
  
  const rejectMutation = trpc.mqttClient.reject.useMutation({
    onSuccess: () => {
      toast.success('Đã từ chối thiết bị');
      refetchMqtt();
    },
    onError: (error) => toast.error(error.message),
  });
  
  const updateMqttMappingMutation = trpc.mqttClient.updateMapping.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật mapping');
      refetchMqtt();
      setEditMqttDialog({ open: false, client: null });
    },
    onError: (error) => toast.error(error.message),
  });
  
  const updateMqttSettingsMutation = trpc.mqttClient.updateSettings.useMutation({
    onSuccess: () => {
      toast.success('Đã cập nhật cài đặt');
      refetchMqtt();
    },
    onError: (error) => toast.error(error.message),
  });
  
  const disconnectMqttMutation = trpc.mqttClient.disconnectAndReset.useMutation({
    onSuccess: () => {
      toast.success('Đã ngắt kết nối và reset mapping');
      refetchMqtt();
    },
    onError: (error) => toast.error(error.message),
  });
  
  const deleteMqttMutation = trpc.mqttClient.delete.useMutation({
    onSuccess: () => {
      toast.success('Đã xóa thiết bị');
      refetchMqtt();
    },
    onError: (error) => toast.error(error.message),
  });
  
  const createManualMutation = trpc.manualMapping.create.useMutation({
    onSuccess: () => {
      toast.success('Đã tạo kết nối thủ công');
      refetchManual();
      setCreateManualDialog(false);
      setManualForm({ machineId: '', ipAddress: '', port: '8080', protocol: 'websocket' });
    },
    onError: (error) => toast.error(error.message),
  });
  
  const deleteManualMutation = trpc.manualMapping.delete.useMutation({
    onSuccess: () => {
      toast.success('Đã xóa kết nối');
      refetchManual();
    },
    onError: (error) => toast.error(error.message),
  });
  
  const testManualMutation = trpc.manualMapping.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Kết nối thành công (${result.latencyMs}ms)`);
      } else {
        toast.error(`Kết nối thất bại: ${result.message}`);
      }
      refetchManual();
    },
    onError: (error) => toast.error(error.message),
  });
  
  // Filter data
  const filteredMqttClients = mqttClients.filter(client => {
    if (searchQuery && !client.deviceName?.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !client.deviceId.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (statusFilter !== 'all' && client.connectionStatus !== statusFilter) {
      return false;
    }
    return true;
  });
  
  const filteredManualConnections = manualConnections.filter(conn => {
    if (searchQuery && !conn.ipAddress.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (statusFilter !== 'all' && (conn as unknown as { status: string }).status !== statusFilter) {
      return false;
    }
    return true;
  });
  
  const getConnectionStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
      case 'connected':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Wifi className="w-3 h-3 mr-1" />Online</Badge>;
      case 'OFFLINE':
      case 'disconnected':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><WifiOff className="w-3 h-3 mr-1" />Offline</Badge>;
      case 'DISCONNECTED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><WifiOff className="w-3 h-3 mr-1" />Disconnected</Badge>;
      case 'error':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  const getApprovalStatusBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Approved</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'REJECTED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };
  
  const getMappingTypeBadge = (type: string) => {
    switch (type) {
      case 'AUTO':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><RefreshCw className="w-3 h-3 mr-1" />Auto</Badge>;
      case 'MANUAL':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30"><Link2 className="w-3 h-3 mr-1" />Manual</Badge>;
      default:
        return <Badge variant="outline">{type}</Badge>;
    }
  };
  
  const pendingCount = mqttClients.filter(c => c.approvalStatus === 'PENDING').length;
  
  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" />
              Quản lý Mapping Thiết bị
              {pendingCount > 0 && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 ml-2">
                  {pendingCount} chờ duyệt
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Quản lý kết nối MQTT clients (Android) và kết nối thủ công tới máy
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchMqtt(); refetchManual(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Làm mới
            </Button>
            <Button size="sm" onClick={() => setCreateManualDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Thêm kết nối thủ công
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm theo tên, ID, IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ConnectionStatus)}>
            <SelectTrigger className="w-[180px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả trạng thái</SelectItem>
              <SelectItem value="ONLINE">Online</SelectItem>
              <SelectItem value="OFFLINE">Offline</SelectItem>
              <SelectItem value="DISCONNECTED">Disconnected</SelectItem>
              <SelectItem value="connected">Connected</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MappingType)}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">
              Tất cả ({mqttClients.length + manualConnections.length})
            </TabsTrigger>
            <TabsTrigger value="mqtt">
              <Smartphone className="w-4 h-4 mr-2" />
              MQTT Clients ({mqttClients.length})
            </TabsTrigger>
            <TabsTrigger value="manual">
              <Server className="w-4 h-4 mr-2" />
              Kết nối thủ công ({manualConnections.length})
            </TabsTrigger>
          </TabsList>
          
          {/* MQTT Clients Table */}
          {(activeTab === 'all' || activeTab === 'mqtt') && (
            <TabsContent value={activeTab} className="mt-0">
              {activeTab === 'all' && <h3 className="text-sm font-medium mb-2 text-muted-foreground">MQTT Clients (Android)</h3>}
              <div className="rounded-md border border-border/50 overflow-hidden mb-4">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Thiết bị</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Phê duyệt</TableHead>
                      <TableHead>Mapping</TableHead>
                      <TableHead>Trạm</TableHead>
                      <TableHead>Cài đặt</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingMqtt ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Đang tải...
                        </TableCell>
                      </TableRow>
                    ) : filteredMqttClients.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Chưa có MQTT client nào
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredMqttClients.map((client) => (
                        <TableRow key={`mqtt-${client.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Smartphone className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <div className="font-medium">{client.deviceName || 'Unnamed'}</div>
                                <div className="text-xs text-muted-foreground">{client.deviceModel || 'Unknown'}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{client.deviceId.slice(0, 12)}...</TableCell>
                          <TableCell>{getConnectionStatusBadge(client.connectionStatus)}</TableCell>
                          <TableCell>{getApprovalStatusBadge(client.approvalStatus)}</TableCell>
                          <TableCell>{getMappingTypeBadge(client.mappingType)}</TableCell>
                          <TableCell>
                            {client.stationId ? (
                              stations.find(s => s.id === client.stationId)?.name || `Station #${client.stationId}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {client.receiveNGAlerts && <Badge variant="outline" className="text-xs">NG</Badge>}
                              {client.receiveDailySummary && <Badge variant="outline" className="text-xs">Daily</Badge>}
                              {client.receiveWeeklySummary && <Badge variant="outline" className="text-xs">Weekly</Badge>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {client.approvalStatus === 'PENDING' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setApproveForm({ stationId: '', mappingType: 'MANUAL' });
                                      setApproveDialog({ open: true, client });
                                    }}
                                    className="text-green-400 hover:text-green-300"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => rejectMutation.mutate({ id: client.id })}
                                    className="text-red-400 hover:text-red-300"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              {client.approvalStatus === 'APPROVED' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditMqttDialog({ open: true, client })}
                                  >
                                    <Settings className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => disconnectMqttMutation.mutate({ id: client.id })}
                                    className="text-orange-400 hover:text-orange-300"
                                  >
                                    <Link2Off className="w-4 h-4" />
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteMqttMutation.mutate({ id: client.id })}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
          
          {/* Manual Connections Table */}
          {(activeTab === 'all' || activeTab === 'manual') && (
            <TabsContent value={activeTab} className="mt-0">
              {activeTab === 'all' && <h3 className="text-sm font-medium mb-2 text-muted-foreground mt-4">Kết nối thủ công</h3>}
              <div className="rounded-md border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Máy</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Port</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Retry</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingManual ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Đang tải...
                        </TableCell>
                      </TableRow>
                    ) : filteredManualConnections.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Chưa có kết nối thủ công nào
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredManualConnections.map((conn) => (
                        <TableRow key={`manual-${conn.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Server className="w-4 h-4 text-muted-foreground" />
                              <span>{machines.find(m => m.id === conn.machineId)?.name || `Machine #${conn.machineId}`}</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono">{conn.ipAddress}</TableCell>
                          <TableCell>{conn.port}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{conn.protocol}</Badge>
                          </TableCell>
                          <TableCell>{getConnectionStatusBadge((conn as unknown as { status: string }).status || 'disconnected')}</TableCell>
                          <TableCell>
                            <span className="text-muted-foreground">{conn.retryCount}/{conn.maxRetries}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => testManualMutation.mutate({ id: conn.id })}
                                disabled={testManualMutation.isPending}
                              >
                                <Wifi className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setEditManualDialog({ open: true, connection: conn })}
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => deleteManualMutation.mutate({ id: conn.id })}
                                className="text-red-400 hover:text-red-300"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
      
      {/* Approve Dialog */}
      <Dialog open={approveDialog.open} onOpenChange={(open) => setApproveDialog({ open, client: open ? approveDialog.client : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Phê duyệt thiết bị</DialogTitle>
            <DialogDescription>
              Phê duyệt thiết bị "{approveDialog.client?.deviceName || approveDialog.client?.deviceId}" để nhận bản tin lỗi
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Trạm (tùy chọn)</Label>
              <Select value={approveForm.stationId} onValueChange={(v) => setApproveForm(f => ({ ...f, stationId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn trạm" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Không chọn</SelectItem>
                  {stations.map(station => (
                    <SelectItem key={station.id} value={station.id.toString()}>{station.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Loại mapping</Label>
              <Select value={approveForm.mappingType} onValueChange={(v) => setApproveForm(f => ({ ...f, mappingType: v as 'AUTO' | 'MANUAL' }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Thủ công - Giữ mapping khi reconnect</SelectItem>
                  <SelectItem value="AUTO">Tự động - Cho phép reset mapping</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog({ open: false, client: null })}>Hủy</Button>
            <Button 
              onClick={() => {
                if (approveDialog.client) {
                  approveMutation.mutate({
                    id: approveDialog.client.id,
                    stationId: approveForm.stationId ? parseInt(approveForm.stationId) : undefined,
                    mappingType: approveForm.mappingType,
                  });
                }
              }}
              disabled={approveMutation.isPending}
            >
              Phê duyệt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Edit MQTT Client Dialog */}
      <Dialog open={editMqttDialog.open} onOpenChange={(open) => setEditMqttDialog({ open, client: open ? editMqttDialog.client : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cài đặt thiết bị MQTT</DialogTitle>
            <DialogDescription>
              Cập nhật mapping và cài đặt nhận thông báo
            </DialogDescription>
          </DialogHeader>
          {editMqttDialog.client && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Trạm</Label>
                <Select 
                  value={editMqttDialog.client.stationId?.toString() || ''} 
                  onValueChange={(v) => {
                    updateMqttMappingMutation.mutate({
                      id: editMqttDialog.client!.id,
                      stationId: v ? parseInt(v) : null,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Chọn trạm" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Không chọn</SelectItem>
                    {stations.map(station => (
                      <SelectItem key={station.id} value={station.id.toString()}>{station.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Loại mapping</Label>
                <Select 
                  value={editMqttDialog.client.mappingType} 
                  onValueChange={(v) => {
                    updateMqttMappingMutation.mutate({
                      id: editMqttDialog.client!.id,
                      stationId: editMqttDialog.client!.stationId || null,
                      mappingType: v as 'AUTO' | 'MANUAL',
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Thủ công</SelectItem>
                    <SelectItem value="AUTO">Tự động</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-3 pt-2 border-t">
                <Label>Nhận thông báo</Label>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Cảnh báo NG realtime</span>
                  <Switch 
                    checked={editMqttDialog.client.receiveNGAlerts}
                    onCheckedChange={(checked) => {
                      updateMqttSettingsMutation.mutate({
                        id: editMqttDialog.client!.id,
                        receiveNGAlerts: checked,
                      });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Báo cáo tổng hợp hàng ngày</span>
                  <Switch 
                    checked={editMqttDialog.client.receiveDailySummary}
                    onCheckedChange={(checked) => {
                      updateMqttSettingsMutation.mutate({
                        id: editMqttDialog.client!.id,
                        receiveDailySummary: checked,
                      });
                    }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Báo cáo tổng hợp hàng tuần</span>
                  <Switch 
                    checked={editMqttDialog.client.receiveWeeklySummary}
                    onCheckedChange={(checked) => {
                      updateMqttSettingsMutation.mutate({
                        id: editMqttDialog.client!.id,
                        receiveWeeklySummary: checked,
                      });
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMqttDialog({ open: false, client: null })}>Đóng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Create Manual Connection Dialog */}
      <Dialog open={createManualDialog} onOpenChange={setCreateManualDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thêm kết nối thủ công</DialogTitle>
            <DialogDescription>
              Tạo kết nối thủ công tới máy qua IP
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Máy</Label>
              <Select value={manualForm.machineId} onValueChange={(v) => setManualForm(f => ({ ...f, machineId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Chọn máy" />
                </SelectTrigger>
                <SelectContent>
                  {machines.map(machine => (
                    <SelectItem key={machine.id} value={machine.id.toString()}>{machine.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>IP Address</Label>
              <Input 
                value={manualForm.ipAddress} 
                onChange={(e) => setManualForm(f => ({ ...f, ipAddress: e.target.value }))}
                placeholder="192.168.1.100"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Port</Label>
                <Input 
                  type="number"
                  value={manualForm.port} 
                  onChange={(e) => setManualForm(f => ({ ...f, port: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select value={manualForm.protocol} onValueChange={(v) => setManualForm(f => ({ ...f, protocol: v as 'websocket' | 'tcp' | 'http' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="websocket">WebSocket</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="http">HTTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateManualDialog(false)}>Hủy</Button>
            <Button 
              onClick={() => {
                if (manualForm.machineId && manualForm.ipAddress) {
                  createManualMutation.mutate({
                    machineId: parseInt(manualForm.machineId),
                    ipAddress: manualForm.ipAddress,
                    port: parseInt(manualForm.port),
                    protocol: manualForm.protocol,
                  });
                }
              }}
              disabled={!manualForm.machineId || !manualForm.ipAddress || createManualMutation.isPending}
            >
              Tạo kết nối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
