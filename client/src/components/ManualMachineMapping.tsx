import { useState, useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  Plus,
  Pencil,
  Trash2,
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  Network,
  Server,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Plug,
  Unplug
} from "lucide-react";

interface ManualConnection {
  id: number;
  machineId: number;
  ipAddress: string;
  port: number;
  protocol: 'websocket' | 'tcp' | 'http';
  isEnabled: boolean;
  lastConnectionAttempt: Date | null;
  lastSuccessfulConnection: Date | null;
  connectionStatus: 'connected' | 'disconnected' | 'error' | 'pending';
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  retryIntervalSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}

interface Machine {
  id: number;
  code: string;
  name: string;
  machineType: string;
}

export default function ManualMachineMapping() {
  const { t } = useTranslation();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ManualConnection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testingConnectionId, setTestingConnectionId] = useState<number | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    machineId: "",
    ipAddress: "",
    port: "8080",
    protocol: "websocket" as 'websocket' | 'tcp' | 'http',
    isEnabled: true,
    maxRetries: "5",
    retryIntervalSeconds: "30",
  });

  // Fetch data
  const { data: connections, refetch: refetchConnections } = trpc.manualMapping.list.useQuery();
  const { data: machines } = trpc.machine.list.useQuery();

  // Mutations
  const createMutation = trpc.manualMapping.create.useMutation({
    onSuccess: () => {
      toast.success(t('machines.connectionCreated'));
      setCreateDialogOpen(false);
      resetForm();
      refetchConnections();
    },
    onError: (error) => {
      toast.error(mapTrpcError(error));
    },
  });

  const updateMutation = trpc.manualMapping.update.useMutation({
    onSuccess: () => {
      toast.success(t('machines.connectionUpdated'));
      setEditDialogOpen(false);
      setEditingConnection(null);
      refetchConnections();
    },
    onError: (error) => {
      toast.error(mapTrpcError(error));
    },
  });

  const deleteMutation = trpc.manualMapping.delete.useMutation({
    onSuccess: () => {
      toast.success(t('machines.connectionDeleted'));
      refetchConnections();
    },
    onError: (error) => {
      toast.error(mapTrpcError(error));
    },
  });

  const testConnectionMutation = trpc.manualMapping.testConnection.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
      refetchConnections();
    },
    onError: (error) => {
      toast.error(mapTrpcError(error));
    },
    onSettled: () => {
      setTestingConnectionId(null);
    },
  });

  const resetForm = () => {
    setFormData({
      machineId: "",
      ipAddress: "",
      port: "8080",
      protocol: "websocket",
      isEnabled: true,
      maxRetries: "5",
      retryIntervalSeconds: "30",
    });
  };

  const handleCreate = async () => {
    if (!formData.machineId || !formData.ipAddress) {
      toast.error(t('common.fillRequiredInfo'));
      return;
    }

    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        machineId: parseInt(formData.machineId),
        ipAddress: formData.ipAddress,
        port: parseInt(formData.port) || 8080,
        protocol: formData.protocol,
        isEnabled: formData.isEnabled,
        maxRetries: parseInt(formData.maxRetries) || 5,
        retryIntervalSeconds: parseInt(formData.retryIntervalSeconds) || 30,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingConnection) return;

    setIsSubmitting(true);
    try {
      await updateMutation.mutateAsync({
        id: editingConnection.id,
        ipAddress: formData.ipAddress,
        port: parseInt(formData.port) || 8080,
        protocol: formData.protocol,
        isEnabled: formData.isEnabled,
        maxRetries: parseInt(formData.maxRetries) || 5,
        retryIntervalSeconds: parseInt(formData.retryIntervalSeconds) || 30,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (connection: ManualConnection) => {
    setEditingConnection(connection);
    setFormData({
      machineId: connection.machineId.toString(),
      ipAddress: connection.ipAddress,
      port: connection.port.toString(),
      protocol: connection.protocol,
      isEnabled: connection.isEnabled,
      maxRetries: connection.maxRetries.toString(),
      retryIntervalSeconds: connection.retryIntervalSeconds.toString(),
    });
    setEditDialogOpen(true);
  };

  const handleTestConnection = async (id: number) => {
    setTestingConnectionId(id);
    await testConnectionMutation.mutateAsync({ id });
  };

  const getMachineName = (machineId: number) => {
    const machine = machines?.find(m => m.id === machineId);
    return machine ? `${machine.name} (${machine.code})` : `Machine #${machineId}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'connected':
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" /> {t('machines.statusConnected')}</Badge>;
      case 'disconnected':
        return <Badge variant="secondary"><WifiOff className="h-3 w-3 mr-1" /> {t('machines.statusDisconnected')}</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> {t('machines.statusError')}</Badge>;
      case 'pending':
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" /> {t('machines.statusPending')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString("vi-VN");
  };

  // Get machines that don't have manual connections yet
  const availableMachines = machines?.filter(
    m => !connections?.some(c => c.machineId === m.id)
  ) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-primary" />
          <span className="font-medium">{t('machines.manualConnectionConfig')}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetchConnections()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={() => {
            resetForm();
            setCreateDialogOpen(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            {t('machines.addConnection')}
          </Button>
        </div>
      </div>

      {/* Connections Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            {t('machines.manualConnectionList')}
          </CardTitle>
          <CardDescription>
            {t('machines.socketConnectionDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!connections || connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Network className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">{t('machines.noConnections')}</p>
              <p className="text-xs">{t('machines.addConnectionHint')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('machines.machine')}</TableHead>
                  <TableHead>{t('machines.ipAddress')}</TableHead>
                  <TableHead>Port</TableHead>
                  <TableHead>{t('machines.protocol')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('machines.lastConnection')}</TableHead>
                  <TableHead>{t('machines.enableDisable')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((conn) => (
                  <TableRow key={conn.id}>
                    <TableCell className="font-medium">
                      {getMachineName(conn.machineId)}
                    </TableCell>
                    <TableCell>{conn.ipAddress}</TableCell>
                    <TableCell>{conn.port}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">
                        {conn.protocol}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(conn.connectionStatus)}
                      {conn.errorMessage && (
                        <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={conn.errorMessage}>
                          {conn.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(conn.lastSuccessfulConnection)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={conn.isEnabled}
                        onCheckedChange={(checked) => {
                          updateMutation.mutate({
                            id: conn.id,
                            isEnabled: checked,
                          });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTestConnection(conn.id)}
                          disabled={testingConnectionId === conn.id}
                        >
                          {testingConnectionId === conn.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : conn.connectionStatus === 'connected' ? (
                            <Unplug className="h-4 w-4" />
                          ) : (
                            <Plug className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(conn)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('common.confirmDelete')}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('machines.confirmDeleteConnection')}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-500 hover:bg-red-600"
                                onClick={() => deleteMutation.mutate({ id: conn.id })}
                              >
                                {t('common.delete')}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('machines.addManualConnection')}</DialogTitle>
            <DialogDescription>
              {t('machines.socketConnectionDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="machine">{t('machines.selectMachine')}</Label>
              <Select
                value={formData.machineId}
                onValueChange={(v) => setFormData({ ...formData, machineId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('machines.selectMachinePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {availableMachines.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>
                      {m.name} ({m.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ipAddress">{t('machines.ipAddress')}</Label>
                <Input
                  id="ipAddress"
                  placeholder="192.168.1.100"
                  value={formData.ipAddress}
                  onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  placeholder="8080"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="protocol">{t('machines.protocol')}</Label>
              <Select
                value={formData.protocol}
                onValueChange={(v) => setFormData({ ...formData, protocol: v as 'websocket' | 'tcp' | 'http' })}
              >
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="maxRetries">{t('machines.maxRetries')}</Label>
                <Input
                  id="maxRetries"
                  type="number"
                  value={formData.maxRetries}
                  onChange={(e) => setFormData({ ...formData, maxRetries: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="retryInterval">{t('machines.retryInterval')}</Label>
                <Input
                  id="retryInterval"
                  type="number"
                  value={formData.retryIntervalSeconds}
                  onChange={(e) => setFormData({ ...formData, retryIntervalSeconds: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="isEnabled">{t('machines.enableConnection')}</Label>
              <Switch
                id="isEnabled"
                checked={formData.isEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('machines.createConnection')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('machines.editConnection')}</DialogTitle>
            <DialogDescription>
              {t('machines.updateConnectionDesc', { name: editingConnection && getMachineName(editingConnection.machineId) })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editIpAddress">{t('machines.ipAddress')}</Label>
                <Input
                  id="editIpAddress"
                  placeholder="192.168.1.100"
                  value={formData.ipAddress}
                  onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editPort">Port</Label>
                <Input
                  id="editPort"
                  type="number"
                  placeholder="8080"
                  value={formData.port}
                  onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="editProtocol">{t('machines.protocol')}</Label>
              <Select
                value={formData.protocol}
                onValueChange={(v) => setFormData({ ...formData, protocol: v as 'websocket' | 'tcp' | 'http' })}
              >
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="editMaxRetries">{t('machines.maxRetries')}</Label>
                <Input
                  id="editMaxRetries"
                  type="number"
                  value={formData.maxRetries}
                  onChange={(e) => setFormData({ ...formData, maxRetries: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editRetryInterval">{t('machines.retryInterval')}</Label>
                <Input
                  id="editRetryInterval"
                  type="number"
                  value={formData.retryIntervalSeconds}
                  onChange={(e) => setFormData({ ...formData, retryIntervalSeconds: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="editIsEnabled">{t('machines.enableConnection')}</Label>
              <Switch
                id="editIsEnabled"
                checked={formData.isEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('common.update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
