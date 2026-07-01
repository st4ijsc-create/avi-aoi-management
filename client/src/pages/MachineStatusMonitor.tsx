import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { 
  Wifi, WifiOff, Activity, Clock, AlertTriangle, RefreshCw,
  Server, Cpu, HardDrive, Thermometer, TrendingUp, History,
  Download, FileText, Settings2, BarChart3, Calendar, Boxes, Move, Search
} from "lucide-react";
import UptimeTimeline from "@/components/UptimeTimeline";
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
  const { t } = useTranslation();
  const isOnline = machine.latestStatus === 'online';
  const lastSeen = machine.latestHeartbeat 
    ? formatDistanceToNow(new Date(machine.latestHeartbeat), { addSuffix: true, locale: vi })
    : t('machines.noData');

  // Get status color based on uptime and online status
  const getStatusColor = () => {
    if (!isOnline) return { border: 'border-red-500/50', bg: 'bg-red-500/5', pulse: 'bg-red-500' };
    if (machine.uptimePercent >= 95) return { border: 'border-emerald-500/50', bg: 'bg-emerald-500/5', pulse: 'bg-emerald-500' };
    if (machine.uptimePercent >= 80) return { border: 'border-green-500/50', bg: 'bg-green-500/5', pulse: 'bg-green-500' };
    if (machine.uptimePercent >= 60) return { border: 'border-yellow-500/50', bg: 'bg-yellow-500/5', pulse: 'bg-yellow-500' };
    return { border: 'border-orange-500/50', bg: 'bg-orange-500/5', pulse: 'bg-orange-500' };
  };

  const statusColor = getStatusColor();

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-lg ${statusColor.border} ${statusColor.bg}`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative">
              {isOnline ? (
                <>
                  <Wifi className="h-5 w-5 text-emerald-500" />
                  <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ${statusColor.pulse} animate-pulse`} />
                </>
              ) : (
                <WifiOff className="h-5 w-5 text-red-500" />
              )}
            </div>
            <CardTitle className="text-base">{machine.name}</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Badge 
              variant="outline" 
              className={`text-xs ${
                machine.uptimePercent >= 95 ? 'border-emerald-500 text-emerald-600' :
                machine.uptimePercent >= 80 ? 'border-green-500 text-green-600' :
                machine.uptimePercent >= 60 ? 'border-yellow-500 text-yellow-600' :
                'border-orange-500 text-orange-600'
              }`}
            >
              {machine.uptimePercent}%
            </Badge>
            <Badge variant={isOnline ? "default" : "destructive"}>
              {isOnline ? 'Online' : 'Offline'}
            </Badge>
          </div>
        </div>
        <CardDescription className="flex items-center gap-2">
          <span className="font-mono text-xs">{machine.code}</span>
          <Badge variant="outline" className="text-xs">{machine.machineType}</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('machines.uptime24h')}</span>
            <span className="font-medium">{machine.uptimePercent}%</span>
          </div>
          <Progress value={machine.uptimePercent} className="h-2" />
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{t('machines.lastSeen')}: {lastSeen}</span>
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
  const { t } = useTranslation();
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
            <span className="text-sm font-medium">{t('machines.timeRange')}:</span>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t('machines.1hour')}</SelectItem>
                <SelectItem value="6">{t('machines.6hours')}</SelectItem>
                <SelectItem value="24">{t('machines.24hoursShort')}</SelectItem>
                <SelectItem value="72">{t('machines.3days')}</SelectItem>
                <SelectItem value="168">{t('machines.7daysShort')}</SelectItem>
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
              <CardTitle className="text-sm">{t('machines.location')}</CardTitle>
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
                {t('machines.statusHistory')}
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
                      <p className="text-center text-muted-foreground py-4">{t('machines.noData')}</p>
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
                      <p className="text-center text-muted-foreground py-4">{t('machines.noHeartbeatData')}</p>
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
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [selectedMachine, setSelectedMachine] = useState<MachineWithStatus | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterFactory, setFilterFactory] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("machines");
  const [timelineHours, setTimelineHours] = useState<number>(24);
  const [alertConfigOpen, setAlertConfigOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportMachineId, setExportMachineId] = useState<number | null>(null);
  const [exportDateRange, setExportDateRange] = useState({ start: '', end: '' });

  const { data: machines, isLoading, refetch } = trpc.machineStatus.listWithStatus.useQuery();
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: timelines, isLoading: timelinesLoading } = trpc.machineStatus.getAllUptimeTimelines.useQuery(
    { hours: timelineHours },
    { enabled: activeTab === 'timeline' }
  );
  const { data: alertConfig, refetch: refetchAlertConfig } = trpc.machineStatus.getAlertConfig.useQuery();
  const updateAlertConfigMutation = trpc.machineStatus.updateAlertConfig.useMutation({
    onSuccess: () => refetchAlertConfig()
  });
  const { data: exportReport, isLoading: exportLoading } = trpc.machineStatus.getReport.useQuery(
    { machineId: exportMachineId!, startDate: exportDateRange.start, endDate: exportDateRange.end },
    { enabled: !!exportMachineId && !!exportDateRange.start && !!exportDateRange.end }
  );

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
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${m.name} ${m.code} ${m.line?.name ?? ""}`.toLowerCase().includes(q)) return false;
    }
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
    <DashboardLayout title="Machine Status Monitor" navItems={navItems} currentPath="/machine-status">
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={t('machines.statusMonitor')}
          description={t('machines.trackConnectionStatus')}
          actions={
            <>
              <Button variant="outline" onClick={() => setLocation("/factory-live-map")}>
                <Boxes className="h-4 w-4 mr-2" />
                {t('machines.view3dMap', 'Bản đồ 3D')}
              </Button>
              <Button variant="outline" onClick={() => setLocation("/factory-floor-editor")}>
                <Move className="h-4 w-4 mr-2" />
                {t('machines.editLayout', 'Sửa mặt bằng')}
              </Button>
              <Button variant="outline" onClick={() => setAlertConfigOpen(true)}>
                <Settings2 className="h-4 w-4 mr-2" />
                {t('machines.alertConfig')}
              </Button>
              <Button variant="outline" onClick={() => setExportDialogOpen(true)}>
                <Download className="h-4 w-4 mr-2" />
                {t('machines.exportReport')}
              </Button>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('machines.refresh')}
              </Button>
            </>
          }
        />

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-3xl font-bold">{totalMachines}</p>
                  <p className="text-sm text-muted-foreground">{t('machines.totalMachines')}</p>
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

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="machines" className="gap-2">
              <Server className="h-4 w-4" />
              {t('machines.machineList')}
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              {t('machines.uptimeTimeline')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="machines" className="mt-4 space-y-4">
            {/* Filters */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('machines.searchPlaceholder', 'Tìm theo tên / mã / dây chuyền…')}
                  className="pl-8 w-64"
                />
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('common.status')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all')}</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterFactory} onValueChange={setFilterFactory}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={t('machines.factory')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('machines.allFactories')}</SelectItem>
                  {factories?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id.toString()}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(filterStatus !== "all" || filterFactory !== "all" || search.trim() !== "") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilterStatus("all");
                    setFilterFactory("all");
                    setSearch("");
                  }}
                >
                  {t('machines.clearFilters')}
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
                  <p className="text-muted-foreground">{t('machines.noMachinesMatchFilter')}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Uptime Timeline</CardTitle>
                    <CardDescription>{t('machines.uptimeTimelineDescription')}</CardDescription>
                  </div>
                  <Select value={timelineHours.toString()} onValueChange={(v) => setTimelineHours(Number(v))}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">{t('machines.last24hours')}</SelectItem>
                      <SelectItem value="48">{t('machines.last48hours')}</SelectItem>
                      <SelectItem value="72">{t('machines.last72hours')}</SelectItem>
                      <SelectItem value="168">{t('machines.last7days')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {timelinesLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : timelines && timelines.length > 0 ? (
                  <UptimeTimeline data={timelines} hours={timelineHours} />
                ) : (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                  {t('machines.noTimelineData')}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Machine Detail Dialog */}
        <MachineDetailDialog 
          machine={selectedMachine}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />

        {/* Alert Config Dialog */}
        <Dialog open={alertConfigOpen} onOpenChange={setAlertConfigOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('machines.offlineAlertConfig')}</DialogTitle>
              <DialogDescription>
                {t('machines.offlineAlertDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>{t('machines.offlineThresholdMinutes')}</Label>
                <Input
                  type="number"
                  aria-label={t('machines.offlineThresholdMinutes')}
                  min={1}
                  max={60}
                  value={alertConfig?.thresholdMinutes || 5}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (value >= 1 && value <= 60) {
                      updateAlertConfigMutation.mutate({
                        thresholdMinutes: value,
                        isActive: alertConfig?.isActive ?? true
                      });
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {t('machines.offlineThresholdHint')}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>{t('machines.enableAlert')}</Label>
                  <p className="text-xs text-muted-foreground">{t('machines.sendNotificationWhenOffline')}</p>
                </div>
                <Switch
                  checked={alertConfig?.isActive ?? true}
                  onCheckedChange={(checked) => {
                    updateAlertConfigMutation.mutate({
                      thresholdMinutes: alertConfig?.thresholdMinutes || 5,
                      isActive: checked
                    });
                    toast.success(checked ? t('machines.alertEnabled') : t('machines.alertDisabled'));
                  }}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Export Report Dialog */}
        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('machines.exportStatusReport')}</DialogTitle>
              <DialogDescription>
                {t('machines.exportReportDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('machines.selectMachine')}</Label>
                  <Select 
                    value={exportMachineId?.toString() || ''} 
                    onValueChange={(v) => setExportMachineId(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('machines.selectMachinePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {machines?.map((m: MachineWithStatus) => (
                        <SelectItem key={m.id} value={m.id.toString()}>
                          {m.name} ({m.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('machines.fromDate')}</Label>
                  <Input
                    type="date"
                    aria-label={t('machines.fromDate')}
                    value={exportDateRange.start}
                    onChange={(e) => setExportDateRange(prev => ({ ...prev, start: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('machines.toDate')}</Label>
                  <Input
                    type="date"
                    aria-label={t('machines.toDate')}
                    value={exportDateRange.end}
                    onChange={(e) => setExportDateRange(prev => ({ ...prev, end: e.target.value }))}
                  />
                </div>
              </div>

              {exportLoading && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {exportReport && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{exportReport.machine.name}</CardTitle>
                    <CardDescription>
                      {format(new Date(exportReport.period.start), 'dd/MM/yyyy')} - {format(new Date(exportReport.period.end), 'dd/MM/yyyy')}
                      {' '}({exportReport.period.totalHours}h)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <div className="text-center p-3 rounded-lg bg-emerald-500/10">
                        <p className="text-2xl font-bold text-emerald-500">{exportReport.statistics.uptimePercent}%</p>
                        <p className="text-xs text-muted-foreground">Uptime</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted">
                        <p className="text-2xl font-bold">{formatDuration(exportReport.statistics.totalOnlineTime)}</p>
                        <p className="text-xs text-muted-foreground">Online</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-red-500/10">
                        <p className="text-2xl font-bold text-red-500">{exportReport.statistics.offlineCount}</p>
                        <p className="text-xs text-muted-foreground">{t('machines.offlineCount')}</p>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-muted">
                        <p className="text-2xl font-bold">{formatDuration(exportReport.statistics.mtbf)}</p>
                        <p className="text-xs text-muted-foreground">MTBF</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        className="flex-1"
                        onClick={() => {
                          // Export as JSON
                          const blob = new Blob([JSON.stringify(exportReport, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `machine-report-${exportReport.machine.code}-${exportDateRange.start}-${exportDateRange.end}.json`;
                          a.click();
                          URL.revokeObjectURL(url);
                          toast.success(t('machines.reportExported'));
                        }}
                      >
                        <Download className="h-4 w-4 mr-2" />
                        {t('machines.downloadJSON')}
                      </Button>
                      <Button 
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          // Export as CSV
                          const headers = [t('machines.csvTime'), t('common.status'), 'IP'];
                          const rows = exportReport.logs.map((log: any) => [
                            format(new Date(log.timestamp), 'dd/MM/yyyy HH:mm:ss'),
                            log.status,
                            log.ipAddress || ''
                          ]);
                          const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `machine-report-${exportReport.machine.code}-${exportDateRange.start}-${exportDateRange.end}.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                          toast.success(t('machines.reportExported'));
                        }}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {t('machines.downloadCSV')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
