import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { io, Socket } from "socket.io-client";
import {
  Wifi,
  WifiOff,
  Check,
  X,
  Clock,
  Cpu,
  Server,
  RefreshCw,
  AlertTriangle,
  Activity,
  Loader2,
  Link2,
  Unlink
} from "lucide-react";

interface PendingRegistration {
  requestSocketId: string;
  ipAddress: string;
  machineInfo: {
    code: string;
    name: string;
    type: "AVI" | "AOI";
    serialNumber?: string;
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
  };
  timestamp: Date;
  status: "pending" | "approved" | "rejected";
}

interface ConnectedMachine {
  machineId: number;
  socketId: string;
  ipAddress: string;
  lastHeartbeat: Date;
}

interface Machine {
  id: number;
  code: string;
  name: string;
  machineType: string;
  apiKey: string;
}

export default function MachineMapping() {
  const { t } = useTranslation();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
  const [connectedMachines, setConnectedMachines] = useState<ConnectedMachine[]>([]);
  const [selectedRegistration, setSelectedRegistration] = useState<PendingRegistration | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>("");
  const [isApproving, setIsApproving] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);

  // Fetch machines for mapping
  const { data: machines } = trpc.machine.list.useQuery();

  // Connect to WebSocket
  useEffect(() => {
    const socketUrl = window.location.origin;
    const newSocket = io(socketUrl, {
      path: "/api/socket.io",
      transports: ["polling", "websocket"],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 10,
    });

    newSocket.on("connect", () => {
      console.log("[MachineMapping] Connected to WebSocket");
      setIsConnected(true);
      // Join admin room
      newSocket.emit("admin:join");
    });

    newSocket.on("disconnect", () => {
      console.log("[MachineMapping] Disconnected from WebSocket");
      setIsConnected(false);
    });

    // Listen for pending registrations list
    newSocket.on("admin:pending_registrations", (data: PendingRegistration[]) => {
      console.log("[MachineMapping] Received pending registrations:", data);
      setPendingRegistrations(data);
    });

    // Listen for connected machines list
    newSocket.on("admin:connected_machines", (data: ConnectedMachine[]) => {
      console.log("[MachineMapping] Received connected machines:", data);
      setConnectedMachines(data);
    });

    // Listen for new registration requests
    newSocket.on("machine:registration_request", (data: PendingRegistration) => {
      console.log("[MachineMapping] New registration request:", data);
      setPendingRegistrations(prev => [...prev, data]);
      toast.info(t('machines.newRegistrationRequest', { code: data.machineInfo.code }));
    });

    // Listen for machine connected
    newSocket.on("machine:connected", (data: { machineId: number; ipAddress: string; timestamp: Date }) => {
      console.log("[MachineMapping] Machine connected:", data);
      setConnectedMachines(prev => {
        const existing = prev.find(m => m.machineId === data.machineId);
        if (existing) {
          return prev.map(m => m.machineId === data.machineId ? { ...m, ...data, lastHeartbeat: new Date(data.timestamp) } : m);
        }
        return [...prev, { ...data, socketId: "", lastHeartbeat: new Date(data.timestamp) }];
      });
      toast.success(t('machines.machineConnected', { id: data.machineId }));
    });

    // Listen for machine disconnected
    newSocket.on("machine:disconnected", (data: { machineId: number; timestamp: Date }) => {
      console.log("[MachineMapping] Machine disconnected:", data);
      setConnectedMachines(prev => prev.filter(m => m.machineId !== data.machineId));
      toast.warning(t('machines.machineDisconnected', { id: data.machineId }));
    });

    // Listen for machine status updates
    newSocket.on("machine:status_update", (data: { machineId: number; status: string; lastHeartbeat: Date }) => {
      setConnectedMachines(prev => prev.map(m => 
        m.machineId === data.machineId 
          ? { ...m, lastHeartbeat: new Date(data.lastHeartbeat) }
          : m
      ));
    });

    // Listen for approve success from server
    newSocket.on("admin:approve_success", (data: { 
      machineId: number; 
      machineCode: string; 
      machineName: string; 
      apiKey: string; 
      registrationCode: string;
    }) => {
      // Remove from pending list
      setPendingRegistrations(prev => 
        prev.filter(r => r.machineInfo.code !== data.registrationCode)
      );
      setIsApproving(false);
      setApproveDialogOpen(false);
      setSelectedRegistration(null);
      setSelectedMachineId("");
      toast.success(
        t('machines.approvedMapping', { registrationCode: data.registrationCode, machineName: data.machineName, machineCode: data.machineCode })
      );
    });

    // Listen for approve error
    newSocket.on("admin:approve_error", (data: { message: string }) => {
      setIsApproving(false);
      toast.error(t('machines.approveError', { message: data.message }));
    });

    // Listen for machine sync status
    newSocket.on("machine:sync_status", (data: { 
      machineId: number; 
      machineCode: string; 
      status: string; 
      ipAddress: string; 
      timestamp: Date;
    }) => {
      if (data.status === "syncing") {
        toast.success(t('machines.syncStarted', { code: data.machineCode }));
        // Update connected machines list
        setConnectedMachines(prev => {
          const existing = prev.find(m => m.machineId === data.machineId);
          if (existing) {
            return prev.map(m => m.machineId === data.machineId ? { ...m, lastHeartbeat: new Date(data.timestamp) } : m);
          }
          return [...prev, { machineId: data.machineId, socketId: "", ipAddress: data.ipAddress, lastHeartbeat: new Date(data.timestamp) }];
        });
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Handle approve registration
  const handleApprove = useCallback(() => {
    if (!socket || !selectedRegistration || !selectedMachineId) return;

    setIsApproving(true);
    
    // Send approve WITHOUT apiKey - server will generate/fetch it
    socket.emit("admin:approve_registration", {
      socketId: selectedRegistration.requestSocketId,
      machineId: parseInt(selectedMachineId),
    });

    // Don't immediately remove - wait for server confirmation
  }, [socket, selectedRegistration, selectedMachineId]);

  // Handle reject registration
  const handleReject = useCallback(() => {
    if (!socket || !selectedRegistration) return;

    socket.emit("admin:reject_registration", {
      socketId: selectedRegistration.requestSocketId,
      reason: rejectReason || t('machines.defaultRejectReason'),
    });

    // Remove from pending list
    setPendingRegistrations(prev => 
      prev.filter(r => r.requestSocketId !== selectedRegistration.requestSocketId)
    );

    toast.info(t('machines.rejected', { code: selectedRegistration.machineInfo.code }));
    setRejectDialogOpen(false);
    setSelectedRegistration(null);
    setRejectReason("");
  }, [socket, selectedRegistration, rejectReason]);

  // Format time ago
  const formatTimeAgo = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - new Date(date).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return t('common.hoursAgo', { count: hours });
    if (minutes > 0) return t('common.minutesAgo', { count: minutes });
    return t('common.secondsAgo', { count: seconds });
  };

  // Get machine name by ID
  const getMachineName = (machineId: number) => {
    const machine = machines?.find(m => m.id === machineId);
    return machine ? `${machine.name} (${machine.code})` : `Machine #${machineId}`;
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <Wifi className="h-5 w-5 text-green-500" />
              <span className="text-sm text-green-500">{t('machines.wsConnected')}</span>
            </>
          ) : (
            <>
              <WifiOff className="h-5 w-5 text-red-500" />
              <span className="text-sm text-red-500">{t('machines.wsDisconnected')}</span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => socket?.emit("admin:join")}
          disabled={!isConnected}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Registrations */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-yellow-500" />
              {t('machines.pendingRegistrations')}
              {pendingRegistrations.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingRegistrations.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {t('machines.awaitingApproval')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {pendingRegistrations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Server className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('machines.noPendingRegistrations')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingRegistrations.map((reg) => (
                    <div
                      key={reg.requestSocketId}
                      className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-primary" />
                            <span className="font-medium">{reg.machineInfo.code}</span>
                            <Badge variant={reg.machineInfo.type === "AVI" ? "default" : "secondary"}>
                              {reg.machineInfo.type}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{reg.machineInfo.name}</p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>IP: {reg.ipAddress}</span>
                            {reg.machineInfo.manufacturer && (
                              <span>NSX: {reg.machineInfo.manufacturer}</span>
                            )}
                            {reg.machineInfo.model && (
                              <span>Model: {reg.machineInfo.model}</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatTimeAgo(reg.timestamp)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            onClick={() => {
                              setSelectedRegistration(reg);
                              setApproveDialogOpen(true);
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setSelectedRegistration(reg);
                              setRejectDialogOpen(true);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Connected Machines */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              {t('machines.connectedMachines')}
              {connectedMachines.length > 0 && (
                <Badge variant="default" className="ml-2 bg-green-500">
                  {connectedMachines.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {t('machines.activeMachines')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              {connectedMachines.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Unlink className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">{t('machines.noConnectedMachines')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {connectedMachines.map((machine) => (
                    <div
                      key={machine.machineId}
                      className="p-4 rounded-lg border bg-card"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Link2 className="h-4 w-4 text-green-500" />
                            <span className="font-medium">{getMachineName(machine.machineId)}</span>
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              Online
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>IP: {machine.ipAddress}</span>
                            <span>ID: {machine.machineId}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Heartbeat: {formatTimeAgo(machine.lastHeartbeat)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Approve Dialog */}
      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('machines.approveRegistration')}</DialogTitle>
            <DialogDescription>
              {t('machines.selectMachineForMapping')}
            </DialogDescription>
          </DialogHeader>
          {selectedRegistration && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted">
                <h4 className="font-medium mb-2">{t('machines.registrationInfo')}:</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">{t('machines.machineCode')}:</span>
                  <span>{selectedRegistration.machineInfo.code}</span>
                  <span className="text-muted-foreground">{t('machines.machineName')}:</span>
                  <span>{selectedRegistration.machineInfo.name}</span>
                  <span className="text-muted-foreground">{t('common.type')}:</span>
                  <span>{selectedRegistration.machineInfo.type}</span>
                  <span className="text-muted-foreground">IP:</span>
                  <span>{selectedRegistration.ipAddress}</span>
                  {selectedRegistration.machineInfo.manufacturer && (
                    <>
                      <span className="text-muted-foreground">{t('machines.manufacturer')}:</span>
                    </>
                  )}
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('machines.selectSystemMachine')}:</label>
                <Select value={selectedMachineId} onValueChange={setSelectedMachineId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('machines.selectMachinePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {machines?.map((machine) => (
                      <SelectItem key={machine.id} value={machine.id.toString()}>
                        {machine.name} ({machine.code}) - {machine.machineType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!selectedMachineId || isApproving}
              className="bg-green-600 hover:bg-green-700"
            >
              {isApproving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              {t('machines.approve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('machines.rejectRegistration')}</DialogTitle>
            <DialogDescription>
              {t('machines.rejectReasonOptional')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t('machines.rejectReasonPlaceholder')}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
            >
              <X className="h-4 w-4 mr-2" />
              {t('machines.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
