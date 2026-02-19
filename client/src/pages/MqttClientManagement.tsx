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
  Smartphone, Plus, Trash2, CheckCircle, XCircle, 
  Clock, Wifi, WifiOff, RefreshCw, History, Settings,
  Heart, Server, MessageSquare,
  Search, Filter, Link2Off
} from "lucide-react";
import { useTranslation } from 'react-i18next';

type ConnectionStatus = 'all' | 'ONLINE' | 'OFFLINE' | 'DISCONNECTED' | 'connected' | 'disconnected' | 'error' | 'pending';
type ApprovalFilter = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED';

export default function MqttClientManagement() {
  const { t } = useTranslation();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<any>(null);
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ConnectionStatus>('all');
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('all');
  
  // Create client form
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

  // Approve dialog
  const [approveDialog, setApproveDialog] = useState<{ open: boolean; client: any }>({ open: false, client: null });
  const [approveForm, setApproveForm] = useState({ stationId: 'none', mappingType: 'MANUAL' as 'AUTO' | 'MANUAL' });

  // Manual connection
  const [createManualDialog, setCreateManualDialog] = useState(false);
  const [manualForm, setManualForm] = useState({
    machineId: '',
    ipAddress: '',
    port: '8080',
    protocol: 'websocket' as 'websocket' | 'tcp' | 'http',
  });

  // Queries
  const { data: clients = [], refetch: refetchClients } = trpc.mqttClient.list.useQuery({});
  const { data: stations = [] } = trpc.station.list.useQuery();
  const { data: machines = [] } = trpc.machine.list.useQuery();
  const { data: clientsHealth } = trpc.mqttClient.allClientsHealth.useQuery();
  const { data: manualConnections = [], refetch: refetchManual } = trpc.manualMapping.list.useQuery();
  const { data: connectionHistory } = trpc.mqttClient.connectionHistory.useQuery(
    { clientId: selectedClient || 0, limit: 20 },
    { enabled: !!selectedClient }
  );
  const { data: clientHealth } = trpc.mqttClient.clientHealth.useQuery(
    { clientId: selectedClient || 0 },
    { enabled: !!selectedClient }
  );

  // MQTT Client Mutations
  const createMutation = trpc.mqttClient.create.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.clientCreated'));
      setIsCreateDialogOpen(false);
      resetForm();
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMutation = trpc.mqttClient.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.clientUpdated'));
      setEditingClient(null);
      resetForm();
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.mqttClient.delete.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.clientDeleted'));
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const approveMutation = trpc.mqttClient.approve.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.deviceApproved'));
      refetchClients();
      setApproveDialog({ open: false, client: null });
    },
    onError: (error) => toast.error(error.message),
  });

  const rejectMutation = trpc.mqttClient.reject.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.deviceRejected'));
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  const updateMappingMutation = trpc.mqttClient.updateMapping.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.mappingUpdated'));
      refetchClients();
      setEditingClient(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const disconnectMutation = trpc.mqttClient.disconnectAndReset.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.disconnectResetDone'));
      refetchClients();
    },
    onError: (error) => toast.error(error.message),
  });

  // Manual Connection Mutations
  const createManualMutation = trpc.manualMapping.create.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.manualConnectionCreated'));
      refetchManual();
      setCreateManualDialog(false);
      setManualForm({ machineId: '', ipAddress: '', port: '8080', protocol: 'websocket' });
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteManualMutation = trpc.manualMapping.delete.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.connectionDeleted'));
      refetchManual();
    },
    onError: (error) => toast.error(error.message),
  });

  const testManualMutation = trpc.manualMapping.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t('mqtt.clientMgmt.connectionSuccess', { latency: result.latencyMs }));
      } else {
        toast.error(t('mqtt.clientMgmt.connectionFailed', { message: result.message }));
      }
      refetchManual();
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
      toast.error(t('mqtt.clientMgmt.enterDeviceIdAndName'));
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

  // Filter clients
  const filteredClients = clients.filter(client => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!client.deviceName?.toLowerCase().includes(query) && 
          !client.deviceId.toLowerCase().includes(query)) {
        return false;
      }
    }
    if (statusFilter !== 'all' && client.connectionStatus !== statusFilter) {
      return false;
    }
    if (approvalFilter !== 'all' && client.approvalStatus !== approvalFilter) {
      return false;
    }
    return true;
  });

  const filteredManualConnections = manualConnections.filter(conn => {
    if (searchQuery && !conn.ipAddress.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const pendingCount = clients.filter(c => c.approvalStatus === 'PENDING').length;

  // Badge helpers
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ONLINE':
      case 'connected':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><Wifi className="w-3 h-3 mr-1" /> Online</Badge>;
      case 'OFFLINE':
      case 'disconnected':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30"><WifiOff className="w-3 h-3 mr-1" /> Offline</Badge>;
      case 'DISCONNECTED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Disconnected</Badge>;
      case 'error':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Error</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'PENDING':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'REJECTED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {t('mqtt.clientMgmt.title')}
              {pendingCount > 0 && (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                  {pendingCount} {t('mqtt.clientMgmt.pendingApproval')}
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground">{t('mqtt.clientMgmt.description')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { refetchClients(); refetchManual(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" onClick={() => setCreateManualDialog(true)}>
              <Server className="w-4 h-4 mr-2" />
              {t('mqtt.clientMgmt.addManualConnection')}
            </Button>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  {t('mqtt.clientMgmt.addClient')}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('mqtt.addClient')}</DialogTitle>
                  <DialogDescription>{t('mqtt.clientMgmt.createClientDesc')}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Device ID *</Label>
                    <Input
                      value={formData.deviceId}
                      onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                      placeholder={t('mqtt.clientMgmt.enterDeviceId')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Device Name *</Label>
                    <Input
                      value={formData.deviceName}
                      onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                      placeholder={t('mqtt.clientMgmt.enterDeviceName')}
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
                    <Label>{t('mqtt.clientMgmt.workstation')}</Label>
                    <Select
                      value={formData.stationId?.toString() || "none"}
                      onValueChange={(value) => setFormData({ ...formData, stationId: value === "none" ? null : parseInt(value) })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('mqtt.clientMgmt.selectWorkstation')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('mqtt.clientMgmt.noSelection')}</SelectItem>
                        {stations?.map((station) => (
                          <SelectItem key={station.id} value={station.id.toString()}>
                            {station.name} ({station.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{t('mqtt.clientMgmt.receiveNgAlerts')}</Label>
                    <Switch
                      checked={formData.receiveNGAlerts}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveNGAlerts: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{t('mqtt.clientMgmt.receiveDailySummary')}</Label>
                    <Switch
                      checked={formData.receiveDailySummary}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveDailySummary: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{t('mqtt.clientMgmt.receiveWeeklySummary')}</Label>
                    <Switch
                      checked={formData.receiveWeeklySummary}
                      onCheckedChange={(checked) => setFormData({ ...formData, receiveWeeklySummary: checked })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending ? t('mqtt.clientMgmt.creating') : t('mqtt.clientMgmt.createClient')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder={t('mqtt.clientMgmt.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ConnectionStatus)}>
                <SelectTrigger className="w-[180px]">
                  <Wifi className="w-4 h-4 mr-2" />
                  <SelectValue placeholder={t('mqtt.clientMgmt.connectionStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('mqtt.clientMgmt.allStatuses')}</SelectItem>
                  <SelectItem value="ONLINE">Online</SelectItem>
                  <SelectItem value="OFFLINE">Offline</SelectItem>
                  <SelectItem value="DISCONNECTED">Disconnected</SelectItem>
                </SelectContent>
              </Select>
              <Select value={approvalFilter} onValueChange={(v) => setApprovalFilter(v as ApprovalFilter)}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder={t('mqtt.clientMgmt.approvalStatus')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  <SelectItem value="PENDING">{t('mqtt.clientMgmt.pendingFilter')}</SelectItem>
                  <SelectItem value="APPROVED">{t('mqtt.clientMgmt.approvedFilter')}</SelectItem>
                  <SelectItem value="REJECTED">{t('mqtt.clientMgmt.rejectedFilter')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Main Tabs */}
        <Tabs defaultValue="clients" className="space-y-4">
          <TabsList>
            <TabsTrigger value="clients" className="gap-2">
              <Smartphone className="w-4 h-4" />
              MQTT Clients ({filteredClients.length})
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-2">
              <Server className="w-4 h-4" />
              {t('mqtt.clientMgmt.manualConnections')} ({manualConnections.length})
            </TabsTrigger>
            <TabsTrigger value="health" className="gap-2">
              <Heart className="w-4 h-4" />
              {t('mqtt.clientMgmt.health')}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="w-4 h-4" />
              {t('mqtt.clientMgmt.historyTab')}
            </TabsTrigger>
          </TabsList>

          {/* MQTT Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.clientMgmt.clientList')}</CardTitle>
                <CardDescription>{t('mqtt.clientMgmt.deviceDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.clientMgmt.device')}</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>{t('mqtt.clientMgmt.connection')}</TableHead>
                      <TableHead>{t('mqtt.clientMgmt.approvalHeader')}</TableHead>
                      <TableHead>{t('mqtt.clientMgmt.workstationHeader')}</TableHead>
                      <TableHead>{t('mqtt.clientMgmt.notifications')}</TableHead>
                      <TableHead>Last Seen</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{client.deviceName || 'Unnamed'}</div>
                              <div className="text-xs text-muted-foreground">{client.deviceModel || 'Unknown'}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{client.deviceId.slice(0, 16)}...</TableCell>
                        <TableCell>{getStatusBadge(client.connectionStatus)}</TableCell>
                        <TableCell>{getApprovalBadge(client.approvalStatus)}</TableCell>
                        <TableCell>
                          {client.stationId ? (
                            <Badge variant="outline">
                              {stations.find(s => s.id === client.stationId)?.name || `#${client.stationId}`}
                            </Badge>
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
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(client.lastHeartbeat)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {/* Approve/Reject for PENDING */}
                            {client.approvalStatus === 'PENDING' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setApproveForm({ stationId: 'none', mappingType: 'MANUAL' });
                                    setApproveDialog({ open: true, client });
                                  }}
                                  className="text-green-400 hover:text-green-300"
                                  title={t('mqtt.clientMgmt.approve')}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => rejectMutation.mutate({ id: client.id })}
                                  className="text-red-400 hover:text-red-300"
                                  title={t('mqtt.clientMgmt.reject')}
                                >
                                  <XCircle className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {/* Edit/Disconnect for APPROVED */}
                            {client.approvalStatus === 'APPROVED' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
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
                                  title={t('common.edit')}
                                >
                                  <Settings className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => disconnectMutation.mutate({ id: client.id })}
                                  className="text-orange-400 hover:text-orange-300"
                                  title={t('mqtt.clientMgmt.disconnectReset')}
                                >
                                  <Link2Off className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                            {/* Delete for all */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => {
                                if (confirm(t('mqtt.clientMgmt.confirmDeleteClient'))) {
                                  deleteMutation.mutate({ id: client.id });
                                }
                              }}
                              title={t('common.delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredClients.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          {clients.length === 0 ? t('mqtt.clientMgmt.noClients') : t('mqtt.clientMgmt.noMatchingClients')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manual Connections Tab */}
          <TabsContent value="manual">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.clientMgmt.manualConnections')}</CardTitle>
                <CardDescription>{t('mqtt.clientMgmt.manualConnectionsDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('mqtt.clientMgmt.machine')}</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Port</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>Retry</TableHead>
                      <TableHead className="text-right">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredManualConnections.map((conn) => (
                      <TableRow key={conn.id}>
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
                        <TableCell>{getStatusBadge((conn as unknown as { status: string }).status || 'disconnected')}</TableCell>
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
                              title={t('mqtt.testConnection')}
                            >
                              <Wifi className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteManualMutation.mutate({ id: conn.id })}
                              className="text-red-400 hover:text-red-300"
                              title={t('common.delete')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {manualConnections.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {t('mqtt.clientMgmt.noManualConnections')}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Health Tab */}
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
                    {t('mqtt.clientMgmt.noHealthData')}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="text-base">{t('mqtt.clientMgmt.selectClient')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-auto">
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
                  <CardTitle className="text-base">{t('mqtt.clientMgmt.connectionHistory')}</CardTitle>
                  <CardDescription>
                    {selectedClient ? `Client ID: ${selectedClient}` : t('mqtt.clientMgmt.selectClientForHistory')}
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
                        <TableHead>{t('mqtt.clientMgmt.timeHeader')}</TableHead>
                        <TableHead>{t('mqtt.clientMgmt.typeHeader')}</TableHead>
                        <TableHead>{t('common.status')}</TableHead>
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
                            {selectedClient ? t('mqtt.clientMgmt.noHistory') : t('mqtt.clientMgmt.selectClientForHistory')}
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

        {/* Approve Dialog */}
        <Dialog open={approveDialog.open} onOpenChange={(open) => setApproveDialog({ open, client: open ? approveDialog.client : null })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('mqtt.clientMgmt.approveDevice')}</DialogTitle>
              <DialogDescription>
                {t('mqtt.clientMgmt.approveDeviceDesc', { device: approveDialog.client?.deviceName || approveDialog.client?.deviceId })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('mqtt.clientMgmt.workstationOptional')}</Label>
                <Select value={approveForm.stationId} onValueChange={(v) => setApproveForm(f => ({ ...f, stationId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('mqtt.clientMgmt.selectWorkstation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('mqtt.clientMgmt.noSelection')}</SelectItem>
                    {stations.map(station => (
                      <SelectItem key={station.id} value={station.id.toString()}>{station.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('mqtt.clientMgmt.mappingType')}</Label>
                <Select value={approveForm.mappingType} onValueChange={(v) => setApproveForm(f => ({ ...f, mappingType: v as 'AUTO' | 'MANUAL' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">{t('mqtt.clientMgmt.manualMapping')}</SelectItem>
                    <SelectItem value="AUTO">{t('mqtt.clientMgmt.autoMapping')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveDialog({ open: false, client: null })}>{t('common.cancel')}</Button>
              <Button 
                onClick={() => {
                  if (approveDialog.client) {
                    approveMutation.mutate({
                      id: approveDialog.client.id,
                      stationId: approveForm.stationId && approveForm.stationId !== 'none' ? parseInt(approveForm.stationId) : undefined,
                      mappingType: approveForm.mappingType,
                    });
                  }
                }}
                disabled={approveMutation.isPending}
              >
                {t('mqtt.clientMgmt.approve')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Client Dialog */}
        <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('mqtt.editClient')}</DialogTitle>
              <DialogDescription>{t('mqtt.clientMgmt.updateSettingsFor')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Device Name</Label>
                <Input
                  value={formData.deviceName}
                  onChange={(e) => setFormData({ ...formData, deviceName: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>{t('mqtt.clientMgmt.workstation')}</Label>
                <Select
                  value={formData.stationId?.toString() || "none"}
                  onValueChange={(value) => {
                    const newStationId = value === "none" ? null : parseInt(value);
                    setFormData({ ...formData, stationId: newStationId });
                    if (editingClient) {
                      updateMappingMutation.mutate({
                        id: editingClient.id,
                        stationId: newStationId,
                        mappingType: formData.mappingType,
                      });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('mqtt.clientMgmt.selectWorkstation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('mqtt.clientMgmt.noSelection')}</SelectItem>
                    {stations?.map((station) => (
                      <SelectItem key={station.id} value={station.id.toString()}>
                        {station.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('mqtt.clientMgmt.receiveNGAlerts')}</Label>
                <Switch
                  checked={formData.receiveNGAlerts}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveNGAlerts: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('mqtt.clientMgmt.receiveDailySummary')}</Label>
                <Switch
                  checked={formData.receiveDailySummary}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveDailySummary: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t('mqtt.clientMgmt.receiveWeeklySummary')}</Label>
                <Switch
                  checked={formData.receiveWeeklySummary}
                  onCheckedChange={(checked) => setFormData({ ...formData, receiveWeeklySummary: checked })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingClient(null)}>{t('common.cancel')}</Button>
              <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? t('mqtt.clientMgmt.saving') : t('mqtt.clientMgmt.saveChanges')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Manual Connection Dialog */}
        <Dialog open={createManualDialog} onOpenChange={setCreateManualDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('mqtt.clientMgmt.addManualConnection')}</DialogTitle>
              <DialogDescription>{t('mqtt.clientMgmt.createManualDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('mqtt.clientMgmt.machine')}</Label>
                <Select value={manualForm.machineId} onValueChange={(v) => setManualForm(f => ({ ...f, machineId: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('mqtt.clientMgmt.selectMachine')} />
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
              <Button variant="outline" onClick={() => setCreateManualDialog(false)}>{t('common.cancel')}</Button>
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
                {t('mqtt.clientMgmt.createConnection')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
