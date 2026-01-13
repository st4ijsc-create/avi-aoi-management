import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Wifi, WifiOff, Activity, Clock, AlertTriangle, RefreshCw,
  Server, Cpu, HardDrive, Thermometer, TrendingUp, History
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

type MachineWithStatus = {
  id: number;
  code: string;
  name: string;
  machineType: string;
  latestStatus: string;
  lastStatusChange: Date | null;
  latestHeartbeat: Date | null;
  heartbeatStatus: string;
  uptimePercent: number;
  totalOnlineTime: number;
  totalOfflineTime: number;
  station: { id: number; name: string; code: string };
  line: { id: number; name: string; code: string };
  workshop: { id: number; name: string; code: string };
  factory: { id: number; name: string; code: string };
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function MachineCard({ machine, onClick }: { machine: MachineWithStatus; onClick: () => void }) {
  const isOnline = machine.latestStatus === 'online';
  const lastSeen = machine.latestHeartbeat 
    ? formatDistanceToNow(new Date(machine.latestHeartbeat), { addSuffix: true, locale: vi })
    : 'Chưa có dữ liệu';

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-lg ${
        isOnline ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-red-500/50 bg-red-500/5'
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="h-5 w-5 text-emerald-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            <CardTitle className="text-base">{machine.name}</CardTitle>
          </div>
          <Badge variant={isOnline ? "default" : "destructive"}>
            {isOnline ? 'Online' : 'Offline'}
          </Badge>
        </div>
        <CardDescription className="flex items-center gap-2">
          <span className="font-mono text-xs">{machine.code}</span>
          <Badge variant="outline" className="text-xs">{machine.machineType}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Uptime (24h)</span>
            <span className="font-medium">{machine.uptimePercent}%</span>
          </div>
          <Progress value={machine.uptimePercent} className="h-2" />
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Last seen: {lastSeen}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Activity className="h-3 w-3" />
              <span>{machine.heartbeatStatus}</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {machine.factory.name} → {machine.workshop.name} → {machine.line.name}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MachineDetailDialog({ 
  machine, 
  open, 
  onOpenChange 
}: { 
  machine: MachineWithStatus | null; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const [timeRange, setTimeRange] = useState("24");
  
  const { data: statusLogs } = trpc.machineStatus.getLogs.useQuery(
    { machineId: machine?.id || 0, limit: 50 },
    { enabled: !!machine }
  );

  const { data: heartbeats } = trpc.machineStatus.getHeartbeats.useQuery(
    { machineId: machine?.id || 0, hours: parseInt(timeRange) },
    { enabled: !!machine }
  );

  const { data: uptimeStats } = trpc.machineStatus.getUptimeStats.useQuery(
    { machineId: machine?.id || 0, hours: parseInt(timeRange) },
    { enabled: !!machine }
  );

  if (!machine) return null;

  const isOnline = machine.latestStatus === 'online';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {isOnline ? (
              <Wifi className="h-6 w-6 text-emerald-500" />
            ) : (
              <WifiOff className="h-6 w-6 text-red-500" />
            )}
            <div>
              <DialogTitle className="text-xl">{machine.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-2">
                <span className="font-mono">{machine.code}</span>
                <Badge variant="outline">{machine.machineType}</Badge>
                <Badge variant={isOnline ? "default" : "destructive"}>
                  {isOnline ? 'Online' : 'Offline'}
                </Badge>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Time Range Selector */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Khoảng thời gian:</span>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 giờ</SelectItem>
                <SelectItem value="6">6 giờ</SelectItem>
                <SelectItem value="24">24 giờ</SelectItem>
                <SelectItem value="72">3 ngày</SelectItem>
                <SelectItem value="168">7 ngày</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Uptime Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-emerald-500" />
                  <div>
                    <p className="text-2xl font-bold">{uptimeStats?.uptimePercent || 0}%</p>
                    <p className="text-xs text-muted-foreground">Uptime</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Wifi className="h-5 w-5 text-emerald-500" />
                  <div>
                    <p className="text-2xl font-bold">{formatDuration(uptimeStats?.totalOnlineTime || 0)}</p>
                    <p className="text-xs text-muted-foreground">Online</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <WifiOff className="h-5 w-5 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold">{formatDuration(uptimeStats?.totalOfflineTime || 0)}</p>
                    <p className="text-xs text-muted-foreground">Offline</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Location Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Vị trí</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span>{machine.factory.name}</span>
                <span className="text-muted-foreground">→</span>
                <span>{machine.workshop.name}</span>
                <span className="text-muted-foreground">→</span>
                <span>{machine.line.name}</span>
                <span className="text-muted-foreground">→</span>
                <span>{machine.station.name}</span>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="status">
            <TabsList>
              <TabsTrigger value="status">
                <History className="h-4 w-4 mr-1" />
                Lịch sử trạng thái
              </TabsTrigger>
              <TabsTrigger value="heartbeat">
                <Activity className="h-4 w-4 mr-1" />
                Heartbeat
              </TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {statusLogs && statusLogs.length > 0 ? (
                      statusLogs.map((log: any) => (
                        <div 
                          key={log.id} 
                          className={`flex items-center justify-between p-2 rounded ${
                            log.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {log.status === 'online' ? (
                              <Wifi className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <WifiOff className="h-4 w-4 text-red-500" />
                            )}
                            <span className="font-medium capitalize">{log.status}</span>
                            {log.ipAddress && (
                              <span className="text-xs text-muted-foreground">({log.ipAddress})</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm:ss', { locale: vi })}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-muted-foreground py-4">Chưa có dữ liệu</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="heartbeat" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {heartbeats && heartbeats.length > 0 ? (
                      heartbeats.map((hb: any) => (
                        <div key={hb.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                          <div className="flex items-center gap-4">
                            <Badge variant="outline" className="capitalize">{hb.status}</Badge>
                            {hb.cpuUsage && (
                              <div className="flex items-center gap-1 text-xs">
                                <Cpu className="h-3 w-3" />
                                <span>{hb.cpuUsage}%</span>
                              </div>
                            )}
                            {hb.memoryUsage && (
                              <div className="flex items-center gap-1 text-xs">
                                <HardDrive className="h-3 w-3" />
                                <span>{hb.memoryUsage}%</span>
                              </div>
                            )}
                            {hb.temperature && (
                              <div className="flex items-center gap-1 text-xs">
                                <Thermometer className="h-3 w-3" />
                                <span>{hb.temperature}°C</span>
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(hb.timestamp), 'HH:mm:ss', { locale: vi })}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-muted-foreground py-4">Chưa có dữ liệu heartbeat</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function MachineStatusMonitor() {
  const [selectedMachine, setSelectedMachine] = useState<MachineWithStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterFactory, setFilterFactory] = useState<string>("all");

  const { data: machines, isLoading, refetch } = trpc.machineStatus.listWithStatus.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  const filteredMachines = machines?.filter((m: MachineWithStatus) => {
    if (filterStatus !== "all" && m.latestStatus !== filterStatus) return false;
    if (filterFactory !== "all" && m.factory.id.toString() !== filterFactory) return false;
    return true;
  }) || [];

  const onlineMachines = machines?.filter((m: MachineWithStatus) => m.latestStatus === 'online').length || 0;
  const offlineMachines = machines?.filter((m: MachineWithStatus) => m.latestStatus === 'offline').length || 0;
  const totalMachines = machines?.length || 0;

  const handleMachineClick = (machine: MachineWithStatus) => {
    setSelectedMachine(machine);
    setDialogOpen(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Machine Status Monitor</h1>
            <p className="text-muted-foreground">Theo dõi trạng thái kết nối của tất cả máy trong hệ thống</p>
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-3xl font-bold">{totalMachines}</p>
                  <p className="text-sm text-muted-foreground">Tổng số máy</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Wifi className="h-8 w-8 text-emerald-500" />
                <div>
                  <p className="text-3xl font-bold text-emerald-500">{onlineMachines}</p>
                  <p className="text-sm text-muted-foreground">Online</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-red-500/50">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <WifiOff className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-3xl font-bold text-red-500">{offlineMachines}</p>
                  <p className="text-sm text-muted-foreground">Offline</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-3xl font-bold">
                    {totalMachines > 0 ? Math.round((onlineMachines / totalMachines) * 100) : 0}%
                  </p>
                  <p className="text-sm text-muted-foreground">Availability</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterFactory} onValueChange={setFilterFactory}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Nhà máy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nhà máy</SelectItem>
              {factories?.map((f: any) => (
                <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(filterStatus !== "all" || filterFactory !== "all") && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => {
                setFilterStatus("all");
                setFilterFactory("all");
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
        </div>

        {/* Machine Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2">
                  <div className="h-5 bg-muted rounded w-3/4"></div>
                  <div className="h-4 bg-muted rounded w-1/2 mt-2"></div>
                </CardHeader>
                <CardContent>
                  <div className="h-2 bg-muted rounded w-full mt-4"></div>
                  <div className="h-4 bg-muted rounded w-2/3 mt-4"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredMachines.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredMachines.map((machine: MachineWithStatus) => (
              <MachineCard 
                key={machine.id} 
                machine={machine} 
                onClick={() => handleMachineClick(machine)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">Không tìm thấy máy nào phù hợp với bộ lọc</p>
            </CardContent>
          </Card>
        )}

        {/* Machine Detail Dialog */}
        <MachineDetailDialog 
          machine={selectedMachine}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      </div>
    </DashboardLayout>
  );
}
