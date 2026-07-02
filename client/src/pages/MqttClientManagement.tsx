import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Smartphone, Plus, Trash2, CheckCircle, XCircle, 
  Clock, Wifi, WifiOff, RefreshCw, History, Settings,
  Heart, Server, MessageSquare, Send, Download,
  Search, Filter, Link2Off, Cog
} from "lucide-react";
import { useTranslation } from 'react-i18next';
import { SoftwareVersionsTab } from "./SoftwareVersionsTab";

type ConnectionStatus = 'all' | 'ONLINE' | 'OFFLINE' | 'DISCONNECTED' | 'connected' | 'disconnected' | 'error' | 'pending';
type ApprovalFilter = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED';

export function MqttClientManagementContent() {
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

  // Edit dialog MQTT connection config
  const [editMqttConfig, setEditMqttConfig] = useState({
    enabled: false,
    brokerAddress: '',
    port: 1883,
    protocol: 'tcp' as 'tcp' | 'websocket',
    useSSL: false,
    keepAlive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  });

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
  const { data: workstations = [] } = trpc.workstation.list.useQuery();
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

  // Single-device configure — reuses bulk config dialog
  const [singleConfigClient, setSingleConfigClient] = useState<any>(null);

  // Multi-select & Bulk configure state
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [bulkConfigOpen, setBulkConfigOpen] = useState(false);

  // Bulk config form — each section has `enabled` toggle + values
  const [bulkConfig, setBulkConfig] = useState({
    // Assignment
    stationId: 'none' as string,
    processId: 'none' as string,
    workstationId: 'none' as string,
    filterPointsByWorkstation: false,
    // MQTT
    mqttEnabled: false,
    mqtt: {
      brokerAddress: '',
      port: 1883,
      protocol: 'tcp' as 'tcp' | 'websocket',
      useSSL: false,
      keepAlive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 30000,
    },
    // Notifications
    notifEnabled: false,
    notification: {
      enabled: true,
      sound: true,
      vibration: true,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      floatingBubbleEnabled: true,
    },
    // App
    appEnabled: false,
    app: {
      language: 'vi' as 'vi' | 'en' | 'zh',
      theme: 'dark' as 'light' | 'dark' | 'system',
      autoReconnect: true,
      keepScreenOn: true,
      alertAnimationEnabled: true,
      alertAnimationType: 'bomb' as 'bomb' | 'alarm' | 'triangle',
      alertAnimationDurationSec: 3,
      proactivePollingEnabled: false,
      proactivePollingIntervalSec: 60,
      ngAutoClearColor: false,
      ngMarkerScale: 1.5,
      canvasImageMode: 'fit' as 'fit' | 'fill' | 'cover',
      debugMode: false,
      mqttHealthCheckInterval: 15000,
      mqttRetryMaxAttempts: 5,
      mqttRetryInterval: 10000,
      subscriptionMode: 'manual' as 'manual' | 'hierarchy',
      maxQueueSize: 100,
      alertRetentionDays: 7,
      ngFlashDurationMs: 500,
      ngBubbleDismissSec: 10,
      ngExplosionDismissSec: 5,
      autoCheckUpdate: true,
    },
    // Post-configure action
    restartAfterConfigure: false,
  });

  const sendBulkConfigureMutation = trpc.mqttClient.sendBulkConfigure.useMutation({
    onSuccess: (result) => {
      if (result.failed > 0) {
        toast.warning(t('mqtt.clientMgmt.bulkConfigPartial', { succeeded: result.succeeded, failed: result.failed }));
      } else {
        toast.success(t('mqtt.clientMgmt.bulkConfigSuccess', { count: result.succeeded }));
      }
      // Restart apps after configure if requested
      if (bulkConfig.restartAfterConfigure) {
        const succeededDevices = result.results.filter((r: any) => r.success).map((r: any) => r.deviceId);
        for (const deviceId of succeededDevices) {
          sendCommandMutation.mutate({ deviceId, command: 'RESTART_APP' });
        }
        if (succeededDevices.length > 0) {
          toast.info(t('mqtt.clientMgmt.restartCommandSent', { count: succeededDevices.length }));
        }
      }
      setBulkConfigOpen(false);
      setSingleConfigClient(null);
      setSelectedDeviceIds(new Set());
    },
    onError: (error) => toast.error(error.message),
  });

  const sendCommandMutation = trpc.mqttClient.sendCommand.useMutation({
    onSuccess: () => {
      toast.success(t('mqtt.clientMgmt.commandSent'));
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
    // Also push MQTT connection settings if enabled
    if (editMqttConfig.enabled) {
      sendBulkConfigureMutation.mutate({
        deviceIds: [editingClient.deviceId],
        profile: {
          mqtt: {
            brokerAddress: editMqttConfig.brokerAddress,
            port: editMqttConfig.port,
            protocol: editMqttConfig.protocol,
            useSSL: editMqttConfig.useSSL,
            keepAlive: editMqttConfig.keepAlive,
            reconnectPeriod: editMqttConfig.reconnectPeriod,
            connectTimeout: editMqttConfig.connectTimeout,
          },
        },
      });
    }
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

  // Multi-select helpers
  const approvedFilteredClients = useMemo(() => filteredClients.filter(c => c.approvalStatus === 'APPROVED'), [filteredClients]);
  const allFilteredSelected = approvedFilteredClients.length > 0 && approvedFilteredClients.every(c => selectedDeviceIds.has(c.deviceId));

  const toggleSelectDevice = (deviceId: string) => {
    setSelectedDeviceIds(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedDeviceIds(new Set());
    } else {
      setSelectedDeviceIds(new Set(approvedFilteredClients.map(c => c.deviceId)));
    }
  };

  const handleBulkConfigure = () => {
    const profile: Record<string, any> = {};

    // Station/process assignment
    if (bulkConfig.stationId !== 'none') profile.stationId = parseInt(bulkConfig.stationId);
    if (bulkConfig.processId !== 'none') profile.processId = parseInt(bulkConfig.processId);

    // MQTT settings
    if (bulkConfig.mqttEnabled) {
      profile.mqtt = { ...bulkConfig.mqtt };
    }

    // Notification settings
    if (bulkConfig.notifEnabled) {
      profile.notification = { ...bulkConfig.notification };
    }

    // App settings (include workstationId & filterPointsByWorkstation)
    if (bulkConfig.appEnabled) {
      profile.app = { ...bulkConfig.app };
    }
    // Workstation assignment goes into app section even if appEnabled is off
    if (bulkConfig.workstationId !== 'none' || bulkConfig.filterPointsByWorkstation) {
      if (!profile.app) profile.app = {};
      if (bulkConfig.workstationId !== 'none') profile.app.workstationId = parseInt(bulkConfig.workstationId);
      profile.app.filterPointsByWorkstation = bulkConfig.filterPointsByWorkstation;
    }

    // Determine target devices: single device or multi-select
    const deviceIds = singleConfigClient
      ? [singleConfigClient.deviceId]
      : Array.from(selectedDeviceIds);

    sendBulkConfigureMutation.mutate({
      deviceIds,
      profile,
    });
  };

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
        return <Badge className="bg-success/20 text-success border-success/30"><Wifi className="w-3 h-3 mr-1" /> Online</Badge>;
      case 'OFFLINE':
      case 'disconnected':
        return <Badge className="bg-muted text-muted-foreground border-border"><WifiOff className="w-3 h-3 mr-1" /> Offline</Badge>;
      case 'DISCONNECTED':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="w-3 h-3 mr-1" /> Disconnected</Badge>;
      case 'error':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="w-3 h-3 mr-1" /> Error</Badge>;
      case 'pending':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getApprovalBadge = (status: string) => {
    switch (status) {
      case 'APPROVED':
        return <Badge className="bg-success/20 text-success border-success/30"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'PENDING':
        return <Badge className="bg-warning/20 text-warning border-warning/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'REJECTED':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getHealthBadge = (score: number) => {
    if (score >= 80) return <Badge className="bg-success/20 text-success">{score}%</Badge>;
    if (score >= 50) return <Badge className="bg-warning/20 text-warning">{score}%</Badge>;
    return <Badge className="bg-destructive/20 text-destructive">{score}%</Badge>;
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleString('vi-VN');
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Smartphone className="w-6 h-6" />}
          title={
            <span className="flex items-center gap-2">
              {t('mqtt.clientMgmt.title')}
              {pendingCount > 0 && (
                <Badge className="bg-warning/20 text-warning border-warning/30">
                  {pendingCount} {t('mqtt.clientMgmt.pendingApproval')}
                </Badge>
              )}
            </span>
          }
          description={t('mqtt.clientMgmt.description')}
          actions={
            <>
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
            </>
          }
        />

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
                <SelectTrigger className="w-45">
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
                <SelectTrigger className="w-45">
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
            <TabsTrigger value="software" className="gap-2">
              <Download className="w-4 h-4" />
              {t('mqtt.versions.tab')}
            </TabsTrigger>
          </TabsList>

          {/* MQTT Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <CardTitle>{t('mqtt.clientMgmt.clientList')}</CardTitle>
                <CardDescription>{t('mqtt.clientMgmt.deviceDesc')}</CardDescription>
              </CardHeader>
              {/* Bulk action bar */}
              {selectedDeviceIds.size > 0 && (
                <div className="mx-6 mb-4 p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t('mqtt.clientMgmt.selectedCount', { count: selectedDeviceIds.size })}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedDeviceIds(new Set())}>
                      {t('mqtt.clientMgmt.clearSelection')}
                    </Button>
                    <Button size="sm" onClick={() => setBulkConfigOpen(true)}>
                      <Cog className="w-4 h-4 mr-2" />
                      {t('mqtt.clientMgmt.configureSelected')}
                    </Button>
                  </div>
                </div>
              )}
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>{t('mqtt.clientMgmt.device')}</TableHead>
                      <TableHead>Device ID</TableHead>
                      <TableHead>Device Info</TableHead>
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
                          <Checkbox
                            checked={selectedDeviceIds.has(client.deviceId)}
                            onCheckedChange={() => toggleSelectDevice(client.deviceId)}
                            disabled={client.approvalStatus !== 'APPROVED'}
                            aria-label={`Select ${client.deviceName || client.deviceId}`}
                          />
                        </TableCell>
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
                        <TableCell>
                          <div className="text-xs space-y-0.5">
                            {client.brand && <div><span className="text-muted-foreground">Brand:</span> {client.brand}</div>}
                            {client.ipAddress && <div><span className="text-muted-foreground">IP:</span> {client.ipAddress}</div>}
                            {client.osVersion && <div><span className="text-muted-foreground">OS:</span> {client.osVersion}</div>}
                            {client.appVersion && <div><span className="text-muted-foreground">App:</span> {client.appVersion}</div>}
                            {!client.brand && !client.ipAddress && <span className="text-muted-foreground">-</span>}
                          </div>
                        </TableCell>
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
                                  className="text-success hover:text-success/80"
                                  title={t('mqtt.clientMgmt.approve')}
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => rejectMutation.mutate({ id: client.id })}
                                  className="text-destructive hover:text-destructive/80"
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
                                    setEditMqttConfig({
                                      enabled: false,
                                      brokerAddress: '',
                                      port: 1883,
                                      protocol: 'tcp',
                                      useSSL: false,
                                      keepAlive: 60,
                                      reconnectPeriod: 5000,
                                      connectTimeout: 30000,
                                    });
                                  }}
                                  title={t('common.edit')}
                                >
                                  <Settings className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    // Reset bulkConfig with current device's assignment pre-filled
                                    setBulkConfig(c => ({
                                      ...c,
                                      stationId: client.stationId ? String(client.stationId) : 'none',
                                      processId: client.processId ? String(client.processId) : 'none',
                                      workstationId: 'none',
                                      filterPointsByWorkstation: false,
                                      mqttEnabled: false,
                                      notifEnabled: false,
                                      appEnabled: false,
                                      restartAfterConfigure: false,
                                    }));
                                    setSingleConfigClient(client);
                                    setBulkConfigOpen(true);
                                  }}
                                  className="text-info hover:text-info/80"
                                  title="Send Configure"
                                >
                                  <Send className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => disconnectMutation.mutate({ id: client.id })}
                                  className="text-warning hover:text-warning/80"
                                  title={t('mqtt.clientMgmt.disconnectReset')}
                                >
                                  <Link2Off className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    sendCommandMutation.mutate({ deviceId: client.deviceId, command: 'CHECK_UPDATE' });
                                  }}
                                  className="text-success hover:text-success/80"
                                  title={t('mqtt.clientMgmt.pushUpdateToDevice')}
                                >
                                  <Download className="w-4 h-4" />
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
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
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
                              className="text-destructive hover:text-destructive/80"
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
                          <CheckCircle className="w-3 h-3 text-success" />
                          <span>Success: {health?.messageStats.successRate}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <XCircle className="w-3 h-3 text-destructive" />
                          <span>Failed: {health?.messageStats.failed}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-warning" />
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
                          <div className="text-2xl font-bold text-success">{clientHealth.messageStats.delivered}</div>
                          <div className="text-xs text-muted-foreground">Delivered</div>
                        </div>
                        <div>
                          <div className="text-2xl font-bold text-destructive">{clientHealth.messageStats.failed}</div>
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
                            {log.status === 'DELIVERED' && <Badge className="bg-success/20 text-success">Delivered</Badge>}
                            {log.status === 'FAILED' && <Badge className="bg-destructive/20 text-destructive">Failed</Badge>}
                            {log.status === 'PENDING' && <Badge className="bg-warning/20 text-warning">Pending</Badge>}
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

          {/* Software Versions Tab */}
          <TabsContent value="software">
            <SoftwareVersionsTab />
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
          <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>{t('mqtt.editClient')}</DialogTitle>
              <DialogDescription>{t('mqtt.clientMgmt.updateSettingsFor')}</DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-4">
              <Tabs defaultValue="general" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="general">{t('mqtt.clientMgmt.tabGeneral', 'Cài đặt chung')}</TabsTrigger>
                  <TabsTrigger value="mqtt">{t('mqtt.clientMgmt.tabMqtt')}</TabsTrigger>
                </TabsList>

                {/* General Settings Tab */}
                <TabsContent value="general" className="space-y-4 mt-4">
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
                  <div className="grid gap-2">
                    <Label>{t('mqtt.clientMgmt.mappingType')}</Label>
                    <Select
                      value={formData.mappingType}
                      onValueChange={(value) => {
                        const newMappingType = value as 'AUTO' | 'MANUAL';
                        setFormData({ ...formData, mappingType: newMappingType });
                        if (editingClient) {
                          updateMappingMutation.mutate({
                            id: editingClient.id,
                            stationId: formData.stationId,
                            mappingType: newMappingType,
                          });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MANUAL">{t('mqtt.clientMgmt.manualMapping')}</SelectItem>
                        <SelectItem value="AUTO">{t('mqtt.clientMgmt.autoMapping')}</SelectItem>
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
                </TabsContent>

                {/* MQTT Connection Settings Tab */}
                <TabsContent value="mqtt" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Label className="font-medium">{t('mqtt.clientMgmt.enableMqttSection')}</Label>
                    <Switch checked={editMqttConfig.enabled} onCheckedChange={(v) => setEditMqttConfig(c => ({ ...c, enabled: v }))} />
                  </div>
                  {editMqttConfig.enabled && (
                    <div className="space-y-4 pl-1">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.brokerAddress')}</Label>
                          <Input
                            value={editMqttConfig.brokerAddress}
                            onChange={(e) => setEditMqttConfig(c => ({ ...c, brokerAddress: e.target.value }))}
                            placeholder="192.168.1.100"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.brokerPort')}</Label>
                          <Input
                            type="number"
                            value={editMqttConfig.port}
                            onChange={(e) => setEditMqttConfig(c => ({ ...c, port: parseInt(e.target.value) || 1883 }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.protocol')}</Label>
                          <Select
                            value={editMqttConfig.protocol}
                            onValueChange={(v) => setEditMqttConfig(c => ({ ...c, protocol: v as 'tcp' | 'websocket' }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tcp">TCP</SelectItem>
                              <SelectItem value="websocket">WebSocket</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between pt-6">
                          <Label>{t('mqtt.clientMgmt.useSSL')}</Label>
                          <Switch
                            checked={editMqttConfig.useSSL}
                            onCheckedChange={(v) => setEditMqttConfig(c => ({ ...c, useSSL: v }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.keepAlive')}</Label>
                          <Input
                            type="number"
                            value={editMqttConfig.keepAlive}
                            onChange={(e) => setEditMqttConfig(c => ({ ...c, keepAlive: parseInt(e.target.value) || 60 }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.reconnectPeriod')}</Label>
                          <Input
                            type="number"
                            value={editMqttConfig.reconnectPeriod}
                            onChange={(e) => setEditMqttConfig(c => ({ ...c, reconnectPeriod: parseInt(e.target.value) || 5000 }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.connectTimeout')}</Label>
                          <Input
                            type="number"
                            value={editMqttConfig.connectTimeout}
                            onChange={(e) => setEditMqttConfig(c => ({ ...c, connectTimeout: parseInt(e.target.value) || 30000 }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </ScrollArea>
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

        {/* Configure Dialog (single device & bulk) */}
        <Dialog open={bulkConfigOpen} onOpenChange={(open) => { setBulkConfigOpen(open); if (!open) setSingleConfigClient(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>
                {singleConfigClient
                  ? t('mqtt.clientMgmt.sendConfigureTitle')
                  : t('mqtt.clientMgmt.bulkConfigTitle')
                }
              </DialogTitle>
              <DialogDescription>
                {singleConfigClient
                  ? t('mqtt.clientMgmt.sendConfigureDesc', { device: singleConfigClient.deviceName || singleConfigClient.deviceId })
                  : t('mqtt.clientMgmt.bulkConfigDesc', { count: selectedDeviceIds.size })
                }
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-4">
              <Tabs defaultValue="assignment" className="w-full">
                <TabsList className="flex flex-wrap h-auto gap-1">
                  <TabsTrigger value="assignment">{t('mqtt.clientMgmt.tabAssignment')}</TabsTrigger>
                  <TabsTrigger value="mqtt">{t('mqtt.clientMgmt.tabMqtt')}</TabsTrigger>
                  <TabsTrigger value="notification">{t('mqtt.clientMgmt.tabNotification')}</TabsTrigger>
                  <TabsTrigger value="app">{t('mqtt.clientMgmt.tabApp')}</TabsTrigger>
                  <TabsTrigger value="advanced">{t('mqtt.clientMgmt.tabAdvanced')}</TabsTrigger>
                </TabsList>

                {/* Assignment Tab */}
                <TabsContent value="assignment" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>{t('mqtt.clientMgmt.workstation')}</Label>
                    <Select value={bulkConfig.stationId} onValueChange={(v) => setBulkConfig(c => ({ ...c, stationId: v }))}>
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
                    <Label>{t('mqtt.clientMgmt.process')}</Label>
                    <Select value={bulkConfig.processId} onValueChange={(v) => setBulkConfig(c => ({ ...c, processId: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('mqtt.clientMgmt.selectProcess')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('mqtt.clientMgmt.noSelection')}</SelectItem>
                        {machines.map(machine => (
                          <SelectItem key={machine.id} value={machine.id.toString()}>{machine.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('mqtt.clientMgmt.workstationPoint')}</Label>
                    <Select value={bulkConfig.workstationId} onValueChange={(v) => setBulkConfig(c => ({ ...c, workstationId: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('mqtt.clientMgmt.selectWorkstationPoint')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('mqtt.clientMgmt.noSelection')}</SelectItem>
                        {workstations.map(ws => (
                          <SelectItem key={ws.id} value={ws.id.toString()}>{ws.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>{t('mqtt.clientMgmt.filterPointsByWorkstation')}</Label>
                    <Switch
                      checked={bulkConfig.filterPointsByWorkstation}
                      onCheckedChange={(v) => setBulkConfig(c => ({ ...c, filterPointsByWorkstation: v }))}
                    />
                  </div>
                </TabsContent>

                {/* MQTT Settings Tab */}
                <TabsContent value="mqtt" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Label className="font-medium">{t('mqtt.clientMgmt.enableMqttSection')}</Label>
                    <Switch checked={bulkConfig.mqttEnabled} onCheckedChange={(v) => setBulkConfig(c => ({ ...c, mqttEnabled: v }))} />
                  </div>
                  {bulkConfig.mqttEnabled && (
                    <div className="space-y-4 pl-1">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.brokerAddress')}</Label>
                          <Input
                            value={bulkConfig.mqtt.brokerAddress}
                            onChange={(e) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, brokerAddress: e.target.value } }))}
                            placeholder="192.168.1.100"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.brokerPort')}</Label>
                          <Input
                            type="number"
                            value={bulkConfig.mqtt.port}
                            onChange={(e) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, port: parseInt(e.target.value) || 1883 } }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.protocol')}</Label>
                          <Select
                            value={bulkConfig.mqtt.protocol}
                            onValueChange={(v) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, protocol: v as 'tcp' | 'websocket' } }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tcp">TCP</SelectItem>
                              <SelectItem value="websocket">WebSocket</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center justify-between pt-6">
                          <Label>{t('mqtt.clientMgmt.useSSL')}</Label>
                          <Switch
                            checked={bulkConfig.mqtt.useSSL}
                            onCheckedChange={(v) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, useSSL: v } }))}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.keepAlive')}</Label>
                          <Input
                            type="number"
                            value={bulkConfig.mqtt.keepAlive}
                            onChange={(e) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, keepAlive: parseInt(e.target.value) || 60 } }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.reconnectPeriod')}</Label>
                          <Input
                            type="number"
                            value={bulkConfig.mqtt.reconnectPeriod}
                            onChange={(e) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, reconnectPeriod: parseInt(e.target.value) || 5000 } }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.connectTimeout')}</Label>
                          <Input
                            type="number"
                            value={bulkConfig.mqtt.connectTimeout}
                            onChange={(e) => setBulkConfig(c => ({ ...c, mqtt: { ...c.mqtt, connectTimeout: parseInt(e.target.value) || 30000 } }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Notification Tab */}
                <TabsContent value="notification" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Label className="font-medium">{t('mqtt.clientMgmt.enableNotifSection')}</Label>
                    <Switch checked={bulkConfig.notifEnabled} onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notifEnabled: v }))} />
                  </div>
                  {bulkConfig.notifEnabled && (
                    <div className="space-y-4 pl-1">
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.notifEnabled')}</Label>
                        <Switch
                          checked={bulkConfig.notification.enabled}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, enabled: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.notifSound')}</Label>
                        <Switch
                          checked={bulkConfig.notification.sound}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, sound: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.notifVibration')}</Label>
                        <Switch
                          checked={bulkConfig.notification.vibration}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, vibration: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.floatingBubble')}</Label>
                        <Switch
                          checked={bulkConfig.notification.floatingBubbleEnabled}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, floatingBubbleEnabled: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.quietHours')}</Label>
                        <Switch
                          checked={bulkConfig.notification.quietHoursEnabled}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, quietHoursEnabled: v } }))}
                        />
                      </div>
                      {bulkConfig.notification.quietHoursEnabled && (
                        <div className="grid grid-cols-2 gap-4 pl-4">
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.quietStart')}</Label>
                            <Input
                              type="time"
                              value={bulkConfig.notification.quietHoursStart}
                              onChange={(e) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, quietHoursStart: e.target.value } }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.quietEnd')}</Label>
                            <Input
                              type="time"
                              value={bulkConfig.notification.quietHoursEnd}
                              onChange={(e) => setBulkConfig(c => ({ ...c, notification: { ...c.notification, quietHoursEnd: e.target.value } }))}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>

                {/* App Settings Tab */}
                <TabsContent value="app" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Label className="font-medium">{t('mqtt.clientMgmt.enableAppSection')}</Label>
                    <Switch checked={bulkConfig.appEnabled} onCheckedChange={(v) => setBulkConfig(c => ({ ...c, appEnabled: v }))} />
                  </div>
                  {bulkConfig.appEnabled && (
                    <div className="space-y-4 pl-1">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.appLanguage')}</Label>
                          <Select
                            value={bulkConfig.app.language}
                            onValueChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, language: v as 'vi' | 'en' | 'zh' } }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="vi">Tiếng Việt</SelectItem>
                              <SelectItem value="en">English</SelectItem>
                              <SelectItem value="zh">中文</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.appTheme')}</Label>
                          <Select
                            value={bulkConfig.app.theme}
                            onValueChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, theme: v as 'light' | 'dark' | 'system' } }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="dark">Dark</SelectItem>
                              <SelectItem value="light">Light</SelectItem>
                              <SelectItem value="system">System</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.autoReconnect')}</Label>
                        <Switch
                          checked={bulkConfig.app.autoReconnect}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, autoReconnect: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.keepScreenOn')}</Label>
                        <Switch
                          checked={bulkConfig.app.keepScreenOn}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, keepScreenOn: v } }))}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.debugMode')}</Label>
                        <Switch
                          checked={bulkConfig.app.debugMode}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, debugMode: v } }))}
                        />
                      </div>

                      {/* Alert Animation */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <div className="flex items-center justify-between">
                          <Label className="font-medium">{t('mqtt.clientMgmt.alertAnimation')}</Label>
                          <Switch
                            checked={bulkConfig.app.alertAnimationEnabled}
                            onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, alertAnimationEnabled: v } }))}
                          />
                        </div>
                        {bulkConfig.app.alertAnimationEnabled && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>{t('mqtt.clientMgmt.animationType')}</Label>
                              <Select
                                value={bulkConfig.app.alertAnimationType}
                                onValueChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, alertAnimationType: v as 'bomb' | 'alarm' | 'triangle' } }))}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="bomb">Bomb</SelectItem>
                                  <SelectItem value="alarm">Alarm</SelectItem>
                                  <SelectItem value="triangle">Triangle</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>{t('mqtt.clientMgmt.animationDuration')}</Label>
                              <Input
                                type="number"
                                value={bulkConfig.app.alertAnimationDurationSec}
                                onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, alertAnimationDurationSec: parseInt(e.target.value) || 3 } }))}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Proactive Polling */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <div className="flex items-center justify-between">
                          <Label className="font-medium">{t('mqtt.clientMgmt.proactivePolling')}</Label>
                          <Switch
                            checked={bulkConfig.app.proactivePollingEnabled}
                            onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, proactivePollingEnabled: v } }))}
                          />
                        </div>
                        {bulkConfig.app.proactivePollingEnabled && (
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.pollingInterval')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.proactivePollingIntervalSec}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, proactivePollingIntervalSec: parseInt(e.target.value) || 60 } }))}
                            />
                          </div>
                        )}
                      </div>

                      {/* Auto Update */}
                      <div className="flex items-center justify-between">
                        <Label>{t('mqtt.clientMgmt.autoCheckUpdate')}</Label>
                        <Switch
                          checked={bulkConfig.app.autoCheckUpdate}
                          onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, autoCheckUpdate: v } }))}
                        />
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Advanced Tab */}
                <TabsContent value="advanced" className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <Label className="font-medium">{t('mqtt.clientMgmt.enableAdvancedSection')}</Label>
                    <Switch checked={bulkConfig.appEnabled} onCheckedChange={(v) => setBulkConfig(c => ({ ...c, appEnabled: v }))} />
                  </div>
                  {bulkConfig.appEnabled && (
                    <div className="space-y-4 pl-1">
                      {/* NG Settings */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <Label className="font-medium">{t('mqtt.clientMgmt.ngSettings')}</Label>
                        <div className="flex items-center justify-between">
                          <Label>{t('mqtt.clientMgmt.ngAutoClearColor')}</Label>
                          <Switch
                            checked={bulkConfig.app.ngAutoClearColor}
                            onCheckedChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, ngAutoClearColor: v } }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.ngMarkerScale')}</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={bulkConfig.app.ngMarkerScale}
                            onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, ngMarkerScale: parseFloat(e.target.value) || 1.5 } }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.canvasImageMode')}</Label>
                          <Select
                            value={bulkConfig.app.canvasImageMode}
                            onValueChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, canvasImageMode: v as 'fit' | 'fill' | 'cover' } }))}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fit">Fit</SelectItem>
                              <SelectItem value="fill">Fill</SelectItem>
                              <SelectItem value="cover">Cover</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Health Check */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <Label className="font-medium">{t('mqtt.clientMgmt.healthCheck')}</Label>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.healthInterval')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.mqttHealthCheckInterval}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, mqttHealthCheckInterval: parseInt(e.target.value) || 15000 } }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.retryMax')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.mqttRetryMaxAttempts}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, mqttRetryMaxAttempts: parseInt(e.target.value) || 5 } }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.retryInterval')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.mqttRetryInterval}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, mqttRetryInterval: parseInt(e.target.value) || 10000 } }))}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Subscription & Queue */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <Label className="font-medium">{t('mqtt.clientMgmt.subscriptionSettings')}</Label>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.subscriptionMode')}</Label>
                            <Select
                              value={bulkConfig.app.subscriptionMode}
                              onValueChange={(v) => setBulkConfig(c => ({ ...c, app: { ...c.app, subscriptionMode: v as 'manual' | 'hierarchy' } }))}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="manual">Manual</SelectItem>
                                <SelectItem value="hierarchy">Hierarchy</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.maxQueueSize')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.maxQueueSize}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, maxQueueSize: parseInt(e.target.value) || 100 } }))}
                            />
                          </div>
                        </div>
                      </div>

                      {/* NG Timing & Alerts */}
                      <div className="space-y-3 p-3 rounded-lg border">
                        <Label className="font-medium">{t('mqtt.clientMgmt.ngTimingSettings')}</Label>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.ngFlashDurationMs')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.ngFlashDurationMs}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, ngFlashDurationMs: parseInt(e.target.value) || 500 } }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.ngBubbleDismissSec')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.ngBubbleDismissSec}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, ngBubbleDismissSec: parseInt(e.target.value) || 10 } }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t('mqtt.clientMgmt.ngExplosionDismissSec')}</Label>
                            <Input
                              type="number"
                              value={bulkConfig.app.ngExplosionDismissSec}
                              onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, ngExplosionDismissSec: parseInt(e.target.value) || 5 } }))}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>{t('mqtt.clientMgmt.alertRetentionDays')}</Label>
                          <Input
                            type="number"
                            value={bulkConfig.app.alertRetentionDays}
                            onChange={(e) => setBulkConfig(c => ({ ...c, app: { ...c.app, alertRetentionDays: parseInt(e.target.value) || 7 } }))}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t">
              <div className="flex items-center space-x-2 mr-auto">
                <Checkbox
                  id="bulkRestartAfter"
                  checked={bulkConfig.restartAfterConfigure}
                  onCheckedChange={(v) => setBulkConfig(c => ({ ...c, restartAfterConfigure: v as boolean }))}
                />
                <Label htmlFor="bulkRestartAfter" className="text-sm">{t('mqtt.clientMgmt.restartAfterConfigure')}</Label>
              </div>
              <Button variant="outline" onClick={() => { setBulkConfigOpen(false); setSingleConfigClient(null); }}>{t('common.cancel')}</Button>
              <Button
                onClick={handleBulkConfigure}
                disabled={sendBulkConfigureMutation.isPending}
              >
                <Send className="w-4 h-4 mr-2" />
                {sendBulkConfigureMutation.isPending
                  ? t('mqtt.clientMgmt.sending')
                  : singleConfigClient
                    ? t('mqtt.clientMgmt.sendConfigure')
                    : t('mqtt.clientMgmt.applyToDevices', { count: selectedDeviceIds.size })
                }
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

export default function MqttClientManagement() {
  return (
    <DashboardLayout>
      <MqttClientManagementContent />
    </DashboardLayout>
  );
}
